"""
Response Suggestor — background pre-generation.
With 128GB unified memory on DGX Spark, pre-generates the next likely response
while participants are still discussing. When a trigger fires, the pre-generated
response is checked for recency and used if still applicable.
"""
import asyncio
import logging
from typing import Optional

from app.ai.facilitator import FacilitatorEngine

log = logging.getLogger(__name__)


class ResponseSuggestor:
    """
    Runs a background task that periodically pre-generates
    the facilitator's next response.
    """

    def __init__(self, engine: FacilitatorEngine, interval_seconds: float = 30.0):
        self._engine = engine
        self._interval = interval_seconds
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        while self._running:
            await asyncio.sleep(self._interval)
            try:
                await self._engine.pre_generate()
            except Exception as e:
                log.warning(f"Pre-generation error: {e}")
