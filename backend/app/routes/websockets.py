"""
WebSocket endpoints for JSON messaging and signaling.
Audio/video handled by LiveKit SFU — no binary WebSocket endpoints needed.
"""
import logging
import time
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.session.manager import session_manager, ActiveSession
from app.config import config

log = logging.getLogger("ws")
logging.basicConfig(level=logging.INFO)
from app.session.orchestrator_registry import orchestrator_registry
from app.models import EventEntry, EventType, AISource
from app.ws.hub import ws_manager
from app.audio.manager import audio_registry
from app.audio.speech_frame import build_alex_speaking
from app.video.recorder import video_registry

router = APIRouter()


@router.websocket("/ws/audio/{session_id}/{role}")
async def audio_websocket(websocket: WebSocket, session_id: str, role: str):
    """Binary WebSocket for streaming PCM16 audio from participant browsers to backend VAD/transcription."""
    session = session_manager.get_session(session_id)
    if not session or role not in ("P1", "P2"):
        await websocket.close(code=4004, reason="Invalid session or role")
        return
    capture_role = config.participant_audio.capture_role
    if capture_role in ("P1", "P2") and role != capture_role:
        await websocket.close(code=4003, reason=f"Audio capture is assigned to {capture_role}")
        return

    audio_mgr = audio_registry.get(session_id)
    if not audio_mgr:
        await websocket.close(code=4005, reason="Audio manager not started — start session first")
        return

    await websocket.accept()
    try:
        while True:
            pcm_data = await websocket.receive_bytes()
            audio_mgr.process_audio(role, pcm_data)
    except WebSocketDisconnect:
        pass


@router.websocket("/ws/video/{session_id}/{role}")
async def video_websocket(websocket: WebSocket, session_id: str, role: str):
    """Binary WebSocket for WebM video chunks from participant browsers.
    Lazy-creates the video manager and emits heartbeat events for liveness."""
    session = session_manager.get_session(session_id)
    if not session or role not in ("P1", "P2"):
        await websocket.close(code=4004, reason="Invalid session or role")
        return

    video_mgr = video_registry.get(session_id)
    if not video_mgr:
        video_mgr = video_registry.create(session_id, session.session_dir)

    await websocket.accept()
    HEARTBEAT_INTERVAL_S = 30.0
    started_logged = False
    last_heartbeat_at = time.time()
    try:
        while True:
            chunk = await websocket.receive_bytes()
            written = video_mgr.write_participant(role, chunk)
            if not written:
                log.warning(f"[ws/video] dropped chunk for {role}: recorder is closed or role is invalid")
                continue

            if not started_logged and session._started:
                rec = video_mgr.get_recorder(role)
                session.event_logger.log(EventEntry(
                    type=EventType.VIDEO_RECORDING_START,
                    speaker=role,
                    extra={
                        "sink": "backend_backup",
                        "filepath": str(rec.filepath) if rec else None,
                    },
                ))
                started_logged = True

            now = time.time()
            if now - last_heartbeat_at >= HEARTBEAT_INTERVAL_S and session._started:
                rec = video_mgr.get_recorder(role)
                if rec:
                    session.event_logger.log(EventEntry(
                        type=EventType.VIDEO_RECORDING_HEARTBEAT,
                        speaker=role,
                        extra={
                            "bytes_written": rec.bytes_written,
                            "first_chunk_at": rec.first_chunk_at,
                        },
                    ))
                last_heartbeat_at = now
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning(f"[ws/video] {role} unexpected error: {e}")
        if session._started:
            try:
                session.event_logger.log(EventEntry(
                    type=EventType.VIDEO_RECORDING_FAILED,
                    speaker=role,
                    extra={"error": str(e)},
                ))
            except Exception:
                pass
    finally:
        if started_logged and session._started:
            try:
                rec = video_mgr.get_recorder(role)
                session.event_logger.log(EventEntry(
                    type=EventType.VIDEO_RECORDING_STOP,
                    speaker=role,
                    extra={
                        "sink": "backend_backup",
                        "bytes_written": rec.bytes_written if rec else 0,
                    },
                ))
            except Exception as e:
                log.warning(f"[ws/video] failed to log stop event for {role}: {e}")


