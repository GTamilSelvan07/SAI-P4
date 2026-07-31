interface AlexPanelProps {
  status: "listening" | "speaking" | "monitoring" | "hidden";
  text?: string;
}

export function AlexAvatar({ status, text }: AlexPanelProps) {
  if (status === "hidden") return null;

  const statusConfig: Record<string, { label: string; dotColor: string }> = {
    listening: { label: "Listening", dotColor: "bg-gray-400" },
    speaking: { label: "Speaking", dotColor: "bg-purple-500" },
    monitoring: { label: "Monitoring", dotColor: "bg-green-500" },
  };
  const cfg = statusConfig[status] ?? statusConfig.monitoring;

  return (
    <div className={`bg-white rounded-xl border-2 ${status === "speaking" ? "border-purple-400 speaking-ring" : "border-gray-200"} overflow-hidden`}>
      {/* Avatar / Waveform area */}
      <div className="bg-purple-50 px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
          AI
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">Alex</span>
            <span className={`w-2 h-2 rounded-full ${cfg.dotColor}`} />
            <span className="text-xs text-gray-500">{cfg.label}</span>
          </div>
          {/* Waveform when speaking */}
          {status === "speaking" && (
            <div className="flex items-end gap-0.5 h-4 mt-1">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="waveform-bar h-4 bg-purple-400" />
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Speech bubble */}
      {status === "speaking" && text && (
        <div className="px-4 py-3 border-t border-purple-100">
          <p className="text-sm text-gray-700 italic leading-relaxed">"{text}"</p>
        </div>
      )}
      {status === "monitoring" && (
        <div className="px-4 py-2 border-t border-gray-100">
          <p className="text-xs text-gray-400">AI facilitator is observing the discussion.</p>
        </div>
      )}
    </div>
  );
}
