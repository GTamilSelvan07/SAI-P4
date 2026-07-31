"""
Battery autosave + progress endpoints.

Per-scale POST autosaves a single scale's responses; GET /progress returns the
randomised, persisted scale order plus the set of completed scales so a client
can resume into the right scale.

Spec: `docs/superpowers/specs/2026-05-09-questionnaire-battery-integration-design.md`
      §4.2, §4.3, §4.6, §7.

Each scale POST also writes:
- An LSL marker (per-group CSV for intake/debrief; per-session CSV for posttask)
- An EventEntry of type BATTERY_SCALE_SUBMITTED (posttask only — intake/debrief
  have no events.jsonl by design; the JSONL battery rows + the LSL CSV are the
  durable record there).
"""
import json
import logging
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.battery.scale_registry import (
    REGISTRY_VERSION,
    randomise_order,
    scales_for_phase,
)
from app.config import PROJECT_ROOT
from app.database import get_db
from app.logging.lsl_markers import LSLMarkerLogger
from app.models import EventEntry, EventType
from app.session.group_registry import group_registry
from app.session.manager import session_manager

log = logging.getLogger("battery")

router = APIRouter(prefix="/api")


GROUPS_DIR = PROJECT_ROOT / "data" / "groups"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _group_dir(group_id: str) -> Path:
    p = GROUPS_DIR / group_id
    p.mkdir(parents=True, exist_ok=True)
    return p


# ── Order persistence ──────────────────────────────────────────────────────


def _get_or_create_order(
    group_id: str,
    session_id: Optional[str],
    role: str,
    phase: str,
    condition: Optional[str],
) -> tuple[list[str], int]:
    """Return (ordered_scale_ids, seed). On first call for a (group, session?,
    role, phase), generates a random permutation and persists it. Subsequent
    calls return the persisted order verbatim — resume is deterministic."""
    with get_db() as conn:
        if session_id is None:
            row = conn.execute(
                "SELECT ordered_scale_ids, seed FROM battery_orders "
                "WHERE group_id=? AND session_id IS NULL AND role=? AND phase=?",
                (group_id, role, phase),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT ordered_scale_ids, seed FROM battery_orders "
                "WHERE group_id=? AND session_id=? AND role=? AND phase=?",
                (group_id, session_id, role, phase),
            ).fetchone()
        if row:
            return json.loads(row["ordered_scale_ids"]), row["seed"]

        all_ids = scales_for_phase(phase, condition)
        seed = random.randint(0, 2**31 - 1)
        ordered = randomise_order(all_ids, seed)
        conn.execute(
            "INSERT INTO battery_orders "
            "(group_id, session_id, role, phase, ordered_scale_ids, seed, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (group_id, session_id, role, phase, json.dumps(ordered), seed, _utc_now_iso()),
        )
        return ordered, seed


def _completed_scale_ids(
    group_id: str, session_id: Optional[str], role: str, phase: str
) -> set[str]:
    with get_db() as conn:
        if session_id is None:
            rows = conn.execute(
                "SELECT scale_id FROM battery_responses "
                "WHERE group_id=? AND session_id IS NULL AND role=? AND phase=?",
                (group_id, role, phase),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT scale_id FROM battery_responses "
                "WHERE group_id=? AND session_id=? AND role=? AND phase=?",
                (group_id, session_id, role, phase),
            ).fetchall()
    return {r["scale_id"] for r in rows}


def _next_scale(ordered: list[str], completed: set[str]) -> Optional[str]:
    for sid in ordered:
        if sid not in completed:
            return sid
    return None


