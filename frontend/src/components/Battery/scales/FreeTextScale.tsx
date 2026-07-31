/**
 * FreeTextScale — open-text response. Optional minimum length per item.
 *
 * Used by: manipulation-check open items (C13.1, C13.6), debrief open items
 * (E2, E3, E5).
 */
import type { ScaleRendererProps } from "./types";
import { visibleItems } from "../scaleRegistry";

export function FreeTextScale({ scale, values, onChange, condition, disabled }: ScaleRendererProps) {
  const items = visibleItems(scale, condition);

  return (
    <div className="space-y-4">
      {scale.instruction && (
        <p className="text-sm text-gray-600 leading-relaxed">{scale.instruction}</p>
      )}

      {items.map((item) => (
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
            value={(values[item.id] as string | null) ?? ""}
            onChange={(e) => onChange(item.id, e.target.value)}
            aria-label={item.text}
          />
          {item.minLength !== undefined && item.minLength > 0 && (
            <p className="text-[11px] text-gray-400 mt-1">
              Min. {item.minLength} characters.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
