/**
 * GroupDetail — drilldown for one questionnaire dyad: intake status, session list, create
 * new session, end / abort.
 */
import { useEffect, useState } from "react";
import type { Condition } from "../../types";
import { QuestionnairesPanel } from "./QuestionnairesPanel";

interface GroupSnapshot {
  group_id: string;
  status: string;
  created_at: number;
  p1_label: string | null;
  p2_label: string | null;
  p1_intake_done: boolean;
  p2_intake_done: boolean;
  p1_intake_done_at: string | null;
  p2_intake_done_at: string | null;
  p1_debrief_done_at: string | null;
  p2_debrief_done_at: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  session_ids: string[];
  last_active_session_id: string | null;
}

interface SessionRow {
  session_id: string;
  group_id: string;
  condition: Condition;
  task_id: string;
  status: string;
  created_at: number;
}

const CONDITIONS: Condition[] = ["C0", "C1", "C2", "C3", "C4", "C5"];

const CONDITION_LABELS: Record<Condition, string> = {
  C0: "No AI",
  C1: "Sham AI",
  C2: "Neutral AI",
  C3: "Anchoring AI",
  C4: "Amplification AI",
  C5: "Devil's Advocate",
};

export interface GroupDetailProps {
  groupId: string;
  onBack: () => void;
  onOpenSession: (sessionId: string) => void;
}

