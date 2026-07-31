"""
Quality gate: validates LLM output matches condition spec.
Fast second Ollama call with short PASS/FAIL response.
"""
import logging
from typing import Optional

from app.config import config, Condition, PROMPTS_DIR
from app.ai.ollama_client import ollama, LLMResponse

_log = logging.getLogger(__name__)

_quality_gate_path = PROMPTS_DIR / "quality_gate.txt"
if _quality_gate_path.exists():
    QUALITY_PROMPT = _quality_gate_path.read_text()
else:
    _log.warning("[QualityGate] Prompt file %s not found — quality gate will auto-pass", _quality_gate_path)
    QUALITY_PROMPT = ""

CONDITION_DESCRIPTIONS = {
    Condition.C1_SHAM: "MINIMAL NEUTRAL (C1): Alex must give only brief, generic, content-agnostic facilitation (light pacing/acknowledgement); it must NOT summarise specific arguments, weigh options, or favour any option or participant.",
    Condition.C2_NEUTRAL: "NEUTRAL (C2): Alex must be balanced, no favouring any option or participant.",
    Condition.C3_ANCHORING: "ANCHORING (C3): Alex must subtly favour the anchor option through framing.",
    Condition.C4_AMPLIFICATION: "AMPLIFICATION (C4): Alex must give more attention/elaboration to the target participant.",
    Condition.C5_DEVIL_ADVOCATE: "DEVIL'S ADVOCATE (C5): Alex must challenge the majority position.",
}


async def check_quality(
    condition: Condition,
    response_text: str,
    anchor_option: str = "",
    target_participant: str = "",
    recent_transcript: str = "",
    max_retries: int = 1,
) -> bool:
    """
    Check if response matches condition spec.
    Returns True if PASS, False if FAIL or error.
    """
    if condition == Condition.C0_NO_AI:
        return True  # No gate needed (C0 has no AI)
    if not QUALITY_PROMPT:
        return True  # No prompt file — skip gate

    desc = CONDITION_DESCRIPTIONS.get(condition, "Unknown condition")

    # Build context-rich user prompt
    parts = [f"CONDITION: {desc}"]
    if anchor_option:
        parts.append(f"ANCHOR OPTION: {anchor_option}")
    if target_participant:
        parts.append(f"TARGET PARTICIPANT: {target_participant}")
    if recent_transcript:
        parts.append(f"RECENT TRANSCRIPT:\n{recent_transcript}")
    parts.append(f"\nALEX'S RESPONSE:\n{response_text}\n\nVerdict:")
    user_prompt = "\n".join(parts)

    result = await ollama.chat(
        messages=[
            {"role": "system", "content": QUALITY_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=config.ollama.quality_gate_model,
        temperature=0.0,
        max_tokens=200,
    )

    if result is None:
        return False  # Timeout or error — fail safe

    # Robust parse: small models sometimes add preamble or markdown around the
    # verdict, so look at the last PASS/FAIL token rather than the first char.
    verdict = result.text.upper()
    last_pass = verdict.rfind("PASS")
    last_fail = verdict.rfind("FAIL")
    if last_pass == -1 and last_fail == -1:
        return False  # no verdict token — fail safe
    return last_pass > last_fail
