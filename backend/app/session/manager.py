"""
Session manager. Creates sessions, manages data directories, coordinates loggers.
"""
import hashlib
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Optional

from app.config import DATA_DIR, Condition, SessionMode, config

log = logging.getLogger(__name__)
from app.models import SessionMeta, EventEntry, EventType, ParticipantInfo
from app.logging.events import EventLogger
from app.logging.transcript import TranscriptLogger
from app.logging.lsl_markers import LSLMarkerLogger
from app.session.bibd import (
    assign_anchoring_direction,
    assign_amplification_target,
)
from app.session.state_machine import SessionStateMachine
from app.database import get_db


class SessionManager:
    """Manages active experiment sessions."""

    def __init__(self):
        self._active_sessions: dict[str, "ActiveSession"] = {}

    def create_session(
        self,
        group_number: int,
        mode: str,
        condition: str,
        task_id: str,
    ) -> "ActiveSession":
        """Create a new single-condition session (1 task, 1 condition, 7 phases)."""
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        group_id = f"g{group_number:03d}"
        return self._create_single_condition(
            group_number, group_id, timestamp, mode, condition, task_id,
        )

    def _create_single_condition(
        self,
        group_number: int,
        group_id: str,
        timestamp: str,
        mode: str,
        condition_code: str,
        task_id: str,
    ) -> "ActiveSession":
        """Create a single-condition session (1 block)."""
        cond = Condition(condition_code)
        session_id = f"{group_number}_{condition_code}"

        # Anchoring direction for C3
        anchoring_dir = None
        if cond == Condition.C3_ANCHORING:
            anchoring_dir = assign_anchoring_direction(group_number)
        amplification_target = None
        if cond == Condition.C4_AMPLIFICATION:
            amplification_target = assign_amplification_target(group_number)

        session_dir = DATA_DIR / f"{session_id}_{timestamp}"
        session_dir.mkdir(parents=True, exist_ok=True)

        meta = SessionMeta(
            session_id=session_id,
            group_id=group_id,
            mode=mode,
            conditions=[condition_code],
            task_order=[task_id],
            condition_task_map={condition_code: task_id},
            anchoring_direction=anchoring_dir,
            amplification_target=amplification_target,
            model=config.ollama.model,
        )

        meta_path = session_dir / "session_meta.json"
        meta_path.write_text(meta.model_dump_json(indent=2))

        with get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO groups (group_id, conditions, created_at) VALUES (?, ?, ?)",
                (group_id, json.dumps([condition_code]), time.time()),
            )
            conn.execute(
                """INSERT OR REPLACE INTO sessions
                   (session_id, group_id, block_number, condition, task_id, status, created_at, model, anchoring_direction)
                   VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)""",
                (session_id, group_id, 1, condition_code, task_id, time.time(),
                 config.ollama.model, anchoring_dir),
            )

        active = ActiveSession(
            session_id=session_id,
            group_id=group_id,
            group_number=group_number,
            session_dir=session_dir,
            meta=meta,
            conditions=[cond],
            task_order=[task_id],
        )
        if amplification_target:
            active.amplification_target = amplification_target
        self._active_sessions[session_id] = active
        return active

    def create_session_for_group(
        self,
        group_id: str,
        mode: str,
        condition: str,
        task_id: str,
    ) -> "ActiveSession":
        """Create a session bound to a string-id group (the new group lifecycle).

        The legacy `create_session(group_number=int, ...)` path is kept for the
        deprecated /api/sessions endpoint and for any tests. New callers
        (routes/groups.py POST /api/groups/{id}/sessions) should use this one —
        it skips the f"g{n:03d}" auto-id rewrite and the post-create UPDATE
        sessions hack.
        """
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        cond = Condition(condition)
        # Stable 31-bit seed derived from group_id, used by the bibd helpers
        # which still take an int. MD5 is fine here — non-cryptographic seed.
        seed = int.from_bytes(
            hashlib.md5(group_id.encode("utf-8")).digest()[:4], "big",
        ) & 0x7FFFFFFF

        anchoring_dir = None
        if cond == Condition.C3_ANCHORING:
            anchoring_dir = assign_anchoring_direction(seed)
        amplification_target = None
        if cond == Condition.C4_AMPLIFICATION:
            amplification_target = assign_amplification_target(seed)

        # Compose a session_id that includes a count of existing sessions in the
        # group so multiple sessions per group don't collide.
        with get_db() as conn:
            existing_n = conn.execute(
                "SELECT COUNT(*) FROM sessions WHERE group_id = ?", (group_id,),
            ).fetchone()[0]
        session_id = f"{group_id}_{condition}_{existing_n + 1}"

        session_dir = DATA_DIR / f"{session_id}_{timestamp}"
        session_dir.mkdir(parents=True, exist_ok=True)

        meta = SessionMeta(
            session_id=session_id,
            group_id=group_id,
            mode=mode,
            conditions=[condition],
            task_order=[task_id],
            condition_task_map={condition: task_id},
            anchoring_direction=anchoring_dir,
            amplification_target=amplification_target,
            model=config.ollama.model,
        )
        (session_dir / "session_meta.json").write_text(meta.model_dump_json(indent=2))

        with get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO groups (group_id, conditions, created_at, status) "
                "VALUES (?, ?, ?, 'pending')",
                (group_id, json.dumps([condition]), time.time()),
            )
            conn.execute(
                "INSERT OR REPLACE INTO sessions "
                "(session_id, group_id, block_number, condition, task_id, status, "
                " created_at, model, anchoring_direction) "
                "VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
                (session_id, group_id, 1, condition, task_id, time.time(),
                 config.ollama.model, anchoring_dir),
            )

        active = ActiveSession(
            session_id=session_id,
            group_id=group_id,
            group_number=seed,
            session_dir=session_dir,
            meta=meta,
            conditions=[cond],
            task_order=[task_id],
        )
        # Override the seed-derived amplification target with one tied to group_id.
        if amplification_target:
            active.amplification_target = amplification_target
        self._active_sessions[session_id] = active
        return active

    def get_session(self, session_id: str) -> Optional["ActiveSession"]:
        return self._active_sessions.get(session_id)

    def list_sessions(self) -> list[str]:
        return list(self._active_sessions.keys())


