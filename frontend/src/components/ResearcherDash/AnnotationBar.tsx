import { useState, useRef } from "react";

export type FlagTag = "issue" | "interesting" | "follow-up" | "milestone";

export interface ResearcherFlag {
  ts: number; // unix epoch seconds
  tag: FlagTag;
  note: string;
  phase: string | null;
}

interface AnnotationBarProps {
  onSubmit: (tag: FlagTag, note: string) => void;
  flags: ResearcherFlag[];
  disabled?: boolean;
}

const TAG_CONFIG: Record<FlagTag, { label: string; color: string; icon: string }> = {
  "issue":       { label: "Issue",       color: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100",       icon: "⚠" },
  "interesting": { label: "Interesting", color: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100", icon: "★" },
  "follow-up":   { label: "Follow-up",   color: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",      icon: "↻" },
  "milestone":   { label: "Milestone",   color: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100",  icon: "✓" },
};

const TAG_ORDER: FlagTag[] = ["issue", "interesting", "follow-up", "milestone"];

export function AnnotationBar({ onSubmit, flags, disabled = false }: AnnotationBarProps) {
  const [tag, setTag] = useState<FlagTag>("interesting");
  const [note, setNote] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (disabled) return;
    onSubmit(tag, note.trim());
    setNote("");
    inputRef.current?.focus();
  };

  const recent = flags.slice(-5).reverse();

  return (
    <div className="border-t border-gray-200 bg-white">
      {recent.length > 0 && (
        <div className="px-4 pt-2 pb-1 flex flex-wrap gap-1.5">
          {recent.map((f, i) => {
            const cfg = TAG_CONFIG[f.tag];
            return (
              <span
                key={`${f.ts}-${i}`}
                title={`${cfg.label} · ${f.phase ?? "no phase"} · ${new Date(f.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${cfg.color}`}
              >
                <span aria-hidden>{cfg.icon}</span>
                <span className="truncate max-w-[140px]">{f.note || cfg.label}</span>
              </span>
            );
          })}
        </div>
      )}
      <div className="px-4 py-2 flex items-center gap-2">
        <div className="flex gap-1">
          {TAG_ORDER.map((t) => {
            const cfg = TAG_CONFIG[t];
            const selected = tag === t;
            return (
              <button
                key={t}
                onClick={() => setTag(t)}
                disabled={disabled}
                aria-pressed={selected}
                title={cfg.label}
                className={`px-2 py-1 rounded-md text-xs font-semibold border transition-colors ${
                  selected
                    ? cfg.color + " ring-2 ring-offset-1 ring-gray-300"
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}
              >
                <span aria-hidden className="mr-1">{cfg.icon}</span>
                {cfg.label}
              </button>
            );
          })}
        </div>
        <input
          ref={inputRef}
          data-shortcut="annotate"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={disabled}
          placeholder="Annotate this moment… (Cmd+Enter to focus, Enter to submit)"
          className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
        />
        <button
          onClick={submit}
          disabled={disabled}
          className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
        >
          Flag
        </button>
      </div>
    </div>
  );
}
