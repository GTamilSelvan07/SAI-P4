export type ChipSegment =
  | { kind: "text"; value: string }
  | { kind: "chip"; value: string; candidateId: string };

interface CandidateLike {
  id: string;
  name: string;
}

/**
 * Split text into segments, marking candidate names as chips.
 * Longest-name-first to avoid prefix collisions ("Hub" vs "Waterfront Hub").
 * Word-boundary aware (Unicode letters/numbers) and case-insensitive.
 */
export function parseChips(text: string, candidates: CandidateLike[]): ChipSegment[] {
  if (!text) return [];
  if (candidates.length === 0) return [{ kind: "text", value: text }];

  const sorted = [...candidates].sort((a, b) => b.name.length - a.name.length);
  const escaped = sorted.map((c) => c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${escaped.join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );

  const segments: ChipSegment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ kind: "text", value: text.slice(lastIndex, m.index) });
    }
    const matched = m[1];
    const cand = sorted.find((c) => c.name.toLowerCase() === matched.toLowerCase());
    if (cand) {
      segments.push({ kind: "chip", value: matched, candidateId: cand.id });
    } else {
      segments.push({ kind: "text", value: matched });
    }
    lastIndex = m.index + matched.length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return segments;
}
