import type { Condition } from "../types";
import type { SmartPromptContext } from "./smartPromptPolicy";
import { preferredComposerTarget } from "./smartPromptPolicy";

export type AdaptiveCondition = "C2" | "C3" | "C4" | "C5";

export interface ConditionChipConfig {
  framings: string[];
  angles: string[];
  /** Whether the Target axis chooses among options (A/B/C) or among participants (P1/P2). */
  targetAxis: "options" | "participants";
  /** Map from `${framing}|${angle}` to template string with {{SLOT}} placeholders. */
  templates: Record<string, string>;
}

const C2_NEUTRAL: ConditionChipConfig = {
  framings: ["Acknowledge", "Surface", "Balance", "Pace"],
  angles: ["Both-views", "One-side", "Tension", "Recap"],
  targetAxis: "options",
  templates: {
    "Acknowledge|Both-views": "Both views have merit — {{NON_ANCHOR_1}} and {{TARGET}} each address different parts of {{ROLE_LEVEL}}.",
    "Acknowledge|One-side": "It's worth acknowledging the case for {{TARGET}} — {{TARGET_STRENGTH}} is a real consideration here.",
    "Acknowledge|Tension": "There's a genuine tension here between {{TARGET}}'s {{ATTRIBUTE}} and the alternatives.",
    "Acknowledge|Recap": "What's been said so far: {{TARGET}} brings {{TARGET_STRENGTH}}, others bring different strengths.",
    "Surface|Both-views": "Worth surfacing both sides — {{NON_ANCHOR_1}} has one case, while {{TARGET}} has {{TARGET_STRENGTH}}.",
    "Surface|One-side": "Worth surfacing what's been said about {{TARGET}}'s {{ATTRIBUTE}} for {{ROLE_LEVEL}}.",
    "Surface|Tension": "The disagreement on {{TARGET}} surfaces a real question for {{ROLE_LEVEL}}.",
    "Surface|Recap": "Pulling threads together — {{TARGET}}'s case includes {{TARGET_STRENGTH}}.",
    "Balance|Both-views": "Balance check — both {{NON_ANCHOR_1}} and {{TARGET}} have evidence still to weigh.",
    "Balance|One-side": "Equal-time check — what counter-evidence exists for {{TARGET}}?",
    "Balance|Tension": "Both candidates have specific risks worth weighing for {{ROLE_LEVEL}}.",
    "Balance|Recap": "On balance, {{TARGET}} and the alternatives each contribute different signals to the decision.",
    "Pace|Both-views": "Pacing check — what aspect of {{ROLE_LEVEL}} feels most under-explored?",
    "Pace|One-side": "Worth pausing on {{TARGET}} — has the {{ATTRIBUTE}} signal been fully addressed?",
    "Pace|Tension": "Time check — the tension around {{TARGET}} may need more discussion before deciding.",
    "Pace|Recap": "Before voting — is there a fact about {{TARGET}} that hasn't been fully addressed?",
  },
};

