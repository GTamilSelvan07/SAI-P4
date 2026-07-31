import { useState } from "react";
import type { AIIntervention } from "../../types";

interface InterventionTimelineProps {
  interventions: AIIntervention[];
  startTs: number | null;
  endTs?: number | null; // if null, "now" is used (live mode)
  height?: number;
}

const TRIGGER_COLOR: Record<string, string> = {
  timer:       "#6366f1", // indigo
  lull:        "#14b8a6", // teal
  keyword:     "#f59e0b", // amber
  turn_count:  "#8b5cf6", // violet
  fixed_timer: "#06b6d4", // cyan
  researcher:  "#a855f7", // purple
  failsafe:    "#ef4444", // red
};

const TRIGGER_LABEL: Record<string, string> = {
  timer: "Timer", lull: "Lull", keyword: "Keyword", turn_count: "Turns",
  fixed_timer: "Fixed", researcher: "Manual", failsafe: "Failsafe",
};

/**
 * Horizontal SVG strip rendering interventions as dots positioned by time.
 * Reusable: live (endTs null = now, refreshes implicitly when state changes)
 * and post-session (endTs = session_ended_at).
 */
export function InterventionTimeline({
  interventions,
  startTs,
  endTs = null,
  height = 36,
}: InterventionTimelineProps) {
  const [hover, setHover] = useState<number | null>(null);

  if (!startTs) {
    return (
      <div className="text-xs text-gray-400 italic px-1 py-2">Timeline unavailable.</div>
    );
  }

  const right = endTs ?? Date.now() / 1000;
  const totalSec = Math.max(1, right - startTs);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Intervention timeline"
      >
        {/* Track */}
        <rect x={1} y={height / 2 - 1} width={98} height={2} fill="#e5e7eb" rx={1} />
        {/* Quarter / half / three-quarter tick marks */}
        {[0.25, 0.5, 0.75].map((q) => (
          <line
            key={q}
            x1={1 + 98 * q}
            x2={1 + 98 * q}
            y1={height / 2 - 4}
            y2={height / 2 + 4}
            stroke="#d1d5db"
            strokeWidth={0.3}
          />
        ))}
        {/* Interventions */}
        {interventions.map((iv, i) => {
          const xPct = Math.min(99, Math.max(1, ((iv.ts - startTs) / totalSec) * 100));
          const color = TRIGGER_COLOR[iv.trigger] ?? "#6b7280";
          const isHover = hover === i;
          return (
            <g
              key={`${iv.ts}-${i}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={xPct}
                cy={height / 2}
                r={isHover ? 4 : 2.5}
                fill={color}
                stroke="white"
                strokeWidth={0.6}
              />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 font-mono mt-0.5 px-1">
        <span>0:00</span>
        <span>{formatMs(totalSec * 1000)}</span>
      </div>

      {/* Hover detail */}
      {hover !== null && interventions[hover] && (
        <div className="mt-2 rounded-md border border-gray-200 bg-white p-2 text-xs shadow-sm">
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: TRIGGER_COLOR[interventions[hover].trigger] ?? "#6b7280" }}
            />
            <span className="font-semibold text-gray-700">
              {TRIGGER_LABEL[interventions[hover].trigger] ?? interventions[hover].trigger}
            </span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-500">
              t+{formatMs((interventions[hover].ts - startTs) * 1000)}
            </span>
            {interventions[hover].llm_latency_ms > 0 && (
              <>
                <span className="text-gray-400">·</span>
                <span className="text-gray-500">
                  {(interventions[hover].llm_latency_ms / 1000).toFixed(1)}s
                </span>
              </>
            )}
          </div>
          <p className="text-gray-700 italic leading-snug line-clamp-3">
            "{interventions[hover].text}"
          </p>
        </div>
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