@router.websocket("/ws/{session_id}/{role}")
async def websocket_endpoint(websocket: WebSocket, session_id: str, role: str):
    """WebSocket for real-time JSON communication. role: P1, P2, or researcher."""
    log.info(f"[WS] {role} connecting to session {session_id}")
    session = session_manager.get_session(session_id)
    if not session:
        log.warning(f"[WS] Session {session_id} NOT FOUND — rejecting {role}")
        await websocket.close(code=4004, reason="Session not found")
        return

    await ws_manager.connect(websocket, session_id, role)
    log.info(f"[WS] {role} CONNECTED to session {session_id}")

    orch = orchestrator_registry.get(session_id)
    if orch:
        status = orch.state_machine.get_status()
        status["mode"] = session.meta.mode
        await ws_manager.send_to(session_id, role, {
            "type": "session_started" if session._started else "session_status",
            "data": status,
        })
    elif session.state_machine:
        status = session.state_machine.get_status()
        status["mode"] = session.meta.mode
        await ws_manager.send_to(session_id, role, {
            "type": "session_started" if session._started else "session_status",
            "data": status,
        })

    if role in ("P1", "P2") and session._started:
        session.event_logger.log(EventEntry(type=EventType.PARTICIPANT_JOIN, speaker=role))
        session.lsl_logger.push("participant_join", role)

    # Check if both participants are now connected — trigger WebRTC
    connected = ws_manager.get_connected_roles(session_id)
    log.info(f"[WS] Connected roles for {session_id}: {connected}")
    if "P1" in connected and "P2" in connected:
        log.info(f"[WS] Both P1+P2 connected — sending rtc_start")
        await ws_manager.send_to_participants(session_id, {
            "type": "rtc_start",
            "data": {},
        })

    await ws_manager.send_to_researcher(session_id, {
        "type": "connection_update",
        "data": {"role": role, "action": "connected", "connected": connected},
    })

    try:
        while True:
            data = await websocket.receive_json()
            try:
                await _handle_ws_message(session, session_id, role, data)
            except Exception as e:
                log.error(f"[WS] Error handling message from {role} in {session_id}: {e}")
    except WebSocketDisconnect:
        await ws_manager.disconnect(session_id, role)
        if role in ("P1", "P2") and session._started:
            session.event_logger.log(EventEntry(type=EventType.PARTICIPANT_LEAVE, speaker=role))
        connected = ws_manager.get_connected_roles(session_id)
        try:
            await ws_manager.send_to_researcher(session_id, {
                "type": "connection_update",
                "data": {"role": role, "action": "disconnected", "connected": connected},
            })
        except Exception:
            pass


VALID_MSG_TYPES = {
    "rtc_offer", "rtc_answer", "rtc_ice_candidate",
    "posttask_complete", "survey_response", "decision_vote", "preference_vote",
    "researcher_failsafe", "researcher_advance", "researcher_flag",
    "prompt_composed", "prompt_live_tts_play",
}

# Allowed annotation tags. Free-form note travels alongside.
RESEARCHER_FLAG_TAGS = {"issue", "interesting", "follow-up", "milestone"}


def _event_context(session_id: str) -> tuple[str | None, str | None, str | None]:
    orch = orchestrator_registry.get(session_id)
    block = orch.state_machine.current_block if orch and orch.state_machine else None
    phase = block.current_phase.value if block and block.current_phase else None
    condition = block.condition.value if block else None
    task_id = block.task_id if block else None
    return phase, condition, task_id


