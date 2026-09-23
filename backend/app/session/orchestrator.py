"""
Session Orchestrator — coordinates state machine, facilitator engine,
and audio manager across block transitions.

When a block ends, the orchestrator:
1. Stops the current facilitator
2. Starts a washout period
3. Starts a new facilitator for the next block's condition
"""
import asyncio
import logging
import time
from pathlib import Path
from typing import Optional, Callable, Awaitable

from app.config import Condition, Phase, config

log = logging.getLogger(__name__)
from app.models import EventEntry, EventType
from app.logging.events import EventLogger
from app.logging.lsl_markers import LSLMarkerLogger
from app.tasks import task_registry
from app.session.state_machine import (
    SessionStateMachine, StateMachineCallbacks, TaskBlockState, MicState,
)
from app.ai.facilitator import FacilitatorEngine, FacilitatorResponse
from app.ai.suggestor import ResponseSuggestor
from app.audio.speech_frame import build_alex_speaking
from app.ws.hub import ws_manager


class SessionOrchestrator:
    """
    High-level coordinator for a live experiment session.
    Owns the state machine, facilitator, and suggestor lifecycle.
    """

    def __init__(
        self,
        session_id: str,
        conditions: list[Condition],
        task_ids: list[str],
        event_logger: EventLogger,
        lsl_logger: LSLMarkerLogger,
        anchoring_direction: str = "",
        amplification_target: str = "",
        auto_advance: bool = False,
        mode: str = "study",
    ):
        self.session_id = session_id
        self._alex_agent = None  # Set by session start route
        self._mode = mode
        self._event_logger = event_logger
        self._lsl_logger = lsl_logger
        self._anchoring_direction = anchoring_direction
        self._amplification_target = amplification_target

        self._facilitator: Optional[FacilitatorEngine] = None
        self._suggestor: Optional[ResponseSuggestor] = None
        self._metrics_task: Optional[asyncio.Task] = None

        # State machine with callbacks
        callbacks = StateMachineCallbacks(
            on_phase_change=self._on_phase_change,
            on_block_change=self._on_block_change,
            on_session_end=self._on_session_end,
            on_mic_change=self._on_mic_change,
            on_timer_expired=self._on_timer_expired,
        )

        self.state_machine = SessionStateMachine(
            session_id=session_id,
            conditions=conditions,
            task_ids=task_ids,
            callbacks=callbacks,
            auto_advance=auto_advance,
            anchoring_direction=anchoring_direction,
            amplification_target=amplification_target,
        )

    async def start(self) -> None:
        """Start the first block's facilitator. State machine already started by session.start()."""
        if not self.state_machine.session_started:
            await self.state_machine.start_session()
        block = self.state_machine.current_block
        if block:
            await self._start_facilitator(block.condition)

    async def stop(self) -> None:
        """Stop everything."""
        self.state_machine.stop()
        await self._stop_facilitator()
        await self._stop_metrics_loop()

    @property
    def facilitator(self) -> Optional[FacilitatorEngine]:
        return self._facilitator

    # ── Facilitator Lifecycle ──────────────────────────────────────────────

    async def _start_facilitator(self, condition: Condition) -> None:
        """Start a facilitator engine for a condition."""
        await self._stop_facilitator()

        if condition == Condition.C0_NO_AI:
            return  # No facilitator for C0

        async def on_response(resp: FacilitatorResponse):
            # Record Alex's audio to disk via audio manager (pipeline rate)
            if resp.audio_pcm:
                from app.audio.manager import audio_registry
                audio_mgr = audio_registry.get(self.session_id)
                if audio_mgr:
                    try:
                        audio_mgr.write_alex_audio(resp.audio_pcm)
                    except Exception as e:
                        log.debug(f"Alex audio write error: {e}")

            # Broadcast text + audio + lipsync timings via JSON WebSocket
            await ws_manager.broadcast(self.session_id, build_alex_speaking(
                session_id=self.session_id,
                text=resp.text,
                speech=resp.speech,
                audio_pcm=resp.audio_pcm,
                source=resp.source.value,
                condition=resp.condition,
                trigger=resp.trigger,
                llm_latency_ms=resp.llm_latency_ms,
                tts_latency_ms=resp.tts_latency_ms,
            ))

            # Push facilitator status to researcher dashboard (avoids polling)
            await ws_manager.send_to_researcher(self.session_id, {
                "type": "facilitator_status",
                "data": {
                    "active": True,
                    "intervention_count": self._facilitator.intervention_count if self._facilitator else 0,
                    "seconds_until_next": self._facilitator.seconds_until_next if self._facilitator else 0,
                    "last_response": resp.text,
                    "model": config.ollama.model,
                },
            })

        # Determine anchor option for C3 — resolve to actual candidate name
        anchor = ""
        if condition == Condition.C3_ANCHORING:
            from app.session.bibd import resolve_c3_anchor_option

            block = self.state_machine.current_block
            if block:
                anchor_id = resolve_c3_anchor_option(block.task_id, self._anchoring_direction or "incorrect")
                task = task_registry.get(block.task_id)
                if task and anchor_id:
                    anchor = next((c.name for c in task.candidates if c.id == anchor_id), anchor_id)
                else:
                    anchor = anchor_id or ""

        self._facilitator = FacilitatorEngine(
            condition=condition,
            event_logger=self._event_logger,
            lsl_logger=self._lsl_logger,
            anchor_option=anchor,
            target_participant=self._amplification_target,
            task_id=self.state_machine.current_block.task_id if self.state_machine.current_block else "",
            on_response=on_response,
        )
        await self._facilitator.start()

        self._suggestor = ResponseSuggestor(self._facilitator)
        await self._suggestor.start()

    async def _stop_facilitator(self) -> None:
        """Stop current facilitator and suggestor."""
        if self._suggestor:
            await self._suggestor.stop()
            self._suggestor = None
        if self._facilitator:
            await self._facilitator.stop()
            self._facilitator = None

    # ── State Machine Callbacks ────────────────────────────────────────────

    async def _on_phase_change(self, block: TaskBlockState, phase: Phase) -> None:
        """Called when phase changes within a block."""
        self._event_logger.log(EventEntry(
            type=EventType.PHASE_CHANGE,
            phase=phase.value,
            condition=block.condition.value,
        ))
        self._lsl_logger.push("phase_change", f"{block.condition.value}:{phase.value}")

        # Clear per-phase tracking state (votes, surveys) on each phase transition
        from app.session.manager import session_manager
        active_session = session_manager.get_session(self.session_id)
        if active_session:
            active_session.votes.clear()
            active_session.surveys.clear()

        # Enable/disable facilitator triggers based on phase
        if self._facilitator:
            discussion_phases = {Phase.P1_OPENING, Phase.P2_OPENING, Phase.OPEN_DISCUSSION}
            if phase in discussion_phases:
                self._facilitator._triggers.enable()
            else:
                self._facilitator._triggers.disable()

        # Live metrics loop runs only during open_discussion. Start on enter,
        # cancel on exit. The researcher dashboard renders <LiveMetrics /> from
        # `metrics_update` WS frames pushed by this loop.
        if phase == Phase.OPEN_DISCUSSION:
            await self._start_metrics_loop()
        else:
            await self._stop_metrics_loop()

        # Broadcast status
        status = self.state_machine.get_status()
        status["mode"] = self._mode
        await ws_manager.broadcast(self.session_id, {
            "type": "phase_change",
            "data": status,
        })

        self._start_live_transition_if_needed(phase)

    def _start_live_transition_if_needed(self, phase: Phase) -> None:
        """Start live-study transition facilitation without blocking phase/mic updates."""
        if self._mode != "study" or not self._facilitator:
            return
        trigger_by_phase = {
            Phase.P2_OPENING: "phase_transition:p1_to_p2",
            Phase.OPEN_DISCUSSION: "phase_transition:p2_to_open_discussion",
            Phase.DECISION: "phase_transition:pre_vote_summary",
        }
        trigger = trigger_by_phase.get(phase)
        if not trigger:
            return

        task = asyncio.create_task(self._facilitator.generate_intervention(trigger))

        def _log_failure(done: asyncio.Task) -> None:
            try:
                done.result()
            except Exception as e:
                log.warning(f"[Facilitator] transition intervention failed ({trigger}): {e}")

        task.add_done_callback(_log_failure)

    async def _on_block_change(self, block: TaskBlockState) -> None:
        """Called when transitioning to a new block. Switch facilitator."""
        self._event_logger.log(EventEntry(
            type=EventType.PHASE_CHANGE,
            phase="block_start",
            condition=block.condition.value,
            extra={"block_number": block.block_number, "task_id": block.task_id},
        ))
        self._lsl_logger.push("block_start", f"b{block.block_number}:{block.condition.value}")

        # Switch facilitator to new condition
        await self._start_facilitator(block.condition)

        await ws_manager.broadcast(self.session_id, {
            "type": "block_change",
            "data": {
                "block_number": block.block_number,
                "condition": block.condition.value,
                "task_id": block.task_id,
            },
        })

    async def _on_session_end(self) -> None:
        """Called when all blocks are completed. Clean up all resources."""
        await self._stop_facilitator()
        await self._stop_metrics_loop()
        self._event_logger.log(EventEntry(type=EventType.SESSION_END))
        self._lsl_logger.push("session_end", "all_blocks_completed")

        # Auto-compute metrics.json so the SessionComplete view can render
        # results without making the researcher click anything. Failure is
        # non-fatal — JSONL artifacts remain and the CLI tool can be run
        # later to regenerate.
        try:
            from app.session.manager import session_manager as _sm
            _active = _sm.get_session(self.session_id)
            if _active:
                from scripts.analysis.compute_metrics import compute_session_metrics
                _project_root = Path(__file__).resolve().parents[3]
                _m = compute_session_metrics(_active.session_dir, _project_root)
                import json as _json
                (_active.session_dir / "metrics.json").write_text(
                    _json.dumps(_m.to_dict(), indent=2) + "\n"
                )
        except Exception as e:
            log.warning(f"[metrics] session-end compute failed: {e}")

        await ws_manager.broadcast(self.session_id, {
            "type": "session_ended",
            "data": {"reason": "all_blocks_completed"},
        })

        # Clean up resources
        from app.session.manager import session_manager
        from app.livekit.rooms import delete_room
        from app.audio.manager import audio_registry
        from app.video.recorder import video_registry

        # Stop audio manager
        try:
            await audio_registry.remove_async(self.session_id)
        except Exception as e:
            log.warning(f"Audio manager cleanup error: {e}")

        # Close video recorder (flushes WebM files)
        try:
            video_registry.remove(self.session_id)
        except Exception as e:
            log.warning(f"Video recorder cleanup error: {e}")

        # Disconnect Alex agent from LiveKit
        if self._alex_agent:
            try:
                await self._alex_agent.disconnect()
            except Exception as e:
                log.warning(f"Alex agent disconnect error: {e}")

        # Delete LiveKit room
        try:
            await delete_room(self.session_id)
        except Exception as e:
            log.warning(f"LiveKit room delete error: {e}")

        session = session_manager.get_session(self.session_id)
        if session:
            session.stop("completed")

    async def _on_mic_change(self, mics: dict[str, MicState]) -> None:
        """Log mic state per role and broadcast to participants.

        Two events emitted per call (one per role), so post-hoc analysis can
        reconstruct who was allowed to speak when. For C0 in particular
        these are the only observable artifacts of the strict baseline,
        since there are no AI events.
        """
        sm = self.state_machine
        block = sm.current_block if sm else None
        phase = block.current_phase.value if block and block.current_phase else None
        condition = block.condition.value if block else None
        for role in ("P1", "P2"):
            state = mics.get(role, MicState.MUTED)
            self._event_logger.log(EventEntry(
                type=EventType.MIC_MUTE if state == MicState.MUTED else EventType.MIC_UNMUTE,
                phase=phase,
                condition=condition,
                speaker=role,
            ))

        await ws_manager.broadcast(self.session_id, {
            "type": "mic_change",
            "data": {
                "P1": mics.get("P1", MicState.MUTED).value,
                "P2": mics.get("P2", MicState.MUTED).value,
            },
        })

    # ── Live Metrics (Wave 5) ──────────────────────────────────────────────

    async def _start_metrics_loop(self) -> None:
        """Begin a 30-second cadence metrics broadcast for the researcher.
        Idempotent: if already running, leaves the existing task alone.
        Reads the session's transcript.jsonl + events.jsonl on each tick and
        pushes a `metrics_update` WS frame to the researcher only."""
        if self._metrics_task and not self._metrics_task.done():
            return
        self._metrics_task = asyncio.create_task(self._metrics_loop())

    async def _stop_metrics_loop(self) -> None:
        if self._metrics_task and not self._metrics_task.done():
            self._metrics_task.cancel()
            try:
                await self._metrics_task
            except (asyncio.CancelledError, Exception):
                pass
        self._metrics_task = None

    async def _metrics_loop(self) -> None:
        """Recompute metrics every 30s during open_discussion. Cancellable."""
        # Resolve session dir + project root once
        from app.session.manager import session_manager
        active = session_manager.get_session(self.session_id)
        if not active:
            return
        session_dir: Path = active.session_dir
        # backend/app/session/orchestrator.py → project root is parents[3]
        project_root: Path = Path(__file__).resolve().parents[3]
        # Lazy import to avoid CLI script side effects on backend startup
        from scripts.analysis.compute_metrics import compute_session_metrics

        try:
            while True:
                await asyncio.sleep(30)
                try:
                    m = compute_session_metrics(
                        session_dir, project_root, now=time.time(),
                    )
                    await ws_manager.send_to_researcher(self.session_id, {
                        "type": "metrics_update",
                        "data": m.to_dict(),
                    })
                except Exception as e:
                    log.warning(f"[metrics] live compute failed: {e}")
        except asyncio.CancelledError:
            return

    async def _on_timer_expired(self, block: TaskBlockState, phase: Phase) -> None:
        """Called when a phase timer expires (before auto-advance)."""
        self._event_logger.log(EventEntry(
            type=EventType.PHASE_CHANGE,
            phase=f"{phase.value}_expired",
            condition=block.condition.value,
        ))
        await ws_manager.send_to_researcher(self.session_id, {
            "type": "timer_expired",
            "data": {"phase": phase.value, "block": block.block_number},
        })
