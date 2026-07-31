import { CandidateBadge, paletteFor } from "./CandidateBadge";
import { useCandidateSelection } from "./useCandidateSelection";

export interface CandidateMeta {
  id: string;
  name: string;
  index: number;
}

interface Props {
  candidates: CandidateMeta[];
  compact?: boolean;
}

export function CandidateMap({ candidates, compact = false }: Props) {
  const { hoveredId, activeId, setHovered, toggleActive } = useCandidateSelection();

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {candidates.map((c) => {
          const isHover = hoveredId === c.id;
          const isActive = activeId === c.id;
          const palette = paletteFor(c.index);
          return (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => setHovered(c.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(c.id)}
              onBlur={() => setHovered(null)}
              onClick={() => toggleActive(c.id)}
              aria-pressed={isActive}
              aria-label={`Candidate ${c.name}`}
              className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 transition"
              style={{ outlineColor: palette.ring }}
            >
              <CandidateBadge
                letter={String.fromCharCode(65 + c.index)}
                paletteIndex={c.index}
                size="mini"
                filled={isActive || isHover}
                glow={isActive || isHover}
              />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Candidates</h3>
        <span className="text-[11px] text-gray-400">Hover to scan · click to focus</span>
      </div>
      <div className="flex justify-around items-end gap-3">
        {candidates.map((c) => {
          const isHover = hoveredId === c.id;
          const isActive = activeId === c.id;
          const palette = paletteFor(c.index);
          return (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => setHovered(c.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(c.id)}
              onBlur={() => setHovered(null)}
              onClick={() => toggleActive(c.id)}
              aria-pressed={isActive}
              aria-label={`Candidate ${c.name}`}
              className="group flex flex-col items-center gap-1.5 rounded-xl px-3 py-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{ outlineColor: palette.ring }}
            >
              <span className={`candidate-orb-breathe ${isHover || isActive ? "is-active" : ""}`}>
                <CandidateBadge
                  letter={String.fromCharCode(65 + c.index)}
                  paletteIndex={c.index}
                  size="orb"
                  filled={isActive || isHover}
                  glow={isHover || isActive}
                />
              </span>
              <span className="text-xs font-semibold text-gray-700 max-w-[7rem] text-center leading-tight">
                {c.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
