"""
Session state machine. Manages phase progression within a task block.
Includes mic muting rules, auto-advance, and async callbacks.
"""
import time
import asyncio
from typing import Optional, Callable, Awaitable
from dataclasses import dataclass, field
from enum import Enum

from app.config import Phase, TASK_BLOCK_PHASES, PHASE_DURATIONS, Condition, config


# ── Mic Rules ──────────────────────────────────────────────────────────────

class MicState(str, Enum):
    OPEN = "open"
    MUTED = "muted"


def get_mic_rules(phase: Phase) -> dict[str, MicState]:
    """
    Returns mic state for each role based on current phase.
    PRD Section 3.2: structured turn-taking with muting.

    Strict baseline: all conditions (incl. C0) share the same mic enforcement
    so the only between-condition variable is the AI's behaviour, not the
    discussion structure. Plan: docs/superpowers/plans/2026-04-28-c0-improvements.md
    """
    capture_role = config.participant_audio.capture_role
    if capture_role in ("P1", "P2"):
        return {
            "P1": MicState.OPEN if capture_role == "P1" else MicState.MUTED,
            "P2": MicState.OPEN if capture_role == "P2" else MicState.MUTED,
        }

    rules = {
        Phase.INFO_READING:     {"P1": MicState.MUTED, "P2": MicState.MUTED},
        Phase.PREFERENCE:       {"P1": MicState.MUTED, "P2": MicState.MUTED},
        Phase.P1_OPENING:       {"P1": MicState.OPEN,  "P2": MicState.MUTED},
        Phase.P2_OPENING:       {"P1": MicState.MUTED, "P2": MicState.OPEN},
        Phase.OPEN_DISCUSSION:  {"P1": MicState.OPEN,  "P2": MicState.OPEN},
        Phase.DECISION:         {"P1": MicState.OPEN,  "P2": MicState.OPEN},
        Phase.SURVEY:           {"P1": MicState.MUTED, "P2": MicState.MUTED},
        Phase.WASHOUT:          {"P1": MicState.MUTED, "P2": MicState.MUTED},
    }
    return rules.get(phase, {"P1": MicState.OPEN, "P2": MicState.OPEN})


# ── Phase State ────────────────────────────────────────────────────────────

@dataclass
class PhaseState:
    phase: Phase
    started_at: float = 0.0
    duration_seconds: float = 0.0
    paused: bool = False
    pause_started_at: float = 0.0
    total_paused_seconds: float = 0.0

    @property
    def elapsed(self) -> float:
        if self.paused:
            return self.pause_started_at - self.started_at - self.total_paused_seconds
        return time.time() - self.started_at - self.total_paused_seconds

    @property
    def remaining(self) -> float:
        if self.duration_seconds <= 0:
            return float("inf")
        return max(0, self.duration_seconds - self.elapsed)

    @property
    def expired(self) -> bool:
        return self.duration_seconds > 0 and self.remaining <= 0


# ── Task Block State ───────────────────────────────────────────────────────

@dataclass
class TaskBlockState:
    """State for one task block (one condition)."""
    block_number: int  # 1-4
    condition: Condition
    task_id: str
    session_id: str
    current_phase_index: int = 0
    current_phase_state: Optional[PhaseState] = None
    completed: bool = False
    started_at: float = 0.0
    ended_at: float = 0.0

    @property
    def current_phase(self) -> Optional[Phase]:
        if self.current_phase_index < len(TASK_BLOCK_PHASES):
            return TASK_BLOCK_PHASES[self.current_phase_index]
        return None

    @property
    def mic_rules(self) -> dict[str, MicState]:
        phase = self.current_phase
        if phase is None:
            return {"P1": MicState.MUTED, "P2": MicState.MUTED}
        return get_mic_rules(phase)


# ── Callbacks ──────────────────────────────────────────────────────────────

@dataclass
class StateMachineCallbacks:
    """Async callbacks fired by the state machine."""
    on_phase_change: Optional[Callable[[TaskBlockState, Phase], Awaitable[None]]] = None
    on_block_change: Optional[Callable[[TaskBlockState], Awaitable[None]]] = None
    on_session_end: Optional[Callable[[], Awaitable[None]]] = None
    on_mic_change: Optional[Callable[[dict[str, MicState]], Awaitable[None]]] = None
    on_timer_expired: Optional[Callable[[TaskBlockState, Phase], Awaitable[None]]] = None