def _upsert_response(
    group_id: str,
    session_id: Optional[str],
    role: str,
    phase: str,
    scale_id: str,
    responses_json: str,
    duration_ms: Optional[int],
    registry_version: str,
) -> str:
    """UPSERT into battery_responses. Returns submitted_at ISO string."""
    submitted_at = _utc_now_iso()
    with get_db() as conn:
        if session_id is None:
            # Partial unique index uniq_battery_responses_no_session covers the NULL case.
            conn.execute(
                "INSERT INTO battery_responses "
                "(group_id, session_id, role, phase, scale_id, responses_json, "
                " submitted_at, duration_ms, registry_version) "
                "VALUES (?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(group_id, role, phase, scale_id) WHERE session_id IS NULL "
                "DO UPDATE SET responses_json=excluded.responses_json, "
                "  submitted_at=excluded.submitted_at, duration_ms=excluded.duration_ms, "
                "  registry_version=excluded.registry_version",
                (group_id, None, role, phase, scale_id, responses_json,
                 submitted_at, duration_ms, registry_version),
            )
        else:
            conn.execute(
                "INSERT INTO battery_responses "
                "(group_id, session_id, role, phase, scale_id, responses_json, "
                " submitted_at, duration_ms, registry_version) "
                "VALUES (?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(group_id, session_id, role, phase, scale_id) "
                "DO UPDATE SET responses_json=excluded.responses_json, "
                "  submitted_at=excluded.submitted_at, duration_ms=excluded.duration_ms, "
                "  registry_version=excluded.registry_version",
                (group_id, session_id, role, phase, scale_id, responses_json,
                 submitted_at, duration_ms, registry_version),
            )
    return submitted_at


