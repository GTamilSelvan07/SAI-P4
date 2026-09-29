import { useEffect, useRef, useState } from "react";
import type { SpeechRenderer } from "../../avatar/SpeechPlayer";
import type { TalkingHeadRenderer } from "../../avatar/talkingHead";

interface AlexPanelProps {
  status: "listening" | "speaking" | "monitoring" | "hidden";
  text?: string;
  onRenderer: (renderer: SpeechRenderer | null) => void;
  audioBlocked?: boolean;
  onEnableAudio?: () => void;
}

const MODEL_URL = import.meta.env.VITE_ALEX_MODEL_URL || "/avatars/alex.glb";

/** Visual presentation only. The room owns speech, captions and telemetry. */
export function AlexAvatar({ status, text, onRenderer, audioBlocked, onEnableAudio }: AlexPanelProps) {
  const container = useRef<HTMLDivElement>(null);
  const [modelState, setModelState] = useState<"loading" | "ready" | "unavailable">("loading");
  const visible = status !== "hidden";

  useEffect(() => {
    if (!visible || !container.current) return;
    const abort = new AbortController();
    // Own a child container so a late StrictMode load cannot remove the next
    // renderer's canvas when it finishes cleaning up.
    const stage = document.createElement("div");
    stage.className = "absolute inset-0";
    container.current.append(stage);
    let renderer: TalkingHeadRenderer | undefined;
    setModelState("loading");
    const timeout = window.setTimeout(() => {
      abort.abort();
      setModelState("unavailable");
    }, 20000);
    void import("../../avatar/talkingHead").then(({ createTalkingHeadRenderer }) =>
      createTalkingHeadRenderer(stage, {
        modelUrl: MODEL_URL,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        signal: abort.signal,
      }),
    ).then((loaded) => {
      if (abort.signal.aborted) { loaded.dispose(); return; }
      renderer = loaded;
      onRenderer(renderer);
      setModelState("ready");
    }).catch((error) => {
      if (!abort.signal.aborted) {
        console.warn("[Alex] 3D avatar unavailable; keeping audio and captions.", error);
        setModelState("unavailable");
      }
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      abort.abort();
      if (renderer) {
        onRenderer(null); // Cancel audible sources before closing the context.
        renderer.dispose();
      }
      stage.remove();
    };
  }, [visible, onRenderer]);

  if (!visible) return null;
  const speaking = status === "speaking";
  const label = speaking ? "Speaking" : status === "monitoring" ? "Monitoring" : "Listening";

  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50" aria-label="Alex, AI facilitator">
      <div className="relative h-64 overflow-hidden bg-[#edece7] sm:h-72">
        <div ref={container} className="absolute inset-0" role="img" aria-label="3D avatar of Alex" />
        {modelState !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-stone-500" role="status">
            <svg width="88" height="104" viewBox="0 0 88 104" fill="none" aria-hidden="true">
              <circle cx="44" cy="31" r="22" fill="#c7cac4" />
              <path d="M8 100V88c0-22 16-36 36-36s36 14 36 36v12" fill="#c7cac4" />
            </svg>
            <span className="text-xs">{modelState === "loading" ? "Getting Alex ready…" : "Alex is available by voice and captions"}</span>
          </div>
        )}
        <span className="absolute left-3 top-3 rounded bg-stone-50/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-stone-600">AI facilitator</span>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-stone-200 px-4 py-3">
        <span className="text-sm font-semibold text-stone-900">Alex</span>
        <span className="flex items-center gap-2 text-xs text-stone-600" role="status">
          <span className={`h-2 w-2 rounded-full ${speaking ? "bg-emerald-600" : "bg-stone-400"}`} aria-hidden="true" />
          {label}
        </span>
      </div>
      {audioBlocked && (
        <button onClick={onEnableAudio} className="m-3 mt-0 w-[calc(100%-1.5rem)] rounded-lg bg-stone-800 px-3 py-2 text-xs font-medium text-white hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700">
          Enable Alex’s audio
        </button>
      )}
      {speaking && text && <p className="border-t border-stone-200 px-4 py-3 text-sm leading-relaxed text-stone-700">{text}</p>}
    </section>
  );
}
