import type { SessionStatus, Phase } from "../../types";
import { useTimer } from "../../hooks/useTimer";

const PHASE_ORDER: Phase[] = [
  "info_reading", "preference", "p1_opening", "p2_opening", "open_discussion", "decision", "survey",
];
const PHASE_LABELS: Record<string, string> = {
  info_reading: "Info Reading", preference: "Preference", p1_opening: "P1 Opening", p2_opening: "P2 Opening",
  open_discussion: "Open Discussion", decision: "Decision", survey: "Survey",
};

interface SharedControlsProps {
  status: SessionStatus | null;
  sessionStarted: boolean;
  advancePhase: () => void;
  pause: () => void;
  resume: () => void;
  extend: (s: number) => void;
  onStartSession: () => void;
  onStopSession: () => void;
  startLoading: boolean;
}

export function SharedControls({
  status, sessionStarted, advancePhase, pause, resume, extend,
  onStartSession, onStopSession, startLoading,
}: SharedControlsProps) {
  // Drift-corrected local countdown — same hook the participant Timer uses,
  // so admin and participant displays stay synchronized after a phase advance.
  // Without this, the admin timer was a static read of status.phase_remaining
  // and froze between WebSocket state events while the participant kept ticking.
  const { remaining, display: timer } = useTimer(
    status?.phase_remaining ?? null,
    status?.phase_paused ?? null,
  );
  const isUrgent = remaining > 0 && remaining <= 30;
  const currentPhase = status?.phase;

  // Not started state
  if (!sessionStarted) {
    return (
      <div className="px-5 py-6 bg-white border-b border-gray-200 flex flex-col items-center gap-4">
        <div className="text-center">
          <div className="text-4xl mb-2">{"🔬"}</div>
          <p className="text-sm text-gray-500 mb-1">Session created. Waiting for participants to connect.</p>
          <p className="text-xs text-gray-400">Press Start when both P1 and P2 are connected.</p>
        </div>
        <button
          onClick={onStartSession}
          disabled={startLoading}
          className="px-8 py-3 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 disabled:bg-gray-300 disabled:text-gray-500 shadow-sm transition-colors"
        >
          {startLoading ? "Starting..." : "Start Session"}
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 py-3 bg-white border-b border-gray-200">
      {/* Phase stepper — read-only navigation; phase changes via "Advance →" button only */}
      <div className="flex items-center gap-0.5 mb-3" role="status" aria-label="phase progress">
        {PHASE_ORDER.map((p, i) => {
          const phaseIdx = PHASE_ORDER.indexOf(currentPhase as Phase);
          const isCurrent = currentPhase === p;
          const isPast = phaseIdx >= 0 && i < phaseIdx;
          return (
            <div key={p} className="flex items-center">
              {i > 0 && (
                <div className={`w-4 h-0.5 ${isPast ? "bg-indigo-400" : "bg-gray-200"}`} />
              )}
              <span
                title={PHASE_LABELS[p]}
                aria-current={isCurrent ? "step" : undefined}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold select-none ${
                  isCurrent
                    ? "bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300"
                    : isPast
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-gray-100 text-gray-400"
                }`}
              >
                {PHASE_LABELS[p]?.split(" ").map(w => w[0]).join("") ?? p}
              </span>
            </div>
          );
        })}
        <span className="ml-2 text-xs text-gray-500 font-medium">
          {PHASE_LABELS[currentPhase ?? ""] ?? currentPhase ?? "---"}
        </span>
      </div>

      {/* Timer + controls row */}
      <div className="flex items-center gap-4">
        {/* Big timer */}
        <div className={`font-mono text-4xl font-black tabular-nums tracking-tight ${
          isUrgent ? "text-red-600 timer-urgent" : status?.phase_paused ? "text-amber-500" : "text-gray-900"
        }`}>
          {timer}
        </div>

        {/* Control buttons */}
        <div className="flex gap-1.5">
          <button
            onClick={status?.phase_paused ? resume : pause}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
              status?.phase_paused
                ? "bg-green-100 text-green-700 hover:bg-green-200"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {status?.phase_paused ? "\u25B6 Resume" : "\u23F8 Pause"}
          </button>
          <button
            onClick={() => extend(60)}
            className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-xs font-semibold"
            title="Extend the current phase by 1 minute"
          >
            +1 Min
          </button>
          <button
            onClick={advancePhase}
            disabled={status?.phase_paused || currentPhase === "survey"}
            className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 text-sm font-bold shadow-sm transition-colors flex items-center gap-1.5"
          >
            Advance
            <span aria-hidden className="text-base leading-none">{"→"}</span>
          </button>
        </div>

        {/* Spacer pushes End Session to the far right, away from Advance */}
        <div className="flex-1" />

        {/* End session — visually demoted, far from Advance to prevent misclick */}
        <button
          onClick={onStopSession}
          className="px-3 py-2 bg-gray-50 text-gray-400 rounded-lg hover:bg-red-50 hover:text-red-600 text-xs font-medium transition-colors"
        >
          End Session
        </button>
      </div>

      {status?.phase_paused && (
        <div className="mt-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Paused — phase will not auto-advance. Click Resume to continue.
        </div>
      )}
    </div>
  );
}
