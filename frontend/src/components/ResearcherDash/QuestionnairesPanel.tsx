/**
 * QuestionnairesPanel — researcher-facing per-condition view of every
 * questionnaire phase for a group (Demographics, Intake, Posttask, Debrief).
 *
 * For each phase:
 *  - lists the scales that will be presented (driven by frontend scaleRegistry,
 *    which mirrors the backend manifest),
 *  - shows per-role completion (via the existing /progress endpoints),
 *  - exposes the participant URL with Copy + Open-in-new-tab buttons.
 *
 * Only the Posttask card changes when the researcher switches condition;
 * Demographics, Intake and Debrief are condition-agnostic by registry design.
 */
import { useEffect, useMemo, useState } from "react";
import type { Condition } from "../../types";
import {
  scalesForPhase,
  estimatedSeconds,
  REGISTRY_VERSION,
  type ScaleDef,
  type Phase,
} from "../Battery/scaleRegistry";

interface QuestionnairesPanelProps {
  groupId: string;
  p1Label: string | null;
  p2Label: string | null;
  p1IntakeDoneAt: string | null;
  p2IntakeDoneAt: string | null;
  p1DebriefDoneAt: string | null;
  p2DebriefDoneAt: string | null;
  sessionIds: string[];
}

const CONDITIONS: Condition[] = ["C0", "C1", "C2", "C3", "C4", "C5"];

const CONDITION_COLOR: Record<Condition, string> = {
  C0: "bg-gray-100 text-gray-700 border-gray-300",
  C1: "bg-gray-100 text-gray-700 border-gray-300",
  C2: "bg-green-50 text-green-800 border-green-300",
  C3: "bg-amber-50 text-amber-800 border-amber-300",
  C4: "bg-orange-50 text-orange-800 border-orange-300",
  C5: "bg-purple-50 text-purple-800 border-purple-300",
};

const D0_COLOR = "bg-sky-50 text-sky-800 border-sky-300";

interface BatteryProgress {
  phase: string;
  ordered_scale_ids: string[];
  completed_scale_ids: string[];
  next_scale_id: string | null;
  registry_version: string;
}

type Role = "P1" | "P2";

// ── Component ────────────────────────────────────────────────────────────────

export function QuestionnairesPanel(props: QuestionnairesPanelProps) {
  const {
    groupId,
    p1Label, p2Label,
    p1IntakeDoneAt, p2IntakeDoneAt,
    p1DebriefDoneAt, p2DebriefDoneAt,
    sessionIds,
  } = props;

  const [condition, setCondition] = useState<Condition>("C2");
  const [selectedSessionId, setSelectedSessionId] = useState<string>(sessionIds[0] ?? "");

  // Keep the dropdown in sync if the parent group adds new sessions.
  useEffect(() => {
    if (!selectedSessionId && sessionIds.length > 0) {
      setSelectedSessionId(sessionIds[0]);
    }
  }, [sessionIds, selectedSessionId]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Questionnaires</h3>
          <p className="text-xs text-gray-500">
            Registry <code className="font-mono">{REGISTRY_VERSION}</code>.
            D0 is collected once before the task conditions; posttask scales depend on C0-C5.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${D0_COLOR}`}>D0 · one-time</span>
          <ConditionTabs value={condition} onChange={setCondition} />
        </div>
      </div>

      <PhaseCard
        label="D0"
        title="Demographics"
        description="Age, gender, language, prior AI experience. Collected once before any task condition."
        scales={null}
        showScaleList={false}
        url={participantUrl(groupId, "P1", "intake")}
        urlP2={participantUrl(groupId, "P2", "intake")}
        p1Done={!!p1IntakeDoneAt}
        p2Done={!!p2IntakeDoneAt}
        p1Label={p1Label}
        p2Label={p2Label}
        progressFor={null}
        footnote="Demographics is the first step of the same URL participants use for the intake battery; submitting one auto-advances to the other."
      />

      <PhaseCard
        label="D0"
        title="Pre-task questionnaire"
        description="Personality (TIPI), Need for Cognition, Trust Propensity, baseline SAM, and pre-task expectation. Collected once."
        scales={scalesForPhase("intake")}
        showScaleList
        estimatedMinutes={Math.ceil(estimatedSeconds("intake") / 60)}
        url={participantUrl(groupId, "P1", "intake")}
        urlP2={participantUrl(groupId, "P2", "intake")}
        progressFor={{ kind: "group", groupId, phase: "intake" }}
        p1Done={!!p1IntakeDoneAt}
        p2Done={!!p2IntakeDoneAt}
        p1Label={p1Label}
        p2Label={p2Label}
      />

      <PosttaskCard
        condition={condition}
        sessionIds={sessionIds}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
      />

      <PhaseCard
        label="Debrief"
        title="Debrief (Post-debrief manipulation check)"
        description="Awareness of the AI manipulation. Same scale for every condition; specific items only render for C1–C5."
        scales={scalesForPhase("debrief")}
        showScaleList
        estimatedMinutes={Math.ceil(estimatedSeconds("debrief") / 60)}
        url={participantUrl(groupId, "P1", "debrief")}
        urlP2={participantUrl(groupId, "P2", "debrief")}
        progressFor={{ kind: "group", groupId, phase: "debrief" }}
        p1Done={!!p1DebriefDoneAt}
        p2Done={!!p2DebriefDoneAt}
        p1Label={p1Label}
        p2Label={p2Label}
        footnote="Debrief URLs become active after the researcher clicks End + Debrief above. Sending them before that returns a 'group not complete' notice to the participant."
      />
    </div>
  );
}

// ── ConditionTabs ────────────────────────────────────────────────────────────

function ConditionTabs({ value, onChange }: { value: Condition; onChange: (c: Condition) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1">
      {CONDITIONS.map((c) => {
        const selected = c === value;
        return (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
              selected
                ? CONDITION_COLOR[c] + " shadow-sm"
                : "bg-transparent text-gray-500 border-transparent hover:bg-white hover:text-gray-700"
            }`}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}

