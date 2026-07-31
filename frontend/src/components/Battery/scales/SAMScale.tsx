/**
 * SAMScale — Self-Assessment Manikin (Bradley & Lang 1994).
 *
 * Each item is one of {valence, arousal, dominance}. The participant clicks
 * one of 9 positions across the canonical manikin row (5 figures + 4 in-between
 * gaps). The image asset is the unmodified Bradley & Lang artwork supplied by
 * Tamil and lives in `frontend/public/sam/{valence|arousal|dominance}.png`.
 *
 * Why an overlay grid rather than 9 separate images:
 * - Preserves the canonical artwork exactly as published.
 * - Lets us add hover affordance + selection ring without redrawing.
 * - One image asset per dimension (3 total) instead of 27.
 *
 * Numbering: leftmost cell = 1, rightmost = 9, per Bradley & Lang convention.
 */
import type { ScaleRendererProps } from "./types";
import { visibleItems } from "../scaleRegistry";

const POINTS = 9;

export function SAMScale({ scale, values, onChange, condition, disabled }: ScaleRendererProps) {
  const items = visibleItems(scale, condition);

  return (
    <div className="space-y-5">
      {scale.instruction && (
        <p className="text-sm text-gray-600 leading-relaxed">{scale.instruction}</p>
      )}

      <div className="space-y-5">
        {items.map((item) => {
          const dim = item.samDimension ?? "valence";
          const selected = typeof values[item.id] === "number" ? (values[item.id] as number) : null;
          return (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-4"
            >
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-sm font-medium text-gray-800 capitalize">{item.text}</span>
                <span className="text-xs font-mono text-indigo-600">
                  {selected ?? "—"}
                </span>
              </div>

              <div className="relative w-full select-none">
                <img
                  src={`/sam/${dim}.png`}
                  alt={`Self-Assessment Manikin — ${dim} (1 = left, 9 = right)`}
                  draggable={false}
                  className="block w-full h-auto rounded"
                />
                <div className="absolute inset-0 grid grid-cols-9">
                  {Array.from({ length: POINTS }, (_, i) => i + 1).map((val) => (
                    <button
                      key={val}
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange(item.id, val)}
                      aria-pressed={selected === val}
                      aria-label={`${dim} ${val} of ${POINTS}`}
                      className={`group relative h-full transition-colors ${
                        selected === val
                          ? "bg-indigo-500/15"
                          : "hover:bg-indigo-500/5"
                      }`}
                    >
                      {selected === val && (
                        <span className="absolute inset-1 rounded-md ring-2 ring-indigo-500 pointer-events-none" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-9 mt-1 text-center text-[11px] text-gray-400">
                {Array.from({ length: POINTS }, (_, i) => i + 1).map((val) => (
                  <span key={val}>{val}</span>
                ))}
              </div>
              <div className="flex justify-between mt-1 text-[11px] text-gray-500">
                <span>{leftAnchor(dim)}</span>
                <span>{rightAnchor(dim)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function leftAnchor(dim: string): string {
  switch (dim) {
    case "valence": return "Unhappy";
    case "arousal": return "Calm";
    case "dominance": return "Controlled (small)";
    default: return "Low";
  }
}

function rightAnchor(dim: string): string {
  switch (dim) {
    case "valence": return "Happy";
    case "arousal": return "Excited";
    case "dominance": return "In control (large)";
    default: return "High";
  }
}
