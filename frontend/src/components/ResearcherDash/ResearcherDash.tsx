import { useState, useCallback, useEffect, useRef } from "react";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import type { WSMessage, SessionStatus, MicState, TranscriptLine, AIIntervention, TaskFull } from "../../types";
import { SharedControls } from "./SharedControls";
import { LiveTranscript } from "./LiveTranscript";
import { SessionContext } from "./SessionContext";
import { AIPanel, type FacilitatorState } from "./AIPanel";
import { PhaseFocus } from "./PhaseFocus";
import { ParticipantStatus } from "./ParticipantStatus";
import { RecordingIndicator } from "./RecordingIndicator";
import { EmergencyStop } from "./EmergencyStop";
import { AnnotationBar } from "./AnnotationBar";
import type { FlagTag, ResearcherFlag } from "./AnnotationBar";
import { LiveMetrics } from "./LiveMetrics";
import type { LiveMetricsValue } from "./LiveMetrics";
import { SessionComplete } from "../SessionComplete/SessionComplete";
import { ChoiceMonitor } from "./ChoiceMonitor";
import { ChoiceToast, type ChoiceToastItem } from "./ChoiceToast";
import { useSessionStore } from "../../stores/sessionStore";
import { Cockpit } from "./Cockpit";

const CONDITION_LABELS: Record<string, { label: string; color: string }> = {
  C0: { label: "No AI", color: "bg-gray-100 text-gray-700 border-gray-300" },
  C1: { label: "Sham AI", color: "bg-gray-100 text-gray-600 border-gray-300" },
  C2: { label: "Neutral", color: "bg-green-50 text-green-800 border-green-300" },
  C3: { label: "Anchoring", color: "bg-amber-50 text-amber-800 border-amber-300" },
  C4: { label: "Amplification", color: "bg-orange-50 text-orange-800 border-orange-300" },
  C5: { label: "Devil's Advocate", color: "bg-purple-50 text-purple-800 border-purple-300" },
};

interface ResearcherDashProps {
  sessionId: string;
  onNewSession?: () => void;
}

