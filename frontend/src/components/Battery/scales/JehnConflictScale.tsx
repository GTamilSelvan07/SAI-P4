/**
 * JehnConflictScale — 5-point Jehn intragroup-conflict items grouped by
 * subscale (Task vs Relationship). Visual wrapper around the Likert renderer
 * pattern that adds the subscale headings for clarity.
 */
import type { ScaleRendererProps } from "./types";
import { visibleItems } from "../scaleRegistry";

const SUBSCALE_ORDER = ["Task Conflict", "Relationship Conflict"];

export function JehnConflictScale({ scale, values, onChange, condition, disabled }: ScaleRendererProps) {
  const items = visibleItems(scale, condition);
  const grouped = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.subscale ?? "(items)";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

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

      {SUBSCALE_ORDER.filter((k) => grouped.has(k)).map((subscale) => (
        <div key={subscale}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            {subscale}
          </h3>
          <div className="space-y-3">
            {grouped.get(subscale)!.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-4"
              >
                <p className="text-sm font-medium text-gray-800 mb-3">{item.text}</p>
                <div className="flex gap-2 justify-between">
                  {[1, 2, 3, 4, 5].map((val) => (
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
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
