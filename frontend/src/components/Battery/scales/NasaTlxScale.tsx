/**
 * NasaTlxScale — Raw NASA-TLX 21-point scale per dimension (0–20 in unit steps).
 *
 * Performance dimension uses inverted anchors per Hart & Staveland (1988):
 * 0 = Perfect, 20 = Failure. We render the slider as-is; the anchorLow /
 * anchorHigh fields per item carry the correct labels.
 */
import type { ScaleRendererProps } from "./types";
import { visibleItems } from "../scaleRegistry";

export function NasaTlxScale({ scale, values, onChange, condition, disabled }: ScaleRendererProps) {
  const items = visibleItems(scale, condition);

  return (
    <div className="space-y-5">
      {scale.instruction && (
        <p className="text-sm text-gray-600 leading-relaxed">{scale.instruction}</p>
      )}

      <div className="space-y-4">
        {items.map((item) => {
          const v = typeof values[item.id] === "number" ? (values[item.id] as number) : 10;
          return (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-4"
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm font-medium text-gray-800">{item.text}</span>
                <span className="text-xs font-mono text-indigo-600">{values[item.id] ?? "—"}</span>
              </div>
              {item.description && (
                <p className="text-xs text-gray-500 mb-3">{item.description}</p>
              )}
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={v}
                disabled={disabled}
                onChange={(e) => onChange(item.id, Number(e.target.value))}
                className="w-full accent-indigo-600"
                aria-label={`${item.text} 0–20`}
              />
              <div className="flex justify-between mt-1 text-[11px] text-gray-400 px-1">
                <span>{item.anchorLow}</span>
                <span>{item.anchorHigh}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
