interface EmergencyStopProps {
  sessionId: string;
}

export function EmergencyStop({ sessionId }: EmergencyStopProps) {
  const emergencyStop = () => {
    if (confirm("EMERGENCY STOP \u2014 This will mute all audio and freeze the phase. Continue?")) {
      fetch(`/api/sessions/${sessionId}/emergency-stop`, { method: "POST" });
    }
  };

  return (
    <div className="p-4 mt-auto">
      <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-red-700 uppercase">Emergency</span>
        </div>
        <button
          onClick={emergencyStop}
          className="w-full py-3 bg-red-600 rounded-xl font-bold text-white hover:bg-red-700 transition-colors shadow-sm text-sm"
        >
          EMERGENCY STOP
        </button>
        <p className="text-xs text-red-500 mt-2 text-center">Mute All & Freeze Phase</p>
      </div>
    </div>
  );
}