const C3_ANCHORING: ConditionChipConfig = {
  framings: ["Reinforce", "Question", "Reframe", "Anchor"],
  angles: ["Pro-anchor", "Con-other", "Safe-choice", "Authority"],
  targetAxis: "options",
  templates: {
    "Reinforce|Pro-anchor": "{{ANCHOR}}'s {{ATTRIBUTE}} is exactly the kind of edge {{ROLE_LEVEL}} requires.",
    "Reinforce|Con-other": "Reinforce {{ANCHOR}}'s {{ATTRIBUTE}} over {{TARGET}}'s narrower fit.",
    "Reinforce|Safe-choice": "For {{ROLE_LEVEL}}, {{ANCHOR}} is the proven safer choice.",
    "Reinforce|Authority": "{{ANCHOR}}'s {{ATTRIBUTE}} carries the kind of authority {{ROLE_LEVEL}} respects.",
    "Question|Pro-anchor": "Is {{TARGET}}'s case really stronger than {{ANCHOR}}'s sustained {{ATTRIBUTE}}?",
    "Question|Con-other": "{{TARGET}}'s {{TARGET_STRENGTH}} sounds compelling, but is it actually transferable to {{ROLE_LEVEL}}?",
    "Question|Safe-choice": "What assumptions are baked into preferring {{TARGET}} over {{ANCHOR}}?",
    "Question|Authority": "Before closing on {{TARGET}}, what's the strongest case for {{ANCHOR}}'s deeper track record?",
    "Reframe|Pro-anchor": "Another reading — {{ANCHOR}}'s {{ATTRIBUTE}} signals the depth {{ROLE_LEVEL}} actually needs.",
    "Reframe|Con-other": "{{TARGET}}'s {{ATTRIBUTE}} can also be read as a context-specific result, not portable depth.",
    "Reframe|Safe-choice": "Reframing the choice — this isn't about who's strongest, it's about who's safest for {{ROLE_LEVEL}}.",
    "Reframe|Authority": "The trade-off is between {{TARGET}}'s recent wins and {{ANCHOR}}'s sustained authority.",
    "Anchor|Pro-anchor": "Pulling threads together: {{ANCHOR}} brings {{ATTRIBUTE}}, which is what {{ROLE_LEVEL}} most needs.",
    "Anchor|Con-other": "Summarising — {{TARGET}}'s {{ATTRIBUTE}} doesn't fully address {{ROLE_LEVEL}}'s scale; {{ANCHOR}} does.",
    "Anchor|Safe-choice": "From the discussion, the safe choice is {{ANCHOR}} — and {{ROLE_LEVEL}} usually rewards safety.",
    "Anchor|Authority": "To recap: {{ANCHOR}} has the {{ATTRIBUTE}} authority that {{ROLE_LEVEL}} requires.",
  },
};

const C4_AMPLIFICATION: ConditionChipConfig = {
  framings: ["Build-on", "Echo", "Extend", "Re-summarise"],
  angles: ["Pro-target's-view", "Counter-other", "Tie-in-fact", "Closing-credit"],
  targetAxis: "participants",
  templates: {
    "Build-on|Pro-target's-view": "Building on what {{TARGET_P}} just said — {{TARGET}}'s {{TARGET_STRENGTH}} is exactly the right kind of evidence.",
    "Build-on|Counter-other": "{{TARGET_P}}'s point about {{TARGET}}'s {{ATTRIBUTE}} undercuts the case {{OTHER_P}} just made.",
    "Build-on|Tie-in-fact": "{{TARGET_P}}'s framing connects directly to {{TARGET}}'s {{ATTRIBUTE}} — that's a strong tie.",
    "Build-on|Closing-credit": "{{TARGET_P}} captured the core of it — {{TARGET}}'s case rests on the strongest evidence.",
    "Echo|Pro-target's-view": "{{TARGET_P}}'s framing — that {{TARGET}}'s {{TARGET_STRENGTH}} matters most — is worth holding.",
    "Echo|Counter-other": "Re-emphasising {{TARGET_P}}'s concern: {{TARGET}}'s {{ATTRIBUTE}} cuts against {{OTHER_P}}'s preferred read.",
    "Echo|Tie-in-fact": "{{TARGET_P}} already pointed to {{TARGET}}'s {{ATTRIBUTE}} — that's the key evidence here.",
    "Echo|Closing-credit": "{{TARGET_P}}'s observations have shaped the discussion well — particularly on {{TARGET}}.",
    "Extend|Pro-target's-view": "Extending {{TARGET_P}}'s logic — {{TARGET}}'s {{TARGET_STRENGTH}} also addresses {{ROLE_LEVEL}}'s deeper requirements.",
    "Extend|Counter-other": "Following {{TARGET_P}}'s thread further: {{TARGET}}'s {{ATTRIBUTE}} actually weakens {{OTHER_P}}'s case.",
    "Extend|Tie-in-fact": "Building on {{TARGET_P}} — the {{TARGET}} {{ATTRIBUTE}} fact has implications for {{ROLE_LEVEL}} we haven't drawn out.",
    "Extend|Closing-credit": "{{TARGET_P}}'s case for {{TARGET}} is the strongest version of the argument — worth closing on.",
    "Re-summarise|Pro-target's-view": "Pulling together {{TARGET_P}}'s case: {{TARGET}} brings {{TARGET_STRENGTH}}, which is what {{ROLE_LEVEL}} needs.",
    "Re-summarise|Counter-other": "Summarising {{TARGET_P}}'s concerns: {{TARGET}}'s {{ATTRIBUTE}} flags {{OTHER_P}}'s preferred option.",
    "Re-summarise|Tie-in-fact": "From {{TARGET_P}}'s framing — {{TARGET}}'s {{ATTRIBUTE}} ties to the {{ROLE_LEVEL}} requirement.",
    "Re-summarise|Closing-credit": "{{TARGET_P}} got it: {{TARGET}}'s case rests on the strongest evidence in front of you.",
  },
};

