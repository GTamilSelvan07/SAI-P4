/**
 * LikertScale — generic 4/5/7-point Likert renderer.
 *
 * Used by: TIPI, NCS-6, Mayer-Davis Propensity, Jian Trust, SASSI, Group
 * Satisfaction, Engagement, and the Jehn Conflict scale (responseType
 * "jehn_5pt" is a 5-point Likert with custom anchors). The shared
 * implementation keeps the visual style consistent across scales.
 */
import type { ScaleRendererProps } from "./types";
import { visibleItems } from "../scaleRegistry";

const POINTS_FOR: Record<string, number> = {
  likert4: 4,
  likert5: 5,
  likert7: 7,
  jehn_5pt: 5,
};

export function LikertScale({ scale, values, onChange, condition, disabled }: ScaleRendererProps) {
  const points = POINTS_FOR[scale.responseType] ?? 7;
  const items = visibleItems(scale, condition);

  return (
    <div className="space-y-5">
      {scale.instruction && (
        <p className="text-sm text-gray-600 leading-relaxed">{scale.instruction}</p>
      )}

      {scale.anchors && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
            {scale.anchors.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {scale.stem && (
        <p className="text-sm font-medium text-gray-800 italic">{scale.stem}</p>
      )}

      <div className="space-y-3">
        {items.map((item, idx) => (
          <div
            key={item.id}
            className="bg-white rounded-xl border border-gray-200 shadow-sm p-4"
          >
            <p className="text-sm font-medium text-gray-800 mb-3">
              <span className="text-gray-400 mr-2">{idx + 1}.</span>
              {item.text}
              {item.reverseScored && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                  (reverse)
                </span>
              )}
            </p>
            <div className="flex gap-2 justify-between">
              {Array.from({ length: points }, (_, i) => i + 1).map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => onChange(item.id, val)}
                  disabled={disabled}
                  className={`flex-1 max-w-[3rem] h-10 rounded-lg font-medium text-sm transition-all border-2 ${
                    values[item.id] === val
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-100"
                  }`}
                  aria-pressed={values[item.id] === val}
                  aria-label={`Item ${item.id} value ${val}`}
                >
                  {val}
                </button>
              ))}
            </div>
            {scale.anchors && scale.anchors.length >= 2 && (
              <div className="flex justify-between mt-1 text-[11px] text-gray-400 px-1">
                <span>{stripPrefix(scale.anchors[0])}</span>
                <span>{stripPrefix(scale.anchors[scale.anchors.length - 1])}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function stripPrefix(anchor: string): string {
  return anchor.replace(/^\d+%?\s*[—-]\s*/, "");
}
