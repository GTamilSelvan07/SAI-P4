"""
Registry of active SessionOrchestrators by session_id.
Follows the same pattern as AudioManagerRegistry.
"""
from typing import Optional

from app.session.orchestrator import SessionOrchestrator


class OrchestratorRegistry:
    """Manages active orchestrators for live sessions."""

    def __init__(self):
        self._orchestrators: dict[str, SessionOrchestrator] = {}

    def add(self, session_id: str, orch: SessionOrchestrator) -> None:
        self._orchestrators[session_id] = orch

    def get(self, session_id: str) -> Optional[SessionOrchestrator]:
        return self._orchestrators.get(session_id)

    async def remove(self, session_id: str) -> Optional[SessionOrchestrator]:
        orch = self._orchestrators.pop(session_id, None)
        if orch:
            await orch.stop()
        return orch

    async def shutdown(self) -> None:
        """Stop all orchestrators. Called during server shutdown."""
        for sid in list(self._orchestrators):
            await self.remove(sid)

    def __contains__(self, session_id: str) -> bool:
        return session_id in self._orchestrators


# Global registry
orchestrator_registry = OrchestratorRegistry()
