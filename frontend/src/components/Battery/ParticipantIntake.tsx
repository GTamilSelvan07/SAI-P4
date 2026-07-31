/**
 * ParticipantIntake — DemographicsForm → BatteryRunner(intake) → IntakeWait.
 *
 * Skips the demographics step on resume if the participant already submitted
 * (server returns 200 from GET /demographics/{role}).
 */
import { useEffect, useState } from "react";
import { BatteryRunner } from "./BatteryRunner";
import { DemographicsForm } from "./DemographicsForm";
import { IntakeWait } from "./IntakeWait";

type Step = "loading" | "demographics" | "battery" | "wait";

export interface ParticipantIntakeProps {
  groupId: string;
  role: "P1" | "P2";
  d0Id?: string;
  onSessionAvailable: (sessionId: string) => void;
}

export function ParticipantIntake({ groupId, role, d0Id, onSessionAvailable }: ParticipantIntakeProps) {
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    fetch(`/api/groups/${groupId}`)
      .then((r) => {
        if (!r.ok) throw new Error("D0 ID has not been created by the researcher yet.");
        return r.json();
      })
      .then((group: { metadata?: Record<string, unknown> }) => {
        if (d0Id && group.metadata?.d0_id !== d0Id) {
          throw new Error("D0 ID has not been created by the researcher yet.");
        }
      })
      .then(() => fetch(`/api/groups/${groupId}/demographics/${role}`))
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setStep("battery");
        } else {
          setStep("demographics");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message);
          setStep("loading");
        }
      });
    return () => { cancelled = true; };
  }, [groupId, role, d0Id]);

  if (step === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 py-10">
        <D0Header role={role} />
        {error ? (
          <div className="max-w-xl mx-auto rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">Loading…</div>
        )}
      </div>
    );
  }

  if (step === "demographics") {
    return (
      <div className="min-h-screen bg-gray-50 py-10">
        <D0Header role={role} />
        <DemographicsForm
          groupId={groupId}
          role={role}
          onComplete={() => setStep("battery")}
        />
      </div>
    );
  }

  if (step === "battery") {
    return (
      <div className="min-h-screen bg-gray-50 py-6">
        <D0Header role={role} />
        <BatteryRunner
          progressUrl={`/api/groups/${groupId}/battery/${role}/progress?phase=intake`}
          submitUrlFor={(scaleId) => `/api/groups/${groupId}/battery/${role}/${scaleId}`}
          phase="intake"
          onComplete={() => setStep("wait")}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <D0Header role={role} />
      <IntakeWait
        groupId={groupId}
        role={role}
        onSessionAvailable={onSessionAvailable}
      />
    </div>
  );
}

function D0Header({ role }: { role: "P1" | "P2" }) {
  return (
    <div className="max-w-3xl mx-auto px-6 mb-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide font-bold text-sky-700">D0 · one-time pre-study block</div>
          <div className="text-sm font-semibold text-gray-900">Demographics + pre-task questionnaire</div>
        </div>
        <span className="px-2.5 py-1 rounded-md border border-sky-300 bg-white text-sky-800 text-xs font-mono font-bold">
          {role}
        </span>
      </div>
    </div>
  );
}