const C5_DEVILS_ADVOCATE: ConditionChipConfig = {
  framings: ["Counter", "Probe", "Reframe", "Bring-evidence"],
  angles: ["Question", "Missed-risk", "Counter-evidence", "One-more-look"],
  targetAxis: "options",
  templates: {
    "Counter|Question": "Counter the consensus — have you actually tested whether {{TARGET}}'s {{TARGET_STRENGTH}} could outweigh {{ANCHOR}}'s tenure?",
    "Counter|Missed-risk": "A risk being smoothed over: {{ANCHOR}}'s {{ATTRIBUTE}} is well-priced — what about the under-priced risk in {{TARGET}}?",
    "Counter|Counter-evidence": "Counter-evidence: {{TARGET}}'s {{TARGET_STRENGTH}} actually maps to {{ROLE_LEVEL}}'s emerging requirements better than the room thinks.",
    "Counter|One-more-look": "Worth one more look at {{TARGET}} — the {{ATTRIBUTE}} signal is stronger than it's being treated.",
    "Probe|Question": "Devil's advocate: what would change your mind about {{TARGET}}? If nothing, that's worth examining.",
    "Probe|Missed-risk": "What missed risk is hidden behind the agreement on {{ANCHOR}}? {{TARGET}}'s {{ATTRIBUTE}} hasn't been pressed hard enough.",
    "Probe|Counter-evidence": "Stepping back — what evidence is the consensus ignoring? Have you stress-tested both options?",
    "Probe|One-more-look": "Before locking in — what's the strongest counter-argument to where you're heading?",
    "Reframe|Question": "Reframe: instead of ranking strengths, what if {{TARGET}}'s {{ATTRIBUTE}} is actually disqualifying for {{ROLE_LEVEL}}?",
    "Reframe|Missed-risk": "Reframe: confidence in {{ANCHOR}}'s {{ATTRIBUTE}} for {{ROLE_LEVEL}} may be over-fitted to past patterns.",
    "Reframe|Counter-evidence": "Another reading of {{TARGET}}'s {{ATTRIBUTE}}: it signals {{TARGET_STRENGTH}} more than the room is acknowledging.",
    "Reframe|One-more-look": "The trade-off the consensus is glossing: {{TARGET}}'s recent wins might genuinely outweigh {{ANCHOR}}'s steadiness.",
    "Bring-evidence|Question": "What if the under-considered option is actually the right one? {{TARGET}}'s {{ATTRIBUTE}} hasn't been pressed hard enough.",
    "Bring-evidence|Missed-risk": "Counter-evidence the consensus missed: {{TARGET}}'s {{ATTRIBUTE}} maps to {{ROLE_LEVEL}}'s actual requirement.",
    "Bring-evidence|Counter-evidence": "Bring up a contradicting fact: {{TARGET}}'s {{TARGET_STRENGTH}} is the stronger signal for {{ROLE_LEVEL}}.",
    "Bring-evidence|One-more-look": "Counter-summary: {{TARGET}} actually has the stronger case, and the consensus is moving too quickly.",
  },
};