// ── PhaseCard ────────────────────────────────────────────────────────────────

interface PhaseCardProps {
  label?: string;
  title: string;
  description: string;
  scales: ScaleDef[] | null;
  showScaleList: boolean;
  estimatedMinutes?: number;
  url: string;
  urlP2: string;
  progressFor: { kind: "group"; groupId: string; phase: "intake" | "debrief" } | null;
  p1Done: boolean;
  p2Done: boolean;
  p1Label: string | null;
  p2Label: string | null;
  footnote?: string;
}

function PhaseCard(props: PhaseCardProps) {
  const {
    label, title, description, scales, showScaleList, estimatedMinutes,
    url, urlP2, progressFor, p1Done, p2Done, p1Label, p2Label, footnote,
  } = props;

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
          {label && (
            <span className={`inline-flex mt-1 px-2 py-0.5 rounded text-[10px] font-bold border ${label === "D0" ? D0_COLOR : "bg-gray-100 text-gray-600 border-gray-200"}`}>
              {label}
            </span>
          )}
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {scales && <span>{scales.length} scale{scales.length === 1 ? "" : "s"}</span>}
          {estimatedMinutes !== undefined && (
            <span>· ≈{estimatedMinutes} min</span>
          )}
        </div>
      </div>

      {showScaleList && scales && (
        <div className="flex flex-wrap gap-1.5">
          {scales.map((s) => (
            <span
              key={s.id}
              title={`${s.title} · ${s.citation}`}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-white border border-gray-200 text-gray-700"
            >
              <code className="font-mono">{s.id}</code>
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <RoleRow
          role="P1"
          label={p1Label}
          done={p1Done}
          url={url}
          progressFor={progressFor}
        />
        <RoleRow
          role="P2"
          label={p2Label}
          done={p2Done}
          url={urlP2}
          progressFor={progressFor}
        />
      </div>

      {footnote && (
        <p className="text-[11px] text-gray-400 italic">{footnote}</p>
      )}
    </div>
  );
}

// ── RoleRow ──────────────────────────────────────────────────────────────────

interface RoleRowProps {
  role: Role;
  label: string | null;
  done: boolean;
  url: string;
  progressFor: { kind: "group"; groupId: string; phase: "intake" | "debrief" } | null;
}

function RoleRow({ role, label, done, url, progressFor }: RoleRowProps) {
  const progress = useGroupProgress(progressFor, role);
  const completed = progress?.completed_scale_ids.length ?? 0;
  const total = progress?.ordered_scale_ids.length ?? 0;
  const ratio = total > 0 ? `${completed}/${total}` : (done ? "✓" : "—");

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-gray-700">
          {role}{label ? ` · ${label}` : ""}
        </span>
        <span className={`font-mono ${done ? "text-emerald-600 font-semibold" : "text-gray-500"}`}>
          {ratio}{done && progressFor ? " ✓" : ""}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          className="flex-1 min-w-0 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-[11px] font-mono"
        />
        <CopyButton value={url} />
        <button
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          className="px-2.5 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-[11px] font-semibold hover:bg-indigo-100 whitespace-nowrap"
          title="Open this URL in a new tab"
        >
          Open ↗
        </button>
      </div>
    </div>
  );
}

// ── PosttaskCard (session-bound, condition-aware) ────────────────────────────

interface PosttaskCardProps {
  condition: Condition;
  sessionIds: string[];
  selectedSessionId: string;
  onSelectSession: (sid: string) => void;
}

function PosttaskCard({ condition, sessionIds, selectedSessionId, onSelectSession }: PosttaskCardProps) {
  const scales = useMemo(() => scalesForPhase("posttask", condition), [condition]);
  const minutes = Math.ceil(estimatedSeconds("posttask", condition) / 60);

  return (
    <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-gray-900">
            Posttask <span className="text-xs font-normal text-gray-500">— {condition}</span>
          </h4>
          <p className="text-xs text-gray-500 mt-0.5">
            {condition === "C0"
              ? "C0 uses a reduced battery — AI-specific scales (Jian, Schaefer, Godspeed, SASSI, manipulation_check) are dropped because Alex is absent."
              : "C1–C5 use the full AI-evaluation battery. manipulation_check is pinned last to avoid biasing earlier responses."}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{scales.length} scale{scales.length === 1 ? "" : "s"}</span>
          <span>· ≈{minutes} min</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {scales.map((s) => (
          <span
            key={s.id}
            title={`${s.title} · ${s.citation}`}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-white border border-gray-200 text-gray-700"
          >
            <code className="font-mono">{s.id}</code>
          </span>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <label className="text-gray-500">Session:</label>
          {sessionIds.length === 0 ? (
            <span className="italic text-gray-400">No sessions yet — create one above.</span>
          ) : (
            <select
              value={selectedSessionId}
              onChange={(e) => onSelectSession(e.target.value)}
              className="flex-1 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-[11px] font-mono"
            >
              {sessionIds.map((sid) => (
                <option key={sid} value={sid}>{sid}</option>
              ))}
            </select>
          )}
        </div>

        {selectedSessionId && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <PosttaskRoleRow sessionId={selectedSessionId} role="P1" />
            <PosttaskRoleRow sessionId={selectedSessionId} role="P2" />
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 italic">
        Posttask fires automatically inside each participant's live session view when the task ends.
        It does not have a standalone URL; the row above shows real-time progress polled from the
        backend. To re-trigger it for a specific role, ask them to refresh the participant tab.
      </p>
    </div>
  );
}

function PosttaskRoleRow({ sessionId, role }: { sessionId: string; role: Role }) {
  const progress = useSessionPosttaskProgress(sessionId, role);
  const completed = progress?.completed_scale_ids.length ?? 0;
  const total = progress?.ordered_scale_ids.length ?? 0;
  const ratio = total > 0 ? `${completed}/${total}` : "—";
  const done = total > 0 && completed === total;

  return (
    <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5 text-xs">
      <span className="font-semibold text-gray-700">{role}</span>
      <span className={`font-mono ${done ? "text-emerald-600 font-semibold" : "text-gray-500"}`}>
        {ratio}{done ? " ✓" : ""}
      </span>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function participantUrl(groupId: string, role: Role, kind: "intake" | "debrief"): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return kind === "intake"
    ? `${base}/group/${encodeURIComponent(groupId)}/${role}`
    : `${base}/group/${encodeURIComponent(groupId)}/${role}/debrief`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="px-2.5 py-1.5 bg-white text-gray-700 border border-gray-300 rounded text-[11px] font-semibold hover:bg-gray-50 whitespace-nowrap"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Progress polling hooks ───────────────────────────────────────────────────

function useGroupProgress(
  target: { kind: "group"; groupId: string; phase: Phase } | null,
  role: Role,
): BatteryProgress | null {
  const [state, setState] = useState<BatteryProgress | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const url = `/api/groups/${encodeURIComponent(target.groupId)}/battery/${role}/progress?phase=${target.phase}`;
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) return;
        const d: BatteryProgress = await r.json();
        if (!cancelled) setState(d);
      } catch {
        /* transient — try again next tick */
      }
    };
    void tick();
    const id = window.setInterval(tick, 4000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [target, role]);

  return state;
}

function useSessionPosttaskProgress(
  sessionId: string,
  role: Role,
): BatteryProgress | null {
  const [state, setState] = useState<BatteryProgress | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/posttask/${role}/progress`;
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) return;
        const d: BatteryProgress = await r.json();
        if (!cancelled) setState(d);
      } catch {
        /* transient — try again next tick */
      }
    };
    void tick();
    const id = window.setInterval(tick, 4000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [sessionId, role]);

  return state;
}