async def _handle_ws_message(session: ActiveSession, session_id: str, role: str, data: dict) -> None:
    """Route incoming WebSocket messages."""
    msg_type = data.get("type", "")

    # Validate message type
    if msg_type not in VALID_MSG_TYPES:
        log.warning(f"[WS] Unknown message type '{msg_type}' from {role} in {session_id}")
        return

    # Role-based access: only researcher can send researcher_* messages
    if msg_type.startswith("researcher_") and role != "researcher":
        log.warning(f"[WS] Non-researcher {role} sent {msg_type} in {session_id}")
        return

    # ── WebRTC signaling relay (P1↔P2) ──
    if msg_type in ("rtc_offer", "rtc_answer", "rtc_ice_candidate"):
        peer = "P2" if role == "P1" else "P1"
        log.info(f"[WS] Relay {msg_type} from {role} → {peer} (session {session_id})")
        await ws_manager.send_to_peer(session_id, role, data)
        return

    if not session._started:
        # Session not started yet — only allow signaling, ignore data messages
        return

    if msg_type in ("posttask_complete", "survey_response"):
        # `posttask_complete` is the new completion signal from the battery
        # path; `survey_response` is kept for one release as a deprecated
        # alias so older clients still drive auto-advance. Real responses
        # are already on disk via the per-scale battery_responses UPSERT —
        # this handler only flips the per-role done flag and triggers
        # auto-advance.
        phase, condition, task_id = _event_context(session_id)
        payload = data.get("data", {})
        if msg_type == "survey_response" and phase not in {"survey", "post_task"}:
            session.event_logger.log(EventEntry(
                type=EventType.SURVEY_RESPONSE,
                phase=phase,
                condition=condition,
                speaker=role,
                extra={**payload, "task_id": task_id, "ignored_for_completion": True},
            ))
            log.warning(
                f"[WS] Ignoring legacy survey_response from {role} during phase {phase!r}; "
                "not marking posttask complete."
            )
            return
        if role in session.surveys:
            log.info(f"[WS] Ignoring duplicate {msg_type} from {role} in {session_id}")
            return
        session.event_logger.log(EventEntry(
            type=EventType.SURVEY_RESPONSE,
            phase=phase,
            condition=condition,
            speaker=role,
            extra={**payload, "task_id": task_id},
        ))
        if msg_type == "survey_response":
            log.warning(
                f"[WS] {session_id}/{role} sent legacy `survey_response`; "
                "clients should send `posttask_complete` instead."
            )

        session.surveys[role] = True
        await ws_manager.send_to(session_id, role, {
            "type": "posttask_ack",
            "data": {"role": role},
        })
        await ws_manager.send_to_researcher(session_id, {
            "type": "posttask_complete",
            "data": {"role": role, **payload},
        })
        if len(session.surveys) >= 2:
            orch = orchestrator_registry.get(session_id)
            if orch:
                log.info(f"[WS] Both participants finished posttask — auto-advancing phase")
                await orch.state_machine.advance_phase()
            session.surveys.clear()

    elif msg_type == "preference_vote":
        phase, condition, task_id = _event_context(session_id)
        choice = data.get("data", {}).get("choice", "")
        session.preferences[role] = choice
        session.event_logger.log(EventEntry(
            type=EventType.PREFERENCE_VOTE,
            phase=phase,
            condition=condition,
            speaker=role,
            content=choice,
            extra={"task_id": task_id},
        ))
        session.lsl_logger.push("preference_vote", f"{role}:{choice}")
        await ws_manager.send_to_researcher(session_id, {
            "type": "preference_vote",
            "data": {"role": role, **data.get("data", {})},
        })

    elif msg_type == "decision_vote":
        phase, condition, task_id = _event_context(session_id)
        choice = data.get("data", {}).get("choice", "")
        session.event_logger.log(EventEntry(
            type=EventType.DECISION_VOTE,
            phase=phase,
            condition=condition,
            speaker=role,
            content=choice,
            extra={"task_id": task_id},
        ))
        session.lsl_logger.push("decision_vote", f"{role}:{choice}")
        await ws_manager.send_to_researcher(session_id, {
            "type": "decision_vote",
            "data": {"role": role, **data.get("data", {})},
        })
        # Track votes and detect consensus (votes cleared on phase change via orchestrator callback)
        session.votes[role] = choice
        if len(session.votes) >= 2:
            choices = list(session.votes.values())
            if len(set(choices)) == 1 and choices[0]:
                session.event_logger.log(EventEntry(
                    type=EventType.DECISION_CONSENSUS,
                    content=choices[0],
                    extra={"votes": dict(session.votes)},
                ))
                await ws_manager.broadcast(session_id, {
                    "type": "decision_consensus",
                    "data": {"choice": choices[0]},
                })
            session.votes.clear()

    elif msg_type == "researcher_failsafe":
        payload = data.get("data", {}) or {}
        category = payload.get("clip", "")
        text = payload.get("text", "")
        session.event_logger.log(EventEntry(
            type=EventType.FAILSAFE_OVERRIDE, source=AISource.FAILSAFE_CLIP,
            content=category, extra=payload,
        ))
        session.lsl_logger.push("failsafe_override", category)

        audio_pcm = None
        speech = None
        try:
            from app.audio.failsafe import failsafe_manager
            if not failsafe_manager.loaded:
                failsafe_manager.load_clips()
            audio_pcm = failsafe_manager.get_clip_bytes(category)
            if not text:
                text = failsafe_manager.get_clip_text(category) or ""
        except Exception as e:
            log.warning(f"[WS] failsafe clip lookup failed for {category}: {e}")

        if audio_pcm is None and text:
            try:
                from app.audio.tts import create_tts
                tts = create_tts()
                speech = await asyncio.to_thread(tts.synthesize_speech, text)
                audio_pcm = speech.pcm16_pipeline if speech else None
            except Exception as e:
                log.warning(f"[WS] failsafe TTS failed for {category}: {e}")

        if audio_pcm:
            try:
                audio_mgr = audio_registry.get(session_id)
                if audio_mgr:
                    audio_mgr.write_alex_audio(audio_pcm)
            except Exception as e:
                log.warning(f"[WS] failsafe Alex audio write failed for {session_id}: {e}")

        await ws_manager.broadcast(session_id, build_alex_speaking(
            text=text,
            speech=speech,
            audio_pcm=audio_pcm,
            source=AISource.FAILSAFE_CLIP.value,
            trigger="researcher",
            condition=session.meta.conditions[0] if session.meta.conditions else None,
            category=category,
        ))

    elif msg_type == "researcher_advance":
        orch = orchestrator_registry.get(session_id)
        if orch:
            await orch.state_machine.advance_phase()
            session.event_logger.log(EventEntry(
                type=EventType.RESEARCHER_ACTION, content="manual_advance",
            ))

    elif msg_type == "researcher_flag":
        # Researcher annotation. Persist to events.jsonl with current phase
        # + condition for post-hoc filtering. Tag must be from the allowlist;
        # note is free text.
        payload = data.get("data", {}) or {}
        tag = payload.get("tag")
        note = (payload.get("note") or "").strip()
        if tag not in RESEARCHER_FLAG_TAGS:
            log.warning(f"[WS] researcher_flag with invalid tag '{tag}' in {session_id}")
            return
        orch = orchestrator_registry.get(session_id)
        block = orch.state_machine.current_block if orch and orch.state_machine else None
        phase = block.current_phase.value if block and block.current_phase else None
        condition = block.condition.value if block else None
        session.event_logger.log(EventEntry(
            type=EventType.RESEARCHER_FLAG,
            phase=phase,
            condition=condition,
            content=note or None,
            extra={"tag": tag, "note": note},
        ))
        # Echo to the researcher only so optimistic UI can reconcile.
        await ws_manager.send_to_researcher(session_id, {
            "type": "flag_logged",
            "data": {"tag": tag, "note": note, "phase": phase},
        })