export function ResearcherDash({ sessionId, onNewSession }: ResearcherDashProps) {
  // Core state
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [connectedRoles, setConnectedRoles] = useState<string[]>([]);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [startError, setStartError] = useState("");
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [sessionEndedAt, setSessionEndedAt] = useState<number | null>(null);

  // AI state — the live LLM facilitator (Ollama) driven by Whisper ASR triggers.
  const [facilitator, setFacilitator] = useState<FacilitatorState | null>(null);
  const [interventions, setInterventions] = useState<AIIntervention[]>([]);

  // Task & session context
  const [task, setTask] = useState<TaskFull | null>(null);
  const [votes, setVotes] = useState<Record<string, string>>({});

  // Alex audio playback (base64 WAV over JSON WS)
  const [audioBlocked, setAudioBlocked] = useState(false);
  const pendingAlexAudioRef = useRef<HTMLAudioElement | null>(null);

  // Survey submission count for the current phase (resets on phase_change)
  const [surveysSubmitted, setSurveysSubmitted] = useState(0);

  // Researcher annotations (Wave 4). Optimistic local state; backend echoes
  // a `flag_logged` to confirm persistence.
  const [flags, setFlags] = useState<ResearcherFlag[]>([]);

  // Live metrics (Wave 5). Backend pushes `metrics_update` every 30s during
  // open_discussion only.
  const [liveMetrics, setLiveMetrics] = useState<LiveMetricsValue | null>(null);
  const [liveMetricsAt, setLiveMetricsAt] = useState<number | null>(null);

  // Choice tracking (E4)
  const [toasts, setToasts] = useState<ChoiceToastItem[]>([]);
  const preferences = useSessionStore((s) => s.preferences);
  const decisions = useSessionStore((s) => s.decisions);
  const setPreference = useSessionStore((s) => s.setPreference);
  const setDecision = useSessionStore((s) => s.setDecision);
  const resetChoices = useSessionStore((s) => s.resetChoices);
  const useCockpitV3 = useSessionStore((s) => s.useCockpitV3);
  const currentSpeaker = useSessionStore((s) => s.currentSpeaker);

  // ── Toast helpers (E4) ──
  const pushToast = (kind: ChoiceToastItem["kind"], text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, kind, text, createdAt: Date.now() }]);
  };
  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const playAlexAudio = useCallback((audioData: unknown) => {
    if (typeof audioData !== "string" || !audioData) return;
    try {
      const audio = new Audio(`data:audio/wav;base64,${audioData}`);
      audio.play().then(() => {
        pendingAlexAudioRef.current = null;
        setAudioBlocked(false);
      }).catch((err) => {
        console.warn("[ResearcherDash] Alex audio autoplay blocked:", err?.message);
        pendingAlexAudioRef.current = audio;
        setAudioBlocked(true);
      });
    } catch (e) {
      console.warn("[ResearcherDash] Alex audio construction failed:", e);
    }
  }, []);

  useEffect(() => {
    if (!audioBlocked) return;
    const retry = () => {
      const cached = pendingAlexAudioRef.current;
      if (!cached) {
        setAudioBlocked(false);
        return;
      }
      cached.play().then(() => {
        pendingAlexAudioRef.current = null;
        setAudioBlocked(false);
      }).catch((e) => console.warn("[ResearcherDash] Alex audio retry failed:", e));
    };
    document.addEventListener("click", retry, { once: true });
    document.addEventListener("keydown", retry, { once: true });
    return () => {
      document.removeEventListener("click", retry);
      document.removeEventListener("keydown", retry);
    };
  }, [audioBlocked]);

  useEffect(() => {
    return () => {
      pendingAlexAudioRef.current?.pause();
      pendingAlexAudioRef.current = null;
    };
  }, []);

  // ── WebSocket message handler ──
  const onMessage = useCallback((msg: WSMessage) => {
    const data = msg.data as Record<string, unknown>;
    switch (msg.type) {
      case "session_started":
        setStatus(data as unknown as SessionStatus);
        setSessionStarted(true);
        setSessionStartedAt(Date.now() / 1000);
        setSessionEndedAt(null);
        break;
      case "phase_change":
        setStatus(data as unknown as SessionStatus);
        setSurveysSubmitted(0);
        if ((data as unknown as SessionStatus).phase === "info_reading") {
          resetChoices();
        }
        break;
      case "paused":
      case "resumed":
      case "time_extended":
        setStatus(data as unknown as SessionStatus);
        break;
      case "block_change":
        // block_change payload is partial — fetch full status
        fetch(`/api/sessions/${sessionId}/status`)
          .then((r) => r.json())
          .then((s) => { setStatus(s); setVotes({}); })
          .catch((e) => console.warn("[ResearcherDash] block_change status fetch failed:", e));
        break;
      case "transcript":
        setTranscript((prev) => {
          const next = [...prev, data as unknown as TranscriptLine];
          return next.length > 500 ? next.slice(-500) : next;
        });
        break;
      case "connection_update":
        setConnectedRoles(data.connected as string[]);
        break;
      case "alex_speaking": {
        playAlexAudio(data.audio);
        const iv: AIIntervention = {
          ts: Date.now() / 1000,
          text: data.text as string,
          trigger: (data.trigger as string) ?? "",
          source: (data.source as string) ?? "",
          condition: (data.condition as string) ?? "",
          llm_latency_ms: (data.llm_latency_ms as number) ?? 0,
          tts_latency_ms: (data.tts_latency_ms as number) ?? 0,
        };
        setInterventions((prev) => [...prev, iv]);
        setTranscript((prev) => {
          const next = [...prev, { ts: iv.ts, speaker: "AI", text: iv.text, confidence: 1 }];
          return next.length > 500 ? next.slice(-500) : next;
        });
        break;
      }
      case "preference_vote": {
          const role = data.role as "P1" | "P2";
          const choice = data.choice as string;
          if (role && choice) {
            setPreference(role, choice);
            pushToast("preference", `${role} chose ${choice} (initial preference)`);
          }
          break;
        }
      case "decision_vote": {
          // Preserve existing local votes state for PhaseFocus / SessionComplete
          setVotes((prev) => ({ ...prev, [data.role as string]: data.choice as string }));

          // NEW: store update + toasts (E4)
          const role = data.role as "P1" | "P2";
          const choice = data.choice as string;
          if (role && choice) {
            setDecision(role, choice);
            pushToast("decision", `${role} chose ${choice} (final decision)`);
            const pref = useSessionStore.getState().preferences[role];
            if (pref && pref !== choice) {
              pushToast("drift", `${role} drifted: ${pref} → ${choice}`);
            }
            const decs = { ...useSessionStore.getState().decisions, [role]: choice };
            if (decs.P1 && decs.P2) {
              if (decs.P1 === decs.P2) {
                pushToast("consensus", `Consensus reached on ${decs.P1}`);
              } else {
                pushToast("divergent", `Divergent decision: P1 → ${decs.P1}, P2 → ${decs.P2}`);
              }
            }
          }
          break;
        }
      case "mic_change":
        setStatus((prev) =>
          prev ? { ...prev, mic_p1: data.P1 as MicState, mic_p2: data.P2 as MicState } : prev
        );
        break;
      case "decision_consensus":
        // Already handled via vote tracking
        break;
      case "facilitator_status":
        setFacilitator(data as unknown as FacilitatorState);
        break;
      case "posttask_complete":
      case "survey_response":
        // Researcher notification of participant survey submission.
        // Cap at 2 (we have at most P1+P2). If a participant resubmits we
        // still only show 2/2 — the backend dedupes by (session, role, type).
        setSurveysSubmitted((n) => Math.min(2, n + 1));
        break;
      case "emergency_stop":
        setSessionStarted(false);
        setSessionEndedAt(Date.now() / 1000);
        setStatus((prev) => (prev ? { ...prev, session_ended: true } : prev));
        break;
      case "session_ended":
        setSessionStarted(false);
        setSessionEndedAt(Date.now() / 1000);
        setStatus((prev) => (prev ? { ...prev, session_ended: true } : prev));
        break;
      case "flag_logged":
        // Backend echo confirming the flag was persisted. We already
        // appended optimistically on submit; this is a no-op for now,
        // but keeps the WS contract symmetric for future audit.
        break;
      case "metrics_update":
        // Live metrics computed by the orchestrator's 30s loop. Only fires
        // during open_discussion; receivedAt drives the pulse animation.
        setLiveMetrics(data as unknown as LiveMetricsValue);
        setLiveMetricsAt(Date.now() / 1000);
        break;
    }
  }, [sessionId, playAlexAudio]);

  const { connected, send } = useWebSocket({ sessionId, role: "researcher", onMessage });

  // ── Fetch session info on mount ──
  useEffect(() => {
    if (!sessionId) return;
    // Check if session is already started
    fetch(`/api/sessions/${sessionId}/status`)
      .then((r) => r.json())
      .then((s) => {
        setStatus(s);
        if (s.session_started) setSessionStarted(true);
      })
      .catch((e) => console.warn("[ResearcherDash] initial status fetch failed:", e));
  }, [sessionId]);

  // Fetch task info when status changes (new block = new task)
  useEffect(() => {
    if (!sessionId || !sessionStarted) return;
    fetch(`/api/sessions/${sessionId}/task-full`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setTask)
      .catch(() => setTask(null));
  }, [sessionId, sessionStarted, status?.task_id]);

  // Poll facilitator status as fallback (primary updates come via WebSocket).
  // Exponential backoff on errors, capped at 60s; resets to 10s on success.
  useEffect(() => {
    if (!sessionId || !sessionStarted) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timeout = setTimeout(tick, delayMs);
    };

    const tick = async () => {
      try {
        const r = await fetch(`/api/sessions/${sessionId}/facilitator`);
        if (!r.ok) throw new Error(`status ${r.status}`);
        const data = await r.json();
        if (cancelled) return;
        setFacilitator(data);
        failures = 0;
        schedule(10000);
      } catch (e) {
        if (cancelled) return;
        failures += 1;
        const backoff = Math.min(60000, 10000 * Math.pow(2, failures - 1));
        console.warn(`[ResearcherDash] facilitator poll failed (${failures}); retrying in ${backoff}ms`, e);
        schedule(backoff);
      }
    };

    schedule(10000);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [sessionId, sessionStarted]);

  // ── Actions ──
  const advancePhase = useCallback(() => send({ type: "researcher_advance", data: {} }), [send]);
  const pause = useCallback(() => { fetch(`/api/sessions/${sessionId}/pause`, { method: "POST" }); }, [sessionId]);
  const resume = useCallback(() => { fetch(`/api/sessions/${sessionId}/resume`, { method: "POST" }); }, [sessionId]);
  const extend = (s: number) => fetch(`/api/sessions/${sessionId}/extend?seconds=${s}`, { method: "POST" });
  // Failsafe pre-recorded clip request — routed through the session control WS.
  const playFailsafe = useCallback((category: string, text: string) => {
    send({ type: "researcher_failsafe", data: { clip: category, text } });
  }, [send]);

  const submitFlag = useCallback((tag: FlagTag, note: string) => {
    // Optimistic append; backend echoes `flag_logged` to confirm.
    const flag: ResearcherFlag = {
      ts: Date.now() / 1000,
      tag,
      note,
      phase: status?.phase ?? null,
    };
    setFlags((prev) => [...prev, flag]);
    send({ type: "researcher_flag", data: { tag, note } });
  }, [send, status?.phase]);

  // Keyboard shortcuts — only active during a live session, never when typing.
  useGlobalShortcuts({
    enabled: sessionStarted && !status?.session_ended,
    onPauseToggle: () => (status?.phase_paused ? resume() : pause()),
    onAdvance: advancePhase,
    onFailsafeFocus: () => {
      const el = document.querySelector<HTMLElement>("[data-shortcut='failsafe']");
      el?.focus();
    },
    onEmergencyFocus: () => {
      const el = document.querySelector<HTMLElement>("[data-shortcut='emergency']");
      el?.focus();
    },
    onAnnotateFocus: () => {
      const el = document.querySelector<HTMLElement>("[data-shortcut='annotate']");
      el?.focus();
    },
  });

  const handleStartSession = async () => {
    setStartLoading(true);
    setStartError("");
    try {
      const resp = await fetch(`/api/sessions/${sessionId}/start`, { method: "POST" });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        setStartError(err.detail || `Error ${resp.status}`);
        return;
      }
      const data = await resp.json();
      setStatus(data);
      setSessionStarted(true);
    } catch {
      setStartError("Failed to start session.");
    } finally {
      setStartLoading(false);
    }
  };

  const handleStopSession = () => {
    if (!confirm("Stop session and save all data? This cannot be undone.")) return;
    fetch(`/api/sessions/${sessionId}/emergency-stop?reason=researcher_stopped`, { method: "POST" })
      .then(() => setSessionStarted(false))
      .catch((e) => console.warn("[ResearcherDash] emergency-stop failed:", e));
  };

  const condCfg = CONDITION_LABELS[status?.condition ?? ""] ?? CONDITION_LABELS.C0;
  const isNoAI = status?.condition === "C0";
  const conditionFailsafeCategory = (() => {
    if (status?.condition === "C1") return "sham_neutral";
    if (status?.condition === "C2") return "c2_neutral";
    if (status?.condition === "C3") return "c3_anchored";
    if (status?.condition === "C4") return "c4_amplified";
    if (status?.condition === "C5") return "c5_challenge";
    return "sham_neutral";
  })();

  // Session-end summary view
  if (status?.session_ended) {
    const duration =
      sessionStartedAt && sessionEndedAt ? sessionEndedAt - sessionStartedAt : null;
    return (
      <SessionComplete
        sessionId={sessionId}
        status={status}
        task={task}
        votes={votes}
        interventions={interventions}
        durationSeconds={duration}
        onNewSession={() => {
          if (onNewSession) onNewSession();
          else window.location.reload();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 px-5 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-gray-900 text-sm">Researcher Dashboard</h1>
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-xs px-2 py-0.5 rounded font-bold uppercase bg-blue-100 text-blue-700">
            Study
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            ID: <span className="font-mono font-medium text-gray-600">{sessionId}</span>
          </span>
          {status?.condition && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${condCfg.color}`}>
              {status.condition}: {condCfg.label}
            </span>
          )}
          {status?.task_id && (
            <span className="text-xs text-gray-500">
              Task: <span className="font-medium text-gray-700">{status.task_id.replace(/_/g, " ")}</span>
            </span>
          )}
        </div>
      </header>

      {/* ── Layout: Cockpit v3 (feature flag) or legacy 3-column ── */}
      {useCockpitV3 && status?.session_started && !status?.session_ended ? (
        <Cockpit
          sessionId={sessionId}
          status={status}
          transcript={transcript}
          interventions={interventions}
          task={task ?? null}
          preferences={preferences}
          decisions={decisions}
          currentSpeaker={currentSpeaker}
          connectedRoles={connectedRoles ?? []}
          conditionLabel={CONDITION_LABELS[status?.condition ?? ""]?.label}
          conditionColor={CONDITION_LABELS[status?.condition ?? ""]?.color}
          paused={status?.phase_paused ?? false}
          facilitator={facilitator}
          sessionStartedAt={sessionStartedAt}
          liveMetrics={liveMetrics}
          liveMetricsAt={liveMetricsAt}
          onAdvance={advancePhase}
          onPause={() => (status?.phase_paused ? resume() : pause())}
          onFailsafe={() => {
            if (!isNoAI) playFailsafe(conditionFailsafeCategory, "Failsafe triggered");
          }}
          onEmergencyStop={handleStopSession}
          onAnnotate={(tag) => submitFlag(tag, "")}
          playFailsafe={playFailsafe}
        />
      ) : (
        /* ── Legacy 3-Column Layout (preserved verbatim) ── */
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: Session Context */}
          <SessionContext
            status={status}
            task={task}
            votes={votes}
          />

          {/* CENTER: Phase focus + Controls + Transcript */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <PhaseFocus
              status={status}
              interventions={interventions}
              votes={votes}
              connectedRoles={connectedRoles}
              surveysSubmitted={surveysSubmitted}
            />
            {status?.phase === "open_discussion" && (
              <LiveMetrics metrics={liveMetrics} receivedAt={liveMetricsAt} />
            )}
            <SharedControls
              status={status}
              sessionStarted={sessionStarted}
              advancePhase={advancePhase}
              pause={pause}
              resume={resume}
              extend={extend}
              onStartSession={handleStartSession}
              onStopSession={handleStopSession}
              startLoading={startLoading}
            />
            {startError && (
              <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">{startError}</div>
            )}
            <LiveTranscript transcript={transcript} />
            <AnnotationBar
              onSubmit={submitFlag}
              flags={flags}
              disabled={!sessionStarted || status?.session_ended}
            />
          </div>

          {/* RIGHT: AI Panel (or C0 placeholder) + Participants + Emergency */}
          <div className="flex flex-col bg-white border-l border-gray-200">
            {isNoAI ? (
              <div className="w-80 shrink-0 px-4 py-6 border-b border-gray-200">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                  Condition
                </h3>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-5 text-center">
                  <div className="text-2xl mb-1 opacity-60">{"\u{1F465}"}</div>
                  <p className="text-sm font-semibold text-gray-700">No AI Condition</p>
                  <p className="text-xs text-gray-500 mt-1">Observation only.</p>
                  <p className="text-xs text-gray-400 mt-3">
                    No facilitator interventions or failsafe controls in this run.
                  </p>
                </div>
              </div>
            ) : (
              <AIPanel
                status={status}
                facilitator={facilitator}
                interventions={interventions}
                sessionStartedAt={sessionStartedAt}
                playFailsafe={playFailsafe}
              />
            )}
            <ParticipantStatus connectedRoles={connectedRoles} status={status} />
            <div className="px-3 py-1 border-t border-gray-100">
              <RecordingIndicator sessionId={sessionId} />
            </div>
            <div className="px-3 py-2">
              <ChoiceMonitor preferences={preferences} decisions={decisions} />
            </div>
            <EmergencyStop sessionId={sessionId} />
          </div>
        </div>
      )}
      <ChoiceToast toasts={toasts} onDismiss={dismissToast} />
      {audioBlocked && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-amber-50 text-amber-800 border border-amber-300 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg">
          Alex audio was blocked by the browser. Click anywhere or press a key to enable.
        </div>
      )}
    </div>
  );
}
