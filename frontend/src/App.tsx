import { lazy, Suspense, useState, useEffect } from "react";
import type { ReactNode } from "react";
import type { SessionMode, Condition } from "./types";

const DiscussionRoom = lazy(() => import("./components/DiscussionRoom/DiscussionRoom").then((m) => ({ default: m.DiscussionRoom })));
const ResearcherDash = lazy(() => import("./components/ResearcherDash/ResearcherDash").then((m) => ({ default: m.ResearcherDash })));
const ParticipantIntake = lazy(() => import("./components/Battery/ParticipantIntake").then((m) => ({ default: m.ParticipantIntake })));
const ParticipantDebrief = lazy(() => import("./components/Battery/ParticipantDebrief").then((m) => ({ default: m.ParticipantDebrief })));
const GroupsTab = lazy(() => import("./components/ResearcherDash/GroupsTab").then((m) => ({ default: m.GroupsTab })));
const GroupDetail = lazy(() => import("./components/ResearcherDash/GroupDetail").then((m) => ({ default: m.GroupDetail })));

type View =
  | "home" | "join" | "participant"
  | "researcher_setup" | "researcher"
  | "intake" | "debrief" | "groups" | "group_detail";

interface IntakeRoute { groupId: string; role: "P1" | "P2"; mode: "intake" | "debrief"; d0Id?: string }
interface ParticipantRoute { sessionId: string; role: "P1" | "P2" }
interface D0Status {
  group_id: string;
  status: string;
  p1_intake_done: boolean;
  p2_intake_done: boolean;
  p1_intake_done_at: string | null;
  p2_intake_done_at: string | null;
  metadata?: Record<string, unknown>;
}

function parseD0Id(value: string): { d0Id: string; groupId: string } | null {
  const id = value.trim();
  const match = /^(\d+)_D0$/i.exec(id);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return { d0Id: `${n}_D0`, groupId: `g${String(n).padStart(3, "0")}` };
}

/** Detect /group/:id/:role and /group/:id/:role/debrief URLs on first paint. */
function parseGroupRoute(): IntakeRoute | null {
  if (typeof window === "undefined") return null;
  const debrief = /^\/group\/([^/]+)\/(P[12])\/debrief\/?$/.exec(window.location.pathname);
  if (debrief) {
    return { groupId: decodeURIComponent(debrief[1]), role: debrief[2] as "P1" | "P2", mode: "debrief" };
  }
  const intake = /^\/group\/([^/]+)\/(P[12])\/?$/.exec(window.location.pathname);
  if (intake) {
    return { groupId: decodeURIComponent(intake[1]), role: intake[2] as "P1" | "P2", mode: "intake" };
  }
  return null;
}

/** Detect /session/:sessionId/:role and legacy ?session_id=&role= URLs. */
function parseParticipantRoute(): ParticipantRoute | null {
  if (typeof window === "undefined") return null;
  const direct = /^\/session\/([^/]+)\/(P[12])\/?$/.exec(window.location.pathname);
  if (direct) {
    return { sessionId: decodeURIComponent(direct[1]), role: direct[2] as "P1" | "P2" };
  }
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");
  const role = params.get("role");
  if (sessionId && (role === "P1" || role === "P2")) {
    return { sessionId, role };
  }
  return null;
}

const CONDITION_INFO: Record<Condition, { label: string; desc: string; color: string }> = {
  C0: { label: "No AI", desc: "Human-only baseline", color: "bg-gray-100 text-gray-700 border-gray-300" },
  C1: { label: "Sham AI", desc: "Pre-written neutral messages", color: "bg-gray-100 text-gray-700 border-gray-300" },
  C2: { label: "Neutral AI", desc: "Balanced summaries", color: "bg-green-50 text-green-800 border-green-300" },
  C3: { label: "Anchoring AI", desc: "Frames toward anchor option", color: "bg-amber-50 text-amber-800 border-amber-300" },
  C4: { label: "Amplification AI", desc: "Amplifies one participant", color: "bg-orange-50 text-orange-800 border-orange-300" },
  C5: { label: "Devil's Advocate", desc: "Challenges majority view", color: "bg-purple-50 text-purple-800 border-purple-300" },
};

