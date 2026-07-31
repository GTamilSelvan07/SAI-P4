"""
Group lifecycle + demographics endpoints.

Spec: `docs/superpowers/specs/2026-05-09-questionnaire-battery-integration-design.md` §4.2.
"""
import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import Condition, PROJECT_ROOT
from app.database import get_db
from app.routes.sessions import verify_researcher
from app.session.group_registry import group_registry
from app.session.manager import session_manager
from app.tasks import task_registry

log = logging.getLogger("groups")

router = APIRouter(prefix="/api")

# Group-level data tree (separate from `data/sessions/`).
GROUPS_DIR = PROJECT_ROOT / "data" / "groups"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _group_dir(group_id: str) -> Path:
    """Lazily create + return data/groups/{group_id}/ for JSONL writes."""
    p = GROUPS_DIR / group_id
    p.mkdir(parents=True, exist_ok=True)
    return p


# ── Group lifecycle ────────────────────────────────────────────────────────


class CreateGroupRequest(BaseModel):
    p1_label: Optional[str] = None
    p2_label: Optional[str] = None
    notes: Optional[str] = None
    metadata: Optional[dict] = None


class EnsureD0GroupRequest(BaseModel):
    group_id: str


def _normalise_d0_group_id(group_id: str) -> tuple[str, str]:
    d0_id = group_id.strip()
    if not d0_id.lower().endswith("_d0"):
        raise HTTPException(400, "D0 group id must end with _D0, for example 1_D0")
    base = d0_id[:-3]
    if not base.isdigit():
        raise HTTPException(400, "D0 group id must use the numeric researcher ID, for example 1_D0")
    return f"g{int(base):03d}", f"{int(base)}_D0"


@router.post("/groups", dependencies=[Depends(verify_researcher)])
async def create_group(req: CreateGroupRequest):
    """Create a new participant group in 'pending' state."""
    ctx = group_registry.create(
        p1_label=req.p1_label,
        p2_label=req.p2_label,
        notes=req.notes,
        metadata=req.metadata,
    )
    meta_path = _group_dir(ctx.group_id) / "group_meta.json"
    meta_path.write_text(json.dumps(ctx.to_dict(), indent=2, default=str))
    return {
        "group_id": ctx.group_id,
        "status": ctx.status,
        "p1_join_url": f"/group/{ctx.group_id}/P1",
        "p2_join_url": f"/group/{ctx.group_id}/P2",
    }


@router.post("/groups/d0/ensure", dependencies=[Depends(verify_researcher)])
async def ensure_d0_group(req: EnsureD0GroupRequest):
    """Create a D0 one-time intake group if it does not already exist.

    This supports the simple participant flow where the participant enters an
    ID such as `1_D0` in the same join box used for task sessions. The public
    D0 ID maps to the same durable group id used by task sessions: 1_D0 → g001.
    """
    group_id, d0_id = _normalise_d0_group_id(req.group_id)
    ctx = group_registry.get(group_id)
    if ctx is None:
        try:
            ctx = group_registry.create(
                group_id=group_id,
                notes="D0 one-time demographics + pre-task intake",
                metadata={"kind": "D0", "d0_id": d0_id},
            )
        except ValueError:
            ctx = group_registry.get(group_id)
    if ctx is None:
        raise HTTPException(500, "failed to create D0 group")
    metadata = dict(ctx.metadata or {})
    if metadata.get("d0_id") != d0_id:
        metadata["kind"] = "D0"
        metadata["d0_id"] = d0_id
        with get_db() as conn:
            conn.execute(
                "UPDATE groups SET metadata_json = ? WHERE group_id = ?",
                (json.dumps(metadata), group_id),
            )
        ctx = group_registry.get(group_id)
        if ctx is None:
            raise HTTPException(500, "failed to reload D0 group")
    meta_path = _group_dir(ctx.group_id) / "group_meta.json"
    meta_path.write_text(json.dumps(ctx.to_dict(), indent=2, default=str))
    return {**ctx.to_dict(), "d0_id": d0_id}


@router.get("/groups")
async def list_groups(status: str = "all"):
    """List groups; optional status filter ('pending'|'ready'|'active'|'completed'|'aborted'|'all')."""
    return [g.to_dict() for g in group_registry.list(status=status)]


@router.get("/groups/{group_id}")
async def get_group(group_id: str):
    ctx = group_registry.get(group_id)
    if ctx is None:
        raise HTTPException(404, "group not found")
    return ctx.to_dict()


@router.post("/groups/{group_id}/end", dependencies=[Depends(verify_researcher)])
async def end_group(group_id: str):
    """Mark group completed; returns the session_id that should run debrief."""
    ctx = group_registry.get(group_id)
    if ctx is None:
        raise HTTPException(404, "group not found")
    if ctx.status == "aborted":
        raise HTTPException(409, "group is aborted; cannot end")
    ctx, last_session_id = group_registry.end_group(group_id)
    return {
        "group_id": ctx.group_id,
        "status": ctx.status,
        "last_session_id": last_session_id,
        "debrief_pending": last_session_id is not None,
    }


class AbortGroupRequest(BaseModel):
    reason: Optional[str] = None


@router.post("/groups/{group_id}/abort", dependencies=[Depends(verify_researcher)])
async def abort_group(group_id: str, req: AbortGroupRequest):
    if group_registry.get(group_id) is None:
        raise HTTPException(404, "group not found")
    ctx = group_registry.abort(group_id, reason=req.reason)
    return ctx.to_dict()


