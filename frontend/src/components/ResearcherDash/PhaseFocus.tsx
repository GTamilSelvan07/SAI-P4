import type { SessionStatus, MicState, AIIntervention } from "../../types";

interface PhaseFocusProps {
  status: SessionStatus | null;
  interventions: AIIntervention[];
  votes: Record<string, string>;
  connectedRoles: string[];
  surveysSubmitted: number; // 0–2
}

/**
 * Single high-prominence card whose contents change with the current phase.
 * The visual anchor of the live researcher view — designed so the researcher
 * can glance once and know "what should I be watching right now."
 */
export function PhaseFocus({
  status,
  interventions,
  votes,
  connectedRoles,
  surveysSubmitted,
}: PhaseFocusProps) {
  const phase = status?.phase ?? null;
  const condition = status?.condition ?? "";
  const isNoAI = condition === "C0";

  if (!phase || !status?.session_started) return null;

  return (
    <div className="px-5 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-gray-200">
      {phase === "info_reading" && (
        <FocusContent
          icon="📖"
          headline="Reading task info"
          subline={`${connectedRoles.length}/2 connected — both reading independently.`}
        />
      )}
      {phase === "preference" && (
        <FocusContent
          icon="✋"
          headline="Initial preference"
          subline="Both participants choose silently. Discussion has not started."
        />
      )}
      {phase === "p1_opening" && (
        <MicFocus active="P1" status={status} />
      )}
      {phase === "p2_opening" && (
        <MicFocus active="P2" status={status} />
      )}
      {phase === "open_discussion" && (
        <DiscussionFocus interventions={interventions} isNoAI={isNoAI} />
      )}
      {phase === "decision" && (
        <DecisionFocus votes={votes} />
      )}
      {phase === "survey" && (
        <FocusContent
          icon="📋"
          headline="Post-task survey"
          subline={`${surveysSubmitted}/2 submitted.`}
        />
      )}
    </div>
  );
}

function FocusContent({ icon, headline, subline }: { icon: string; headline: string; subline: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="text-4xl leading-none">{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-900 leading-tight">{headline}</p>
        <p className="text-sm text-gray-500 mt-0.5">{subline}</p>
      </div>
    </div>
  );
}

function MicFocus({ active, status }: { active: "P1" | "P2"; status: SessionStatus }) {
  const mic_p1 = (status.mic_p1 ?? "open") as MicState;
  const mic_p2 = (status.mic_p2 ?? "open") as MicState;
  return (
    <div className="flex items-center gap-4">
      <div className="text-4xl leading-none">🎙️</div>
      <div className="flex-1">
        <p className="text-2xl font-bold text-gray-900 leading-tight">
          {active}'s opening statement
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <MicChip role="P1" state={mic_p1} highlight={active === "P1"} />
          <MicChip role="P2" state={mic_p2} highlight={active === "P2"} />
        </div>
      </div>
    </div>
  );
}

function MicChip({ role, state, highlight }: { role: string; state: MicState; highlight: boolean }) {
  const open = state === "open";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${
        open
          ? highlight
            ? "bg-green-100 text-green-800 border-green-400 ring-2 ring-green-200"
            : "bg-green-50 text-green-700 border-green-200"
          : "bg-gray-100 text-gray-500 border-gray-200"
      }`}
    >
      <span aria-hidden>{open ? "🎙️" : "🔇"}</span>
      {role} · {open ? "OPEN" : "MUTED"}
    </span>
  );
}

function DiscussionFocus({ interventions, isNoAI }: { interventions: AIIntervention[]; isNoAI: boolean }) {
  if (isNoAI) {
    return (
      <FocusContent
        icon="💬"
        headline="Open discussion"
        subline="No AI in this condition — both participants speaking freely."
      />
    );
  }
  const last = interventions.length > 0 ? interventions[interventions.length - 1] : null;
  return (
    <div className="flex items-start gap-4">
      <div className="text-4xl leading-none">💬</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-2xl font-bold text-gray-900 leading-tight">Open discussion</p>
          <span className="text-xs text-gray-500 font-medium">
            {interventions.length} intervention{interventions.length === 1 ? "" : "s"}
          </span>
        </div>
        {last ? (
          <div className="mt-2">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-0.5">
              <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold uppercase">
                {last.trigger || "manual"}
              </span>
              {last.llm_latency_ms ? (
                <span>{(last.llm_latency_ms / 1000).toFixed(1)}s</span>
              ) : null}
            </div>
            <p className="text-sm text-gray-700 leading-snug line-clamp-2">{last.text}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic mt-1">Awaiting first intervention…</p>
        )}
      </div>
    </div>
  );
}

function DecisionFocus({ votes }: { votes: Record<string, string> }) {
  const p1 = votes.P1;
  const p2 = votes.P2;
  const consensus = p1 && p2 && p1 === p2;
  return (
    <div className="flex items-center gap-4">
      <div className="text-4xl leading-none">🎯</div>
      <div className="flex-1">
        <p className="text-2xl font-bold text-gray-900 leading-tight">Final decision</p>
        <div className="flex items-center gap-2 mt-1.5">
          <VoteChip role="P1" choice={p1} />
          <span className="text-gray-300">·</span>
          <VoteChip role="P2" choice={p2} />
          {consensus && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-bold border border-green-300">
              ✓ CONSENSUS
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function VoteChip({ role, choice }: { role: string; choice: string | undefined }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-semibold border ${
        choice
          ? "bg-indigo-50 text-indigo-800 border-indigo-200"
          : "bg-gray-50 text-gray-400 border-gray-200 italic"
      }`}
    >
      <span className={`text-xs font-bold ${role === "P1" ? "text-blue-600" : "text-teal-600"}`}>{role}</span>
      <span>·</span>
      <span>{choice ?? "—"}</span>
    </span>
  );
}
