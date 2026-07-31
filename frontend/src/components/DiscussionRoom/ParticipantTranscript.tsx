import { useEffect, useRef, useState } from "react";
import type { TranscriptLine, Phase } from "../../types";

interface ParticipantTranscriptProps {
  lines: TranscriptLine[];
  phase: Phase | null;
  defaultOpen?: boolean;
  placement?: "floating" | "embedded";
  maxLines?: number;
}

const ACTIVE_PHASES: ReadonlyArray<Phase> = ["p1_opening", "p2_opening", "open_discussion"];

const PHASE_LABEL: Partial<Record<Phase, string>> = {
  setup: "setup",
  info_reading: "reading task info",
  preference: "initial preference",
  decision: "final decision",
  survey: "post-task survey",
  washout: "between tasks",
  debrief: "debrief",
};

export function ParticipantTranscript({
  lines,
  phase,
  defaultOpen = true,
  placement = "floating",
  maxLines,
}: ParticipantTranscriptProps) {
  const [open, setOpen] = useState(defaultOpen);
  const endRef = useRef<HTMLDivElement>(null);
  const isActive = phase != null && (ACTIVE_PHASES as ReadonlyArray<Phase | null>).includes(phase);
  const visibleLines = maxLines ? lines.slice(-maxLines) : lines;
  const isEmbedded = placement === "embedded";

  useEffect(() => {
    if (open && isActive) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, open, isActive]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={isEmbedded
          ? "w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          : "fixed right-4 bottom-4 z-30 bg-white border border-gray-300 rounded-full shadow-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"}
        aria-label="Show transcript"
      >
        Show transcript
      </button>
    );
  }

  return (
    <div className={isEmbedded
      ? "w-full bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden max-h-64"
      : "fixed top-20 right-4 bottom-4 w-80 z-30 bg-white border border-gray-200 rounded-xl shadow-lg flex flex-col overflow-hidden"}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-600">
          {isEmbedded ? "Transcript · latest" : "Transcript"}
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          aria-label="Hide transcript"
        >
          {"×"}
        </button>
      </div>

      {!isActive ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center text-sm text-gray-400 italic">
          Transcript hidden during {phase ? (PHASE_LABEL[phase] ?? phase) : "this phase"}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-sm">
          {lines.length === 0 ? (
            <p className="text-xs text-gray-400 italic mt-1">Waiting for first utterance…</p>
          ) : (
            visibleLines.map((line, i) => {
              const isAI = line.speaker === "AI" || line.speaker === "Alex";
              const speakerColor = isAI
                ? "text-purple-700 bg-purple-50"
                : line.speaker === "P1"
                  ? "text-blue-700 bg-blue-50"
                  : "text-teal-700 bg-teal-50";
              return (
                <div key={`${line.ts}-${i}`} className="flex gap-2">
                  <span className={`shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded ${speakerColor}`}>
                    {isAI ? "AI" : line.speaker}
                  </span>
                  <span className={isAI ? "text-purple-900 italic" : "text-gray-800"}>{line.text}</span>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
