import type { SessionStatus, MicState } from "../../types";

interface TopContextStripProps {
  status: SessionStatus | null;
  conditionLabel?: string;
  conditionColor?: string;
  taskTitle?: string | null;
  anchorOption?: string | null;
  anchorName?: string | null;
  currentSpeaker: "P1" | "P2" | null;
}

function formatTime(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TopContextStrip({ status, conditionLabel = "", conditionColor = "bg-gray-100 text-gray-700 border-gray-300", taskTitle, anchorOption, anchorName, currentSpeaker }: TopContextStripProps) {
  const phase = status?.phase ?? "—";
  const mic_p1 = (status?.mic_p1 ?? "muted") as MicState;
  const mic_p2 = (status?.mic_p2 ?? "muted") as MicState;
  return (
    <div className="flex items-center justify-between bg-white rounded-md px-3 py-2 border border-gray-200">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${conditionColor}`}>{status?.condition} {conditionLabel ? `· ${conditionLabel}` : ""}</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">▸ {phase}</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">{formatTime(status?.phase_remaining)}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${mic_p1 === "open" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>P1 {mic_p1}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${mic_p2 === "open" ? "bg-teal-50 text-teal-700 border-teal-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>P2 {mic_p2}</span>
        {currentSpeaker && (<span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">● {currentSpeaker} speaking</span>)}
      </div>
      <div className="text-xs text-gray-500">
        {taskTitle && (<span>Task: <strong>{taskTitle}</strong></span>)}
        {anchorOption && anchorName && (<span> · anchor: <strong>{anchorOption} ({anchorName})</strong></span>)}
      </div>
    </div>
  );
}