# ── State Machine ──────────────────────────────────────────────────────────

class SessionStateMachine:
    """
    Manages phase progression for a single-run session (one condition × one task).
    The block-list machinery is retained because the orchestrator still iterates
    over `self.blocks`; in single-run mode the list always has length 1.
    Supports auto-advance on timer expiry.
    """

    def __init__(
        self,
        session_id: str,
        conditions: list[Condition],
        task_ids: list[str],
        callbacks: Optional[StateMachineCallbacks] = None,
        auto_advance: bool = False,
        anchoring_direction: str = "",
        amplification_target: str = "",
    ):
        self.session_id = session_id
        self._callbacks = callbacks or StateMachineCallbacks()
        self._auto_advance = auto_advance
        self._anchoring_direction = anchoring_direction
        self._amplification_target = amplification_target

        self.blocks: list[TaskBlockState] = []
        for i, (cond, task) in enumerate(zip(conditions, task_ids)):
            self.blocks.append(TaskBlockState(
                block_number=i + 1,
                condition=cond,
                task_id=task,
                session_id=session_id,
            ))

        self.current_block_index = 0
        self.session_started = False
        self.session_ended = False
        self._advancing = False  # Guard against concurrent advance_phase() calls
        self._timer_task: Optional[asyncio.Task] = None

    @property
    def current_block(self) -> Optional[TaskBlockState]:
        if 0 <= self.current_block_index < len(self.blocks):
            return self.blocks[self.current_block_index]
        return None

    @property
    def current_phase(self) -> Optional[Phase]:
        block = self.current_block
        if block is None:
            return None
        return block.current_phase

    @property
    def current_phase_state(self) -> Optional[PhaseState]:
        block = self.current_block
        if block is None:
            return None
        return block.current_phase_state

    @property
    def mic_rules(self) -> dict[str, MicState]:
        block = self.current_block
        if block is None:
            return {"P1": MicState.MUTED, "P2": MicState.MUTED}
        return block.mic_rules

    async def start_session(self) -> None:
        if self.session_started:
            return  # Already started — don't reset
        self.session_started = True
        await self._start_block(0)

    async def _start_block(self, index: int) -> None:
        if index >= len(self.blocks):
            if self.session_ended:
                return  # Already ended — prevent double callback
            self.session_ended = True
            if self._callbacks.on_session_end:
                await self._callbacks.on_session_end()
            return
        self.current_block_index = index
        block = self.blocks[index]
        block.started_at = time.time()

        if self._callbacks.on_block_change:
            await self._callbacks.on_block_change(block)

        await self._start_phase(0)

    async def _start_phase(self, phase_index: int) -> None:
        block = self.current_block
        if block is None:
            return
        if phase_index >= len(TASK_BLOCK_PHASES):
            block.completed = True
            block.ended_at = time.time()
            await self._start_block(self.current_block_index + 1)
            return

        block.current_phase_index = phase_index
        phase = TASK_BLOCK_PHASES[phase_index]
        duration = PHASE_DURATIONS.get(phase, 0)
        block.current_phase_state = PhaseState(
            phase=phase,
            started_at=time.time(),
            duration_seconds=duration,
        )

        # Fire callbacks (wrapped to prevent stuck phases if callback raises)
        try:
            if self._callbacks.on_phase_change:
                await self._callbacks.on_phase_change(block, phase)
        except Exception as e:
            import logging
            logging.getLogger("state_machine").error(f"on_phase_change callback error: {e}")
        try:
            if self._callbacks.on_mic_change:
                await self._callbacks.on_mic_change(block.mic_rules)
        except Exception as e:
            import logging
            logging.getLogger("state_machine").error(f"on_mic_change callback error: {e}")

        # Start auto-advance timer
        self._cancel_timer()
        if self._auto_advance and duration > 0:
            self._timer_task = asyncio.create_task(self._auto_advance_timer(duration))

    async def _auto_advance_timer(self, seconds: float) -> None:
        """Wait for phase duration, then auto-advance.
        Guards against stale timers by verifying block/phase hasn't changed."""
        expected_block = self.current_block_index
        expected_phase = self.current_block.current_phase_index if self.current_block else -1
        try:
            await asyncio.sleep(seconds)
            # Verify we're still in the expected block/phase (guards against race)
            if self.current_block_index != expected_block:
                return
            if self.current_block and self.current_block.current_phase_index != expected_phase:
                return
            ps = self.current_phase_state
            if ps and ps.expired and not ps.paused:
                block = self.current_block
                phase = self.current_phase
                if block and phase and self._callbacks.on_timer_expired:
                    await self._callbacks.on_timer_expired(block, phase)
                if self._auto_advance:
                    await self.advance_phase()
        except asyncio.CancelledError:
            pass
        except Exception:
            import logging
            logging.getLogger("state_machine").exception("Auto-advance timer error")

    def _cancel_timer(self) -> None:
        if self._timer_task and not self._timer_task.done():
            self._timer_task.cancel()

    async def advance_phase(self) -> Optional[Phase]:
        """Manually advance to the next phase. Returns the new phase or None.
        Guarded against concurrent calls (e.g. timer + survey auto-advance race)."""
        if self._advancing or self.session_ended:
            return self.current_phase
        self._advancing = True
        try:
            self._cancel_timer()
            block = self.current_block
            if block is None:
                return None
            await self._start_phase(block.current_phase_index + 1)
            return self.current_phase
        finally:
            self._advancing = False

    async def advance_block(self) -> Optional[int]:
        """Skip remaining phases and move to next block. Returns new block number or None."""
        self._cancel_timer()
        block = self.current_block
        if block:
            block.completed = True
            block.ended_at = time.time()
        await self._start_block(self.current_block_index + 1)
        new_block = self.current_block
        return new_block.block_number if new_block else None

    async def pause(self) -> None:
        ps = self.current_phase_state
        if ps and not ps.paused:
            ps.paused = True
            ps.pause_started_at = time.time()
            self._cancel_timer()

    async def resume(self) -> None:
        if self.session_ended:
            return
        ps = self.current_phase_state
        if ps and ps.paused:
            ps.total_paused_seconds += time.time() - ps.pause_started_at
            ps.paused = False
            # Restart auto-advance timer with remaining time
            self._cancel_timer()
            if self._auto_advance and ps.remaining > 0:
                self._timer_task = asyncio.create_task(
                    self._auto_advance_timer(ps.remaining)
                )

    def extend_time(self, seconds: float) -> None:
        if self.session_ended:
            return
        ps = self.current_phase_state
        if ps:
            ps.duration_seconds += seconds
            # Restart auto-advance timer with updated remaining time
            if self._auto_advance and not ps.paused and ps.remaining > 0:
                self._cancel_timer()
                self._timer_task = asyncio.create_task(
                    self._auto_advance_timer(ps.remaining)
                )

    def stop(self) -> None:
        """Stop all timers."""
        self._cancel_timer()

    def get_status(self) -> dict:
        block = self.current_block
        ps = self.current_phase_state
        mics = self.mic_rules
        return {
            "session_id": self.session_id,
            "session_started": self.session_started,
            "session_ended": self.session_ended,
            "current_block": block.block_number if block else None,
            "total_blocks": len(self.blocks),
            "condition": block.condition.value if block else None,
            "task_id": block.task_id if block else None,
            "phase": ps.phase.value if ps else None,
            "phase_elapsed": round(ps.elapsed, 1) if ps else None,
            "phase_remaining": round(ps.remaining, 1) if ps else None,
            "phase_paused": ps.paused if ps else None,
            "mic_p1": mics.get("P1", MicState.MUTED).value,
            "mic_p2": mics.get("P2", MicState.MUTED).value,
            "participant_audio_capture_role": config.participant_audio.capture_role,
            "livekit_participant_audio_enabled": config.participant_audio.livekit_microphone_enabled,
            "remote_participant_audio_enabled": config.participant_audio.remote_participant_playback_enabled,
            "anchoring_direction": self._anchoring_direction or None,
            "amplification_target": self._amplification_target or None,
        }
