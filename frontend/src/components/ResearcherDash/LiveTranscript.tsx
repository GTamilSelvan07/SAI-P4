import { useEffect, useRef } from "react";
import type { TranscriptLine } from "../../types";

interface LiveTranscriptProps {
  transcript: TranscriptLine[];
}

export function LiveTranscript({ transcript }: LiveTranscriptProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-white">
      <div className="flex items-center gap-2 px-5 py-2 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Live Transcript</span>
        <span className="text-xs text-gray-400">({transcript.length} lines)</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-2 space-y-0.5 text-sm custom-scroll">
        {transcript.map((line, i) => {
          const isAI = line.speaker === "AI";
          const isFailsafe = line.text.startsWith("[FAILSAFE");
          return (
            <div key={i} className={`flex gap-2 py-0.5 ${isAI ? "bg-purple-50/50 -mx-2 px-2 rounded" : ""}`}>
              <span className="text-gray-400 font-mono text-xs w-14 shrink-0 tabular-nums">
                {new Date(line.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              {isAI ? (
                <span className="shrink-0 text-xs px-1.5 py-0.5 rounded font-semibold bg-purple-100 text-purple-700">
                  {isFailsafe ? "FAILSAFE" : "AI"}
                </span>
              ) : (
                <span className={`font-semibold shrink-0 w-6 ${line.speaker === "P1" ? "text-blue-600" : "text-teal-600"}`}>
                  {line.speaker}
                </span>
              )}
              <span className={isAI ? "text-purple-800 italic" : "text-gray-700"}>{line.text}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
