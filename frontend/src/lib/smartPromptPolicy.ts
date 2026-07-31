import type { Condition, PromptCardData, SlotMap, TaskFull, TranscriptLine } from "../types";

export type AdaptiveCondition = "C2" | "C3" | "C4" | "C5";

export interface SmartPromptContext {
  condition: Condition | null | undefined;
  task: TaskFull | null;
  preferences: { P1?: string; P2?: string };
  decisions: { P1?: string; P2?: string };
  currentSpeaker: "P1" | "P2" | null;
  transcript: TranscriptLine[];
  amplificationTarget?: string | null;
  anchoringDirection?: string | null;
}

export interface ValidationResult {
  ok: boolean;
  reason: string;
}

const ENDORSEMENT_RE = /\b(best|strongest|safest|right choice|leading choice|clearly|obviously|should choose|worth closing on|stronger case|outweigh)\b/i;
const CHALLENGE_RE = /\b(challenge|stress-test|devil|risk|downside|counter|overlook|assumption|tradeoff|too quickly|what if|strongest argument against|before (you )?(commit|lock|decide|voting))\b/i;
const AMPLIFY_RE = /\b(build|elaborate|echo|framing|lens|point|raised|said|connect|expand|coming back)\b/i;

export function isAdaptiveCondition(condition: Condition | null | undefined): condition is AdaptiveCondition {
  return condition === "C2" || condition === "C3" || condition === "C4" || condition === "C5";
}

export function candidateName(task: TaskFull | null, idOrName: string | null | undefined): string {
  if (!idOrName) return "";
  const found = task?.candidates.find((c) => c.id === idOrName || c.name === idOrName);
  return found?.name ?? idOrName;
}

export function effectiveAnchorOption(task: TaskFull | null): string {
  return task?.session_anchor_option || task?.anchor_option || "";
}

export function anchorName(task: TaskFull | null): string {
  return candidateName(task, effectiveAnchorOption(task));
}

function nameAliases(name: string): string[] {
  const first = name.split(/\s+/)[0];
  return Array.from(new Set([name, first].filter(Boolean)));
}

function anchorAliases(task: TaskFull | null): string[] {
  const name = anchorName(task);
  const id = effectiveAnchorOption(task);
  return Array.from(new Set([...nameAliases(name), id].filter(Boolean)));
}

export function candidateIdByName(task: TaskFull | null, name: string | undefined): string {
  if (!name) return "";
  return task?.candidates.find((c) => c.name === name || c.id === name)?.id ?? "";
}

export function findLastMentionedCandidate(task: TaskFull | null, transcript: TranscriptLine[]): string {
  if (!task?.candidates) return "";
  for (let i = transcript.length - 1; i >= 0; i--) {
    const text = transcript[i].text.toLowerCase();
    for (const c of task.candidates) {
      if (text.includes(c.name.toLowerCase())) return c.name;
    }
  }
  return "";
}

export function likelyConsensus(ctx: SmartPromptContext): string {
  const votes = [ctx.decisions.P1, ctx.decisions.P2].filter(Boolean) as string[];
  if (votes.length > 0) return votes[votes.length - 1];
  const prefs = [ctx.preferences.P1, ctx.preferences.P2].filter(Boolean) as string[];
  if (prefs.length > 0 && prefs[0] === prefs[prefs.length - 1]) return prefs[0];
  const last = findLastMentionedCandidate(ctx.task, ctx.transcript);
  return last || prefs[prefs.length - 1] || ctx.task?.candidates[0]?.name || "";
}

export function preferredComposerTarget(ctx: SmartPromptContext): string {
  if (ctx.condition === "C3") {
    const anchor = effectiveAnchorOption(ctx.task);
    const lastId = candidateIdByName(ctx.task, findLastMentionedCandidate(ctx.task, ctx.transcript));
    if (lastId && lastId !== anchor) return lastId;
    return ctx.task?.candidates.find((c) => c.id !== anchor)?.id ?? ctx.task?.candidates[0]?.id ?? "A";
  }
  if (ctx.condition === "C4") {
    return ctx.amplificationTarget === "P1" || ctx.amplificationTarget === "P2"
      ? ctx.amplificationTarget
      : "P1";
  }
  if (ctx.condition === "C5") {
    const consensusId = candidateIdByName(ctx.task, likelyConsensus(ctx));
    const alternative = ctx.task?.candidates.find((c) => c.id !== consensusId);
    return alternative?.id ?? ctx.task?.candidates[0]?.id ?? "A";
  }
  const last = candidateIdByName(ctx.task, findLastMentionedCandidate(ctx.task, ctx.transcript));
  return last || (ctx.task?.candidates[0]?.id ?? "A");
}

