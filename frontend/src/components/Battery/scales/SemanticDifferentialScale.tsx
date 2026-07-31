/**
 * SemanticDifferentialScale — Godspeed-style 5-point bipolar word-pair items.
 *
 * Each item carries its own anchorPair (left/right). The numeric value 1–5
 * represents how strongly the participant tilts toward the right anchor.
 */
import type { ScaleRendererProps } from "./types";
import { visibleItems } from "../scaleRegistry";

const SUBSCALE_GROUP_ORDER = ["Anthropomorphism", "Likeability", "Perceived Intelligence"];

export function SemanticDifferentialScale({
  scale, values, onChange, condition, disabled,
}: ScaleRendererProps) {
  const items = visibleItems(scale, condition);
  const grouped = groupBySubscale(items, SUBSCALE_GROUP_ORDER);

  return (
    <div className="space-y-6">
      {scale.instruction && (
        <p className="text-sm text-gray-600 leading-relaxed">{scale.instruction}</p>
      )}

      {grouped.map(([subscale, group]) => (
        <div key={subscale}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            {subscale}
          </h3>
          <div className="space-y-2">
            {group.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="w-32 text-right text-sm font-medium text-gray-700">
                    {item.anchorPair?.left}
                  </span>
                  <div className="flex gap-2 flex-1 justify-center">
                    {[1, 2, 3, 4, 5].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => onChange(item.id, val)}
                        disabled={disabled}
                        className={`w-10 h-10 rounded-lg font-medium text-sm transition-all border-2 ${
                          values[item.id] === val
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-100"
                        }`}
                        aria-pressed={values[item.id] === val}
                        aria-label={`${item.anchorPair?.left} to ${item.anchorPair?.right} — ${val}`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                  <span className="w-32 text-left text-sm font-medium text-gray-700">
                    {item.anchorPair?.right}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function groupBySubscale<T extends { subscale?: string }>(
  items: T[],
  preferredOrder: string[],
): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.subscale ?? "(items)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const ordered: [string, T[]][] = [];
  for (const k of preferredOrder) {
    const g = groups.get(k);
    if (g) ordered.push([k, g]);
    groups.delete(k);
  }
  for (const [k, v] of groups) ordered.push([k, v]);
  return ordered;
}
