"""
Session management API routes.
"""
import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import config, Condition, RESEARCHER_API_KEY
from app.livekit.rooms import create_room
from app.database import get_db
from app.session.manager import session_manager
from app.session.orchestrator import SessionOrchestrator
from app.session.orchestrator_registry import orchestrator_registry
from app.models import TranscriptEntry
from app.ws.hub import ws_manager
from app.audio.manager import audio_registry
from app.tasks import task_registry

log = logging.getLogger("sessions")

router = APIRouter(prefix="/api")


async def verify_researcher(x_api_key: str = Header(default="")) -> None:
    """Simple API key check for researcher endpoints. Skipped if no key is configured."""
    if RESEARCHER_API_KEY and x_api_key != RESEARCHER_API_KEY:
        raise HTTPException(403, "Invalid API key")


class CreateSessionRequest(BaseModel):
    group_number: int
    mode: str = "study"
    condition: str
    task_id: str


@router.post("/sessions")
async def create_session(req: CreateSessionRequest):
    """Create a new single-condition experiment session.

    Each session = one condition + one task + 7 phases. To run another condition,
    create a new session.
    """
    if req.mode != "study":
        raise HTTPException(400, f"Invalid mode: {req.mode}. Only 'study' is supported.")
    valid_conditions = {c.value for c in Condition}
    if req.condition not in valid_conditions:
        raise HTTPException(400, f"Invalid condition: {req.condition}. Must be one of {sorted(valid_conditions)}.")
    if not task_registry.get(req.task_id):
        raise HTTPException(400, f"Unknown task: {req.task_id}. Check /api/tasks for available tasks.")

    session = session_manager.create_session(
        group_number=req.group_number,
        mode=req.mode,
        condition=req.condition,
        task_id=req.task_id,
    )
    return {
        "session_id": session.session_id,
        "group_id": session.group_id,
        "mode": session.meta.mode,
        "conditions": session.meta.conditions,
        "task_order": session.meta.task_order,
        "condition_task_map": session.meta.condition_task_map,
        "anchoring_direction": session.meta.anchoring_direction,
        "amplification_target": session.amplification_target,
    }


