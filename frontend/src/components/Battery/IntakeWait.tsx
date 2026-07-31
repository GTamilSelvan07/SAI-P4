/**
 * IntakeWait — partner-wait screen shown after a participant finishes intake.
 *
 * Polls GET /api/groups/{id} every 2 s. As soon as a session_id appears for
 * this group, the participant is auto-routed to /participant?session_id=…
 * via onSessionAvailable.
 */
import { useEffect, useState } from "react";

interface GroupSnapshot {
  group_id: string;
  status: string;
  p1_intake_done: boolean;
  p2_intake_done: boolean;
  session_ids: string[];
  last_active_session_id: string | null;
}

export interface IntakeWaitProps {
  groupId: string;
  role: "P1" | "P2";
  onSessionAvailable: (sessionId: string) => void;
}

export function IntakeWait({ groupId, role, onSessionAvailable }: IntakeWaitProps) {
  const [snap, setSnap] = useState<GroupSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const r = await fetch(`/api/groups/${groupId}`);
        if (!r.ok) {
          timer = setTimeout(poll, 2000);
          return;
        }
        const data: GroupSnapshot = await r.json();
        if (cancelled) return;
        setSnap(data);
        if (data.last_active_session_id) {
          onSessionAvailable(data.last_active_session_id);
          return;
        }
        timer = setTimeout(poll, 2000);
      } catch {
        timer = setTimeout(poll, 2000);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [groupId, onSessionAvailable]);

  const otherRole = role === "P1" ? "P2" : "P1";
  const otherDone = snap ? (role === "P1" ? snap.p2_intake_done : snap.p1_intake_done) : false;
  const isD0 = /^g\d{3}$/.test(groupId) || /^[A-Za-z0-9_-]+_D0$/i.test(groupId);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-8 py-10 max-w-md w-full text-center space-y-4">
        <div className="text-3xl">⏳</div>
        <h2 className="text-lg font-semibold text-gray-900">Thanks — that's the intake done.</h2>
        <p className="text-sm text-gray-600">
          {isD0 && otherDone
            ? "D0 is complete for both participants. Please wait for the researcher to create or give you the task session ID, such as 1_C2."
            : otherDone
              ? "Both intakes complete. Waiting for the researcher to start your session…"
              : `Waiting for ${otherRole} to finish their D0 intake.`}
        </p>
        {isD0 && otherDone && (
          <button
            onClick={() => { window.location.href = "/"; }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700"
          >
            Enter task session ID
          </button>
        )}
        {snap && (
          <div className="text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-3">
            <div>Group <code className="font-mono">{snap.group_id}</code> — status <code>{snap.status}</code></div>
            <div>P1 intake: {snap.p1_intake_done ? "✓" : "…"} · P2 intake: {snap.p2_intake_done ? "✓" : "…"}</div>
          </div>
        )}
      </div>
    </div>
  );
}
