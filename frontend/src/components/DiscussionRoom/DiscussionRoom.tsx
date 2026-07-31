import { useState, useCallback, useEffect, useRef } from "react";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useLiveKit } from "../../hooks/useLiveKit";
import { useAudioStream } from "../../hooks/useAudioStream";
import { useLocalRecording } from "../../hooks/useLocalRecording";
import { useTimer } from "../../hooks/useTimer";
import { useSessionStore } from "../../stores/sessionStore";
import { VideoFeed } from "../shared/VideoFeed";
import { AlexAvatar } from "../shared/AlexAvatar";
import { TurnBanner } from "../shared/TurnBanner";
import { PhaseBadge } from "../shared/PhaseBadge";
import { Timer } from "../shared/Timer";
import { InfoDisplay } from "../InfoDisplay/InfoDisplay";
import { ParticipantPostTask } from "../Battery/ParticipantPostTask";
import type { Condition } from "../../types";
import { AICaptionStrip } from "./AICaptionStrip";
import { ParticipantTranscript } from "./ParticipantTranscript";
import type { WSMessage, MicState, SessionStatus, TranscriptLine } from "../../types";

interface DiscussionRoomProps {
  sessionId: string;
  role: "P1" | "P2";
}

export function DiscussionRoom({ sessionId, role }: DiscussionRoomProps) {
  const storedSessionId = useSessionStore((s) => s.sessionId);
  const rawStatus = useSessionStore((s) => s.status);
  const setStoreSessionId = useSessionStore((s) => s.setSessionId);
  const setStatus = useSessionStore((s) => s.setStatus);
  const resetStore = useSessionStore((s) => s.reset);
  const status = storedSessionId === sessionId ? rawStatus : null;
  const participantTranscript = useSessionStore((s) => s.participantTranscript);
  const aiCaption = useSessionStore((s) => s.aiCaption);
  const addParticipantTranscriptLine = useSessionStore((s) => s.addParticipantTranscriptLine);
  const setAICaption = useSessionStore((s) => s.setAICaption);
  const [alexStatus, setAlexStatus] = useState<"listening" | "speaking" | "monitoring">("listening");
  const [alexText, setAlexText] = useState("");
  const [p1Speaking, setP1Speaking] = useState(false);
  const [p2Speaking, setP2Speaking] = useState(false);
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [surveySubmitted, setSurveySubmitted] = useState(false);
  const [voteSaved, setVoteSaved] = useState(false);
  const [preferenceChoice, setPreferenceChoice] = useState<string>("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [postTaskUnlocked, setPostTaskUnlocked] = useState(false);
  const alexTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAlexAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (storedSessionId === sessionId) return;
    resetStore();
    setStoreSessionId(sessionId);
  }, [sessionId, storedSessionId, resetStore, setStoreSessionId]);

  // Clear any pending Alex-status timeout on unmount so setState doesn't fire after teardown
  useEffect(() => {
    return () => {
      if (alexTimeoutRef.current) clearTimeout(alexTimeoutRef.current);
    };
  }, []);

  // When audio is blocked, listen for any user interaction and retry the cached audio.
  useEffect(() => {
    if (!audioBlocked) return;
    const retry = () => {
      const cached = pendingAlexAudioRef.current;
      if (!cached) {
        setAudioBlocked(false);
        return;
      }
      cached.play().then(() => {
        setAudioBlocked(false);
        pendingAlexAudioRef.current = null;
      }).catch((e) => console.warn("[Alex] retry failed:", e));
    };
    document.addEventListener("click", retry, { once: true });
    document.addEventListener("keydown", retry, { once: true });
    return () => {
      document.removeEventListener("click", retry);
      document.removeEventListener("keydown", retry);
    };
  }, [audioBlocked]);

  const onMessage = useCallback(
    (msg: WSMessage) => {
      const data = msg.data as Record<string, unknown>;
      switch (msg.type) {
        case "session_started":
        case "phase_change":
          setSurveySubmitted(false);  // Reset survey state on new phase
          setVoteSaved(false);        // Reset vote-saved indicator on new phase
          setPreferenceChoice("");
          setStatus(data as unknown as SessionStatus);
          break;
        case "session_status":
          if ((data as { session_started?: boolean }).session_started) {
            setSurveySubmitted(false);
            setVoteSaved(false);
            setPreferenceChoice("");
            setStatus(data as unknown as SessionStatus);
          }
          break;
        case "paused":
        case "resumed":
        case "time_extended":
          setStatus(data as unknown as SessionStatus);
          break;
        case "posttask_ack":
        case "survey_ack":  // legacy alias — backend may still emit during one-release deprecation window
          setSurveySubmitted(true);
          break;
        case "vad":
          if (data.role === "P1") setP1Speaking(data.speaking as boolean);
          if (data.role === "P2") setP2Speaking(data.speaking as boolean);
          break;
        case "alex_speaking": {
          const isClosingClip = data.slot === "skeleton.closing";
          const finishAlexSpeech = () => {
            setAlexStatus("monitoring");
            if (isClosingClip) setPostTaskUnlocked(true);
          };
          setAICaption({
            text: data.text as string,
            ts: Date.now() / 1000,
            source: data.source as string | undefined,
          });
          addParticipantTranscriptLine({
            ts: Date.now() / 1000,
            speaker: "Alex",
            text: (data.text as string) ?? "",
            confidence: 1,
          });
          if (alexTimeoutRef.current) clearTimeout(alexTimeoutRef.current);
          setAlexStatus("speaking");
          setAlexText(data.text as string);
          // Play Alex audio (base64 WAV delivered via JSON WebSocket)
          if (data.audio) {
            try {
              const audio = new Audio(`data:audio/wav;base64,${data.audio}`);
              audio.onended = finishAlexSpeech;
              audio.play().then(() => {
                pendingAlexAudioRef.current = null;
                setAudioBlocked(false);
              }).catch((err) => {
                // Autoplay blocked — surface to participant so they can unblock
                console.warn("[Alex] Audio autoplay blocked:", err?.message);
                pendingAlexAudioRef.current = audio;
                setAudioBlocked(true);
                alexTimeoutRef.current = setTimeout(() => setAlexStatus("monitoring"), 5000);
              });
            } catch (e) {
              console.warn("[Alex] audio construction failed:", e);
              if (isClosingClip) setPostTaskUnlocked(true);
            }
            alexTimeoutRef.current = setTimeout(() => setAlexStatus("monitoring"), 15000);
          } else {
            // No audio attached — show text briefly then reset
            alexTimeoutRef.current = setTimeout(finishAlexSpeech, 5000);
          }
          break;
        }
        case "participant_transcript":
          addParticipantTranscriptLine(data as unknown as TranscriptLine);
          break;
        case "mic_change": {
          // Update mic state in status so LiveKit mute/unmute reacts
          const current = useSessionStore.getState().status;
          if (current) {
            setStatus({ ...current, mic_p1: data.P1 as MicState, mic_p2: data.P2 as MicState });
          }
          break;
        }
        case "emergency_stop":
          alert("Session stopped by researcher.");
          break;
        case "session_ended":
          alert("All tasks completed. Thank you for participating!");
          break;
      }
    },
    [setStatus]
  );

  const { connected: wsConnected, send } = useWebSocket({ sessionId, role, onMessage });

  useEffect(() => {
    const phase = status?.phase;
    if (phase !== "survey" && phase !== "post_task") {
      setPostTaskUnlocked(false);
      return;
    }
    // Study mode has no scripted closing clip to wait for — open the post-task
    // battery as soon as the phase begins.
    setPostTaskUnlocked(true);
  }, [status?.phase]);

  useEffect(() => {
    if (!wsConnected || status || !sessionId) return;
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/status`)
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json();
      })
      .then((data: SessionStatus) => {
        if (!cancelled && data.session_started) {
          setStatus(data);
        }
      })
      .catch((e) => console.warn("[DiscussionRoom] status recovery failed:", e));
    return () => { cancelled = true; };
  }, [wsConnected, status, sessionId, setStatus]);

  // Derive mic state from backend status
  const micState: MicState = role === "P1" ? (status?.mic_p1 ?? "muted") : (status?.mic_p2 ?? "muted");
  const participantAudioCaptureRole = status?.participant_audio_capture_role ?? "both";
  const liveKitParticipantAudioEnabled = status?.livekit_participant_audio_enabled ?? false;
  const remoteParticipantAudioEnabled = status?.remote_participant_audio_enabled ?? false;
  const liveKitMicEnabled = liveKitParticipantAudioEnabled && micState === "open";

  // LiveKit handles video. In co-located room mode participant microphones
  // are not published through LiveKit, so participants only hear Alex.
  // Only connect after WS is up AND we have received status (so we know initial mic state)
  const {
    connected: lkConnected,
    localStream,
    remoteStreams,
    setMicEnabled,
    error: lkError,
  } = useLiveKit({ sessionId, role, enabled: wsConnected && !!status, initialMicEnabled: liveKitMicEnabled });
  useEffect(() => {
    setMicEnabled(liveKitMicEnabled);
  }, [liveKitMicEnabled, setMicEnabled]);

  // Stream participant mics to backend for VAD/transcription only. LiveKit
  // stays video-only, so P1/P2 do not hear each other through the app.
  const audioEnabled = wsConnected && !!status && !status.session_ended
    && (participantAudioCaptureRole === "both" || role === participantAudioCaptureRole);
  useAudioStream({ sessionId, role, enabled: audioEnabled });

  // Local video recording — automatic dual sink (OPFS + backend WS).
  // The configured transcription capture role(s) also include audio.
  // No participant interaction required. exportToDownload() is offered after
  // the session ends so participants can save a copy to their Downloads folder.
  const recordingEnabled = wsConnected && !!status;
  const {
    status: recStatus,
    error: recError,
    backupConnected: recBackup,
    exportToDownload: recExport,
    opfsFilename: recFilename,
  } = useLocalRecording({ sessionId, role, enabled: recordingEnabled });

  // Get peer's stream from LiveKit (stable reference — won't flicker)
  const peerRole = role === "P1" ? "P2" : "P1";
  const remoteStream = remoteStreams[peerRole] ?? null;

  // Timer
  const { display: timerDisplay } = useTimer(
    status?.phase_remaining ?? null,
    status?.phase_paused ?? null
  );

  // Condition flags
  const isNoAI = status?.condition === "C0";
  const showAlex = !isNoAI && (status?.phase !== "survey" || !postTaskUnlocked);

  // Fetch task info
  const [taskInfo, setTaskInfo] = useState<{
    title: string;
    description: string;
    persona?: string;
    candidates: Array<{ id: string; name: string }>;
    shared_info: string[];
    unique_info: string[];
  } | null>(null);
  const [taskFetchFailed, setTaskFetchFailed] = useState(false);

  useEffect(() => {
    if (!sessionId || !status?.task_id) return;
    setTaskFetchFailed(false);
    fetch(`/api/sessions/${sessionId}/task/${role}`)
      .then((r) => { if (!r.ok) throw new Error(`status ${r.status}`); return r.json(); })
      .then((data) => { setTaskInfo(data); setTaskFetchFailed(false); })
      .catch((e) => {
        console.warn("[DiscussionRoom] task fetch failed:", e);
        setTaskFetchFailed(true);
      });
  }, [sessionId, role, status?.task_id]);

  const sharedInfo = taskInfo?.shared_info ?? [];
  const uniqueInfo = taskInfo?.unique_info ?? [];

  // ── Left panel content (phase-specific) ──────────────────────────────

  function renderLeftPanel() {
    const phase = status?.phase;

    if (phase === "info_reading") {
      return (
        <div className="space-y-4">
          <TurnBanner phase={phase} remaining={timerDisplay} condition={status?.condition ?? null} role={role} />
          <InfoDisplay
            title={taskInfo?.title}
            description={taskInfo?.description}
            persona={taskInfo?.persona}
            candidates={taskInfo?.candidates?.map((c) => c.name)}
            sharedInfo={sharedInfo}
            uniqueInfo={uniqueInfo}
          />
        </div>
      );
    }

    if (phase === "preference") {
      const candidates = taskInfo?.candidates?.map((c) => c.name) ?? ["Option A", "Option B", "Option C"];
      const myPref = preferenceChoice;
      return (
        <div className="space-y-6">
          <TurnBanner phase={phase} remaining={timerDisplay} condition={status?.condition ?? null} role={role} />
          <InfoDisplay persona={taskInfo?.persona} sharedInfo={sharedInfo} uniqueInfo={uniqueInfo} compact />
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Your Initial Preference
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Based only on what you've read so far, which option do you currently prefer? You will not see your partner's choice. You can change your mind during discussion.
            </p>
            <div className="grid gap-3">
              {candidates.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setPreferenceChoice(c);
                    send({ type: "preference_vote", data: { choice: c } });
                  }}
                  className={`w-full px-5 py-3 rounded-lg text-left text-sm font-medium transition-all border-2 ${
                    myPref === c
                      ? "bg-indigo-50 border-indigo-500 text-indigo-900 ring-2 ring-indigo-200"
                      : "bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            {myPref && (
              <p className="text-xs text-gray-500 mt-3 italic">
                Saved. You may update your choice anytime during the preference phase.
              </p>
            )}
          </div>
        </div>
      );
    }

    if (phase === "survey" || phase === "post_task") {
      // Post-task battery. Real responses go via per-scale POST autosave;
      // BatteryRunner sends a `posttask_complete` WS message on the last
      // scale, which the state machine listens for to auto-advance once
      // both roles are done.
      const cond = (status?.condition ?? "C2") as Condition;
      if (!postTaskUnlocked) {
        return (
          <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
            <TurnBanner phase={phase} remaining={timerDisplay} condition={status?.condition ?? null} role={role} />
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-indigo-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Closing message</h3>
              <p className="text-sm text-gray-500">
                Please wait for Alex's closing message. The post-task questionnaire will open here automatically.
              </p>
            </div>
          </div>
        );
      }
      if (surveySubmitted) {
        return (
          <div className="max-w-2xl mx-auto py-12 text-center space-y-3">
            <div className="text-4xl">{"✅"}</div>
            <h3 className="text-lg font-semibold text-gray-900">Submitted</h3>
            <p className="text-sm text-gray-500">
              Waiting for the other participant to finish…
            </p>
          </div>
        );
      }
      return (
        <ParticipantPostTask
          sessionId={sessionId}
          role={role}
          condition={cond}
          sendWs={send}
          onComplete={() => setSurveySubmitted(true)}
        />
      );
    }

    if (phase === "decision") {
      const candidates = taskInfo?.candidates?.map((c) => c.name) ?? ["Option A", "Option B", "Option C"];
      const myVote = votes[role];
      return (
        <div className="space-y-6">
          <TurnBanner phase={phase} remaining={timerDisplay} condition={status?.condition ?? null} role={role} />
          <InfoDisplay persona={taskInfo?.persona} sharedInfo={sharedInfo} uniqueInfo={uniqueInfo} compact />
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Select Your Preferred Candidate</h3>
            <div className="grid gap-3">
              {candidates.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setVotes({ ...votes, [role]: c });
                    send({ type: "decision_vote", data: { choice: c } });
                    setVoteSaved(true);
                  }}
                  className={`w-full px-5 py-3 rounded-lg text-left text-sm font-medium transition-all border-2 ${
                    myVote === c
                      ? "bg-indigo-50 border-indigo-500 text-indigo-900 ring-2 ring-indigo-200"
                      : "bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {c}
                  {myVote === c && <span className="ml-2 text-indigo-500">{"\u2713"}</span>}
                </button>
              ))}
            </div>
            {myVote && (
              <p className="mt-3 text-sm text-gray-500">Your selection: <span className="font-medium text-gray-900">{myVote}</span></p>
            )}
            {voteSaved && myVote && (
              <p className="mt-1 text-xs font-medium text-green-700">
                Saved {"✓"} — you may change your selection until the timer ends.
              </p>
            )}
          </div>
        </div>
      );
    }

    // Discussion phases
    return (
      <div className="space-y-4">
        <TurnBanner phase={phase ?? null} remaining={timerDisplay} condition={status?.condition ?? null} role={role} />
        <InfoDisplay
          title={taskInfo?.title}
          description={taskInfo?.description}
          persona={taskInfo?.persona}
          candidates={taskInfo?.candidates?.map((c) => c.name)}
          sharedInfo={sharedInfo}
          uniqueInfo={uniqueInfo}
          compact
        />
      </div>
    );
  }

  // ── Waiting state (no status yet) ────────────────────────────────────

  if (!status) {
    const stepClass = (done: boolean, active: boolean) =>
      done
        ? "text-green-700"
        : active
          ? "text-indigo-700 font-semibold"
          : "text-gray-400";
    const Icon = ({ done, active }: { done: boolean; active: boolean }) =>
      done ? (
        <span className="text-green-600">{"✓"}</span>
      ) : active ? (
        <svg className="w-3.5 h-3.5 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <span className="text-gray-300">{"○"}</span>
      );
    // status is null in this branch, so by definition statusReceived = false
    const wsDone = wsConnected;
    const statusActive = wsConnected;
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-700">Joining session…</h2>
          <ul className="text-sm space-y-1.5 mt-2 min-w-[260px]">
            <li className={`flex items-center gap-2 ${stepClass(wsDone, !wsDone)}`}>
              <Icon done={wsDone} active={!wsDone} />
              <span>Connecting to server</span>
            </li>
            <li className={`flex items-center gap-2 ${stepClass(false, statusActive)}`}>
              <Icon done={false} active={statusActive} />
              <span>Waiting for researcher to start session</span>
            </li>
            <li className={`flex items-center gap-2 ${stepClass(false, false)}`}>
              <Icon done={false} active={false} />
              <span>Connecting video & audio</span>
            </li>
          </ul>
        </div>
        <p className="text-xs text-gray-400 mt-4">Session: {sessionId} | Role: {role}</p>
        {!wsConnected && (
          <div className="mt-2 bg-red-50 text-red-700 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium">
            Disconnected — reconnecting...
          </div>
        )}
      </div>
    );
  }

  // ── Main layout ──────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header Bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
              Hidden Profile Task
            </h1>
            <PhaseBadge phase={status?.phase as any ?? null} />
            {lkConnected && <span className="text-xs text-green-600 font-medium">LiveKit connected</span>}
          </div>
          <div className="flex items-center gap-4">
            {status?.condition && (
              <span className="text-[11px] font-mono text-gray-400 uppercase tracking-wider">
                {status.condition}
              </span>
            )}
            <RecordingPill status={recStatus} backupConnected={recBackup} error={recError} />
            <SaveMyVideoButton onExport={recExport} canExport={!!recFilename && (recStatus === "idle" || recStatus === "stopping")} />
            <Timer remaining={status?.phase_remaining ?? 0} paused={status?.phase_paused ?? false} />
          </div>
        </div>
      </header>

      <div className="px-4 pt-2"><AICaptionStrip caption={aiCaption} /></div>


      {/* Split panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel — shared board (scrollable) */}
        <main className="flex-1 overflow-y-auto p-6 custom-scroll">
          {renderLeftPanel()}
        </main>

        {/* Right column — video feeds + AI + controls */}
        <aside className="w-72 shrink-0 border-l border-gray-200 bg-gray-50 p-4 flex flex-col gap-3 overflow-y-auto custom-scroll">
          {/* P1 Video */}
          <VideoFeed
            role="P1"
            label="Participant 1"
            speaking={p1Speaking}
            micState={status?.mic_p1 ?? "muted"}
            isSelf={role === "P1"}
            accentColor="blue"
            stream={role === "P1" ? localStream : remoteStream}
            audioEnabled={remoteParticipantAudioEnabled}
            showMicState={false}
            status={role === "P1" ? undefined : lkConnected ? undefined : "Connecting..."}
          />

          {/* P2 Video */}
          <VideoFeed
            role="P2"
            label="Participant 2"
            speaking={p2Speaking}
            micState={status?.mic_p2 ?? "muted"}
            isSelf={role === "P2"}
            accentColor="teal"
            stream={role === "P2" ? localStream : remoteStream}
            audioEnabled={remoteParticipantAudioEnabled}
            showMicState={false}
            status={role === "P2" ? undefined : lkConnected ? undefined : "Connecting..."}
          />

          {/* AI Assistant */}
          {showAlex && (
            <AlexAvatar
              status={alexStatus}
              text={alexStatus === "speaking" ? alexText : undefined}
            />
          )}

          <ParticipantTranscript
            lines={participantTranscript}
            phase={status?.phase ?? null}
            defaultOpen={true}
            placement="embedded"
            maxLines={12}
          />

          <div className="flex-1" />

          {/* Recording status */}
          <div className="flex items-center justify-center gap-3 py-2 border-t border-gray-200">
            <div
              className="w-10 h-10 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-lg"
              title="Camera recording"
              aria-label="Camera recording"
            >
              {"\uD83D\uDCF7"}
            </div>
          </div>
        </aside>
      </div>

      {/* Connection status */}
      {!wsConnected && (
        <div className="fixed top-4 right-4 bg-red-50 text-red-700 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium shadow-lg">
          Disconnected — reconnecting...
        </div>
      )}
      {lkError && (
        <div className="fixed top-4 left-4 bg-amber-50 text-amber-700 border border-amber-200 px-4 py-2 rounded-lg text-xs font-medium shadow-lg">
          Media: {lkError}
        </div>
      )}
      {audioBlocked && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-amber-50 text-amber-800 border border-amber-300 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg flex items-center gap-2">
          <span aria-hidden="true">{"🔇"}</span>
          <span>Alex's audio was blocked by your browser. Click anywhere or press a key to enable.</span>
        </div>
      )}
      {taskFetchFailed && status?.task_id && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-50 text-red-700 border border-red-300 px-4 py-2 rounded-lg text-xs font-medium shadow-lg">
          Could not load task information. The page will retry on the next phase change — refresh if it persists.
        </div>
      )}
    </div>
  );
}

interface RecordingPillProps {
  status: "idle" | "starting" | "recording" | "stopping" | "error";
  backupConnected: boolean;
  error: string | null;
}

function RecordingPill({ status, backupConnected, error }: RecordingPillProps) {
  if (status === "idle") return null;
  const tone =
    status === "error" ? "bg-red-50 text-red-700 border-red-200" :
    status === "recording" ? "bg-red-50 text-red-700 border-red-200" :
    "bg-gray-100 text-gray-600 border-gray-200";
  const label =
    status === "starting" ? "Recording…" :
    status === "stopping" ? "Stopping…" :
    status === "error" ? "Rec error" :
    "● REC";
  return (
    <span
      title={error ?? (backupConnected ? "Local file + server backup" : "Local file (server backup offline)")}
      className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${tone}`}
    >
      {label}{!backupConnected && status === "recording" ? " · local-only" : ""}
    </span>
  );
}

interface SaveMyVideoButtonProps {
  onExport: () => Promise<boolean>;
  canExport: boolean;
}

function SaveMyVideoButton({ onExport, canExport }: SaveMyVideoButtonProps) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (!canExport) return null;
  const click = async () => {
    setBusy(true);
    const ok = await onExport();
    setBusy(false);
    if (ok) setDone(true);
  };
  return (
    <button
      onClick={click}
      disabled={busy}
      title="Save the browser-local recording to this computer's Downloads folder"
      className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 disabled:opacity-50"
    >
      {done ? "Saved" : busy ? "Saving..." : "Save video"}
    </button>
  );
}
