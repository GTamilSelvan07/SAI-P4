import { useEffect, useRef } from "react";
import type { TranscriptLine } from "../../types";

interface LiveTranscriptPanelProps {
  transcript: TranscriptLine[];
  driftTimestamps?: Set<number>;
  maxHeight?: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function LiveTranscriptPanel({ transcript, driftTimestamps, maxHeight = "110px" }: LiveTranscriptPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [transcript]);
  const avgConfidence = transcript.length > 0 ? (transcript.reduce((s, t) => s + (t.confidence ?? 0), 0) / transcript.length).toFixed(2) : "—";
  return (
    <div className="border-t border-gray-200 pt-2 mt-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold">Live transcript · auto-scroll</div>
        <span className="text-[9px] text-gray-500">{transcript.length} lines · ASR avg {avgConfidence}</span>
      </div>
      <div className="overflow-y-auto px-1 text-xs leading-tight" style={{ maxHeight }}>
        {transcript.map((line, i) => {
          const drift = driftTimestamps?.has(line.ts) ?? false;
          const tagClass = line.speaker === "AI" || line.speaker === "Alex" ? "bg-purple-100 text-purple-700" : line.speaker === "P1" ? "bg-blue-100 text-blue-700" : "bg-teal-100 text-teal-700";
          const textClass = line.speaker === "AI" || line.speaker === "Alex" ? "italic text-purple-900" : "text-gray-800";
          return (
            <div key={`${line.ts}-${i}`} className={`flex gap-1.5 py-0.5 ${drift ? "bg-amber-100 rounded" : ""}`}>
              <span className="text-[8px] font-mono text-gray-400 w-9 shrink-0">{formatTime(line.ts)}</span>
              <span className={`text-[8px] font-bold px-1.5 rounded shrink-0 h-3.5 ${tagClass}`}>{line.speaker === "Alex" ? "AI" : line.speaker}</span>
              <span className={textClass}>{line.text}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