export function GroupDetail({ groupId, onBack, onOpenSession }: GroupDetailProps) {
  const [group, setGroup] = useState<GroupSnapshot | null>(null);
  const [tasks, setTasks] = useState<string[]>([]);
  const [sessionRows, setSessionRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAdvancedQuestionnaireLinks, setShowAdvancedQuestionnaireLinks] = useState(false);
  const [newCondition, setNewCondition] = useState<Condition>("C2");
  const [newTask, setNewTask] = useState("");

  const refresh = async () => {
    try {
      const r = await fetch(`/api/groups/${groupId}`);
      if (r.ok) setGroup(await r.json());
    } catch (e) {
      setError(`refresh failed: ${(e as Error).message}`);
    }
  };

  const refreshSessions = async () => {
    try {
      const r = await fetch("/api/sessions");
      if (!r.ok) return;
      const rows = (await r.json()) as SessionRow[];
      setSessionRows(rows.filter((row) => row.group_id === groupId));
    } catch (e) {
      console.warn("[GroupDetail] session refresh failed:", e);
    }
  };

  useEffect(() => {
    refresh();
    refreshSessions();
    fetch("/api/tasks").then((r) => r.json()).then((ids: string[]) => {
      setTasks(ids);
      if (ids.length > 0) setNewTask(ids[0]);
    }).catch(() => {});
    const t = setInterval(() => {
      refresh();
      refreshSessions();
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  if (!group) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 text-sm text-gray-500">
        Loading group {groupId}…
      </div>
    );
  }

  const createSession = async () => {
    setCreating(true);
    setError("");
    try {
      const r = await fetch(`/api/groups/${groupId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ condition: newCondition, task_id: newTask, mode: "study" }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }));
        setError(err.detail || `create failed ${r.status}`);
        return;
      }
      setShowCreate(false);
      await refresh();
      await refreshSessions();
    } finally {
      setCreating(false);
    }
  };

  const endGroup = async () => {
    if (!confirm("End this questionnaire flow and run debrief on the last session?")) return;
    const r = await fetch(`/api/groups/${groupId}/end`, { method: "POST" });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      setError(err.detail || `end failed ${r.status}`);
      return;
    }
    await refresh();
  };

  const abortGroup = async () => {
    const reason = prompt("Reason for aborting? (optional)");
    if (reason === null) return;
    const r = await fetch(`/api/groups/${groupId}/abort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason || undefined }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      setError(err.detail || `abort failed ${r.status}`);
      return;
    }
    await refresh();
  };

  const canCreateSession = group.status === "ready" || group.status === "active";
  const canEnd = group.status === "active" || group.status === "ready";
  const joinUrl = (role: "P1" | "P2") => `${window.location.origin}/group/${group.group_id}/${role}`;
  const debriefUrl = (role: "P1" | "P2") => `${window.location.origin}/group/${group.group_id}/${role}/debrief`;
  const sessionUrl = (sessionId: string, role: "P1" | "P2") => `${window.location.origin}/session/${encodeURIComponent(sessionId)}/${role}`;
  const showDebriefUrls = group.status === "completed"
    && (!group.p1_debrief_done_at || !group.p2_debrief_done_at);
  const rowsById = new Map(sessionRows.map((row) => [row.session_id, row]));
  const orderedSessions = group.session_ids.map((sid) => (
    rowsById.get(sid) ?? {
      session_id: sid,
      group_id: group.group_id,
      condition: "C2" as Condition,
      task_id: "unknown",
      status: "unknown",
      created_at: 0,
    }
  ));

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 mb-2">← Back to questionnaire</button>
            <h1 className="text-2xl font-bold text-gray-900 font-mono">{group.group_id}</h1>
            <p className="text-sm text-gray-500">
              Status <code className="font-mono">{group.status}</code>
              {group.notes && ` · ${group.notes}`}
            </p>
          </div>
          <div className="flex gap-2">
            {canEnd && (
              <button
                onClick={endGroup}
                className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 shadow-sm"
              >
                End + Debrief
              </button>
            )}
            {group.status !== "completed" && group.status !== "aborted" && (
              <button onClick={abortGroup} className="px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm hover:bg-red-100">
                Abort
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Simple live-session flow</h3>
              <p className="text-xs text-gray-500 mt-1">
                D0 is the one-time demographics + pre-task block. Then create a C0-C5 session, give participants the session ID, run the task, and post-task opens inside the same participant screen.
              </p>
            </div>
            <button
              onClick={() => setShowAdvancedQuestionnaireLinks((v) => !v)}
              className="px-3 py-2 bg-gray-50 text-gray-700 border border-gray-200 rounded-lg text-xs font-semibold hover:bg-gray-100 whitespace-nowrap"
            >
              {showAdvancedQuestionnaireLinks ? "Hide extra links" : "Show extra links"}
            </button>
          </div>
        </div>

        {showAdvancedQuestionnaireLinks && (
          <ParticipantLinksPanel
            group={group}
            sessions={orderedSessions}
            intakeUrl={joinUrl}
            sessionUrl={sessionUrl}
            debriefUrl={debriefUrl}
          />
        )}

        {showAdvancedQuestionnaireLinks && showDebriefUrls && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-emerald-900 mb-1">Debrief URLs</h3>
            <p className="text-xs text-emerald-800 mb-3">
              Questionnaire flow ended — share these with participants to collect the post-debrief manipulation check.
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {!group.p1_debrief_done_at && <CopyField label="P1 debrief" value={debriefUrl("P1")} />}
              {!group.p2_debrief_done_at && <CopyField label="P2 debrief" value={debriefUrl("P2")} />}
            </div>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Progress</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">P1 · D0</div>
              <div>Intake: {group.p1_intake_done ? `✓ ${fmtTs(group.p1_intake_done_at)}` : "…"}</div>
              <div>Debrief: {group.p1_debrief_done_at ? `✓ ${fmtTs(group.p1_debrief_done_at)}` : "…"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">P2 · D0</div>
              <div>Intake: {group.p2_intake_done ? `✓ ${fmtTs(group.p2_intake_done_at)}` : "…"}</div>
              <div>Debrief: {group.p2_debrief_done_at ? `✓ ${fmtTs(group.p2_debrief_done_at)}` : "…"}</div>
            </div>
          </div>
        </div>

        {showAdvancedQuestionnaireLinks && (
          <QuestionnairesPanel
            groupId={group.group_id}
            p1Label={group.p1_label}
            p2Label={group.p2_label}
            p1IntakeDoneAt={group.p1_intake_done_at}
            p2IntakeDoneAt={group.p2_intake_done_at}
            p1DebriefDoneAt={group.p1_debrief_done_at}
            p2DebriefDoneAt={group.p2_debrief_done_at}
            sessionIds={group.session_ids}
          />
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Sessions ({group.session_ids.length})</h3>
            {canCreateSession && (
              <button
                onClick={() => setShowCreate((s) => !s)}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700"
              >
                + New session
              </button>
            )}
          </div>

          {showCreate && canCreateSession && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Condition">
                  <select
                    value={newCondition}
                    onChange={(e) => setNewCondition(e.target.value as Condition)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm"
                  >
                    {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Task">
                  <select
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm"
                  >
                    {tasks.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm text-gray-600">Cancel</button>
                <button
                  onClick={createSession}
                  disabled={creating || !newTask}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300"
                >
                  {creating ? "Creating…" : "Create session"}
                </button>
              </div>
            </div>
          )}

          {group.session_ids.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No sessions yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {orderedSessions.map((row) => (
                <li key={row.session_id} className="flex items-center justify-between gap-3 border-t border-gray-100 py-2">
                  <div className="min-w-0">
                    <span className="font-mono text-xs">{row.session_id}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      {row.condition} {CONDITION_LABELS[row.condition]} · {row.task_id}
                    </span>
                  </div>
                  <button
                    onClick={() => onOpenSession(row.session_id)}
                    className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                  >
                    Open dashboard →
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ParticipantLinksPanel({
  group,
  sessions,
  intakeUrl,
  sessionUrl,
  debriefUrl,
}: {
  group: GroupSnapshot;
  sessions: SessionRow[];
  intakeUrl: (role: "P1" | "P2") => string;
  sessionUrl: (sessionId: string, role: "P1" | "P2") => string;
  debriefUrl: (role: "P1" | "P2") => string;
}) {
  const [copiedHtml, setCopiedHtml] = useState(false);
  const html = buildParticipantLinksHtml(group, sessions, intakeUrl, sessionUrl, debriefUrl);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Participant URLs</h3>
          <p className="text-xs text-gray-500">
            Consistent links for the participant PCs: intake, every condition session, then debrief.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(html);
              setCopiedHtml(true);
              setTimeout(() => setCopiedHtml(false), 1200);
            }}
            className="px-3 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold hover:bg-indigo-100"
          >
            {copiedHtml ? "HTML copied" : "Copy HTML"}
          </button>
          <button
            onClick={() => {
              const blob = new Blob([html], { type: "text/html" });
              const url = URL.createObjectURL(blob);
              window.open(url, "_blank", "noopener,noreferrer");
              window.setTimeout(() => URL.revokeObjectURL(url), 30000);
            }}
            className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50"
          >
            Open HTML ↗
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-sm">
        <CopyField label={`P1 intake${group.p1_label ? ` · ${group.p1_label}` : ""}`} value={intakeUrl("P1")} />
        <CopyField label={`P2 intake${group.p2_label ? ` · ${group.p2_label}` : ""}`} value={intakeUrl("P2")} />
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-gray-400">Live session dashboards by condition</div>
        {sessions.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Create a session to generate P1/P2 dashboard URLs.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div key={session.session_id} className="border border-gray-200 rounded-lg p-3 bg-gray-50/60 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <span className="font-semibold text-gray-900">
                      {session.condition} · {CONDITION_LABELS[session.condition]}
                    </span>
                    <span className="ml-2 text-gray-500">{session.task_id}</span>
                  </div>
                  <code className="font-mono text-gray-500">{session.session_id}</code>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  <CopyField label="P1 live dashboard" value={sessionUrl(session.session_id, "P1")} compact />
                  <CopyField label="P2 live dashboard" value={sessionUrl(session.session_id, "P2")} compact />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-sm">
        <CopyField label="P1 debrief" value={debriefUrl("P1")} />
        <CopyField label="P2 debrief" value={debriefUrl("P2")} />
      </div>
    </div>
  );
}

function CopyField({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <button
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          className={`${compact ? "px-2 py-1.5" : "px-3 py-2"} bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold hover:bg-indigo-100`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={() => window.open(value, "_blank", "noopener,noreferrer")}
          className={`${compact ? "px-2 py-1.5" : "px-3 py-2"} bg-white text-gray-700 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 whitespace-nowrap`}
        >
          Open ↗
        </button>
      </div>
    </div>
  );
}

function buildParticipantLinksHtml(
  group: GroupSnapshot,
  sessions: SessionRow[],
  intakeUrl: (role: "P1" | "P2") => string,
  sessionUrl: (sessionId: string, role: "P1" | "P2") => string,
  debriefUrl: (role: "P1" | "P2") => string,
): string {
  const esc = (value: string | null | undefined) => String(value ?? "").replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[ch];
  });
  const link = (label: string, url: string) => `<li><a href="${esc(url)}">${esc(label)}</a><div class="url">${esc(url)}</div></li>`;
  const sessionsHtml = sessions.length === 0
    ? "<p>No sessions have been created yet.</p>"
    : `<ul>${sessions.flatMap((s) => [
        link(`P1 ${s.condition} ${CONDITION_LABELS[s.condition]} - ${s.task_id}`, sessionUrl(s.session_id, "P1")),
        link(`P2 ${s.condition} ${CONDITION_LABELS[s.condition]} - ${s.task_id}`, sessionUrl(s.session_id, "P2")),
      ]).join("")}</ul>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(group.group_id)} participant links</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 32px; color: #111827; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 16px; margin: 24px 0 8px; }
    ul { list-style: none; padding: 0; display: grid; gap: 10px; }
    li { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; }
    a { color: #3730a3; font-weight: 700; font-size: 15px; }
    .url { margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #4b5563; overflow-wrap: anywhere; }
    .meta { color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <h1>${esc(group.group_id)} participant links</h1>
  <div class="meta">Status: ${esc(group.status)}</div>
  <h2>Intake</h2>
  <ul>
    ${link(`P1 intake${group.p1_label ? ` - ${group.p1_label}` : ""}`, intakeUrl("P1"))}
    ${link(`P2 intake${group.p2_label ? ` - ${group.p2_label}` : ""}`, intakeUrl("P2"))}
  </ul>
  <h2>Live session dashboards</h2>
  ${sessionsHtml}
  <h2>Debrief</h2>
  <ul>
    ${link("P1 debrief", debriefUrl("P1"))}
    ${link("P2 debrief", debriefUrl("P2"))}
  </ul>
</body>
</html>`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function fmtTs(ts: string | null): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}
