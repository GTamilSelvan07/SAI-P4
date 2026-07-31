/**
 * Frontend configuration. Backend port is configurable via VITE_BACKEND_PORT env var.
 */
export const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT || "8000";

export function wsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  // In dev, connect through Vite proxy (same origin) to avoid self-signed cert issues
  return `${protocol}//${window.location.host}${path}`;
}
