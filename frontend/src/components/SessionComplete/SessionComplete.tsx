import { useEffect, useState } from "react";
import type { SessionStatus, TaskFull, AIIntervention } from "../../types";
import { InterventionTimeline } from "../ResearcherDash/InterventionTimeline";
import { LiveMetrics } from "../ResearcherDash/LiveMetrics";
import type { LiveMetricsValue } from "../ResearcherDash/LiveMetrics";

interface ResearcherFlagRecord {
  ts: number;
  phase: string | null;
  condition: string | null;
  tag: string;
  note: string;
}

const TAG_ICON: Record<string, string> = {
  issue: "⚠", interesting: "★", "follow-up": "↻", milestone: "✓",
};
const TAG_COLOR: Record<string, string> = {
  issue: "bg-red-50 text-red-700 border-red-200",
  interesting: "bg-amber-50 text-amber-700 border-amber-200",
  "follow-up": "bg-blue-50 text-blue-700 border-blue-200",
  milestone: "bg-green-50 text-green-700 border-green-200",
};

const CONDITION_INFO: Record<string, { label: string; color: string }> = {
  C0: { label: "No AI", color: "bg-gray-100 text-gray-700 border-gray-300" },
  C1: { label: "Sham AI", color: "bg-gray-100 text-gray-600 border-gray-300" },
  C2: { label: "Neutral", color: "bg-green-50 text-green-800 border-green-300" },
  C3: { label: "Anchoring", color: "bg-amber-50 text-amber-800 border-amber-300" },
  C4: { label: "Amplification", color: "bg-orange-50 text-orange-800 border-orange-300" },
  C5: { label: "Devil's Advocate", color: "bg-purple-50 text-purple-800 border-purple-300" },
};

interface SessionCompleteProps {
  sessionId: string;
  status: SessionStatus | null;
  task: TaskFull | null;
  votes: Record<string, string>;
  interventions: AIIntervention[];
  durationSeconds?: number | null;
  onNewSession: () => void;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function SessionComplete({
  sessionId,
  status,
  task,
  votes,
  interventions,
  durationSeconds,
  onNewSession,
}: SessionCompleteProps) {
  const cond = status?.condition ?? "";
  const isNoAI = cond === "C0";
  const condCfg = CONDITION_INFO[cond] ?? CONDITION_INFO.C0;
  const correctName = task?.candidates.find((c) => c.id === task?.correct_answer)?.name;
  const consensus =
    votes.P1 && votes.P2 && votes.P1 === votes.P2 ? votes.P1 : null;
  const consensusCorrect = consensus !== null && correctName !== undefined && consensus === correctName;

  // Metrics (Wave 6) — fetched from /api/sessions/{id}/metrics on mount.
  // Backend writes metrics.json on session-end (natural or emergency).
  const [metrics, setMetrics] = useState<LiveMetricsValue | null>(null);
  const [flags, setFlags] = useState<ResearcherFlagRecord[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/sessions/${sessionId}/metrics`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => { if (m) setMetrics(m as LiveMetricsValue); })
      .catch((e) => console.warn("[SessionComplete] metrics fetch failed:", e));
    fetch(`/api/sessions/${sessionId}/flags`)
      .then((r) => (r.ok ? r.json() : { flags: [] }))
      .then((d) => setFlags((d?.flags ?? []) as ResearcherFlagRecord[]))
      .catch((e) => console.warn("[SessionComplete] flags fetch failed:", e));
  }, [sessionId]);

  // Session start = first intervention ts, or fallback to "now - duration"
  const sessionStartTs =
    interventions.length > 0 ? interventions[0].ts
    : durationSeconds ? Date.now() / 1000 - durationSeconds
    : null;
  const sessionEndTs =
    durationSeconds && sessionStartTs ? sessionStartTs + durationSeconds : null;

  return (
    <div className="flex-1 flex flex-col bg-gray-50 overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full p-8 space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Session Complete
              </p>
              <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                {task?.title ?? "Hidden Profile Task"}
              </h1>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {cond && (
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${condCfg.color}`}>
                    {cond}: {condCfg.label}
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  ID: <span className="font-mono">{sessionId}</span>
                </span>
              </div>
            </div>
            <button
              onClick={onNewSession}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 text-sm font-semibold shadow-sm transition-colors shrink-0"
            >
              New Session
            </button>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Duration" value={formatDuration(durationSeconds)} />
          {!isNoAI && (
            <StatCard label="Interventions" value={String(interventions.length)} />
          )}
          {isNoAI && (
            <StatCard label="Flags" value={String(flags.length)} />
          )}
          <StatCard
            label="P1 vote"
            value={votes.P1 ?? "—"}
            highlight={correctName && votes.P1 === correctName ? "good" : undefined}
          />
          <StatCard
            label="P2 vote"
            value={votes.P2 ?? "—"}
            highlight={correctName && votes.P2 === correctName ? "good" : undefined}
          />
        </div>

        {/* Metrics block — Wave 6. Reuses the live metrics tile component
            with the final post-hoc values from metrics.json. */}
        {metrics && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Discussion Metrics
            </h3>
            <LiveMetrics metrics={metrics} receivedAt={null} />
            <p className="mt-3 text-[11px] text-gray-400">
              Computed from the open_discussion phase. Run{" "}
              <code className="font-mono bg-gray-100 px-1 rounded">
                compute_metrics.py
              </code>{" "}
              to regenerate.
            </p>
          </div>
        )}

