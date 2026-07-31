import { useRef, useEffect } from "react";
import type { MicState } from "../../types";

interface VideoFeedProps {
  role: string;
  label: string;
  speaking: boolean;
  micState: MicState;
  isSelf?: boolean;
  status?: string;
  accentColor?: "blue" | "teal";
  stream?: MediaStream | null;
  audioEnabled?: boolean;
  showMicState?: boolean;
}

export function VideoFeed({
  label, speaking, micState, isSelf, status, accentColor = "blue", stream, audioEnabled = false, showMicState = true,
}: VideoFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const borderColor = accentColor === "blue" ? "border-blue-400" : "border-teal-400";
  const bgColor = accentColor === "blue" ? "bg-blue-50" : "bg-teal-50";
  const textColor = accentColor === "blue" ? "text-blue-700" : "text-teal-700";
  const shouldMute = isSelf || !audioEnabled;

  // Only set srcObject when the stream reference actually changes
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream && el.srcObject !== stream) {
      el.srcObject = stream;
      el.muted = shouldMute;
      el.play().then(() => {
        el.muted = shouldMute;
      }).catch(() => {
        // Autoplay blocked — retry on next user click.
        const unlock = () => {
          el.play().then(() => { el.muted = shouldMute; }).catch(() => {});
          document.removeEventListener("click", unlock);
        };
        document.addEventListener("click", unlock, { once: true });
      });
    } else if (stream) {
      el.muted = shouldMute;
    } else if (!stream) {
      el.srcObject = null;
    }
  }, [stream, shouldMute]);

  return (
    <div
      className={`bg-white rounded-xl border-2 ${speaking ? `${borderColor} speaking-ring` : "border-gray-200"} overflow-hidden ${showMicState && micState === "muted" ? "opacity-60" : ""}`}
    >
      {/* Video area */}
      <div className={`relative aspect-video ${bgColor}`}>
        {stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={shouldMute}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className={`text-4xl font-bold ${textColor} opacity-40`}>
              {label.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        {showMicState && micState === "muted" && (
          <div className="absolute top-2 right-2 bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full border border-red-200">
            Muted
          </div>
        )}
        {speaking && (
          <div className="absolute bottom-2 left-2 bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full border border-green-200">
            Speaking
          </div>
        )}
      </div>
      {/* Label */}
      <div className="px-3 py-2 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-900">
            {label} {isSelf && <span className="text-gray-400">(You)</span>}
          </span>
          {status && <span className="text-xs text-gray-500">{status}</span>}
        </div>
      </div>
    </div>
  );
}
