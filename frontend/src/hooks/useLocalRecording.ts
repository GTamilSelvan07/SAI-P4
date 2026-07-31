import { useEffect, useRef, useState, useCallback } from "react";
import { BACKEND_PORT } from "../config";

interface UseLocalRecordingOptions {
  sessionId: string;
  role: "P1" | "P2";
  enabled: boolean;
}

type Status = "idle" | "starting" | "recording" | "stopping" | "error";

interface RecordingConfig {
  enabled: boolean;
  mime_type: string;
  fallback_mime_type: string;
  video_bits_per_second: number;
  audio_bits_per_second: number;
  timeslice_ms: number;
  audio_capture_role: "both" | "P1" | "P2" | null;
}

const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  enabled: true,
  mime_type: "video/webm;codecs=vp9,opus",
  fallback_mime_type: "video/webm;codecs=vp8,opus",
  video_bits_per_second: 2_500_000,
  audio_bits_per_second: 128_000,
  timeslice_ms: 1000,
  audio_capture_role: "both",
};
const WS_RECONNECT_DELAY_MS = 2000;
const WS_RECONNECT_MAX_DELAY_MS = 30_000;

function pickMimeType(config: RecordingConfig): string {
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(config.mime_type)) return config.mime_type;
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(config.fallback_mime_type)) return config.fallback_mime_type;
  return "video/webm";
}

async function loadRecordingConfig(): Promise<RecordingConfig> {
  try {
    const res = await fetch("/api/config/recording");
    if (!res.ok) return DEFAULT_RECORDING_CONFIG;
    return { ...DEFAULT_RECORDING_CONFIG, ...(await res.json()) };
  } catch {
    return DEFAULT_RECORDING_CONFIG;
  }
}

function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function opfsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.getDirectory === "function"
  );
}

