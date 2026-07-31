import type { Phase } from "../../types";

const PHASE_CONFIG: Record<string, { label: string; color: string }> = {
  setup: { label: "Setup", color: "bg-gray-100 text-gray-700 border-gray-300" },
  info_reading: { label: "Information Reading", color: "bg-amber-50 text-amber-800 border-amber-300" },
  preference: { label: "Initial Preference", color: "bg-gray-100 text-gray-700 border-gray-300" },
  p1_opening: { label: "P1 Opening Statement", color: "bg-blue-50 text-blue-800 border-blue-300" },
  p2_opening: { label: "P2 Opening Statement", color: "bg-teal-50 text-teal-800 border-teal-300" },
  open_discussion: { label: "Open Discussion", color: "bg-green-50 text-green-800 border-green-300" },
  decision: { label: "Final Decision", color: "bg-amber-50 text-amber-800 border-amber-300" },
  survey: { label: "Post-Task Survey", color: "bg-gray-100 text-gray-700 border-gray-300" },
  washout: { label: "Break", color: "bg-gray-100 text-gray-600 border-gray-200" },
  debrief: { label: "Debrief", color: "bg-gray-100 text-gray-600 border-gray-200" },
};

interface PhaseBadgeProps {
  phase: Phase | null;
}

export function PhaseBadge({ phase }: PhaseBadgeProps) {
  if (!phase) return null;
  const cfg = PHASE_CONFIG[phase] ?? { label: phase, color: "bg-gray-100 text-gray-700 border-gray-300" };

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}
