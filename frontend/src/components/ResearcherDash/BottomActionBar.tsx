interface BottomActionBarProps {
  onAdvance: () => void;
  onPause: () => void;
  onFailsafe: () => void;
  onEmergencyStop: () => void;
  paused: boolean;
}

export function BottomActionBar({ onAdvance, onPause, onFailsafe, onEmergencyStop, paused }: BottomActionBarProps) {
  return (
    <div className="shrink-0 min-h-[52px] bg-slate-800 text-white rounded-md px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex flex-wrap gap-2">
        <button onClick={onAdvance} className="px-4 py-2 rounded bg-green-600 hover:bg-green-500 text-sm font-semibold whitespace-nowrap">Advance phase</button>
        <button onClick={onPause} className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-400 text-sm font-semibold whitespace-nowrap">{paused ? "Resume" : "Pause"}</button>
        <button onClick={onFailsafe} className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-sm font-semibold whitespace-nowrap">Failsafe</button>
        <button onClick={onEmergencyStop} className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 border border-slate-500 text-sm font-semibold whitespace-nowrap">Emergency stop</button>
      </div>
      <div className="text-xs text-slate-400 whitespace-nowrap">space=pause &nbsp; arrow=advance &nbsp; F=failsafe &nbsp; Esc=focus stop</div>
    </div>
  );
}