function backendVideoWsUrl(sessionId: string, role: "P1" | "P2"): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:${BACKEND_PORT}/ws/video/${sessionId}/${role}`;
}

/**
 * Records the participant's local camera to a WebM file. The configured
 * transcription capture role(s) also include audio.
 *
 * Dual sink, zero participant interaction:
 *   1. OPFS (Origin Private File System) — primary, browser-private, no picker.
 *   2. Backend WebSocket /ws/video/{session_id}/{role} — server-side authoritative copy.
 *
 * Uses its own getUserMedia so recording survives LiveKit phase mic-mute.
 * The OPFS file can be exported to the user's Downloads folder after the
 * session ends via exportToDownload() — that requires a user gesture per
 * browser policy.
 *
 * Replaces the May 6 picker-gated design which silently failed when the
 * picker UI wasn't surfaced. See:
 *   docs/superpowers/specs/2026-05-09-video-recording-reliability.md
 */
export function useLocalRecording({ sessionId, role, enabled }: UseLocalRecordingOptions) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [bytesWritten, setBytesWritten] = useState(0);
  const [backupConnected, setBackupConnected] = useState(false);
  const [opfsFilename, setOpfsFilename] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const opfsWritableRef = useRef<FileSystemWritableFileStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimerRef = useRef<number | null>(null);
  const wsReconnectDelayRef = useRef<number>(WS_RECONNECT_DELAY_MS);
  const wsBufferRef = useRef<ArrayBuffer[]>([]);
  const filenameRef = useRef<string>("");
  const stoppedRef = useRef(false);
  const cancelledRef = useRef(false);

  const connectBackup = useCallback(() => {
    if (cancelledRef.current || stoppedRef.current) return;
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(backendVideoWsUrl(sessionId, role));
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        if (cancelledRef.current) {
          try { ws.close(); } catch { /* ignore */ }
          return;
        }
        wsReconnectDelayRef.current = WS_RECONNECT_DELAY_MS;
        setBackupConnected(true);
        const buffered = wsBufferRef.current;
        wsBufferRef.current = [];
        for (const b of buffered) {
          try { ws.send(b); } catch (e) { console.warn("[recording] flush buffered chunk failed:", e); }
        }
      };
      ws.onclose = () => {
        setBackupConnected(false);
        if (cancelledRef.current || stoppedRef.current) return;
        const delay = wsReconnectDelayRef.current;
        wsReconnectDelayRef.current = Math.min(delay * 2, WS_RECONNECT_MAX_DELAY_MS);
        if (wsReconnectTimerRef.current !== null) {
          window.clearTimeout(wsReconnectTimerRef.current);
        }
        wsReconnectTimerRef.current = window.setTimeout(() => {
          wsReconnectTimerRef.current = null;
          connectBackup();
        }, delay);
      };
      ws.onerror = (e) => { console.warn("[recording] backup WS error:", e); };
      wsRef.current = ws;
    } catch (e) {
      console.warn("[recording] backup WS construct failed:", e);
    }
  }, [sessionId, role]);

  const stop = useCallback(async () => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    setStatus("stopping");

    if (wsReconnectTimerRef.current !== null) {
      window.clearTimeout(wsReconnectTimerRef.current);
      wsReconnectTimerRef.current = null;
    }

    try {
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        await new Promise<void>((resolve) => {
          r.addEventListener("stop", () => resolve(), { once: true });
          try { r.stop(); } catch { resolve(); }
        });
      }
    } catch (e) {
      console.warn("[recording] stop error:", e);
    }

    try {
      const w = opfsWritableRef.current;
      if (w) {
        await w.close();
        opfsWritableRef.current = null;
      }
    } catch (e) {
      console.warn("[recording] OPFS writable close error:", e);
    }

    try {
      wsRef.current?.close();
      wsRef.current = null;
    } catch { /* ignore */ }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId || !role) return;

    cancelledRef.current = false;
    stoppedRef.current = false;
    wsReconnectDelayRef.current = WS_RECONNECT_DELAY_MS;

    async function start() {
      setStatus("starting");
      setError(null);

      try {
        const config = await loadRecordingConfig();
        const audioConstraints =
          config.audio_capture_role === "P1" || config.audio_capture_role === "P2"
            ? config.audio_capture_role === role
              ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
              : false
            : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: audioConstraints,
        });
        if (cancelledRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        if (cancelledRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (!config.enabled) {
          stream.getTracks().forEach((t) => t.stop());
          setStatus("idle");
          return;
        }

        const mimeType = pickMimeType(config);
        const filename = `${sessionId}_${role}_${isoTimestamp()}.webm`;
        filenameRef.current = filename;
        setOpfsFilename(filename);

        if (opfsSupported()) {
          try {
            const root = await navigator.storage.getDirectory();
            const fileHandle = await root.getFileHandle(filename, { create: true });
            opfsWritableRef.current = await fileHandle.createWritable();
          } catch (e) {
            console.warn("[recording] OPFS open failed (continuing with backend-only sink):", e);
            opfsWritableRef.current = null;
          }
        } else {
          console.warn("[recording] OPFS not supported in this browser — relying on backend sink only");
        }

        connectBackup();

        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: config.video_bits_per_second,
          audioBitsPerSecond: config.audio_bits_per_second,
        });
        recorderRef.current = recorder;

        recorder.ondataavailable = async (ev: BlobEvent) => {
          if (!ev.data || ev.data.size === 0) return;
          const chunk = ev.data;
          setBytesWritten((b) => b + chunk.size);

          const w = opfsWritableRef.current;
          if (w) {
            try { await w.write(chunk); }
            catch (e) { console.warn("[recording] OPFS write failed:", e); }
          }

          let buf: ArrayBuffer | null = null;
          try { buf = await chunk.arrayBuffer(); }
          catch (e) { console.warn("[recording] chunk -> arrayBuffer failed:", e); }
          if (!buf) return;

          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(buf); }
            catch (e) {
              console.warn("[recording] backup send failed, buffering:", e);
              wsBufferRef.current.push(buf);
            }
          } else {
            wsBufferRef.current.push(buf);
          }
        };

        recorder.onerror = (ev) => {
          console.error("[recording] MediaRecorder error:", ev);
          setError("Recorder error — see console");
          setStatus("error");
        };

        recorder.start(config.timeslice_ms);
        if (cancelledRef.current) {
          try { recorder.stop(); } catch { /* ignore */ }
          return;
        }
        setStatus("recording");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[recording] start failed:", msg);
        if (!cancelledRef.current) {
          setError(msg);
          setStatus("error");
        }
      }
    }

    start();

    return () => {
      cancelledRef.current = true;
      void stop();
    };
  }, [enabled, sessionId, role, stop, connectBackup]);

  /**
   * Export the OPFS recording to the participant's Downloads folder.
   * Must be called from a user gesture (button click) per browser policy.
   */
  const exportToDownload = useCallback(async (): Promise<boolean> => {
    const filename = filenameRef.current;
    if (!filename || !opfsSupported()) return false;
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(filename, { create: false });
      const file = await fileHandle.getFile();
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return true;
    } catch (e) {
      console.warn("[recording] OPFS export failed:", e);
      return false;
    }
  }, []);

  return { status, error, bytesWritten, backupConnected, opfsFilename, stop, exportToDownload };
}
