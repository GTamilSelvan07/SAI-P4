import { useEffect, useState } from "react";
import type { AICaption } from "../../types";

interface AICaptionStripProps {
  caption: AICaption | null;
  fadeAfterMs?: number;
}

export function AICaptionStrip({ caption, fadeAfterMs = 8000 }: AICaptionStripProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!caption?.text) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), fadeAfterMs);
    return () => clearTimeout(t);
  }, [caption, fadeAfterMs]);

  return (
    <div
      className={`w-full transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`}
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2 flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-purple-700 shrink-0">AI</span>
        <p className="text-sm text-purple-900 italic line-clamp-2">{caption?.text ?? ""}</p>
      </div>
    </div>
  );
}