@router.delete("/groups/{group_id}", dependencies=[Depends(verify_researcher)])
async def delete_group(group_id: str):
    """Delete an unused questionnaire/group record.

    Refuses to delete groups that already have sessions so experiment data is
    not orphaned or lost from the researcher dashboard.
    """
    if group_registry.get(group_id) is None:
        raise HTTPException(404, "group not found")

    with get_db() as conn:
        session_count = conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE group_id = ?",
            (group_id,),
        ).fetchone()[0]
        if session_count:
            raise HTTPException(409, "cannot delete a questionnaire/group with sessions; abort or complete it instead")

        conn.execute("DELETE FROM demographics WHERE group_id = ?", (group_id,))
        conn.execute("DELETE FROM battery_responses WHERE group_id = ?", (group_id,))
        conn.execute("DELETE FROM battery_orders WHERE group_id = ?", (group_id,))
        conn.execute("DELETE FROM participants WHERE group_id = ?", (group_id,))
        conn.execute("DELETE FROM groups WHERE group_id = ?", (group_id,))

    group_path = GROUPS_DIR / group_id
    if group_path.exists():
        shutil.rmtree(group_path)

    return {"status": "deleted", "group_id": group_id}


# ── Demographics ───────────────────────────────────────────────────────────


class DemographicsBody(BaseModel):
    age: Optional[int] = None
    gender: Optional[str] = None
    first_language: Optional[str] = None
    english_prof: Optional[str] = None
    education: Optional[str] = None
    prior_ai_xp: Optional[str] = None
    voice_asst_use: Optional[str] = None


@router.post("/groups/{group_id}/demographics/{role}")
async def upsert_demographics(group_id: str, role: str, body: DemographicsBody):
    if role not in ("P1", "P2"):
        raise HTTPException(400, "role must be P1 or P2")
    if group_registry.get(group_id) is None:
        raise HTTPException(404, "group not found")
    submitted_at = _utc_now_iso()
    payload = body.model_dump()

    # JSON file is the durable record — write before DB so a DB write failure
    # doesn't lose participant-supplied data.
    path = _group_dir(group_id) / f"demographics_{role.lower()}.json"
    record = {**payload, "role": role, "group_id": group_id, "submitted_at": submitted_at}
    path.write_text(json.dumps(record, indent=2))

    with get_db() as conn:
        conn.execute(
            "INSERT INTO demographics "
            "(group_id, role, age, gender, first_language, english_prof, education, "
            " prior_ai_xp, voice_asst_use, submitted_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(group_id, role) DO UPDATE SET "
            "  age=excluded.age, gender=excluded.gender, "
            "  first_language=excluded.first_language, english_prof=excluded.english_prof, "
            "  education=excluded.education, prior_ai_xp=excluded.prior_ai_xp, "
            "  voice_asst_use=excluded.voice_asst_use, submitted_at=excluded.submitted_at",
            (group_id, role,
             payload.get("age"), payload.get("gender"), payload.get("first_language"),
             payload.get("english_prof"), payload.get("education"),
             payload.get("prior_ai_xp"), payload.get("voice_asst_use"),
             submitted_at),
        )

    log.info(f"[demographics] {group_id}/{role} upserted")
    return {"status": "ok", "group_id": group_id, "role": role, "submitted_at": submitted_at}


@router.get("/groups/{group_id}/demographics/{role}")
async def get_demographics(group_id: str, role: str):
    if role not in ("P1", "P2"):
        raise HTTPException(400, "role must be P1 or P2")
    with get_db() as conn:
        row = conn.execute(
            "SELECT age, gender, first_language, english_prof, education, "
            "prior_ai_xp, voice_asst_use, submitted_at "
            "FROM demographics WHERE group_id = ? AND role = ?",
            (group_id, role),
        ).fetchone()
    if not row:
        raise HTTPException(404, "demographics not yet submitted")
    return dict(row)


# ── Session creation under group ──────────────────────────────────────────


class CreateGroupSessionRequest(BaseModel):
    mode: str = "study"
    condition: str
    task_id: str


@router.post("/groups/{group_id}/sessions", dependencies=[Depends(verify_researcher)])
async def create_session_for_group(group_id: str, req: CreateGroupSessionRequest):
    """Create a session bound to this group. Requires status in {ready,active}."""
    ctx = group_registry.get(group_id)
    if ctx is None:
        raise HTTPException(404, "group not found")
    if ctx.status not in ("ready", "active"):
        raise HTTPException(
            409,
            f"group status is {ctx.status!r}; must be 'ready' or 'active'",
        )
    if req.mode != "study":
        raise HTTPException(400, f"invalid mode: {req.mode}. Only 'study' is supported.")
    valid_conditions = {c.value for c in Condition}
    if req.condition not in valid_conditions:
        raise HTTPException(400, f"invalid condition: {req.condition}")
    if not task_registry.get(req.task_id):
        raise HTTPException(400, f"unknown task: {req.task_id}")

    session = session_manager.create_session_for_group(
        group_id=group_id,
        mode=req.mode,
        condition=req.condition,
        task_id=req.task_id,
    )

    if ctx.status == "ready":
        group_registry.transition_to_active(group_id)

    return {
        "session_id": session.session_id,
        "group_id": group_id,
        "condition": session.meta.conditions[0],
        "task_id": session.meta.task_order[0],
        "anchoring_direction": session.meta.anchoring_direction,
        "amplification_target": session.amplification_target,
    }
