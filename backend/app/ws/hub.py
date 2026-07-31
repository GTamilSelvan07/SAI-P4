"""
WebSocket hub for real-time communication between backend, participants, and researcher.
"""
import json
import asyncio
from typing import Optional
from fastapi import WebSocket


class ConnectionManager:
    """Manages WebSocket connections for participants and researcher."""

    def __init__(self):
        # session_id -> role -> WebSocket
        self._connections: dict[str, dict[str, WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, session_id: str, role: str) -> None:
        await websocket.accept()
        async with self._lock:
            if session_id not in self._connections:
                self._connections[session_id] = {}
            self._connections[session_id][role] = websocket

    async def disconnect(self, session_id: str, role: str) -> None:
        async with self._lock:
            if session_id in self._connections:
                self._connections[session_id].pop(role, None)
                if not self._connections[session_id]:
                    del self._connections[session_id]

    async def send_to(self, session_id: str, role: str, message: dict) -> None:
        """Send message to a specific role in a session."""
        async with self._lock:
            ws = self._connections.get(session_id, {}).get(role)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                await self.disconnect(session_id, role)

    async def send_to_participants(self, session_id: str, message: dict) -> None:
        """Send message to both P1 and P2."""
        await asyncio.gather(
            self.send_to(session_id, "P1", message),
            self.send_to(session_id, "P2", message),
        )

    async def send_to_researcher(self, session_id: str, message: dict) -> None:
        """Send message to the researcher dashboard."""
        await self.send_to(session_id, "researcher", message)

    async def broadcast(self, session_id: str, message: dict) -> None:
        """Send message to all connected clients in a session."""
        async with self._lock:
            connections = dict(self._connections.get(session_id, {}))
        for role, ws in connections.items():
            try:
                await ws.send_json(message)
            except Exception:
                await self.disconnect(session_id, role)

    async def send_to_peer(self, session_id: str, sender_role: str, message: dict) -> None:
        """Send message to the other participant (P1→P2 or P2→P1)."""
        peer = "P2" if sender_role == "P1" else "P1"
        await self.send_to(session_id, peer, message)

    def get_connected_roles(self, session_id: str) -> list[str]:
        return list(self._connections.get(session_id, {}).keys())


# Global connection manager
ws_manager = ConnectionManager()