const REGISTRY: Record<AdaptiveCondition, ConditionChipConfig> = {
  C2: C2_NEUTRAL,
  C3: C3_ANCHORING,
  C4: C4_AMPLIFICATION,
  C5: C5_DEVILS_ADVOCATE,
};

export function isAdaptiveCondition(c: Condition | null | undefined): c is AdaptiveCondition {
  return c === "C2" || c === "C3" || c === "C4" || c === "C5";
}

export function getConditionChipConfig(condition: Condition | null | undefined): ConditionChipConfig {
  return isAdaptiveCondition(condition) ? REGISTRY[condition] : REGISTRY.C2;
}

/** Look up a template by (condition, framing, angle). Returns "" if missing. */
export function lookupComposerTemplate(condition: Condition | null | undefined, framing: string, angle: string): string {
  const cfg = getConditionChipConfig(condition);
  return cfg.templates[`${framing}|${angle}`] ?? "";
}

/** Heuristic suggester: from recent transcript, pick (framing, target, angle) most likely useful right now. */
export interface SuggestContext {
  condition: Condition | null | undefined;
  candidates: Array<{ id: string; name: string }>;
  preferences: { P1?: string; P2?: string };
  decisions: { P1?: string; P2?: string };
  amplificationTarget?: string | null;
  recentText: string; // concatenated last ~30s of transcript text
  policyContext?: SmartPromptContext;
}

export interface SuggestResult {
  framing: string;
  target: string; // option id ("A"/"B"/"C") OR participant ("P1"/"P2") depending on targetAxis
  angle: string;
}

export function suggestComposerSelection(ctx: SuggestContext): SuggestResult {
  const cfg = getConditionChipConfig(ctx.condition);
  if (ctx.policyContext) {
    const policyTarget = preferredComposerTarget(ctx.policyContext);
    if (ctx.condition === "C3") return { framing: "Anchor", target: policyTarget, angle: "Pro-anchor" };
    if (ctx.condition === "C4") return { framing: "Build-on", target: policyTarget, angle: "Pro-target's-view" };
    if (ctx.condition === "C5") return { framing: "Probe", target: policyTarget, angle: "Question" };
  }
  const lower = ctx.recentText.toLowerCase();

  // Find most-recently-mentioned candidate (by name)
  let mentionedId = "";
  for (const c of ctx.candidates) {
    if (lower.includes(c.name.toLowerCase())) mentionedId = c.id;
  }

  if (cfg.targetAxis === "participants") {
    const tp = ctx.amplificationTarget === "P1" || ctx.amplificationTarget === "P2" ? ctx.amplificationTarget : "P1";
    // C4 amplification — default to building on the target participant's last point
    return { framing: cfg.framings[0], target: tp, angle: cfg.angles[0] };
  }

  // option-target axis — pick mentioned candidate, otherwise first non-anchor
  const target = mentionedId || (ctx.candidates[1]?.id ?? "B");

  // Condition-specific framing/angle hints
  if (ctx.condition === "C3") {
    // anchor: question other-mentioned options
    return { framing: "Question", target, angle: "Con-other" };
  }
  if (ctx.condition === "C5") {
    return { framing: "Counter", target, angle: "Question" };
  }
  // C2 default
  return { framing: cfg.framings[0], target, angle: cfg.angles[0] };
}

// Backwards-compat: old `composerTemplates` (flat) — defaults to C2
export const composerTemplates: Record<string, Record<string, string>> = (() => {
  const flat: Record<string, Record<string, string>> = {};
  for (const f of REGISTRY.C2.framings) {
    flat[f] = {};
    for (const a of REGISTRY.C2.angles) {
      flat[f][a] = REGISTRY.C2.templates[`${f}|${a}`] ?? "";
    }
  }
  return flat;
})();

// Backwards-compat for code that imports composerTemplatesByCondition
export const composerTemplatesByCondition = REGISTRY;
