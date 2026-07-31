"""
Group registry — lifecycle management for participant dyads (groups).

A "group" is a P1+P2 pair that completes intake once and then runs N sessions.
This registry mirrors the orchestrator_registry pattern but is DB-backed: SQLite
is the source of truth (durable across restarts), the registry just provides a
typed Python interface so route handlers don't write raw SQL.

Status lifecycle:
    pending  → demographics + intake not yet complete for either P1 or P2
    ready    → both participants finished intake; can create sessions
    active   → at least one session has been created
    completed → researcher clicked "End Group"; debrief done
    aborted  → researcher aborted; no debrief

See `docs/superpowers/specs/2026-05-09-questionnaire-battery-integration-design.md` §4.5.
"""
import json
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from app.database import get_db

log = logging.getLogger(__name__)


GroupStatus = str  # 'pending' | 'ready' | 'active' | 'completed' | 'aborted'


def _utc_now_iso() -> str:
    """ISO-8601 UTC timestamp with 'Z' suffix; matches battery row format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class GroupContext:
    """A snapshot of one group's state. Always loaded fresh from the DB."""
    group_id: str
    status: GroupStatus
    created_at: float
    p1_label: Optional[str]
    p2_label: Optional[str]
    p1_intake_done_at: Optional[str]
    p2_intake_done_at: Optional[str]
    p1_debrief_done_at: Optional[str]
    p2_debrief_done_at: Optional[str]
    notes: Optional[str]
    metadata: dict
    session_ids: list[str]
    last_active_session_id: Optional[str]

    @property
    def is_ready(self) -> bool:
        return self.status == "ready"

    @property
    def both_intakes_done(self) -> bool:
        return self.p1_intake_done_at is not None and self.p2_intake_done_at is not None

    @property
    def both_debriefs_done(self) -> bool:
        return self.p1_debrief_done_at is not None and self.p2_debrief_done_at is not None

    def to_dict(self) -> dict:
        return {
            "group_id": self.group_id,
            "status": self.status,
            "created_at": self.created_at,
            "p1_label": self.p1_label,
            "p2_label": self.p2_label,
            "p1_intake_done": self.p1_intake_done_at is not None,
            "p2_intake_done": self.p2_intake_done_at is not None,
            "p1_intake_done_at": self.p1_intake_done_at,
            "p2_intake_done_at": self.p2_intake_done_at,
            "p1_debrief_done_at": self.p1_debrief_done_at,
            "p2_debrief_done_at": self.p2_debrief_done_at,
            "notes": self.notes,
            "metadata": self.metadata,
            "session_ids": self.session_ids,
            "last_active_session_id": self.last_active_session_id,
        }