def _append_jsonl(path: Path, record: dict) -> None:
    """Append one JSON line, flush. Mirrors the data-integrity contract used
    by EventLogger / TranscriptLogger."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
        f.flush()


# ── Per-group LSL logger cache ─────────────────────────────────────────────
#
# Group-level intake/debrief markers go to data/groups/{id}/lsl_markers.csv.
# We open one logger per group on first use and reuse it for the rest of the
# process lifetime (cheap; pylsl outlet creation is the only setup work).
_group_lsl_loggers: dict[str, LSLMarkerLogger] = {}


def _group_lsl(group_id: str) -> LSLMarkerLogger:
    logger = _group_lsl_loggers.get(group_id)
    if logger is None:
        logger = LSLMarkerLogger(_group_dir(group_id) / "lsl_markers.csv")
        logger.open()
        _group_lsl_loggers[group_id] = logger
    return logger


def _emit_lsl_intake_or_debrief(
    group_id: str, role: str, phase: str, scale_id: str,
    duration_ms: Optional[int], registry_version: str,
) -> None:
    marker = "intake_scale_submitted" if phase == "intake" else "debrief_scale_submitted"
    detail = json.dumps({
        "role": role, "group_id": group_id, "scale_id": scale_id,
        "duration_ms": duration_ms, "registry_version": registry_version,
    })
    try:
        _group_lsl(group_id).push(marker, detail)
    except Exception as e:
        log.warning(f"[battery] LSL push failed for {group_id}/{scale_id}: {e}")


def _emit_session_markers(
    session_id: str, group_id: str, role: str, condition: Optional[str],
    scale_id: str, duration_ms: Optional[int], registry_version: str,
) -> None:
    """Push a posttask LSL marker + EventEntry. Uses the session's already-
    open loggers when possible (live, started session); otherwise opens the
    session-dir CSV directly. The session_dir is recovered from the in-memory
    ActiveSession when present, else from a glob over data/sessions/."""
    sess = session_manager.get_session(session_id)
    detail = json.dumps({
        "role": role, "session_id": session_id, "group_id": group_id,
        "condition": condition, "scale_id": scale_id,
        "duration_ms": duration_ms, "registry_version": registry_version,
    })

    if sess is not None and sess._started:
        try:
            sess.lsl_logger.push("posttask_scale_submitted", detail)
        except Exception as e:
            log.warning(f"[battery] session LSL push failed: {e}")
        try:
            sess.event_logger.log(EventEntry(
                type=EventType.BATTERY_SCALE_SUBMITTED,
                phase="post_task",
                condition=condition,
                content=scale_id,
                extra={
                    "role": role, "scale_id": scale_id, "duration_ms": duration_ms,
                    "registry_version": registry_version,
                },
            ))
        except Exception as e:
            log.warning(f"[battery] EventEntry log failed: {e}")
        return

    # Session is in-memory but not started, OR fully cold (process restarted).
    # Resolve the session directory deterministically.
    if sess is not None:
        session_dir = sess.session_dir
    else:
        # Glob — session_dir is f"{session_id}_{timestamp}".
        candidates = list((PROJECT_ROOT / "data" / "sessions").glob(f"{session_id}*"))
        session_dir = candidates[0] if candidates else (
            PROJECT_ROOT / "data" / "sessions" / session_id
        )

    fallback = LSLMarkerLogger(session_dir / "lsl_markers.csv")
    try:
        fallback.open()
        fallback.push("posttask_scale_submitted", detail)
    except Exception as e:
        log.warning(f"[battery] fallback session LSL write failed: {e}")
    finally:
        fallback.close()


# ── Group-level battery (intake / debrief) ─────────────────────────────────


class ScaleSubmission(BaseModel):
    responses: dict
    duration_ms: Optional[int] = None
    phase: str  # 'intake' | 'debrief'
    registry_version: str


@router.post("/groups/{group_id}/battery/{role}/{scale_id}")
async def submit_group_scale(
    group_id: str, role: str, scale_id: str, body: ScaleSubmission
):
    if role not in ("P1", "P2"):
        raise HTTPException(400, "role must be P1 or P2")
    if body.phase not in ("intake", "debrief"):
        raise HTTPException(400, "phase must be 'intake' or 'debrief'")
    if body.registry_version != REGISTRY_VERSION:
        raise HTTPException(
            409,
            f"registry mismatch: client {body.registry_version!r} vs server {REGISTRY_VERSION!r}; "
            "client must restart battery from scratch",
        )
    ctx = group_registry.get(group_id)
    if ctx is None:
        raise HTTPException(404, "group not found")
    valid_scales = scales_for_phase(body.phase)
    if scale_id not in valid_scales:
        raise HTTPException(
            400,
            f"scale_id {scale_id!r} not valid for phase {body.phase!r}; "
            f"valid: {sorted(valid_scales)}",
        )

    # Order: JSONL → DB UPSERT → (LSL/WS deferred to step 10).
    fname = f"{body.phase}_{role.lower()}.jsonl"
    record = {
        "scale_id": scale_id,
        "responses": body.responses,
        "duration_ms": body.duration_ms,
        "registry_version": body.registry_version,
        "ts": _utc_now_iso(),
    }
    _append_jsonl(_group_dir(group_id) / fname, record)

    submitted_at = _upsert_response(
        group_id=group_id, session_id=None, role=role, phase=body.phase,
        scale_id=scale_id, responses_json=json.dumps(body.responses),
        duration_ms=body.duration_ms, registry_version=body.registry_version,
    )

    _emit_lsl_intake_or_debrief(
        group_id=group_id, role=role, phase=body.phase, scale_id=scale_id,
        duration_ms=body.duration_ms, registry_version=body.registry_version,
    )

    # Determine completion: did this scale complete the phase for this role?
    ordered, _seed = _get_or_create_order(
        group_id=group_id, session_id=None, role=role, phase=body.phase,
        condition=None,
    )
    completed = _completed_scale_ids(group_id, None, role, body.phase)
    next_id = _next_scale(ordered, completed)
    phase_complete = next_id is None

    if phase_complete:
        if body.phase == "intake":
            ctx = group_registry.mark_intake_done(group_id, role)
        elif body.phase == "debrief":
            ctx = group_registry.mark_debrief_done(group_id, role)

    return {
        "status": "ok",
        "submitted_at": submitted_at,
        "next_scale_id": next_id,
        "phase_complete": phase_complete,
        "group_status": ctx.status,
    }


@router.get("/groups/{group_id}/battery/{role}/progress")
async def get_group_progress(group_id: str, role: str, phase: str):
    if role not in ("P1", "P2"):
        raise HTTPException(400, "role must be P1 or P2")
    if phase not in ("intake", "debrief"):
        raise HTTPException(400, "phase must be 'intake' or 'debrief'")
    if group_registry.get(group_id) is None:
        raise HTTPException(404, "group not found")
    ordered, seed = _get_or_create_order(
        group_id=group_id, session_id=None, role=role, phase=phase, condition=None,
    )
    completed = _completed_scale_ids(group_id, None, role, phase)
    return {
        "phase": phase,
        "ordered_scale_ids": ordered,
        "completed_scale_ids": sorted(completed),
        "next_scale_id": _next_scale(ordered, completed),
        "registry_version": REGISTRY_VERSION,
        "seed": seed,
    }


# ── Session-level battery (post-task) ──────────────────────────────────────


class PostTaskSubmission(BaseModel):
    responses: dict
    duration_ms: Optional[int] = None
    registry_version: str


@router.post("/sessions/{session_id}/posttask/{role}/{scale_id}")
async def submit_posttask_scale(
    session_id: str, role: str, scale_id: str, body: PostTaskSubmission
):
    if role not in ("P1", "P2"):
        raise HTTPException(400, "role must be P1 or P2")
    if body.registry_version != REGISTRY_VERSION:
        raise HTTPException(
            409,
            f"registry mismatch: client {body.registry_version!r} vs server {REGISTRY_VERSION!r}",
        )
    session = session_manager.get_session(session_id)
    if session is None:
        # Sessions that exist in the DB but are no longer in the in-memory
        # active set (e.g. process restart) can still receive posttask
        # submissions — the session_id is the only required key.
        with get_db() as conn:
            row = conn.execute(
                "SELECT session_id, group_id, condition FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        if not row:
            raise HTTPException(404, "session not found")
        group_id = row["group_id"]
        condition = row["condition"]
        session_dir = None
    else:
        group_id = session.group_id
        condition = session.meta.conditions[0]
        session_dir = session.session_dir

    valid_scales = scales_for_phase("posttask", condition)
    if scale_id not in valid_scales:
        raise HTTPException(
            400,
            f"scale_id {scale_id!r} not valid for posttask in condition {condition!r}; "
            f"valid: {sorted(valid_scales)}",
        )

    record = {
        "scale_id": scale_id,
        "responses": body.responses,
        "duration_ms": body.duration_ms,
        "registry_version": body.registry_version,
        "condition": condition,
        "ts": _utc_now_iso(),
    }
    target_dir = session_dir if session_dir is not None else (
        PROJECT_ROOT / "data" / "sessions" / session_id
    )
    _append_jsonl(target_dir / f"posttask_{role.lower()}.jsonl", record)

    submitted_at = _upsert_response(
        group_id=group_id, session_id=session_id, role=role, phase="posttask",
        scale_id=scale_id, responses_json=json.dumps(body.responses),
        duration_ms=body.duration_ms, registry_version=body.registry_version,
    )

    _emit_session_markers(
        session_id=session_id, group_id=group_id, role=role, condition=condition,
        scale_id=scale_id, duration_ms=body.duration_ms,
        registry_version=body.registry_version,
    )

    ordered, _seed = _get_or_create_order(
        group_id=group_id, session_id=session_id, role=role, phase="posttask",
        condition=condition,
    )
    completed = _completed_scale_ids(group_id, session_id, role, "posttask")
    next_id = _next_scale(ordered, completed)

    return {
        "status": "ok",
        "submitted_at": submitted_at,
        "next_scale_id": next_id,
        "phase_complete": next_id is None,
    }


@router.get("/sessions/{session_id}/posttask/{role}/progress")
async def get_posttask_progress(session_id: str, role: str):
    if role not in ("P1", "P2"):
        raise HTTPException(400, "role must be P1 or P2")
    session = session_manager.get_session(session_id)
    if session is None:
        with get_db() as conn:
            row = conn.execute(
                "SELECT group_id, condition FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        if not row:
            raise HTTPException(404, "session not found")
        group_id = row["group_id"]
        condition = row["condition"]
    else:
        group_id = session.group_id
        condition = session.meta.conditions[0]

    ordered, seed = _get_or_create_order(
        group_id=group_id, session_id=session_id, role=role, phase="posttask",
        condition=condition,
    )
    completed = _completed_scale_ids(group_id, session_id, role, "posttask")
    return {
        "phase": "posttask",
        "condition": condition,
        "ordered_scale_ids": ordered,
        "completed_scale_ids": sorted(completed),
        "next_scale_id": _next_scale(ordered, completed),
        "registry_version": REGISTRY_VERSION,
        "seed": seed,
    }
