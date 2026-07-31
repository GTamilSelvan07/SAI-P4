import { useEffect, useState } from "react";

export type ChoiceToastKind =
  | "preference"
  | "decision"
  | "consensus"
  | "divergent"
  | "drift";

export interface ChoiceToastItem {
  id: string;
  kind: ChoiceToastKind;
  text: string;
  createdAt: number;
}

interface ChoiceToastProps {
  toasts: ChoiceToastItem[];
  onDismiss: (id: string) => void;
}

const KIND_STYLE: Record<ChoiceToastKind, string> = {
  preference: "bg-gray-50 border-gray-300 text-gray-800",
  decision: "bg-blue-50 border-blue-300 text-blue-900",
  consensus: "bg-green-50 border-green-300 text-green-900 font-semibold",
  divergent: "bg-amber-50 border-amber-300 text-amber-900",
  drift: "bg-purple-50 border-purple-300 text-purple-900",
};

const DURATIONS_MS: Record<ChoiceToastKind, number> = {
  preference: 6000,
  decision: 6000,
  consensus: 8000,
  divergent: 10000,
  drift: 8000,
};

const MAX_VISIBLE = 3;

export function ChoiceToast({ toasts, onDismiss }: ChoiceToastProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    for (const t of toasts) {
      if (now - t.createdAt > DURATIONS_MS[t.kind]) onDismiss(t.id);
    }
  }, [toasts, now, onDismiss]);

  const visible = toasts.slice(-MAX_VISIBLE);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-72">
      {visible.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`text-left text-sm border rounded-lg px-3 py-2 shadow-md ${KIND_STYLE[t.kind]} hover:opacity-90`}
          aria-live="polite"
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