class GroupRegistry:
    """DB-backed registry for participant groups.

    No long-lived in-memory state — every method round-trips to SQLite so
    values stay correct across processes and restarts. The session_manager
    legacy path (`INSERT OR IGNORE INTO groups (group_id, conditions, created_at)`)
    creates rows with `status = 'pending'` (the column default); those rows
    can co-exist with new-flow rows without conflict.
    """

    # ── Create / read ──────────────────────────────────────────────────────

    def create(
        self,
        group_id: Optional[str] = None,
        p1_label: Optional[str] = None,
        p2_label: Optional[str] = None,
        notes: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> GroupContext:
        """Create a new group in 'pending' state. `group_id` auto-assigned if omitted."""
        gid = group_id or self._next_group_id()
        meta_json = json.dumps(metadata or {})
        with get_db() as conn:
            existing = conn.execute(
                "SELECT 1 FROM groups WHERE group_id = ?", (gid,)
            ).fetchone()
            if existing:
                raise ValueError(f"group {gid!r} already exists")
            conn.execute(
                "INSERT INTO groups "
                "(group_id, conditions, created_at, status, p1_label, p2_label, notes, metadata_json) "
                "VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)",
                (gid, json.dumps([]), time.time(), p1_label, p2_label, notes, meta_json),
            )
        log.info(f"[group] created {gid}")
        ctx = self.get(gid)
        assert ctx is not None
        return ctx

    def get(self, group_id: str) -> Optional[GroupContext]:
        with get_db() as conn:
            row = conn.execute(
                "SELECT group_id, conditions, created_at, status, p1_label, p2_label, "
                "p1_intake_done_at, p2_intake_done_at, "
                "p1_debrief_done_at, p2_debrief_done_at, notes, metadata_json "
                "FROM groups WHERE group_id = ?",
                (group_id,),
            ).fetchone()
            if not row:
                return None
            sessions = conn.execute(
                "SELECT session_id FROM sessions WHERE group_id = ? "
                "ORDER BY created_at ASC",
                (group_id,),
            ).fetchall()
            last_active = conn.execute(
                "SELECT session_id FROM sessions WHERE group_id = ? "
                "ORDER BY created_at DESC LIMIT 1",
                (group_id,),
            ).fetchone()
        try:
            metadata = json.loads(row["metadata_json"]) if row["metadata_json"] else {}
        except json.JSONDecodeError:
            metadata = {}
        return GroupContext(
            group_id=row["group_id"],
            status=row["status"] or "pending",
            created_at=row["created_at"],
            p1_label=row["p1_label"],
            p2_label=row["p2_label"],
            p1_intake_done_at=row["p1_intake_done_at"],
            p2_intake_done_at=row["p2_intake_done_at"],
            p1_debrief_done_at=row["p1_debrief_done_at"],
            p2_debrief_done_at=row["p2_debrief_done_at"],
            notes=row["notes"],
            metadata=metadata,
            session_ids=[r["session_id"] for r in sessions],
            last_active_session_id=last_active["session_id"] if last_active else None,
        )

    def list(self, status: Optional[str] = None) -> list[GroupContext]:
        with get_db() as conn:
            if status and status != "all":
                rows = conn.execute(
                    "SELECT group_id FROM groups WHERE status = ? ORDER BY created_at DESC",
                    (status,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT group_id FROM groups ORDER BY created_at DESC"
                ).fetchall()
        out = []
        for r in rows:
            ctx = self.get(r["group_id"])
            if ctx:
                out.append(ctx)
        return out

    # ── Mutations ──────────────────────────────────────────────────────────

    def mark_intake_done(self, group_id: str, role: str) -> GroupContext:
        """Stamp intake completion for one role; flip status to 'ready' when both done."""
        if role not in ("P1", "P2"):
            raise ValueError(f"invalid role: {role!r}")
        col = "p1_intake_done_at" if role == "P1" else "p2_intake_done_at"
        ts = _utc_now_iso()
        with get_db() as conn:
            conn.execute(
                f"UPDATE groups SET {col} = COALESCE({col}, ?) WHERE group_id = ?",
                (ts, group_id),
            )
        ctx = self.get(group_id)
        if ctx is None:
            raise KeyError(f"group {group_id!r} not found")
        if ctx.both_intakes_done and ctx.status == "pending":
            with get_db() as conn:
                conn.execute(
                    "UPDATE groups SET status = 'ready' WHERE group_id = ? AND status = 'pending'",
                    (group_id,),
                )
            ctx = self.get(group_id)
            assert ctx is not None
            log.info(f"[group] {group_id} → ready")
        return ctx

    def mark_debrief_done(self, group_id: str, role: str) -> GroupContext:
        if role not in ("P1", "P2"):
            raise ValueError(f"invalid role: {role!r}")
        col = "p1_debrief_done_at" if role == "P1" else "p2_debrief_done_at"
        ts = _utc_now_iso()
        with get_db() as conn:
            conn.execute(
                f"UPDATE groups SET {col} = COALESCE({col}, ?) WHERE group_id = ?",
                (ts, group_id),
            )
        ctx = self.get(group_id)
        if ctx is None:
            raise KeyError(f"group {group_id!r} not found")
        return ctx

    def transition_to_active(self, group_id: str) -> GroupContext:
        """Called when the first session is created for a group."""
        with get_db() as conn:
            conn.execute(
                "UPDATE groups SET status = 'active' WHERE group_id = ? AND status = 'ready'",
                (group_id,),
            )
        ctx = self.get(group_id)
        if ctx is None:
            raise KeyError(f"group {group_id!r} not found")
        return ctx

    def end_group(self, group_id: str) -> tuple[GroupContext, Optional[str]]:
        """Mark the group 'completed' and return (ctx, last_session_id) so the
        caller can push DEBRIEF onto that session.

        Returns (ctx, None) if the group has no sessions yet.
        """
        ctx = self.get(group_id)
        if ctx is None:
            raise KeyError(f"group {group_id!r} not found")
        if ctx.status in ("completed", "aborted"):
            return ctx, ctx.last_active_session_id
        with get_db() as conn:
            conn.execute(
                "UPDATE groups SET status = 'completed' WHERE group_id = ?",
                (group_id,),
            )
        ctx = self.get(group_id)
        assert ctx is not None
        log.info(
            f"[group] {group_id} → completed (last_session={ctx.last_active_session_id})"
        )
        return ctx, ctx.last_active_session_id

    def abort(self, group_id: str, reason: Optional[str] = None) -> GroupContext:
        """Mark the group aborted. No debrief fires."""
        with get_db() as conn:
            if reason:
                conn.execute(
                    "UPDATE groups SET status = 'aborted', "
                    "notes = COALESCE(notes, '') || ? WHERE group_id = ?",
                    (f"\n[abort] {_utc_now_iso()}: {reason}", group_id),
                )
            else:
                conn.execute(
                    "UPDATE groups SET status = 'aborted' WHERE group_id = ?",
                    (group_id,),
                )
        ctx = self.get(group_id)
        if ctx is None:
            raise KeyError(f"group {group_id!r} not found")
        log.info(f"[group] {group_id} → aborted ({reason or 'no reason given'})")
        return ctx

    # ── Helpers ────────────────────────────────────────────────────────────

    def __contains__(self, group_id: str) -> bool:
        with get_db() as conn:
            return conn.execute(
                "SELECT 1 FROM groups WHERE group_id = ?", (group_id,)
            ).fetchone() is not None

    def _next_group_id(self) -> str:
        """Stable, sortable id like `g_2026_05_09_<uuid8>`."""
        date = datetime.now(timezone.utc).strftime("%Y_%m_%d")
        suffix = uuid.uuid4().hex[:8]
        return f"g_{date}_{suffix}"


# Global singleton — mirrors orchestrator_registry export style.
group_registry = GroupRegistry()