@router.post("/sessions/{session_id}/start", dependencies=[Depends(verify_researcher)])
async def start_session(session_id: str, auto_advance: bool = False):
    """Start an experiment session — initializes audio, facilitator, and state machine."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session._started:
        raise HTTPException(400, "Session already started")

    try:
        orch = SessionOrchestrator(
            session_id=session_id,
            conditions=[Condition(c) for c in session.meta.conditions],
            task_ids=session.meta.task_order,
            event_logger=session.event_logger,
            lsl_logger=session.lsl_logger,
            anchoring_direction=session.meta.anchoring_direction or "",
            amplification_target=session.amplification_target,
            auto_advance=auto_advance,
            mode=session.meta.mode,
        )

        session.start()

        # Create LiveKit room for P2P video/audio between participants
        await create_room(session_id)

        # Audio manager for VAD/transcription (receives PCM16 via binary WebSocket)
        audio_mgr = audio_registry.create(
            session_id=session_id,
            session_dir=session.session_dir,
            transcript_logger=session.transcript_logger,
            event_logger=session.event_logger,
            lsl_logger=session.lsl_logger,
        )

        # Video recorder is now lazy — created on first /ws/video connection
        # in routes/websockets.py. Avoids the zombie-empty-file failure mode
        # (see docs/superpowers/specs/2026-05-09-video-recording-reliability.md).

        # Wire async callbacks for transcript + VAD
        # Phases during which participants may see each other's transcript.
        # Server-side check — never trust client phase state (spec §4.2).
        ACTIVE_SPEECH_PHASES = {"p1_opening", "p2_opening", "open_discussion"}

        async def on_transcript(entry: TranscriptEntry):
            try:
                current_phase = orch.state_machine.current_phase
                phase_name = current_phase.value if hasattr(current_phase, "value") else str(current_phase)

                # Researcher always gets the full feed (existing behaviour)
                await ws_manager.send_to_researcher(session_id, {
                    "type": "transcript",
                    "data": entry.model_dump(),
                })

                # Participant routing — phase-gated
                payload = {
                    "type": "participant_transcript",
                    "data": entry.model_dump(),
                }
                if phase_name in ACTIVE_SPEECH_PHASES:
                    await ws_manager.send_to_participants(session_id, payload)
                # Outside active-speech phases: no participant_transcript routing
                # even when the configured room mic is still recording to disk.

                engine = orch.facilitator
                if engine and entry.speaker in ("P1", "P2") and phase_name in ACTIVE_SPEECH_PHASES:
                    engine.add_transcript(entry.speaker, entry.text)
            except Exception as e:
                log.error(f"Error in transcript callback: {e}")

        async def on_vad(role: str, is_speaking: bool):
            try:
                await ws_manager.broadcast(session_id, {
                    "type": "vad",
                    "data": {"role": role, "speaking": is_speaking},
                })
            except Exception as e:
                log.error(f"Error in VAD callback: {e}")

        # Wire callbacks and start audio processing
        audio_mgr._on_transcript = on_transcript
        audio_mgr._on_vad = on_vad
        audio_mgr.start()

        # Start orchestrator (starts state machine + first facilitator)
        await orch.start()
        orchestrator_registry.add(session_id, orch)

        # Use orchestrator's state machine for status
        session.state_machine = orch.state_machine
        status = orch.state_machine.get_status()
        status["mode"] = session.meta.mode
        await ws_manager.broadcast(session_id, {"type": "session_started", "data": status})
        return status

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Failed to start session {session_id}: {e}", exc_info=True)
        # Cleanup partial initialization
        try:
            await orchestrator_registry.remove(session_id)
        except Exception as cleanup_error:
            log.warning(f"Startup cleanup: orchestrator removal failed for {session_id}: {cleanup_error}")
        try:
            await audio_registry.remove_async(session_id)
        except Exception as cleanup_error:
            log.warning(f"Startup cleanup: audio manager removal failed for {session_id}: {cleanup_error}")
        try:
            from app.video.recorder import video_registry
            video_registry.remove(session_id)
        except Exception as cleanup_error:
            log.warning(f"Startup cleanup: video recorder removal failed for {session_id}: {cleanup_error}")
        try:
            from app.livekit.rooms import delete_room
            await delete_room(session_id)
        except Exception as cleanup_error:
            log.warning(f"Startup cleanup: LiveKit room delete failed for {session_id}: {cleanup_error}")
        try:
            session.stop("startup_failed")
        except Exception as cleanup_error:
            log.warning(f"Startup cleanup: session stop failed for {session_id}: {cleanup_error}")
        raise HTTPException(500, f"Failed to start session: {e}")


@router.post("/sessions/{session_id}/advance", dependencies=[Depends(verify_researcher)])
async def advance_phase(session_id: str):
    orch = orchestrator_registry.get(session_id)
    if not orch:
        raise HTTPException(404, "Session not found or not started")
    await orch.state_machine.advance_phase()
    return orch.state_machine.get_status()


@router.post("/sessions/{session_id}/advance-block", dependencies=[Depends(verify_researcher)])
async def advance_block(session_id: str):
    orch = orchestrator_registry.get(session_id)
    if not orch:
        raise HTTPException(404, "Session not found or not started")
    await orch.state_machine.advance_block()
    return orch.state_machine.get_status()


@router.post("/sessions/{session_id}/pause", dependencies=[Depends(verify_researcher)])
async def pause_session(session_id: str):
    orch = orchestrator_registry.get(session_id)
    if not orch:
        raise HTTPException(404, "Session not found or not started")
    await orch.state_machine.pause()
    status = orch.state_machine.get_status()
    await ws_manager.broadcast(session_id, {"type": "paused", "data": status})
    return status


@router.post("/sessions/{session_id}/resume", dependencies=[Depends(verify_researcher)])
async def resume_session(session_id: str):
    orch = orchestrator_registry.get(session_id)
    if not orch:
        raise HTTPException(404, "Session not found or not started")
    await orch.state_machine.resume()
    status = orch.state_machine.get_status()
    await ws_manager.broadcast(session_id, {"type": "resumed", "data": status})
    return status


@router.post("/sessions/{session_id}/extend", dependencies=[Depends(verify_researcher)])
async def extend_time(session_id: str, seconds: float = 60):
    orch = orchestrator_registry.get(session_id)
    if not orch:
        raise HTTPException(404, "Session not found or not started")
    orch.state_machine.extend_time(seconds)
    status = orch.state_machine.get_status()
    await ws_manager.broadcast(session_id, {"type": "time_extended", "data": status})
    return status


@router.post("/sessions/{session_id}/emergency-stop", dependencies=[Depends(verify_researcher)])
async def emergency_stop(session_id: str, reason: str = ""):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    stop_reason = reason or "researcher triggered"
    try:
        await orchestrator_registry.remove(session_id)
    except Exception as e:
        log.error(f"Error stopping orchestrator for {session_id}: {e}")
    # Delete LiveKit room (disconnects all participants)
    try:
        from app.livekit.rooms import delete_room
        await delete_room(session_id)
    except Exception as e:
        log.error(f"Error deleting LiveKit room for {session_id}: {e}")
    # Stop audio manager
    try:
        from app.audio.manager import audio_registry
        await audio_registry.remove_async(session_id)
    except Exception as e:
        log.error(f"Error stopping audio manager for {session_id}: {e}")
    # Close video recorder (flushes WebM files to disk)
    try:
        from app.video.recorder import video_registry
        video_registry.remove(session_id)
    except Exception as e:
        log.error(f"Error stopping video recorder for {session_id}: {e}")
    session.emergency_stop(stop_reason)
    # Auto-compute metrics.json so SessionComplete renders without manual run.
    # Mirrors the natural-end path in orchestrator._on_session_end. Non-fatal.
    try:
        from pathlib import Path as _Path
        from scripts.analysis.compute_metrics import compute_session_metrics as _cm
        import json as _json
        _project_root = _Path(__file__).resolve().parents[3]
        _m = _cm(session.session_dir, _project_root)
        (session.session_dir / "metrics.json").write_text(
            _json.dumps(_m.to_dict(), indent=2) + "\n"
        )
    except Exception as e:
        log.warning(f"[metrics] emergency-stop compute failed: {e}")
    try:
        await ws_manager.broadcast(session_id, {"type": "emergency_stop", "data": {"reason": stop_reason}})
    except Exception:
        pass
    return {"status": "stopped", "reason": stop_reason}


@router.get("/sessions/{session_id}/metrics")
async def get_session_metrics(session_id: str):
    """Return the precomputed metrics.json for a session.

    Written automatically on session-end (natural or emergency). If absent,
    the metrics tool can be run manually:
      PYTHONPATH=backend python3 backend/scripts/analysis/compute_metrics.py <session_dir>
    """
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    metrics_path = session.session_dir / "metrics.json"
    if not metrics_path.exists():
        raise HTTPException(404, "metrics.json not yet generated")
    import json as _json
    return _json.loads(metrics_path.read_text())


@router.get("/sessions/{session_id}/flags")
async def get_session_flags(session_id: str):
    """Return researcher annotations from events.jsonl."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    events_path = session.session_dir / "events.jsonl"
    if not events_path.exists():
        return {"flags": []}
    import json as _json
    flags = []
    for line in events_path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = _json.loads(line)
        except _json.JSONDecodeError:
            continue
        if ev.get("type") == "researcher_flag":
            extra = ev.get("extra") or {}
            flags.append({
                "ts": ev.get("ts"),
                "phase": ev.get("phase"),
                "condition": ev.get("condition"),
                "tag": extra.get("tag"),
                "note": extra.get("note", ""),
            })
    return {"flags": flags}


