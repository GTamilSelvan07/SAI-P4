import type { SessionStatus } from "../../types";

interface ParticipantStatusProps {
  connectedRoles: string[];
  status: SessionStatus | null;
}

export function ParticipantStatus({ connectedRoles, status }: ParticipantStatusProps) {
  return (
    <div className="px-4 py-3 border-b border-gray-200">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Participants</span>
      </div>
      <div className="space-y-3">
        <ParticipantRow role="P1" connected={connectedRoles.includes("P1")} mic={status?.mic_p1 ?? "muted"} phase={status?.phase ?? null} />
        <ParticipantRow role="P2" connected={connectedRoles.includes("P2")} mic={status?.mic_p2 ?? "muted"} phase={status?.phase ?? null} />
      </div>
    </div>
  );
}

function ParticipantRow({ role, connected, mic, phase }: {
  role: string; connected: boolean; mic: string; phase: string | null;
}) {
  const color = role === "P1" ? "text-blue-600" : "text-teal-600";
  const bgColor = role === "P1" ? "bg-blue-50" : "bg-teal-50";

  return (
    <div className={`rounded-lg border ${connected ? "border-gray-200" : "border-red-200 bg-red-50"} p-2.5`}>
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        <span className={`font-bold text-sm ${color}`}>{role}</span>
        {!connected && <span className="text-xs text-red-600 font-medium">DISCONNECTED</span>}
      </div>
      {connected && (
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-xs text-gray-500">Phase: {phase ?? "\u2014"}</span>
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs">{mic === "open" ? "\uD83C\uDFA4" : "\uD83D\uDD07"}</span>
            {mic === "open" && (
              <div className="flex items-end gap-px h-3">
                {[3, 5, 8, 6, 4].map((h, i) => (
                  <div key={i} className={`w-0.5 ${bgColor} rounded-full`} style={{ height: `${h * 1.5}px` }} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
