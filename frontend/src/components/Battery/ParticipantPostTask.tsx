/**
 * ParticipantPostTask — wraps BatteryRunner for the post-task phase.
 *
 * Real per-scale responses are saved via POST autosave to
 * /api/sessions/{id}/posttask/{role}/{scale_id}. On phase completion we send
 * a `posttask_complete` WS message so the state machine flips
 * session.surveys[role] = True and auto-advances when both roles are done.
 */
import { BatteryRunner } from "./BatteryRunner";
import type { Condition } from "../../types";

export interface ParticipantPostTaskProps {
  sessionId: string;
  role: "P1" | "P2";
  condition: Condition;
  /** WS send function from useWebSocket; called on phase_complete. */
  sendWs: (msg: { type: string; data: Record<string, unknown> }) => void;
  onComplete: () => void;
}

export function ParticipantPostTask({
  sessionId, role, condition, sendWs, onComplete,
}: ParticipantPostTaskProps) {
  return (
    <div className="min-h-screen bg-gray-50 py-6">
      <BatteryRunner
        progressUrl={`/api/sessions/${sessionId}/posttask/${role}/progress`}
        submitUrlFor={(scaleId) => `/api/sessions/${sessionId}/posttask/${role}/${scaleId}`}
        phase="posttask"
        condition={condition}
        onComplete={() => {
          sendWs({
            type: "posttask_complete",
            data: { role, condition },
          });
          onComplete();
        }}
      />
    </div>
  );
}
