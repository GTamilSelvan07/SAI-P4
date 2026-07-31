interface LiveContextBarProps {
  preferences: { P1?: string; P2?: string };
  decisions: { P1?: string; P2?: string };
  anchorLabel: string | null;
  currentSpeaker: "P1" | "P2" | null;
}

function pillsForChoice(role: "P1" | "P2", pref?: string, dec?: string): string {
  if (!pref && !dec) return `${role}: —`;
  if (pref && dec && pref !== dec) return `${role} ${pref} → ${dec} (drift)`;
  return `${role}: ${dec ?? pref}`;
}

export function LiveContextBar({ preferences, decisions, anchorLabel, currentSpeaker }: LiveContextBarProps) {
  return (
    <div className="bg-orange-50 border border-orange-200 rounded px-2 py-1.5 text-[9px] flex flex-wrap gap-1.5 items-center mb-2">
      <span className="font-bold uppercase text-orange-800">Context:</span>
      <span className="bg-white px-1.5 py-0.5 rounded border border-orange-200 font-semibold">{pillsForChoice("P1", preferences.P1, decisions.P1)}</span>
      <span className="bg-white px-1.5 py-0.5 rounded border border-orange-200 font-semibold">{pillsForChoice("P2", preferences.P2, decisions.P2)}</span>
      {anchorLabel && (<span className="bg-white px-1.5 py-0.5 rounded border border-orange-200 font-semibold">Anchor → {anchorLabel}</span>)}
      {currentSpeaker && (<span className="bg-white px-1.5 py-0.5 rounded border border-orange-200 font-semibold">Speaking: {currentSpeaker}</span>)}
    </div>
  );
}
