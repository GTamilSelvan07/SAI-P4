import { useState, useEffect } from "react";

/**
 * Countdown timer that syncs with server-provided remaining time.
 * Uses offset-from-sync-point approach to prevent cumulative drift.
 */
export function useTimer(serverRemaining: number | null, paused: boolean | null) {
  const [remaining, setRemaining] = useState(0);
  // Track the last server sync as state (not ref) so useEffect triggers correctly
  const [syncPoint, setSyncPoint] = useState<{ remaining: number; receivedAt: number } | null>(null);

  // Sync with server value
  useEffect(() => {
    if (serverRemaining !== null) {
      setSyncPoint({ remaining: serverRemaining, receivedAt: Date.now() / 1000 });
      setRemaining(serverRemaining);
    }
  }, [serverRemaining]);

  // Local countdown based on offset from last server sync (no cumulative drift)
  useEffect(() => {
    if (paused || !syncPoint) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() / 1000 - syncPoint.receivedAt;
      setRemaining(Math.max(0, syncPoint.remaining - elapsed));
    }, 200); // 5x/sec for smooth display

    return () => clearInterval(interval);
  }, [paused, syncPoint]);

  const minutes = Math.floor(remaining / 60);
  const seconds = Math.floor(remaining % 60);
  const display = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return { remaining, display };
}
