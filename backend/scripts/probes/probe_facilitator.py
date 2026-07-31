"""P6: FacilitatorEngine end-to-end per condition + intervention_lock test."""
from __future__ import annotations
import asyncio
import tempfile
from pathlib import Path

from _common import ensure_pythonpath, pass_, fail_, Result, run_probe

ensure_pythonpath()

from app.config import Condition
from app.ai.facilitator import FacilitatorEngine
from app.logging.events import EventLogger
from app.logging.lsl_markers import LSLMarkerLogger


def _make_loggers(tmp: Path):
    ev = EventLogger(tmp / "events.jsonl")
    ev.open()
    lsl = LSLMarkerLogger(tmp / "lsl.csv")
    lsl.open()
    return ev, lsl


def _seed_transcript(engine: FacilitatorEngine) -> None:
    """Push some fake conversation context so the LLM has something to react to."""
    engine.add_transcript("P1", "I really think option A is the best choice here.")
    engine.add_transcript("P2", "I'm not sure, option B has some real advantages.")
    engine.add_transcript("P1", "But A has been around longer and is more proven.")
    engine.add_transcript("P2", "True, but we should not dismiss B too quickly.")


async def _probe_condition(cond: Condition) -> tuple[bool, str]:
    """Run one intervention through the facilitator for a single condition.
    Returns (passed, detail)."""
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        ev, lsl = _make_loggers(tmp)

        kwargs = {}
        if cond == Condition.C3_ANCHORING:
            kwargs["anchor_option"] = "Option A"
        if cond == Condition.C4_AMPLIFICATION:
            kwargs["target_participant"] = "P1"

        engine = FacilitatorEngine(condition=cond, event_logger=ev, lsl_logger=lsl, **kwargs)
        await engine.start()

        # Track Ollama calls so we can verify C1 doesn't call it
        from app.ai import facilitator as fac_mod
        from app.ai.ollama_client import ollama as real_ollama
        call_count = {"chat": 0}
        original_chat = real_ollama.chat

        async def counting_chat(*args, **kwargs):
            call_count["chat"] += 1
            return await original_chat(*args, **kwargs)

        real_ollama.chat = counting_chat  # type: ignore

        try:
            _seed_transcript(engine)
            response = await engine.generate_intervention("timer")

            if cond == Condition.C0_NO_AI:
                # C0 should produce empty stub response
                if response is None or response.text != "":
                    return False, f"C0 should return empty text, got: {response}"
                return True, "no-op (correct)"

            if response is None:
                return False, "generate_intervention returned None (cooldown? unexpected on first call)"
            if not response.text:
                return False, f"empty text returned (audio={len(response.audio_pcm or b'')} bytes)"

            audio_len = len(response.audio_pcm or b"")

            # C1-C5 are all LLM-driven now: each must call Ollama at least once.
            if call_count["chat"] == 0:
                return False, "expected Ollama call but none made"

            # Strict check: source MUST be LIVE_LLM (or REGENERATED_LLM if first attempt failed gate).
            # If source is FAILSAFE_CLIP, the LLM path failed and the engine fell back —
            # that means the experiment would not actually deliver an AI intervention for this condition.
            from app.models import AISource
            if response.source == AISource.FAILSAFE_CLIP:
                return False, (
                    f"FELL BACK TO FAILSAFE — LLM or quality gate rejected {call_count['chat']} attempt(s). "
                    f"Audio={audio_len}b, text={response.text[:60]!r}"
                )

            return True, (
                f"source={response.source.value}, ollama_calls={call_count['chat']}, "
                f"latency={response.llm_latency_ms}ms, audio={audio_len}b, text={response.text[:60]!r}"
            )
        finally:
            real_ollama.chat = original_chat  # restore
            await engine.stop()
            ev.close()
            lsl.close()


async def _probe_lock() -> tuple[bool, str]:
    """Lock test: fire two concurrent interventions, expect exactly one to succeed."""
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        ev, lsl = _make_loggers(tmp)
        engine = FacilitatorEngine(condition=Condition.C2_NEUTRAL, event_logger=ev, lsl_logger=lsl)
        await engine.start()
        try:
            _seed_transcript(engine)
            r1, r2 = await asyncio.gather(
                engine.generate_intervention("timer"),
                engine.generate_intervention("lull"),
            )
            successes = sum(1 for r in (r1, r2) if r is not None and r.text)
            # Lock + cooldown means only ONE should succeed.
            # The lock serializes them; the cooldown rejects the second one because <5s elapsed.
            if successes != 1:
                return False, f"expected exactly 1 intervention, got {successes} (r1={r1 is not None}, r2={r2 is not None})"
            return True, "1 of 2 concurrent interventions succeeded (lock+cooldown working)"
        finally:
            await engine.stop()
            ev.close()
            lsl.close()


async def _async_main() -> list[tuple[str, bool, str]]:
    results: list[tuple[str, bool, str]] = []
    for cond in [
        Condition.C0_NO_AI,
        Condition.C1_SHAM,
        Condition.C2_NEUTRAL,
        Condition.C3_ANCHORING,
        Condition.C4_AMPLIFICATION,
        Condition.C5_DEVIL_ADVOCATE,
    ]:
        try:
            ok, detail = await _probe_condition(cond)
        except Exception as e:
            ok, detail = False, f"exception: {type(e).__name__}: {e}"
        results.append((f"facilitator {cond.value}", ok, detail))

    try:
        ok, detail = await _probe_lock()
    except Exception as e:
        ok, detail = False, f"exception: {type(e).__name__}: {e}"
    results.append(("facilitator lock", ok, detail))

    return results


def _probe() -> Result:
    results = asyncio.run(_async_main())
    all_ok = all(ok for _, ok, _ in results)
    for name, ok, detail in results:
        prefix = "  ok" if ok else "FAIL"
        print(f"  [{prefix}] {name}: {detail}")
    summary = f"{sum(1 for _, ok, _ in results if ok)}/{len(results)} sub-checks passed"
    if all_ok:
        return pass_("P6 facilitator", summary)
    return fail_("P6 facilitator", summary)


def main() -> Result:
    return run_probe("P6 facilitator", _probe)


if __name__ == "__main__":
    import sys
    r = main()
    sys.exit(0 if r.passed else 1)
