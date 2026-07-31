import { useEffect, useState } from "react";

interface RecordingState {
  active: boolean;
  bytes_written: number;
  last_chunk_age_s: number | null;
  first_chunk_at: number | null;
}

interface RecordingStatus {
  P1: RecordingState;
  P2: RecordingState;
}

interface Props {
  sessionId: string;
  pollIntervalMs?: number;
}

const POLL_DEFAULT_MS = 5000;

const EMPTY: RecordingState = {
  active: false,
  bytes_written: 0,
  last_chunk_age_s: null,
  first_chunk_at: null,
};

function dotColor(s: RecordingState): "green" | "amber" | "red" {
  if (!s.active || s.last_chunk_age_s == null) return "red";
  if (s.last_chunk_age_s < 10) return "green";
  if (s.last_chunk_age_s < 30) return "amber";
  return "red";
}

function dotClass(c: "green" | "amber" | "red"): string {
  if (c === "green") return "bg-green-500";
  if (c === "amber") return "bg-amber-500";
  return "bg-red-500";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function tooltip(role: string, s: RecordingState): string {
  if (!s.active) return `${role}: no chunks received yet`;
  const age = s.last_chunk_age_s ?? 0;
  return `${role}: ${fmtBytes(s.bytes_written)} captured · last chunk ${age.toFixed(1)} s ago`;
}

/**
 * Researcher dashboard widget showing per-role video recording health.
 * Polls /api/sessions/{id}/recording_status every 5 s and renders a
 * green/amber/red dot for each participant.
 *
 * Green:  chunk received in the last 10 s — recording healthy.
 * Amber:  chunk received 10–30 s ago — possible network hiccup.
 * Red:    no chunk received in the last 30 s, or recording never started.
 */
export function RecordingIndicator({ sessionId, pollIntervalMs = POLL_DEFAULT_MS }: Props) {
  const [status, setStatus] = useState<RecordingStatus>({ P1: EMPTY, P2: EMPTY });

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/recording_status`);
        if (!res.ok) return;
        const data: RecordingStatus = await res.json();
        if (!cancelled) setStatus(data);
      } catch {
        /* swallow — transient fetch errors are expected on slow networks */
      }
    }

    void tick();
    const id = window.setInterval(tick, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sessionId, pollIntervalMs]);

  const p1Color = dotColor(status.P1);
  const p2Color = dotColor(status.P2);

  return (
    <div className="flex items-center gap-3 text-xs text-gray-600">
      <span className="font-medium uppercase tracking-wider text-[10px] text-gray-500">REC</span>
      <span title={tooltip("P1", status.P1)} className="flex items-center gap-1">
        <span className={`inline-block w-2 h-2 rounded-full ${dotClass(p1Color)}`} aria-hidden="true" />
        <span>P1</span>
      </span>
      <span title={tooltip("P2", status.P2)} className="flex items-center gap-1">
        <span className={`inline-block w-2 h-2 rounded-full ${dotClass(p2Color)}`} aria-hidden="true" />
        <span>P2</span>
      </span>
      {(status.P1.active || status.P2.active) && (
        <span className="text-gray-400">
          {fmtBytes(status.P1.bytes_written + status.P2.bytes_written)}
        </span>
      )}
    </div>
  );
}
