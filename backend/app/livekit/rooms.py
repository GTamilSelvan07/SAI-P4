"""
LiveKit room management — create/delete rooms via the LiveKit API.
"""
import logging
from livekit import api

from app.config import config

log = logging.getLogger(__name__)


async def create_room(room_name: str) -> None:
    """Create a LiveKit room for a session."""
    lk = config.livekit
    lk_api = api.LiveKitAPI(url=lk.api_url, api_key=lk.api_key, api_secret=lk.api_secret)
    try:
        await lk_api.room.create_room(api.CreateRoomRequest(name=room_name))
        log.info(f"[LiveKit] Created room: {room_name}")
    except Exception as e:
        log.warning(f"[LiveKit] Room create failed (may already exist): {e}")
    finally:
        await lk_api.aclose()


async def delete_room(room_name: str) -> None:
    """Delete a LiveKit room."""
    lk = config.livekit
    lk_api = api.LiveKitAPI(url=lk.api_url, api_key=lk.api_key, api_secret=lk.api_secret)
    try:
        await lk_api.room.delete_room(api.DeleteRoomRequest(room=room_name))
        log.info(f"[LiveKit] Deleted room: {room_name}")
    except Exception as e:
        log.warning(f"[LiveKit] Room delete failed: {e}")
    finally:
        await lk_api.aclose()


def generate_token(room_name: str, identity: str) -> str:
    """Generate an access token for a participant."""
    from datetime import timedelta

    lk = config.livekit
    grants = api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_publish_data=True,
        can_subscribe=True,
    )
    token = (
        api.AccessToken(api_key=lk.api_key, api_secret=lk.api_secret)
        .with_grants(grants)
        .with_identity(identity)
        .with_name(identity)
        .with_ttl(timedelta(hours=3))
    )
    return token.to_jwt()