@router.get("/sessions/{session_id}/status")
async def get_session_status(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    orch = orchestrator_registry.get(session_id)
    if orch:
        status = orch.state_machine.get_status()
    elif session.state_machine:
        status = session.state_machine.get_status()
    else:
        status = {"session_id": session_id, "session_started": False, "session_ended": False}
    status["mode"] = session.meta.mode
    return status


@router.get("/sessions/{session_id}/facilitator")
async def get_facilitator_status(session_id: str):
    orch = orchestrator_registry.get(session_id)
    if not orch or not orch.facilitator:
        return {"active": False}
    try:
        engine = orch.facilitator
        return {
            "active": True,
            "intervention_count": engine.intervention_count,
            "seconds_until_next": round(engine.seconds_until_next, 1),
            "last_response": engine.last_response,
            "model": config.ollama.model,
        }
    except Exception:
        return {"active": False}


@router.get("/sessions/{session_id}/recording_status")
async def get_recording_status(session_id: str):
    """Per-role video recording health for the researcher dashboard.

    Returns {P1, P2: {active, bytes_written, last_chunk_age_s, first_chunk_at}}.
    `active=false` means no chunk has been received yet (recording never started
    or failed). `last_chunk_age_s` lets the dashboard render a green/amber/red
    light: <10 s = green, 10–30 s = amber, >30 s or null = red.
    """
    from app.video.recorder import video_registry
    mgr = video_registry.get(session_id)
    if not mgr:
        return {
            "P1": {"active": False, "bytes_written": 0, "last_chunk_age_s": None, "first_chunk_at": None},
            "P2": {"active": False, "bytes_written": 0, "last_chunk_age_s": None, "first_chunk_at": None},
        }
    return mgr.status()


@router.get("/sessions/{session_id}/task/{role}")
async def get_task_for_participant(session_id: str, role: str):
    orch = orchestrator_registry.get(session_id)
    if not orch:
        raise HTTPException(404, "Session not started")
    block = orch.state_machine.current_block
    if not block:
        raise HTTPException(400, "No active block")
    view = task_registry.get_participant_view(block.task_id, role)
    if not view:
        raise HTTPException(404, f"Task {block.task_id} not found")
    return view


@router.get("/sessions/{session_id}/task-full")
async def get_task_full(session_id: str):
    orch = orchestrator_registry.get(session_id)
    if not orch:
        raise HTTPException(404, "Session not started")
    block = orch.state_machine.current_block
    if not block:
        raise HTTPException(400, "No active block")
    task = task_registry.get(block.task_id)
    if not task:
        raise HTTPException(404, f"Task {block.task_id} not found")
    data = task.model_dump()
    if block.condition == Condition.C3_ANCHORING:
        from app.session.bibd import resolve_c3_anchor_option

        data["session_anchor_option"] = resolve_c3_anchor_option(
            block.task_id,
            orch.state_machine.get_status().get("anchoring_direction") or "incorrect",
        )
    return data


@router.get("/sessions")
async def list_sessions():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT session_id, group_id, condition, task_id, status, created_at FROM sessions ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