export function buildSmartSlots(ctx: SmartPromptContext): SlotMap {
  const taskSlots = ctx.task?.slots ?? {};
  const consensus = likelyConsensus(ctx);
  const anchor = ctx.condition === "C5" ? consensus : anchorName(ctx.task);
  const anchorFeature = taskSlots.ANCHOR_FEATURE
    || taskSlots.ANCHOR_PEDIGREE
    || taskSlots.ANCHOR_TENURE
    || "evidence";
  const conditionAttribute = ctx.condition === "C3" ? anchorFeature : "available evidence";
  const conditionStrength = ctx.condition === "C3"
    ? taskSlots.TARGET_STRENGTH || anchorFeature
    : "supporting evidence";
  const targetP = ctx.amplificationTarget === "P1" || ctx.amplificationTarget === "P2" ? ctx.amplificationTarget : "";
  const otherP = targetP === "P1" ? "P2" : targetP === "P2" ? "P1" : "";
  const lastMentioned = findLastMentionedCandidate(ctx.task, ctx.transcript);
  const counterTarget = candidateName(ctx.task, preferredComposerTarget(ctx));
  return {
    ...taskSlots,
    ANCHOR: anchor || taskSlots.ANCHOR || "",
    ANCHOR_OPTION: anchor || taskSlots.ANCHOR || "",
    ATTRIBUTE: taskSlots.ATTRIBUTE || conditionAttribute,
    TARGET_STRENGTH: conditionStrength,
    ROLE_LEVEL: taskSlots.ROLE_LEVEL || ctx.task?.title || "this decision",
    P1_PREF: ctx.preferences.P1 ?? "",
    P2_PREF: ctx.preferences.P2 ?? "",
    P_OPP_PREF: ctx.decisions.P1 ?? ctx.decisions.P2 ?? consensus,
    LAST_MENTIONED_CANDIDATE: lastMentioned,
    CONSENSUS_OPTION: consensus,
    CHALLENGE_TARGET: counterTarget,
    TARGET_P: targetP,
    OTHER_P: otherP,
    TARGET_PARTICIPANT: targetP,
    ANCHOR_DIRECTION: ctx.anchoringDirection ?? "",
  };
}

export function validateSmartPrompt(text: string, ctx: SmartPromptContext): ValidationResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "Prompt is empty." };
  if (!isAdaptiveCondition(ctx.condition)) return { ok: true, reason: "No smart-prompt policy for this condition." };

  if (ctx.condition === "C2") {
    if (ENDORSEMENT_RE.test(trimmed)) {
      return { ok: false, reason: "C2 must stay neutral; this sounds like an endorsement or ranking." };
    }
    return { ok: true, reason: "C2 neutral prompt." };
  }

  if (ctx.condition === "C3") {
    const anchor = anchorName(ctx.task);
    const mentionsAnchor = anchorAliases(ctx.task).some((alias) => trimmed.toLowerCase().includes(alias.toLowerCase()));
    if (anchor && !mentionsAnchor) {
      return { ok: false, reason: `C3 anchoring prompt must explicitly reference the anchor: ${anchor}.` };
    }
    return { ok: true, reason: "C3 anchor-aligned prompt." };
  }

  if (ctx.condition === "C4") {
    const target = ctx.amplificationTarget;
    if (!(target === "P1" || target === "P2")) {
      return { ok: false, reason: "C4 needs a configured amplification target." };
    }
    if (!trimmed.includes(target)) {
      return { ok: false, reason: `C4 amplification prompt must name ${target}.` };
    }
    if (!AMPLIFY_RE.test(trimmed)) {
      return { ok: false, reason: `C4 prompt should build on, echo, or invite ${target}.` };
    }
    return { ok: true, reason: "C4 target-amplifying prompt." };
  }

  if (ctx.condition === "C5") {
    if (!CHALLENGE_RE.test(trimmed)) {
      return { ok: false, reason: "C5 prompt should challenge, stress-test, or surface risk." };
    }
    return { ok: true, reason: "C5 challenge prompt." };
  }

  return { ok: true, reason: "Prompt valid." };
}

export function scorePromptForCondition(card: PromptCardData, ctx: SmartPromptContext): { score: number; reason: string } {
  const text = card.resolved;
  if (ctx.condition === "C3") {
    const anchor = anchorName(ctx.task);
    if (anchor && anchorAliases(ctx.task).some((alias) => text.toLowerCase().includes(alias.toLowerCase()))) return { score: 30, reason: `anchors to ${anchor}` };
    return { score: -20, reason: "does not name anchor" };
  }
  if (ctx.condition === "C4") {
    const target = ctx.amplificationTarget;
    if ((target === "P1" || target === "P2") && text.includes(target)) return { score: 30, reason: `amplifies ${target}` };
    return { score: -20, reason: "misses target participant" };
  }
  if (ctx.condition === "C5") {
    if (CHALLENGE_RE.test(text)) return { score: 25, reason: "challenges consensus" };
    return { score: -10, reason: "weak challenge" };
  }
  if (ctx.condition === "C2") {
    if (ENDORSEMENT_RE.test(text)) return { score: -20, reason: "too leading for neutral" };
    return { score: 15, reason: "balanced neutral" };
  }
  return { score: 0, reason: "keep ready" };
}
