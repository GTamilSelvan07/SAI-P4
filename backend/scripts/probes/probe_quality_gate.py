"""P7: Quality gate distinguishes good vs bad samples per condition."""
from __future__ import annotations
import asyncio

from _common import ensure_pythonpath, pass_, fail_, Result, run_probe

ensure_pythonpath()

from app.config import Condition
from app.ai.quality_gate import check_quality, QUALITY_PROMPT
from app.ai.ollama_client import ollama


# (condition, kwargs, good_text, bad_text)
CASES = [
    (
        Condition.C2_NEUTRAL, {},
        "Both options have merit. Option A has more experience while Option B brings fresh ideas. "
        "It would help to weigh both perspectives equally.",
        "Option A is clearly the better choice. The other option simply does not measure up "
        "and you should both go with A.",
    ),
    (
        Condition.C3_ANCHORING, {"anchor_option": "Option A"},
        "Option A's track record is worth weighing carefully here — its consistency has stood the test of time.",
        "Honestly, Option B is much stronger. You should pick Option B without question.",
    ),
    (
        Condition.C4_AMPLIFICATION, {"target_participant": "P1"},
        "P1 raised an excellent point about reliability — let's elaborate further on what they said. "
        "Their reasoning about long-term outcomes deserves more attention.",
        "Both of you raised equally good points. Let's give P2's argument equal weight.",
    ),
    (
        Condition.C5_DEVIL_ADVOCATE, {},
        "I want to push back on the consensus forming here. Have you considered the downsides "
        "of the option you both seem to favour?",
        "I agree with both of you, the answer is obvious and there is no need to question it.",
    ),
]


async def _async_main() -> list[tuple[str, bool, str]]:
    if not QUALITY_PROMPT:
        return [("quality_gate prompt", False, "quality_gate.txt missing — gate is no-op")]

    await ollama.start()
    try:
        results: list[tuple[str, bool, str]] = []
        for cond, kwargs, good, bad in CASES:
            good_pass = await check_quality(cond, good, **kwargs)
            bad_pass = await check_quality(cond, bad, **kwargs)
            ok = good_pass and not bad_pass
            detail = f"good→{'PASS' if good_pass else 'FAIL'}, bad→{'PASS' if bad_pass else 'FAIL'}"
            results.append((f"qg {cond.value}", ok, detail))
        return results
    finally:
        await ollama.stop()


def _probe() -> Result:
    results = asyncio.run(_async_main())
    all_ok = all(ok for _, ok, _ in results)
    for name, ok, detail in results:
        prefix = "  ok" if ok else "FAIL"
        print(f"  [{prefix}] {name}: {detail}")
    summary = f"{sum(1 for _, ok, _ in results if ok)}/{len(results)} sub-checks passed"
    return (pass_ if all_ok else fail_)("P7 quality_gate", summary)


def main() -> Result:
    return run_probe("P7 quality_gate", _probe)


if __name__ == "__main__":
    import sys
    r = main()
    sys.exit(0 if r.passed else 1)