        {/* Consensus banner */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Consensus</h3>
          {consensus ? (
            <div
              className={`px-4 py-3 rounded-lg font-semibold ${
                consensusCorrect
                  ? "bg-green-50 text-green-800 border border-green-200"
                  : "bg-amber-50 text-amber-800 border border-amber-200"
              }`}
            >
              <span className="text-base">{consensus}</span>
              {correctName !== undefined && (
                <span className="ml-2 text-sm font-normal">
                  {consensusCorrect ? "— matches correct answer ✓" : "— anchored away from correct ⚠"}
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">
              No consensus — P1 and P2 voted differently or one didn't vote.
            </p>
          )}
          {correctName && (
            <p className="mt-2 text-xs text-gray-500">
              Correct answer: <span className="font-semibold text-gray-700">{correctName}</span>
            </p>
          )}
        </div>

        {/* Intervention timeline — Wave 2 component reused with full-session
            bounds. Hidden for C0 because there are no interventions. */}
        {!isNoAI && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Intervention Timeline ({interventions.length})
            </h3>
            {interventions.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No interventions recorded.</p>
            ) : (
              <>
                <InterventionTimeline
                  interventions={interventions}
                  startTs={sessionStartTs}
                  endTs={sessionEndTs}
                  height={48}
                />
                <ol className="space-y-2 mt-4">
                  {interventions.map((iv, i) => (
                    <li
                      key={`${iv.ts}-${i}`}
                      className="bg-purple-50 border border-purple-100 rounded-lg p-3"
                    >
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                        <span className="font-mono">
                          {new Date(iv.ts * 1000).toLocaleTimeString([], {
                            hour: "2-digit", minute: "2-digit", second: "2-digit",
                          })}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600 font-mono text-[10px]">
                          {iv.source || "?"}
                        </span>
                        {iv.trigger && (
                          <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600 font-mono text-[10px]">
                            {iv.trigger}
                          </span>
                        )}
                        {iv.llm_latency_ms > 0 && (
                          <span className="text-gray-400">{(iv.llm_latency_ms / 1000).toFixed(1)}s</span>
                        )}
                      </div>
                      <p className="text-sm italic text-purple-900 leading-snug">"{iv.text}"</p>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )}

        {/* Researcher flags — annotations entered live during the session */}
        {flags.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Researcher Flags ({flags.length})
            </h3>
            <ol className="space-y-2">
              {flags.map((f, i) => (
                <li
                  key={`${f.ts}-${i}`}
                  className={`rounded-lg border p-3 ${TAG_COLOR[f.tag] ?? "bg-gray-50 border-gray-200"}`}
                >
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <span aria-hidden>{TAG_ICON[f.tag] ?? "•"}</span>
                    <span className="font-bold uppercase tracking-wide">{f.tag}</span>
                    {f.phase && (
                      <span className="font-mono opacity-70">· {f.phase}</span>
                    )}
                    <span className="font-mono opacity-50">
                      · {new Date(f.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>
                  {f.note ? (
                    <p className="text-sm leading-snug">{f.note}</p>
                  ) : (
                    <p className="text-xs italic opacity-70">no note</p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Data location */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Data Saved</h3>
          <p className="text-xs text-gray-600">
            Session artifacts (events.jsonl, transcript.jsonl, audio_*.wav, session_meta.json,
            lsl_markers.csv) are written under:
          </p>
          <code className="mt-2 inline-block text-xs font-mono text-gray-800 bg-gray-100 rounded px-2 py-1">
            data/sessions/{sessionId}_*/
          </code>
        </div>

        <div className="flex justify-center pt-4 pb-8">
          <button
            onClick={onNewSession}
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 text-sm font-semibold shadow-sm transition-colors"
          >
            Run Another Session
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "good" | "bad";
}) {
  const valueColor =
    highlight === "good" ? "text-green-700" : highlight === "bad" ? "text-red-700" : "text-gray-900";
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}
