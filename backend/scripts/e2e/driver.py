"""
SessionDriver: headless WebSocket client that simulates a 2-participant session.
Used by run_session.py for per-condition E2E verification.
"""
from __future__ import annotations
import asyncio
import json
import os
import wave
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import httpx
import websockets


BACKEND_HTTP = os.environ.get("E2E_BACKEND_HTTP", "http://localhost:8000")
BACKEND_WS = os.environ.get("E2E_BACKEND_WS", "ws://localhost:8000")
API_KEY = os.environ.get("EXPERIMENT_API_KEY", "")


def _auth_headers() -> dict:
    return {"X-API-Key": API_KEY} if API_KEY else {}


@dataclass
class SessionDriver:
    """High-level driver for a single experimental session run."""
    session_id: str = ""
    group_id: str = ""
    conditions: list[str] = field(default_factory=list)
    _http: Optional[httpx.AsyncClient] = None
    _ws_p1: Any = None
    _ws_p2: Any = None
    _ws_researcher: Any = None
    _ws_audio_p1: Any = None
    _ws_audio_p2: Any = None

    async def __aenter__(self):
        self._http = httpx.AsyncClient(timeout=30.0)
        return self

    async def __aexit__(self, *args):
        await self.close_all()
        if self._http:
            await self._http.aclose()

    async def create_session(self, group_number: int, condition: str, task_id: str) -> dict:
        r = await self._http.post(
            f"{BACKEND_HTTP}/api/sessions",
            json={
                "group_number": group_number,
                "mode": "study",
                "condition": condition,
                "task_id": task_id,
            },
        )
        r.raise_for_status()
        data = r.json()
        self.session_id = data["session_id"]
        self.group_id = data["group_id"]
        self.conditions = data["conditions"]
        return data

    async def start_session(self) -> dict:
        r = await self._http.post(
            f"{BACKEND_HTTP}/api/sessions/{self.session_id}/start",
            headers=_auth_headers(),
        )
        r.raise_for_status()
        return r.json()

    async def connect_ws_all(self) -> None:
        """Open JSON websockets for researcher, P1, P2 in that order."""
        self._ws_researcher = await websockets.connect(
            f"{BACKEND_WS}/ws/{self.session_id}/researcher"
        )
        self._ws_p1 = await websockets.connect(
            f"{BACKEND_WS}/ws/{self.session_id}/P1"
        )
        self._ws_p2 = await websockets.connect(
            f"{BACKEND_WS}/ws/{self.session_id}/P2"
        )
        # Drain any startup messages on each (non-blocking)
        for ws in (self._ws_researcher, self._ws_p1, self._ws_p2):
            await self._drain(ws)

    async def connect_audio_ws(self) -> None:
        """Open binary audio websockets for P1 and P2 (must be after start_session)."""
        self._ws_audio_p1 = await websockets.connect(
            f"{BACKEND_WS}/ws/audio/{self.session_id}/P1"
        )
        self._ws_audio_p2 = await websockets.connect(
            f"{BACKEND_WS}/ws/audio/{self.session_id}/P2"
        )

    async def _drain(self, ws, timeout: float = 0.05) -> list[dict]:
        """Read any pending messages without blocking."""
        msgs = []
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                try:
                    msgs.append(json.loads(raw))
                except Exception:
                    pass
        except (asyncio.TimeoutError, websockets.ConnectionClosed):
            pass
        return msgs

    async def stream_wav(self, role: str, wav_path: Path, chunk_ms: int = 500) -> None:
        """Stream a WAV file as PCM16 chunks to the participant's audio websocket."""
        ws = self._ws_audio_p1 if role == "P1" else self._ws_audio_p2
        if ws is None:
            return
        with wave.open(str(wav_path), "rb") as w:
            sr = w.getframerate()
            assert sr == 16000, f"fixture sample rate {sr} != 16000"
            chunk_samples = int(sr * chunk_ms / 1000)
            while True:
                frames = w.readframes(chunk_samples)
                if not frames:
                    break
                await ws.send(frames)
                # Pace the stream to ~real-time so VAD/transcription can keep up
                await asyncio.sleep(chunk_ms / 1000.0)

    async def advance_phase(self) -> dict:
        """Manually advance the state machine to the next phase."""
        r = await self._http.post(
            f"{BACKEND_HTTP}/api/sessions/{self.session_id}/advance",
            headers=_auth_headers(),
        )
        r.raise_for_status()
        return r.json()

    async def submit_vote(self, role: str, choice: str) -> None:
        ws = self._ws_p1 if role == "P1" else self._ws_p2
        await ws.send(json.dumps({
            "type": "decision_vote",
            "data": {"choice": choice},
        }))

    async def submit_survey(self, role: str, condition: str, task_id: str) -> None:
        ws = self._ws_p1 if role == "P1" else self._ws_p2
        await ws.send(json.dumps({
            "type": "survey_response",
            "data": {
                "phase": "post_task",
                "condition": condition,
                "task": task_id,
                "responses": {"satisfaction": 4, "comment": f"e2e test {role}"},
            },
        }))

    async def get_status(self) -> dict:
        r = await self._http.get(f"{BACKEND_HTTP}/api/sessions/{self.session_id}/status")
        r.raise_for_status()
        return r.json()

    async def emergency_stop(self) -> None:
        try:
            await self._http.post(
                f"{BACKEND_HTTP}/api/sessions/{self.session_id}/emergency-stop",
                headers=_auth_headers(),
            )
        except Exception:
            pass

    async def close_all(self) -> None:
        for ws in (
            self._ws_audio_p1, self._ws_audio_p2,
            self._ws_p1, self._ws_p2, self._ws_researcher,
        ):
            if ws is not None:
                try:
                    await ws.close()
                except Exception:
                    pass
        self._ws_audio_p1 = self._ws_audio_p2 = None
        self._ws_p1 = self._ws_p2 = self._ws_researcher = None
