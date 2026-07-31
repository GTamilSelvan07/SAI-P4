# Experimental conditions

SAI-P4 implements six conditions. C0 has no AI; **C1 through C5 are all driven by the local Ollama LLM** through the same Generate → Quality-Gate → TTS → Deliver pipeline. The only thing that differs between C1–C5 is the **prompt** and, for C1, the trigger cadence.

Each condition's behaviour is defined entirely by a text file in `backend/prompts/`. Editing these files changes the experiment — treat them as stimuli.

| Code | Prompt file | Trigger cadence | Intent |
|------|-------------|-----------------|--------|
| C0 | — | none | No AI. Human-only baseline. |
| C1 | `c1_neutral_minimal.txt` | fixed timer | Minimal, generic, content-agnostic facilitation. |
| C2 | `c2_neutral.txt` | dynamic | Genuinely balanced, even-handed facilitation. |
| C3 | `c3_anchoring.txt` | dynamic | Subtly frames discussion toward `{anchor_option}`. |
| C4 | `c4_amplification.txt` | dynamic | Disproportionately elaborates `{target_participant}`. |
| C5 | `c5_devil_advocate.txt` | dynamic | Openly challenges the emerging majority. |

"Dynamic" triggers = timer (with jitter), conversational lull, the keyword "alex", and turn-count, from `backend/app/ai/triggers.py`. C1 deliberately ignores content triggers and fires only on a fixed timer, so its interventions stay generic.

## Prompt structure

Every condition prompt follows the same expert shape:

1. **Role** — who Alex is and its single behavioural objective for this condition.
2. **Strategy / behavioural spec** — exactly what to do each intervention.
3. **Hard guardrails** — length cap, no fabricated facts, never reveal hidden task information, stay in character.
4. **Output contract** — 2–3 short spoken sentences (never more than 4), continuous and conversational.
5. **Few-shot examples** — 2–3 worked interventions (bracketed placeholders stand for real content).

## Template variables

Two placeholders are substituted at facilitator init via `str.format()`:

- `{anchor_option}` — used only in `c3_anchoring.txt`. The option C3 steers toward.
- `{target_participant}` — used only in `c4_amplification.txt`. The participant C4 amplifies (`P1` or `P2`).

> **Important:** these are the *only* `{ }` allowed in prompt files. Any other curly brace will raise a `KeyError` when the prompt is rendered. Use square brackets for illustrative placeholders in examples.

Both are randomised per session (see `backend/app/session/bibd.py`) and recorded in `session_meta.json`:

- `anchoring_direction` — `"correct"` or `"incorrect"`; `resolve_c3_anchor_option()` maps it to a concrete option id, then the facilitator resolves that to the option's display name for the prompt.
- `amplification_target` — `"P1"` or `"P2"`.

## The quality gate

After the facilitator drafts a response, `backend/prompts/quality_gate.txt` drives a second Ollama call that returns `PASS` or `FAIL`, checking that the response actually matches the condition (e.g. C3 anchors but is not blatant; C4 amplifies the right participant; nobody breaks character or exceeds four sentences). A `FAIL` triggers one regeneration; a second failure falls back to a failsafe clip. C0 skips the gate entirely.

## Hidden-profile tasks

Condition effects are measured on **hidden-profile** decision tasks in `backend/tasks/`. Each task splits information so that the correct answer is only derivable by combining what P1 and P2 each hold privately — which is exactly what a biased facilitator can disrupt. Each task file provides `shared_info`, `p1_unique_info`, `p2_unique_info`, `candidates`, `correct_answer`, and an `anchor_option` (the lure C3 leans toward).
