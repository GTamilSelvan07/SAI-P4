"""
FastAPI entry point for the Physiological Guardrails experiment platform.
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import DATA_DIR
from app.database import init_db
from app.tasks import task_registry
from app.session.manager import session_manager
from app.session.orchestrator_registry import orchestrator_registry
from app.routes.general import router as general_router
from app.routes.sessions import router as sessions_router
from app.routes.websockets import router as ws_router
from app.routes.groups import router as groups_router
from app.routes.battery import router as battery_router

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown."""
    init_db()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    count = task_registry.load_all()
    print(f"Loaded {count} task scenarios: {task_registry.list_tasks()}")
    yield

    # Shutdown: clean up LiveKit rooms + stop orchestrators + close sessions
    from app.livekit.rooms import delete_room

    for sid in list(session_manager.list_sessions()):
        # Delete LiveKit room
        try:
            await delete_room(sid)
        except Exception as e:
            log.warning(f"Error deleting LiveKit room for {sid}: {e}")

    # Stop orchestrators (stops facilitators + state machine timers)
    await orchestrator_registry.shutdown()

    # Close all session loggers and recorders
    for sid in list(session_manager.list_sessions()):
        session = session_manager.get_session(sid)
        if session and session._started:
            session.stop("server_shutdown")


app = FastAPI(title="Physiological Guardrails", lifespan=lifespan)

# CORS: allow localhost + any private network IP (LAN experiment, not public internet)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(general_router)
app.include_router(sessions_router)
app.include_router(ws_router)
app.include_router(groups_router)
app.include_router(battery_router)
