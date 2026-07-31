import type { Phase } from "../../types";

const TURN_CONFIG: Record<string, { text: string; bg: string; icon: string }> = {
  info_reading: {
    text: "Read the task information carefully. Some information is shared, some is unique to you.",
    bg: "bg-amber-50 border-amber-200 text-amber-900",
    icon: "\uD83D\uDCD6",
  },
  preference: {
    text: "Select your initial preference before discussion begins.",
    bg: "bg-gray-50 border-gray-200 text-gray-800",
    icon: "\u270B",
  },
  p1_opening: {
    text: "Participant 1 is presenting their opening statement.",
    bg: "bg-blue-50 border-blue-200 text-blue-900",
    icon: "\uD83D\uDDE3\uFE0F",
  },
  p2_opening: {
    text: "Participant 2 is presenting their opening statement.",
    bg: "bg-teal-50 border-teal-200 text-teal-900",
    icon: "\uD83D\uDDE3\uFE0F",
  },
  open_discussion: {
    text: "Open discussion \u2014 share your unique information and work toward a decision.",
    bg: "bg-green-50 border-green-200 text-green-900",
    icon: "\uD83D\uDCAC",
  },
  decision: {
    text: "Time to make your final decision together.",
    bg: "bg-amber-50 border-amber-200 text-amber-900",
    icon: "\uD83C\uDFAF",
  },
  survey: {
    text: "Please complete the post-task survey.",
    bg: "bg-gray-50 border-gray-200 text-gray-800",
    icon: "\uD83D\uDCCB",
  },
  washout: {
    text: "Take a short break before the next round.",
    bg: "bg-gray-50 border-gray-200 text-gray-600",
    icon: "\u2615",
  },
};

interface TurnBannerProps {
  phase: Phase | null;
  remaining: string;
  condition: string | null;
  role?: string;
}

export function TurnBanner({ phase, remaining, condition, role }: TurnBannerProps) {
  if (!phase) return null;
  const cfg = TURN_CONFIG[phase] ?? { text: phase, bg: "bg-gray-50 border-gray-200 text-gray-800", icon: "" };

  const isNoAI = condition === "C0";

  let text = cfg.text;
  if (isNoAI) {
    // C0 (no AI): strict mic enforcement still applies (P2 muted in P1 opening, etc.)
    // but the copy is softened to match the no-AI tone \u2014 no facilitator framing.
    if (phase === "p1_opening" && role === "P1") text = "Your turn \u2014 share your opening thoughts.";
    if (phase === "p1_opening" && role === "P2") text = "Listen first. Your turn is next.";
    if (phase === "p2_opening" && role === "P2") text = "Your turn \u2014 share your opening thoughts.";
    if (phase === "p2_opening" && role === "P1") text = "Listen first.";
  } else {
    if (phase === "p1_opening" && role === "P1") text = "Your turn \u2014 present your opening statement.";
    if (phase === "p1_opening" && role === "P2") text = "Listen to Participant 1's opening statement. Your turn is next.";
    if (phase === "p2_opening" && role === "P2") text = "Your turn \u2014 present your opening statement.";
    if (phase === "p2_opening" && role === "P1") text = "Listen to Participant 2's opening statement.";
  }

  return (
    <div className={`rounded-lg border px-4 py-3 ${cfg.bg}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{cfg.icon}</span>
          <p className="text-sm font-medium">{text}</p>
        </div>
        <span className="font-mono text-sm tabular-nums opacity-70">({remaining})</span>
      </div>
      {isNoAI && phase === "info_reading" && (
        <p className="text-xs mt-1 opacity-60">No AI facilitator in this session — discuss as a pair.</p>
      )}
    </div>
  );
}