export default function App() {
  // /group/:id/:role → intake; /group/:id/:role/debrief → debrief.
  const initialGroupRoute = parseGroupRoute();
  const parsedParticipantRoute = initialGroupRoute ? null : parseParticipantRoute();
  const initialD0Route = parsedParticipantRoute
    ? parseD0Id(parsedParticipantRoute.sessionId)
    : null;
  const initialParticipantRoute = initialD0Route ? null : parsedParticipantRoute;
  const [intakeRoute, setIntakeRoute] = useState<IntakeRoute | null>(
    initialGroupRoute ?? (initialD0Route
      ? { groupId: initialD0Route.groupId, role: parsedParticipantRoute!.role, mode: "intake", d0Id: initialD0Route.d0Id }
      : null),
  );
  const [view, setView] = useState<View>(
    intakeRoute
      ? (intakeRoute.mode === "debrief" ? "debrief" : "intake")
      : initialParticipantRoute
        ? "participant"
        : "home",
  );
  const [openedGroupId, setOpenedGroupId] = useState<string | null>(null);
  const [health, setHealth] = useState<string>("checking...");
  const [sessionId, setSessionId] = useState(initialParticipantRoute?.sessionId ?? "");
  const [sessionMode, setSessionMode] = useState<SessionMode>("study");
  const [role, setRole] = useState<"P1" | "P2">(initialParticipantRoute?.role ?? "P1");
  const [joinInput, setJoinInput] = useState("");
  const [groupNumber, setGroupNumber] = useState(1);
  const [setupStep, setSetupStep] = useState(1);
  const [selectedCondition, setSelectedCondition] = useState<Condition>("C2");
  const [selectedTask, setSelectedTask] = useState("");
  const [availableTasks, setAvailableTasks] = useState<string[]>([]);
  const [createdSession, setCreatedSession] = useState<{
    session_id: string;
    mode: string;
    conditions: string[];
  } | null>(null);
  const [createdD0, setCreatedD0] = useState<{ d0_id: string; group_id: string } | null>(null);
  const [d0Status, setD0Status] = useState<D0Status | null>(null);
  const [d0Loading, setD0Loading] = useState(false);
  const [error, setError] = useState("");
  const safeGroupNumber = Math.max(1, groupNumber);
  const d0Id = `${safeGroupNumber}_D0`;
  const d0GroupId = `g${String(safeGroupNumber).padStart(3, "0")}`;
  const d0IsCreated = createdD0?.d0_id === d0Id || d0Status?.metadata?.d0_id === d0Id;

  const joinAs = (selectedRole: "P1" | "P2") => {
    const id = joinInput.trim();
    const d0 = parseD0Id(id);
    if (d0) {
      setIntakeRoute({ groupId: d0.groupId, role: selectedRole, mode: "intake", d0Id: d0.d0Id });
      setRole(selectedRole);
      setView("intake");
      if (typeof window !== "undefined" && window.history.replaceState) {
        window.history.replaceState(null, "", `/session/${encodeURIComponent(d0.d0Id)}/${selectedRole}`);
      }
      return;
    }
    setSessionId(id);
    setRole(selectedRole);
    setView("participant");
  };

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHealth(`Backend OK \u2014 model: ${d.model}`))
      .catch(() => setHealth("Backend not reachable"));
  }, []);

  // Fetch available tasks when entering researcher setup
  useEffect(() => {
    if (view !== "researcher_setup") return;
    fetch("/api/tasks").then(r => r.json()).then((ids: string[]) => {
      setAvailableTasks(ids);
      if (ids.length > 0 && !selectedTask) setSelectedTask(ids[0]);
    }).catch((e) => console.warn("[App] /api/tasks fetch failed:", e));
  }, [view]);

  useEffect(() => {
    if (view !== "researcher_setup" || setupStep < 2) return;
    let cancelled = false;
    const refreshD0 = () => {
      fetch(`/api/groups/${d0GroupId}`)
        .then((r) => {
          if (r.status === 404) return null;
          if (!r.ok) throw new Error(`status ${r.status}`);
          return r.json();
        })
        .then((data: D0Status | null) => {
          if (!cancelled) setD0Status(data);
        })
        .catch((e) => console.warn("[App] D0 status fetch failed:", e));
    };
    refreshD0();
    const t = window.setInterval(refreshD0, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [view, setupStep, d0GroupId]);

  const createD0 = async () => {
    setError("");
    setD0Loading(true);
    try {
      const resp = await fetch("/api/groups/d0/ensure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: d0Id }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        setError(err.detail || `D0 create failed ${resp.status}`);
        return;
      }
      const data = await resp.json();
      setCreatedD0({ d0_id: data.d0_id ?? d0Id, group_id: data.group_id });
      setD0Status(data);
      setCreatedSession(null);
    } catch {
      setError("Failed to create D0 ID. Is the backend running?");
    } finally {
      setD0Loading(false);
    }
  };

  if (view === "home") {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Physiological Guardrails</h1>
          <p className="mt-2 text-sm text-gray-500">Hidden Profile Task Experiment Platform</p>
        </div>
        <p className={`text-sm ${health.startsWith("Backend OK") ? "text-green-600" : "text-red-600"}`}>{health}</p>
        <div className="flex gap-4">
          <button onClick={() => setView("join")} className="px-6 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 text-sm font-semibold shadow-sm transition-colors">
            Join as Participant
          </button>
          <button onClick={() => setView("researcher_setup")} className="px-6 py-3 bg-white text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 text-sm font-semibold shadow-sm transition-colors">
            Researcher Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (view === "groups") {
    return (
      <AppSuspense>
        <GroupsTab
          onOpenGroup={(gid) => { setOpenedGroupId(gid); setView("group_detail"); }}
          onBack={() => setView("home")}
        />
      </AppSuspense>
    );
  }

  if (view === "group_detail" && openedGroupId) {
    return (
      <AppSuspense>
        <GroupDetail
          groupId={openedGroupId}
          onBack={() => { setOpenedGroupId(null); setView("groups"); }}
          onOpenSession={(sid) => { setSessionId(sid); setView("researcher"); }}
        />
      </AppSuspense>
    );
  }

  if (view === "join") {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-6">
        <h2 className="text-xl font-bold text-gray-900">Join Session</h2>
        <input
          type="text"
          placeholder="Enter ID, e.g. 1_D0 or 1_C2"
          value={joinInput}
          onChange={(e) => setJoinInput(e.target.value)}
          className="px-4 py-2.5 w-80 bg-white border border-gray-300 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm"
        />
        <div className="flex gap-3">
          <button
            onClick={() => joinAs("P1")}
            disabled={!joinInput}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-sm font-semibold shadow-sm transition-colors"
          >
            Join as P1
          </button>
          <button
            onClick={() => joinAs("P2")}
            disabled={!joinInput}
            className="px-6 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400 text-sm font-semibold shadow-sm transition-colors"
          >
            Join as P2
          </button>
        </div>
        <button onClick={() => setView("home")} className="text-gray-400 hover:text-gray-600 text-sm mt-2">
          &larr; Back
        </button>
      </div>
    );
  }

  if (view === "participant") {
    return (
      <AppSuspense>
        <DiscussionRoom sessionId={sessionId} role={role} />
      </AppSuspense>
    );
  }

  if (view === "debrief" && intakeRoute) {
    return (
      <AppSuspense>
        <ParticipantDebrief
          groupId={intakeRoute.groupId}
          role={intakeRoute.role}
        />
      </AppSuspense>
    );
  }

  if (view === "intake" && intakeRoute) {
    return (
      <AppSuspense>
        <ParticipantIntake
          groupId={intakeRoute.groupId}
          role={intakeRoute.role}
          d0Id={intakeRoute.d0Id}
          onSessionAvailable={(sid) => {
            // Researcher created a session for this group → switch to participant view
            setSessionId(sid);
            setRole(intakeRoute.role);
            setIntakeRoute(null);
            setView("participant");
            // Tidy URL so reload doesn't go back to intake.
            if (typeof window !== "undefined" && window.history.replaceState) {
              window.history.replaceState(null, "", `/session/${encodeURIComponent(sid)}/${intakeRoute.role}`);
            }
          }}
        />
      </AppSuspense>
    );
  }

  if (view === "researcher_setup") {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-6 p-8">
        <h2 className="text-xl font-bold text-gray-900">Researcher &mdash; Session Setup</h2>

        {/* Step indicator */}
        {!createdSession && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            {["Mode", "Condition", "Task", "Create"].map((label, i) => (
              <span key={label} className="flex items-center gap-1">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${setupStep > i + 1 ? "bg-indigo-600 text-white" : setupStep === i + 1 ? "bg-indigo-100 text-indigo-700 ring-2 ring-indigo-400" : "bg-gray-200 text-gray-500"}`}>{i + 1}</span>
                <span className={setupStep === i + 1 ? "text-gray-700 font-medium" : ""}>{label}</span>
                {i < 3 && <span className="mx-1 text-gray-300">&rarr;</span>}
              </span>
            ))}
          </div>
        )}

        {createdSession ? (
          /* ── Session Created — go straight to dashboard ── */
          <div className="flex flex-col gap-4 w-[28rem] bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-blue-100 text-blue-700">{sessionMode}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${CONDITION_INFO[selectedCondition].color}`}>{selectedCondition} {CONDITION_INFO[selectedCondition].label}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-medium">Session ID:</span>
              <span className="ml-2 font-mono text-indigo-600 font-semibold">{createdSession.session_id}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-medium">Task:</span>
              <span className="ml-2 text-sm text-gray-900">{selectedTask.replace(/_/g, " ")}</span>
            </div>
            <p className="text-xs text-gray-500">Share the session ID with participants. Start session from the dashboard.</p>
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <button
              onClick={() => setView("researcher")}
              className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 text-sm font-semibold shadow-sm transition-colors"
            >
              Open Dashboard
            </button>
          </div>

        ) : setupStep === 1 ? (
          /* ── Step 1: Mode Selection ── */
          <div className="grid grid-cols-3 gap-4">
            {([
              { mode: "study" as SessionMode, icon: "\uD83D\uDD2C", title: "Study Mode", desc: "Fully automatic AI interventions. The live LLM facilitator (Ollama) is driven by Whisper ASR triggers (timer, lull, keyword, turn-count). Monitor and override if needed." },
            ]).map(({ mode, icon, title, desc }) => (
              <button
                key={mode}
                onClick={() => { setSessionMode(mode); setSetupStep(2); }}
                className={`w-60 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md ${sessionMode === mode ? "border-indigo-400 bg-indigo-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
              >
                <div className="text-2xl mb-3 text-gray-700">{icon}</div>
                <h3 className="font-bold text-gray-900">{title}</h3>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">{desc}</p>
              </button>
            ))}
          </div>

        ) : setupStep === 2 ? (
          /* ── Step 2: Condition Selection ── */
          <div className="flex flex-col items-center gap-4">
            <div className="w-[36rem] bg-white border border-sky-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">D0 pre-task ID</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Create this once for the dyad before choosing the condition session.
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold text-sky-700">{d0Id}</span>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-3">
                <label className="block">
                  <span className="block text-xs text-gray-500 mb-1">Group number</span>
                  <input
                    type="number"
                    min={1}
                    value={groupNumber}
                    onChange={(e) => {
                      setGroupNumber(parseInt(e.target.value) || 1);
                      setCreatedD0(null);
                      setD0Status(null);
                    }}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </label>
                <button
                  onClick={createD0}
                  disabled={d0Loading}
                  className="self-end px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-semibold hover:bg-sky-700 disabled:bg-gray-300"
                >
                  {d0Loading ? "Creating..." : d0IsCreated ? "Refresh / ensure D0" : `Create ${d0Id}`}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <D0ParticipantStatus label="P1 questionnaire" done={d0Status?.p1_intake_done ?? false} doneAt={d0Status?.p1_intake_done_at ?? null} />
                <D0ParticipantStatus label="P2 questionnaire" done={d0Status?.p2_intake_done ?? false} doneAt={d0Status?.p2_intake_done_at ?? null} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <D0Link label="P1 D0 link" value={`${window.location.origin}/session/${encodeURIComponent(d0Id)}/P1`} />
                <D0Link label="P2 D0 link" value={`${window.location.origin}/session/${encodeURIComponent(d0Id)}/P2`} />
              </div>
              {d0IsCreated && (
                <p className="mt-2 text-xs text-sky-700">
                  D0 is created. Participants can now enter <span className="font-mono font-semibold">{d0Id}</span> on the participant screen.
                </p>
              )}
            </div>
            <p className="text-sm text-gray-600">Select condition for this session:</p>
            <div className="grid grid-cols-3 gap-3 w-[36rem]">
              {(Object.keys(CONDITION_INFO) as Condition[]).map((c) => {
                const info = CONDITION_INFO[c];
                return (
                  <button
                    key={c}
                    onClick={() => { setSelectedCondition(c); setSetupStep(3); }}
                    className={`p-4 rounded-xl border-2 text-left transition-all hover:shadow-md ${selectedCondition === c ? "border-indigo-400 ring-2 ring-indigo-200" : "border-gray-200 hover:border-gray-300"}`}
                  >
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${info.color}`}>{c}</span>
                    <h4 className="mt-2 font-semibold text-sm text-gray-900">{info.label}</h4>
                    <p className="mt-0.5 text-xs text-gray-500">{info.desc}</p>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setSetupStep(1)} className="text-gray-400 hover:text-gray-600 text-sm mt-1">&larr; Back to mode</button>
          </div>

        ) : setupStep === 3 ? (
          /* ── Step 3: Task Selection ── */
          <div className="flex flex-col items-center gap-4 w-80">
            <p className="text-sm text-gray-600">Select task scenario:</p>
            {availableTasks.length === 0 ? (
              <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2 w-full text-center">
                No tasks found. Check backend/tasks/ directory.
              </p>
            ) : (
              <select
                value={selectedTask}
                onChange={(e) => setSelectedTask(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              >
                {availableTasks.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            )}
            <button onClick={() => setSetupStep(4)} disabled={!selectedTask} className="w-full px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 text-sm font-semibold shadow-sm transition-colors">
              Next
            </button>
            <button onClick={() => setSetupStep(2)} className="text-gray-400 hover:text-gray-600 text-sm">&larr; Back to condition</button>
          </div>

        ) : setupStep === 4 ? (
          /* ── Step 4: Group Number + Create ── */
          <div className="flex flex-col items-center gap-4 w-80">
            <div className="w-full flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-600">
              <span className="px-2 py-0.5 rounded font-bold uppercase bg-blue-100 text-blue-700">{sessionMode}</span>
              <span className={`px-2 py-0.5 rounded font-medium ${CONDITION_INFO[selectedCondition].color}`}>{selectedCondition}</span>
              <span className="text-gray-500">{selectedTask.replace(/_/g, " ")}</span>
            </div>
            <label className="text-sm font-medium text-gray-700 self-start">Group Number</label>
            <input
              type="number"
              min={1}
              value={groupNumber}
              onChange={(e) => setGroupNumber(parseInt(e.target.value) || 1)}
              className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
            <p className="text-[11px] text-gray-400 self-start -mt-2">
              Logging identifier only — each session runs one condition × one task. Run another condition by creating a new session.
            </p>
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <button
              onClick={async () => {
                setError("");
                try {
                  const resp = await fetch("/api/sessions", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      group_number: safeGroupNumber,
                      mode: sessionMode,
                      condition: selectedCondition,
                      task_id: selectedTask,
                    }),
                  });
                  if (!resp.ok) {
                    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
                    setError(err.detail || `Error ${resp.status}`);
                    return;
                  }
                  const data = await resp.json();
                  setCreatedD0(null);
                  setCreatedSession(data);
                  setSessionId(data.session_id);
                } catch {
                  setError("Failed to create session. Is the backend running?");
                }
              }}
              className="w-full px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 text-sm font-semibold shadow-sm transition-colors"
            >
              Create Session
            </button>
            <button onClick={() => setSetupStep(3)} className="text-gray-400 hover:text-gray-600 text-sm">&larr; Back to task</button>

            <div className="text-center text-gray-300 text-xs mt-2">&mdash; or &mdash;</div>
            <input
              type="text"
              placeholder="Join Existing Session ID"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-xl text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
            <button
              onClick={async () => {
                setError("");
                try {
                  // Fetch session status to detect mode
                  const resp = await fetch(`/api/sessions/${joinInput}/status`);
                  if (resp.ok) {
                    const status = await resp.json();
                    // Try to infer mode from session — default study
                    setSessionMode(status.mode ?? "study");
                  }
                  setSessionId(joinInput);
                  setView("researcher");
                } catch {
                  // If status fetch fails, still join with default mode
                  setSessionId(joinInput);
                  setView("researcher");
                }
              }}
              disabled={!joinInput}
              className="w-full px-6 py-2.5 bg-white text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 text-sm font-semibold shadow-sm transition-colors"
            >
              Join Existing Session
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-4 mt-2">
          <button onClick={() => { setCreatedSession(null); setCreatedD0(null); setSetupStep(1); setView("home"); }} className="text-gray-400 hover:text-gray-600 text-sm">
            &larr; Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppSuspense>
      <ResearcherDash
        sessionId={sessionId}
        onNewSession={() => {
          setSessionId("");
          setCreatedSession(null);
          setCreatedD0(null);
          setSetupStep(1);
          setView("researcher_setup");
        }}
      />
    </AppSuspense>
  );
}

function AppSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 p-8 text-center text-sm text-gray-500">Loading…</div>}>
      {children}
    </Suspense>
  );
}

function D0ParticipantStatus({ label, done, doneAt }: { label: string; done: boolean; doneAt: string | null }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${done ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-gray-50 border-gray-200 text-gray-600"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="font-semibold">{done ? "Done" : "Pending"}</span>
      </div>
      {doneAt && <div className="mt-0.5 text-[11px] opacity-75">{new Date(doneAt).toLocaleTimeString()}</div>}
    </div>
  );
}

function D0Link({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="flex gap-1.5">
        <input
          readOnly
          value={value}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-mono text-gray-700"
        />
        <button
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] font-semibold text-sky-700 hover:bg-sky-100"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
