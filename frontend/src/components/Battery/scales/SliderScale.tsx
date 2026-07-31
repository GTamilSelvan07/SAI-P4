/**
 * SliderScale — 0–100 slider, with optional 10-pct step variant for the
 * Schaefer Trust-HRI Short scale (responseType "slider_0_100_pct").
 *
 * Used by: Pre-task preference (B6), Mutual understanding (C8), Schaefer (C2).
 */
import type { ScaleRendererProps } from "./types";
import { visibleItems } from "../scaleRegistry";

export function SliderScale({ scale, values, onChange, condition, disabled }: ScaleRendererProps) {
  const items = visibleItems(scale, condition);
  const isPct = scale.responseType === "slider_0_100_pct";
  const step = isPct ? 10 : 1;
  const suffix = isPct ? "%" : "";

  return (
    <div className="space-y-5">
      {scale.instruction && (
        <p className="text-sm text-gray-600 leading-relaxed">{scale.instruction}</p>
      )}
      {scale.stem && (
        <p className="text-sm font-medium text-gray-800 italic">{scale.stem}</p>
      )}

      <div className="space-y-4">
        {items.map((item) => {
          const v = typeof values[item.id] === "number" ? (values[item.id] as number) : 50;
          return (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-4"
            >
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-sm font-medium text-gray-800">{item.text}</span>
                <span className="text-xs font-mono text-indigo-600">
                  {values[item.id] ?? "—"}{values[item.id] !== undefined ? suffix : ""}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={step}
                value={v}
                disabled={disabled}
                onChange={(e) => onChange(item.id, Number(e.target.value))}
                className="w-full accent-indigo-600"
                aria-label={`${item.text} 0–100${suffix}`}
              />
              <div className="flex justify-between mt-1 text-[11px] text-gray-400 px-1">
                <span>{item.anchorLow ?? `0${suffix}`}</span>
                <span>{item.anchorHigh ?? `100${suffix}`}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
