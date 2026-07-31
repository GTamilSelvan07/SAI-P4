/**
 * ParticipantDebrief — wraps BatteryRunner for the post-debrief manipulation
 * check. Triggered when the researcher clicks "End Group" → the participant
 * is shown the debrief URL (origin/group/{id}/{role}/debrief).
 */
import { useState } from "react";
import { BatteryRunner } from "./BatteryRunner";
import type { Condition } from "../../types";

export interface ParticipantDebriefProps {
  groupId: string;
  role: "P1" | "P2";
  /** Optional — narrows the multi-choice items shown (C3 anchoring probe etc.). */
  condition?: Condition;
}

export function ParticipantDebrief({ groupId, role, condition }: ParticipantDebriefProps) {
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-8 py-10 max-w-md w-full text-center space-y-4">
          <div className="text-3xl">✓</div>
          <h2 className="text-lg font-semibold text-gray-900">Thank you.</h2>
          <p className="text-sm text-gray-600">
            Debrief complete. Your responses have been saved. You may now close this tab.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-6">
      <BatteryRunner
        progressUrl={`/api/groups/${groupId}/battery/${role}/progress?phase=debrief`}
        submitUrlFor={(scaleId) => `/api/groups/${groupId}/battery/${role}/${scaleId}`}
        phase="debrief"
        condition={condition}
        onComplete={() => setDone(true)}
      />
    </div>
  );
}
