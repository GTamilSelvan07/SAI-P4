"""
AI Facilitator Engine — the core of the experiment.
Routes conditions, generates responses, gates quality, and delivers via TTS.

Pipeline per PRD Section 5.1:
  Generate → Quality Gate → Deliver (TTS) | Failsafe
"""
import time
import asyncio
import logging
from typing import Optional, Callable, Awaitable
from dataclasses import dataclass, field
from pathlib import Path

from app.config import config, Condition, PROMPTS_DIR, FAILSAFE_TIMEOUT_SECONDS

log = logging.getLogger(__name__)
from app.models import EventEntry, EventType, AISource, TriggerType
from app.logging.events import EventLogger
from app.logging.lsl_markers import LSLMarkerLogger
from app.ai.ollama_client import ollama, LLMResponse
from app.ai.quality_gate import check_quality
from app.ai.triggers import TriggerEvaluator, TriggerReason
from app.audio.speech import SpeechAudio
from app.audio.tts import create_tts
from app.audio.failsafe import failsafe_manager


def _log_task_exception(task: "asyncio.Task") -> None:
    """Done-callback for fire-and-forget tasks: surface exceptions to the log."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.warning("[Facilitator] background task failed: %r", exc)


# Load prompt templates
def _load_prompt(filename: str) -> str:
    path = PROMPTS_DIR / filename
    if path.exists():
        return path.read_text()
    log.warning("[Facilitator] Prompt file %s not found — condition will use empty prompt", path)
    return ""


PROMPTS = {
    Condition.C1_SHAM: _load_prompt("c1_neutral_minimal.txt"),
    Condition.C2_NEUTRAL: _load_prompt("c2_neutral.txt"),
    Condition.C3_ANCHORING: _load_prompt("c3_anchoring.txt"),
    Condition.C4_AMPLIFICATION: _load_prompt("c4_amplification.txt"),
    Condition.C5_DEVIL_ADVOCATE: _load_prompt("c5_devil_advocate.txt"),
}

# Generic neutral filler, used ONLY as failsafe text when the LLM times out.
FAILSAFE_FILLER_MESSAGES = [
    "The discussion is ongoing. Both of you have been contributing.",
    "The discussion is progressing well. Both participants have shared their thoughts.",
    "Thank you for your contributions so far. The conversation is moving forward.",
    "Both of you have been actively engaged. Let's continue.",
    "The discussion is continuing. All participants have contributed.",
]


@dataclass
class FacilitatorContext:
    """Running context for the facilitator within a session."""
    condition: Condition
    task_id: str = ""
    anchor_option: str = ""         # For C3
    target_participant: str = ""    # For C4
    transcript_lines: list[str] = field(default_factory=list)
    intervention_count: int = 0
    last_response: str = ""
    intervention_history: list[str] = field(default_factory=list)
    pre_generated_response: Optional[str] = None
    pre_generated_at: float = 0.0
    pre_generated_transcript_len: int = 0


@dataclass
class FacilitatorResponse:
    """Result of a facilitator intervention."""
    text: str
    audio_pcm: Optional[bytes]  # raw PCM16 at AUDIO_SAMPLE_RATE for injection + recording
    speech: Optional[SpeechAudio]  # browser-rate audio + lipsync timings, if the engine produced them
    source: AISource
    model: Optional[str]
    llm_latency_ms: int
    tts_latency_ms: int
    trigger: str
    condition: str
    failure_mode: str  # F0 (none), F3, F4, F5, etc.


class FacilitatorEngine:
    """
    Orchestrates AI facilitation for a single session.
    Handles condition routing, LLM generation, quality gating, TTS, and failsafe.
    """

    def __init__(
        self,
        condition: Condition,
        event_logger: EventLogger,
        lsl_logger: LSLMarkerLogger,
        anchor_option: str = "",
        target_participant: str = "",
        task_id: str = "",
        on_response: Optional[Callable[[FacilitatorResponse], Awaitable[None]]] = None,
    ):
        self._condition = condition
        self._event_logger = event_logger
        self._lsl_logger = lsl_logger
        self._on_response = on_response

        self._ctx = FacilitatorContext(
            condition=condition,
            task_id=task_id,
            anchor_option=anchor_option,
            target_participant=target_participant,
        )

        self._triggers = TriggerEvaluator()
        self._tts = create_tts()
        self._running = False
        self._trigger_task: Optional[asyncio.Task] = None
        self._intervention_lock = asyncio.Lock()
        self._last_intervention_time = 0.0

    async def start(self) -> None:
        """Start the facilitator engine."""
        await ollama.start()

        # Health check: verify Ollama is reachable and model is loaded
        if self._condition != Condition.C0_NO_AI:
            available = await ollama.is_available()
            if not available:
                log.warning(
                    f"[Facilitator] Ollama NOT reachable at startup — "
                    f"LLM interventions will fail back to failsafe clips"
                )

        clip_count = failsafe_manager.load_clips()
        if clip_count == 0:
            log.warning("[Facilitator] No failsafe WAV clips found — failsafe audio will use live TTS fallback")

        self._triggers.start()
        self._running = True

        # Start trigger evaluation loop (except C0)
        if self._condition != Condition.C0_NO_AI:
            self._trigger_task = asyncio.create_task(self._trigger_loop())

    async def stop(self) -> None:
        """Stop the facilitator engine."""
        self._running = False
        if self._trigger_task:
            self._trigger_task.cancel()
            try:
                await self._trigger_task
            except asyncio.CancelledError:
                pass
        await ollama.stop()

    def add_transcript(self, speaker: str, text: str) -> None:
        """
        Add a transcript line. Fires keyword trigger internally if detected.
        """
        line = f"{speaker}: {text}"
        self._ctx.transcript_lines.append(line)

        # Check keyword trigger — handle internally to avoid double-fire
        reason = self._triggers.on_speech(text)
        if reason:
            task = asyncio.create_task(self.generate_intervention(reason))
            task.add_done_callback(_log_task_exception)

    async def generate_intervention(self, trigger: str) -> Optional[FacilitatorResponse]:
        """
        Full pipeline: Generate → Quality Gate → TTS → Response.
        Falls back to failsafe on timeout or quality failure.
        Uses lock + cooldown to prevent double-firing.
        """
        async with self._intervention_lock:
            # Cooldown: ignore triggers within configured window of last intervention
            is_transition = trigger.startswith("phase_transition:")
            if not is_transition and time.time() - self._last_intervention_time < config.triggers.cooldown_seconds:
                return None
            response = await self._generate_intervention_inner(trigger)
            if response is not None:
                self._last_intervention_time = time.time()
            return response

    async def _generate_intervention_inner(self, trigger: str) -> FacilitatorResponse:
        """Inner implementation of intervention generation (called under lock)."""
        t0 = time.time()

        # C0: No AI — should never be called
        if self._condition == Condition.C0_NO_AI:
            return FacilitatorResponse(
                text="", audio_pcm=None, speech=None, source=AISource.LIVE_LLM,
                model=None, llm_latency_ms=0, tts_latency_ms=0,
                trigger=trigger, condition="C0", failure_mode="F0",
            )

        # C1-C5: LLM generation with quality gate. C1 uses a deliberately
        # minimal, content-agnostic neutral prompt; C2-C5 apply their bias.
        failure_mode = self._get_failure_mode()
        is_transition = trigger.startswith("phase_transition:")

        # Try pre-generated response first (discard if stale: >15s or >3 new transcript lines)
        if (
            not is_transition
            and self._ctx.pre_generated_response
            and time.time() - self._ctx.pre_generated_at < 15
            and len(self._ctx.transcript_lines) - self._ctx.pre_generated_transcript_len <= 3
        ):
            text = self._ctx.pre_generated_response
            self._ctx.pre_generated_response = None
            source = AISource.PRE_GENERATED
            llm_latency = 0
        else:
            # Generate fresh
            result = await self._generate_llm_response(trigger)
            if result is None:
                log.warning(
                    f"[Facilitator] LLM generation failed/timed out for {self._condition.value} "
                    f"(trigger={trigger}) — falling back to failsafe"
                )
                return await self._failsafe_response(trigger, failure_mode)
            text = result.text
            source = AISource.LIVE_LLM
            llm_latency = result.latency_ms

        # Quality gate — pass condition context for accurate validation
        recent_transcript = "\n".join(self._ctx.transcript_lines[-5:])
        passed = await check_quality(
            self._condition, text,
            anchor_option=self._ctx.anchor_option,
            target_participant=self._ctx.target_participant,
            recent_transcript=recent_transcript,
        )
        if not passed:
            # Retry once
            self._event_logger.log(EventEntry(
                type=EventType.AI_QUALITY_GATE_FAIL,
                condition=self._condition.value,
                content=text,
            ))
            result2 = await self._generate_llm_response(trigger)
            if result2 is None or not await check_quality(
                self._condition, result2.text,
                anchor_option=self._ctx.anchor_option,
                target_participant=self._ctx.target_participant,
                recent_transcript=recent_transcript,
            ):
                # Double fail — use failsafe
                return await self._failsafe_response(trigger, failure_mode)
            text = result2.text
            source = AISource.REGENERATED_LLM
            llm_latency = result2.latency_ms

        # TTS (run in executor to avoid blocking event loop)
        tts_t0 = time.time()
        speech = await asyncio.get_running_loop().run_in_executor(
            None, self._tts.synthesize_speech, text
        )
        tts_latency = int((time.time() - tts_t0) * 1000)

        tts_pcm = speech.pcm16_pipeline if speech else None
        if tts_pcm is None:
            # TTS failed — use failsafe audio but keep the LLM text
            failsafe_audio = failsafe_manager.get_failsafe_for_condition(self._condition)
            tts_pcm = failsafe_audio  # may still be None if clips missing

        self._ctx.last_response = text
        self._ctx.intervention_count += 1
        self._ctx.intervention_history.append(text)
        # Cap history to prevent unbounded memory growth (only last 10 used for context)
        if len(self._ctx.intervention_history) > 20:
            self._ctx.intervention_history = self._ctx.intervention_history[-10:]
        self._triggers.state.reset_after_intervention()

        response = FacilitatorResponse(
            text=text, audio_pcm=tts_pcm, speech=speech, source=source,
            model=config.ollama.model, llm_latency_ms=llm_latency,
            tts_latency_ms=tts_latency, trigger=trigger,
            condition=self._condition.value, failure_mode=failure_mode,
        )

        # Log
        self._event_logger.log(EventEntry(
            type=EventType.AI_INTERVENTION,
            condition=self._condition.value,
            content=text,
            trigger=TriggerType(trigger) if trigger in TriggerType._value2member_map_ else None,
            failure_mode=failure_mode,
            model=config.ollama.model,
            llm_latency_ms=llm_latency,
            tts_latency_ms=tts_latency,
            source=source,
        ))
        self._lsl_logger.push("ai_intervention", f"{self._condition.value}:{trigger}")

        # Notify
        if self._on_response:
            try:
                await self._on_response(response)
            except Exception as e:
                log.debug(f"Broadcast failure in generate_intervention: {e}")

        return response

    async def pre_generate(self) -> None:
        """Background pre-generation for Response Suggestor."""
        if self._condition == Condition.C0_NO_AI:
            return
        result = await self._generate_llm_response("pregeneration")
        if result:
            self._ctx.pre_generated_response = result.text
            self._ctx.pre_generated_at = time.time()
            self._ctx.pre_generated_transcript_len = len(self._ctx.transcript_lines)

    async def _generate_llm_response(self, trigger: str = "general") -> Optional[LLMResponse]:
        """Generate a response using the condition-specific prompt with conversation history."""
        system_prompt = self._build_system_prompt()
        user_prompt = self._build_user_prompt(trigger)

        # Build multi-turn messages with Alex's prior interventions for continuity
        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        for prev in self._ctx.intervention_history[-3:]:
            messages.append({"role": "assistant", "content": prev})
        messages.append({"role": "user", "content": user_prompt})

        return await ollama.chat(
            messages=messages,
            temperature=config.ollama.temperature,
            max_tokens=500,
        )

    def _build_system_prompt(self) -> str:
        """Build the system prompt with condition-specific variables filled in."""
        template = PROMPTS.get(self._condition, "")
        return template.format(
            anchor_option=self._ctx.anchor_option,
            target_participant=self._ctx.target_participant,
        )

    def _build_user_prompt(self, trigger: str) -> str:
        """Build the user prompt from recent transcript."""
        recent = self._ctx.transcript_lines[-14:]
        transcript_text = "\n".join(recent) if recent else "[No discussion yet]"
        task_context = self._task_context_for_prompt()
        transition_goal = self._transition_goal(trigger)
        return (
            f"Task context:\n{task_context}\n\n"
            f"Trigger: {trigger}\n"
            f"Transition goal: {transition_goal}\n\n"
            f"Discussion transcript (last {len(recent)} turns):\n"
            f"{transcript_text}\n\n"
            f"Previous Alex interventions:\n"
            f"{self._previous_interventions_for_prompt()}\n\n"
            f"Intervention #{self._ctx.intervention_count + 1}. "
            f"Respond as Alex in 2-4 spoken sentences. Continue naturally from the transcript. "
            f"Do not mention facts that are not in the transcript unless they are public task context."
        )

    def _task_context_for_prompt(self) -> str:
        if not self._ctx.task_id:
            return "[No task context available]"
        try:
            from app.tasks import task_registry
            task = task_registry.get(self._ctx.task_id)
            if not task:
                return f"Task id: {self._ctx.task_id}"
            candidates = ", ".join(f"{c.id}: {c.name}" for c in task.candidates)
            return (
                f"Title: {task.title}\n"
                f"Description: {task.description}\n"
                f"Candidates: {candidates}\n"
                f"P1 persona: {task.p1_persona}\n"
                f"P2 persona: {task.p2_persona}\n"
                f"Public/shared facts only: {'; '.join(task.shared_info)}"
            )
        except Exception as e:
            log.warning(f"[Facilitator] task context unavailable for {self._ctx.task_id}: {e}")
            return f"Task id: {self._ctx.task_id}"

    def _previous_interventions_for_prompt(self) -> str:
        prev = self._ctx.intervention_history[-3:]
        return "\n".join(f"- {p}" for p in prev) if prev else "[None]"

    def _transition_goal(self, trigger: str) -> str:
        goals = {
            "phase_transition:p1_to_p2": "After P1's opening, briefly summarise P1's contribution, apply the condition framing, and hand over to P2.",
            "phase_transition:p2_to_open_discussion": "After P2's opening, summarise both openings, apply the condition framing, and invite both participants into open discussion.",
            "phase_transition:pre_vote_summary": "Before final voting, summarise the discussion direction, apply the condition framing, and ask for the final choice.",
        }
        return goals.get(trigger, "Respond to the current discussion moment with a concise facilitation intervention.")

    async def _failsafe_response(self, trigger: str, failure_mode: str) -> FacilitatorResponse:
        """Return a failsafe clip when LLM fails.
        Tries pre-recorded WAV clips first, falls back to live TTS synthesis."""
        speech: Optional[SpeechAudio] = None
        audio_bytes = failsafe_manager.get_failsafe_for_condition(self._condition)

        self._event_logger.log(EventEntry(
            type=EventType.AI_TIMEOUT,
            condition=self._condition.value,
            source=AISource.FAILSAFE_CLIP,
        ))

        # Use a generic failsafe text
        text = FAILSAFE_FILLER_MESSAGES[self._ctx.intervention_count % len(FAILSAFE_FILLER_MESSAGES)]

        # If no pre-recorded clips, synthesize via TTS so participants hear audio
        if audio_bytes is None:
            try:
                speech = await asyncio.get_running_loop().run_in_executor(
                    None, self._tts.synthesize_speech, text
                )
                audio_bytes = speech.pcm16_pipeline if speech else None
            except Exception as e:
                log.warning(f"[Facilitator] Failsafe TTS synthesis failed: {e}")

        self._ctx.last_response = text
        self._ctx.intervention_count += 1
        self._ctx.intervention_history.append(text)
        self._triggers.state.reset_after_intervention()

        response = FacilitatorResponse(
            text=text, audio_pcm=audio_bytes, speech=speech, source=AISource.FAILSAFE_CLIP,
            model=None, llm_latency_ms=0, tts_latency_ms=0,
            trigger=trigger, condition=self._condition.value,
            failure_mode=failure_mode,
        )

        if self._on_response:
            try:
                await self._on_response(response)
            except Exception as e:
                log.debug(f"Broadcast failure in failsafe_response: {e}")

        return response

    def _get_failure_mode(self) -> str:
        """Map condition to failure mode code."""
        mapping = {
            Condition.C2_NEUTRAL: "F0",
            Condition.C3_ANCHORING: "F3",
            Condition.C4_AMPLIFICATION: "F4",
            Condition.C5_DEVIL_ADVOCATE: "F5",
        }
        return mapping.get(self._condition, "F0")

    async def _trigger_loop(self) -> None:
        """Background loop that checks triggers every second.
        C1 (minimal neutral) fires the LLM on a fixed timer rather than on
        dynamic content triggers — deliberately generic and content-agnostic."""
        if self._condition == Condition.C1_SHAM:
            # C1: minimal neutral facilitation at fixed intervals (LLM-generated)
            while self._running:
                await asyncio.sleep(config.triggers.timer_interval_seconds)
                if self._running and self._triggers.state.enabled:
                    try:
                        await self.generate_intervention("fixed_timer")
                    except asyncio.CancelledError:
                        raise
                    except Exception as e:
                        log.warning(f"C1 minimal intervention error: {e}")
            return

        # C2-C5: dynamic trigger evaluation
        while self._running:
            await asyncio.sleep(1.0)

            try:
                reason = self._triggers.evaluate()
                if reason:
                    await self.generate_intervention(reason)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning(f"Trigger loop error: {e}")

    async def _suggestor_loop(self) -> None:
        """Background loop that pre-generates responses every 30 seconds."""
        while self._running:
            await asyncio.sleep(30.0)
            await self.pre_generate()

    @property
    def intervention_count(self) -> int:
        return self._ctx.intervention_count

    @property
    def seconds_until_next(self) -> float:
        return self._triggers.seconds_until_next

    @property
    def last_response(self) -> str:
        return self._ctx.last_response
