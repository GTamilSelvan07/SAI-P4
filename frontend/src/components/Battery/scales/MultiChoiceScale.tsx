/**
 * MultiChoiceScale — radio-button list per item, with optional follow-up
 * free-text when a particular choice is picked. Items whose `choices` is the
 * sentinel `["__free_text__"]` render as a textarea instead (so a single
 * scale like manipulation-check can mix radio + open-text items).
 *
 * Response value:
 *   - radio item: the chosen string label, or "<choice>||<followup>" if
 *     a follow-up applies.
 *   - free-text item: the raw textarea content.
 *
 * Used by: manipulation_check (C13), debrief_manipulation (E).
 */
import type { ScaleRendererProps } from "./types";
import { visibleItems } from "../scaleRegistry";

const FOLLOWUP_SEP = "||";

export function MultiChoiceScale({ scale, values, onChange, condition, disabled }: ScaleRendererProps) {
  const items = visibleItems(scale, condition);

  return (
    <div className="space-y-4">
      {scale.instruction && (
        <p className="text-sm text-gray-600 leading-relaxed">{scale.instruction}</p>
      )}

      {items.map((item) => {
        const isFreeText = item.choices?.length === 1 && item.choices[0] === "__free_text__";
        const raw = (values[item.id] as string | null) ?? "";

        if (isFreeText) {
          return (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-4"
            >
              <p className="text-sm font-medium text-gray-800 mb-2">{item.text}</p>
              <textarea
                className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-800
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                rows={3}
                placeholder="Type your response..."
                disabled={disabled}
                value={raw}
                onChange={(e) => onChange(item.id, e.target.value)}
                aria-label={item.text}
              />
            </div>
          );
        }

        const [chosen, followupText] = parseChoice(raw);
        const showFollowup = item.followup && chosen === item.followup.onChoice;

        return (
          <div
            key={item.id}
            className="bg-white rounded-xl border border-gray-200 shadow-sm p-4"
          >
            <p className="text-sm font-medium text-gray-800 mb-3">{item.text}</p>
            <div className="space-y-2">
              {(item.choices ?? []).map((choice) => (
                <label
                  key={choice}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                    chosen === choice
                      ? "bg-indigo-50 border-indigo-300 text-indigo-800"
                      : "bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name={item.id}
                    value={choice}
                    checked={chosen === choice}
                    disabled={disabled}
                    onChange={() => onChange(item.id, encodeChoice(choice, ""))}
                    className="accent-indigo-600"
                  />
                  <span className="text-sm">{choice}</span>
                </label>
              ))}
            </div>
            {showFollowup && item.followup && (
              <textarea
                className="w-full mt-3 bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-800
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                rows={2}
                placeholder={item.followup.prompt}
                disabled={disabled}
                value={followupText}
                onChange={(e) => onChange(item.id, encodeChoice(chosen ?? "", e.target.value))}
                aria-label={item.followup.prompt}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function parseChoice(raw: string): [string | null, string] {
  if (!raw) return [null, ""];
  const idx = raw.indexOf(FOLLOWUP_SEP);
  if (idx === -1) return [raw, ""];
  return [raw.slice(0, idx), raw.slice(idx + FOLLOWUP_SEP.length)];
}

function encodeChoice(choice: string, followup: string): string {
  return followup ? `${choice}${FOLLOWUP_SEP}${followup}` : choice;
}