class ActiveSession:
    """A live experiment session with all its loggers and state."""

    def __init__(
        self,
        session_id: str,
        group_id: str,
        group_number: int,
        session_dir: Path,
        meta: SessionMeta,
        conditions: list[Condition],
        task_order: list[str],
    ):
        self.session_id = session_id
        self.group_id = group_id
        self.group_number = group_number
        self.session_dir = session_dir
        self.meta = meta

        # Loggers
        self.event_logger = EventLogger(session_dir / "events.jsonl")
        self.transcript_logger = TranscriptLogger(session_dir / "transcript.jsonl")
        self.lsl_logger = LSLMarkerLogger(session_dir / "lsl_markers.csv")

        # State machine — set by orchestrator on start
        self.state_machine: Optional[SessionStateMachine] = None

        # Amplification target for C4 only. Stored in metadata so the dashboard,
        # scripted bundles, and logs can agree on the same participant target.
        self.amplification_target = meta.amplification_target or ""

        # Initial preference and decision vote tracking
        self.preferences: dict[str, str] = {}
        self.votes: dict[str, str] = {}

        # Survey submission tracking (role -> True when submitted)
        self.surveys: dict[str, bool] = {}

        self._started = False

    def start(self) -> None:
        """Open all loggers and start the session."""
        self.event_logger.open()
        self.transcript_logger.open()
        self.lsl_logger.open()

        self.event_logger.log(EventEntry(
            type=EventType.SESSION_START,
            extra={"group_id": self.group_id, "conditions": self.meta.conditions},
        ))
        self.lsl_logger.push("session_start", self.session_id)

        self._started = True

    def stop(self, reason: str = "normal") -> None:
        """End the session and close all loggers."""
        if self._started:
            try:
                self.event_logger.log(EventEntry(
                    type=EventType.SESSION_END,
                    extra={"reason": reason},
                ))
                self.lsl_logger.push("session_end", reason)
            except Exception as e:
                log.debug(f"Error logging session end: {e}")
        self.event_logger.close()
        self.transcript_logger.close()
        self.lsl_logger.close()
        # Update DB row so dashboards/reports can distinguish ended from in-progress sessions.
        # JSONL remains the source of truth; this is just a status flag for queries.
        try:
            with get_db() as conn:
                conn.execute(
                    "UPDATE sessions SET status = ? WHERE session_id = ?",
                    (reason, self.session_id),
                )
        except Exception as e:
            log.debug(f"Error updating session status in DB: {e}")
        self._started = False

    def emergency_stop(self, reason: str) -> None:
        """Emergency stop — logs and closes everything."""
        if self._started:
            try:
                self.event_logger.log(EventEntry(
                    type=EventType.EMERGENCY_STOP,
                    extra={"reason": reason},
                ))
                self.lsl_logger.push("emergency_stop", reason)
            except Exception as e:
                log.debug(f"Error logging emergency stop: {e}")
        self.stop(reason=f"emergency: {reason}")


# Global session manager instance
session_manager = SessionManager()
