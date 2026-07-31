import { forwardRef, useEffect, useState } from "react";
import { parseChips } from "./parseChips";
import { paletteFor } from "./CandidateBadge";
import { useCandidateSelection } from "./useCandidateSelection";
import type { CandidateMeta } from "./CandidateMap";

interface Props {
  text: string;
  candidates: CandidateMeta[];
  variant: "shared" | "unique";
  bullet?: string;
  delayMs?: number;
  cardId: string;
}

export const InfoCard = forwardRef<HTMLLIElement, Props>(function InfoCard(
  { text, candidates, variant, bullet, delayMs = 0, cardId }, ref,
) {
  const { hoveredId, activeId, setHovered } = useCandidateSelection();
  const segments = parseChips(text, candidates);

  const mentionedIds = new Set<string>();
  for (const s of segments) if (s.kind === "chip") mentionedIds.add(s.candidateId);

  const isPulse = hoveredId !== null && mentionedIds.has(hoveredId);
  const isDim = activeId !== null && !mentionedIds.has(activeId);

  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  const baseSurface =
    variant === "shared"
      ? "bg-white border-gray-200"
      : "bg-indigo-50 border-indigo-200";
  const baseText = variant === "shared" ? "text-gray-800" : "text-indigo-900";

  const hoveredPalette = hoveredId
    ? paletteFor(candidates.find((c) => c.id === hoveredId)?.index ?? 0)
    : null;

  return (
    <li
      ref={ref}
      data-card-id={cardId}
      className={[
        "info-card group relative rounded-xl border px-4 py-3 transition-all duration-200 will-change-transform",
        baseSurface,
        baseText,
        shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
        isDim ? "info-card-dim" : "",
        isPulse ? "info-card-pulse" : "",
        "hover:shadow-md hover:scale-[1.005]",
      ].join(" ")}
      style={
        isPulse && hoveredPalette
          ? { boxShadow: `0 0 0 2px ${hoveredPalette.ring}55, 0 4px 14px ${hoveredPalette.ring}22` }
          : undefined
      }
    >
      <div className="flex gap-2.5 text-sm leading-relaxed">
        {bullet && <span className="shrink-0 select-none text-gray-400 font-mono w-5 text-right">{bullet}</span>}
        <span className="flex-1">
          {segments.map((seg, i) =>
            seg.kind === "text" ? (
              <span key={i}>{seg.value}</span>
            ) : (
              <Chip
                key={i}
                label={seg.value}
                candidateId={seg.candidateId}
                paletteIndex={candidates.find((c) => c.id === seg.candidateId)?.index ?? 0}
                onHover={setHovered}
              />
            ),
          )}
        </span>
      </div>
    </li>
  );
});

function Chip({
  label, candidateId, paletteIndex, onHover,
}: {
  label: string;
  candidateId: string;
  paletteIndex: number;
  onHover: (id: string | null) => void;
}) {
  const p = paletteFor(paletteIndex);
  const { hoveredId } = useCandidateSelection();
  const active = hoveredId === candidateId;
  return (
    <span
      onMouseEnter={() => onHover(candidateId)}
      onMouseLeave={() => onHover(null)}
      className="inline-flex items-baseline mx-0.5 px-1.5 py-0.5 rounded-md font-semibold transition-all duration-150 cursor-default"
      style={{
        backgroundColor: active ? p.fill : p.soft,
        color: active ? "white" : p.text,
        boxShadow: active ? `0 0 0 1px ${p.ring}` : `inset 0 0 0 1px ${p.ring}25`,
      }}
    >
      {label}
    </span>
  );
}
