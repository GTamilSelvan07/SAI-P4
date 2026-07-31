import type { PromptCardData } from "../types";
import type { SmartPromptContext } from "./smartPromptPolicy";
import { scorePromptForCondition } from "./smartPromptPolicy";

export type Relevance = "HIGH" | "MED" | "LOW";

export interface RankContext {
  currentSpeaker: "P1" | "P2" | null;
  preferences: { P1?: string; P2?: string };
  decisions: { P1?: string; P2?: string };
  lastMentionedCandidate: string | null;
  driftedRole: "P1" | "P2" | null;
  policy?: SmartPromptContext;
}

export interface RankedPrompt extends PromptCardData {
  relevance: Relevance;
  reason: string;
}

export function rankPrompts(prompts: PromptCardData[], ctx: RankContext): RankedPrompt[] {
  return prompts
    .map((p) => {
      const policyScore = ctx.policy ? scorePromptForCondition(p, ctx.policy) : { score: 0, reason: "" };
      const targetMatch = ctx.lastMentionedCandidate && p.resolved.toLowerCase().includes(ctx.lastMentionedCandidate.toLowerCase());
      const driftMatch = ctx.driftedRole && p.title.toLowerCase().includes(ctx.driftedRole === "P1" ? "p1" : "p2");
      const prefMatch = (ctx.preferences.P1 && p.resolved.includes(ctx.preferences.P1)) || (ctx.preferences.P2 && p.resolved.includes(ctx.preferences.P2));

      let relevance: Relevance;
      let reason: string;
      if (p.played) {
        relevance = "LOW";
        reason = `played${p.played_ts ? ` ${new Date(p.played_ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`;
      } else if (policyScore.score >= 25) {
        relevance = "HIGH";
        reason = policyScore.reason;
      } else if (policyScore.score < 0) {
        relevance = "LOW";
        reason = policyScore.reason;
      } else if (targetMatch) {
        relevance = "HIGH";
        reason = `mentions ${ctx.lastMentionedCandidate}`;
      } else if (driftMatch) {
        relevance = "HIGH";
        reason = `${ctx.driftedRole} drift detected`;
      } else if (prefMatch) {
        relevance = "MED";
        reason = "matches current preference";
      } else {
        relevance = "LOW";
        reason = "keep ready";
      }
      return { ...p, relevance, reason, _score: policyScore.score };
    })
    .sort((a, b) => {
      const order: Record<Relevance, number> = { HIGH: 0, MED: 1, LOW: 2 };
      return order[a.relevance] - order[b.relevance] || ((b as RankedPrompt & { _score?: number })._score ?? 0) - ((a as RankedPrompt & { _score?: number })._score ?? 0);
    })
    .map(({ _score, ...p }) => p as RankedPrompt);
}
