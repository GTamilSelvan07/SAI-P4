import type { SessionStatus, AIIntervention } from "../../types";
import { InterventionTimeline } from "./InterventionTimeline";

export interface FacilitatorState {
  active: boolean;
  intervention_count: number;
  seconds_until_next: number;
  last_response: string;
  model: string;
}

interface AIPanelProps {
  status: SessionStatus | null;
  facilitator: FacilitatorState | null;
  interventions: AIIntervention[];
  sessionStartedAt: number | null;
  playFailsafe: (category: string, text: string) => void;
}

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  live_llm: { label: "LLM", color: "bg-blue-100 text-blue-700" },
  regenerated_llm: { label: "REGEN", color: "bg-amber-100 text-amber-700" },
  pre_generated: { label: "PRE", color: "bg-green-100 text-green-700" },
  failsafe_clip: { label: "SAFE", color: "bg-red-100 text-red-700" },
};

const TRIGGER_LABELS: Record<string, string> = {
  timer: "Timer", lull: "Lull", keyword: "Keyword", turn_count: "Turns",
  fixed_timer: "Fixed", researcher: "Manual", failsafe: "Failsafe",
};

export function AIPanel({
  status, facilitator, interventions, sessionStartedAt, playFailsafe,
}: AIPanelProps) {
  const condCond = status?.condition ?? "";

  return (
    <div className="w-80 shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-y-auto custom-scroll">
      {/* AI Monitor Metrics — the live LLM facilitator driven by Whisper ASR
          triggers (timer, lull, keyword, turn-count). */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
          AI Facilitator (Auto)
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="Interventions" value={`${facilitator?.intervention_count ?? interventions.length}`} />
          <MetricCard
            label="Next Trigger"
            value={facilitator?.seconds_until_next ? `${Math.round(facilitator.seconds_until_next)}s` : "—"}
          />
          {interventions.length > 0 && (
            <>
              <MetricCard
                label="Last Latency"
                value={interventions[interventions.length - 1].llm_latency_ms
                  ? `${(interventions[interventions.length - 1].llm_latency_ms / 1000).toFixed(1)}s`
                  : "—"}
                color={
                  interventions[interventions.length - 1].llm_latency_ms > 5000 ? "text-red-600"
                  : interventions[interventions.length - 1].llm_latency_ms > 3000 ? "text-amber-600"
                  : "text-green-600"
                }
              />
              <MetricCard label="Model" value={facilitator?.model ?? "—"} small />
            </>
          )}
        </div>
      </div>

      {/* Failsafe Override */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-xs font-bold text-red-500 uppercase tracking-wider mb-2">Failsafe Override</h3>
        <div className="space-y-1">
          {condCond === "C3" && (
            <FailsafeBtn label="Anchored Summary"
              onClick={() => playFailsafe("c3_anchored", "It sounds like this option has some strong points. What do you think about it as the leading choice?")} />
          )}
          {condCond === "C4" && (
            <FailsafeBtn label="Amplified Follow-up"
              onClick={() => playFailsafe("c4_amplified", "That's a really interesting point you made. Could you tell us more about your thinking there?")} />
          )}
          {condCond === "C5" && (
            <FailsafeBtn label="Challenge"
              onClick={() => playFailsafe("c5_challenge", "Before you decide, what are the potential downsides of the option you're leaning toward?")} />
          )}
          <div className="border-t border-gray-100 pt-1 mt-1" />
          <FailsafeBtn label="Sham Neutral" onClick={() => playFailsafe("sham_neutral", "The discussion is progressing well. Both of you have been contributing.")} />
          <FailsafeBtn label="2-Min Warning" onClick={() => playFailsafe("2min_warning", "You have about 2 minutes remaining to reach a decision.")} />
        </div>
      </div>

      {/* Intervention Timeline (visual strip) */}
      {sessionStartedAt !== null && (
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
            Timeline
          </h3>
          <InterventionTimeline
            interventions={interventions}
            startTs={sessionStartedAt}
          />
        </div>
      )}

      {/* Intervention list */}
      <div className="px-4 py-3 border-b border-gray-200 flex-1 overflow-hidden flex flex-col">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
          Intervention History ({interventions.length})
        </h3>
        <div className="flex-1 overflow-y-auto space-y-2 custom-scroll">
          {interventions.length === 0 && (
            <p className="text-xs text-gray-400 italic">No interventions yet</p>
          )}
          {[...interventions].reverse().map((iv, idx) => {
            const srcCfg = SOURCE_LABELS[iv.source] ?? { label: iv.source, color: "bg-gray-100 text-gray-600" };
            return (
              <div key={`${iv.ts}-${idx}`} className="bg-purple-50 rounded-lg p-2.5 border border-purple-100">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <span className="text-xs text-gray-400 font-mono">
                    {new Date(iv.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${srcCfg.color}`}>{srcCfg.label}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                    {TRIGGER_LABELS[iv.trigger] ?? iv.trigger}
                  </span>
                  {iv.llm_latency_ms > 0 && (
                    <span className="text-xs text-gray-400">{(iv.llm_latency_ms / 1000).toFixed(1)}s</span>
                  )}
                </div>
                <p className="text-xs text-purple-900 italic leading-snug">"{iv.text}"</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color, small }: {
  label: string; value: string; color?: string; small?: boolean;
}) {
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`${small ? "text-xs" : "text-sm"} font-bold ${color ?? "text-gray-900"}`}>{value}</div>
    </div>
  );
}

function FailsafeBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-800 hover:bg-red-100 text-left font-medium"
    >
      {label}
    </button>
  );
}
