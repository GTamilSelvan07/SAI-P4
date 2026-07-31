"""
General API routes: health, tasks, conditions, LiveKit tokens.
"""
import time
from datetime import timedelta
from fastapi import APIRouter, HTTPException

from app.config import (
    config,
    Condition,
    CONDITION_LABELS,
    VIDEO_RECORDING_ENABLED,
    VIDEO_CODEC,
    VIDEO_BITRATE_BPS,
    VIDEO_AUDIO_BITRATE_BPS,
    VIDEO_CHUNK_MS,
)
from app.tasks import task_registry
from app.session.manager import session_manager

router = APIRouter(prefix="/api")


@router.get("/health")
async def health():
    return {"status": "ok", "time": time.time(), "model": config.ollama.model}


@router.get("/tasks")
async def list_tasks():
    return task_registry.list_tasks()


@router.get("/conditions")
async def list_conditions():
    return {c.value: CONDITION_LABELS[c] for c in Condition}


@router.get("/config/recording")
async def recording_config():
    return {
        "enabled": VIDEO_RECORDING_ENABLED,
        "mime_type": VIDEO_CODEC,
        "fallback_mime_type": "video/webm;codecs=vp8,opus",
        "video_bits_per_second": VIDEO_BITRATE_BPS,
        "audio_bits_per_second": VIDEO_AUDIO_BITRATE_BPS,
        "timeslice_ms": VIDEO_CHUNK_MS,
        "audio_capture_role": config.participant_audio.capture_role,
    }


@router.get("/livekit/token")
async def get_livekit_token(session_id: str, identity: str):
    """Generate a LiveKit access token for a participant to join a room."""
    from livekit.api import AccessToken, VideoGrants

    lk = config.livekit
    if not lk.api_key or not lk.api_secret:
        raise HTTPException(500, "LiveKit not configured (set LIVEKIT_API_KEY and LIVEKIT_API_SECRET)")

    # Validate session exists
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, f"Session {session_id} not found")

    # Validate identity
    valid_identities = {"P1", "P2", "researcher", "Alex"}
    if identity not in valid_identities:
        raise HTTPException(400, f"Invalid identity. Must be one of: {sorted(valid_identities)}")

    grants = VideoGrants(
        room_join=True,
        room=session_id,
        can_publish=True,
        can_publish_data=True,
        can_subscribe=True,
    )

    token = (
        AccessToken(api_key=lk.api_key, api_secret=lk.api_secret)
        .with_grants(grants)
        .with_identity(identity)
        .with_name(identity)
        .with_ttl(timedelta(hours=3))
    )

    return {
        "token": token.to_jwt(),
        "url": lk.url,
    }
