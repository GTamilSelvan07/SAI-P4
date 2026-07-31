import { useEffect, useRef, useCallback, useState } from "react";
import type { WSMessage } from "../types";
import { wsUrl } from "../config";

interface UseWebSocketOptions {
  sessionId: string;
  role: string;
  onMessage?: (msg: WSMessage) => void;
}

export function useWebSocket({ sessionId, role, onMessage }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Use ref for callback to avoid reconnect on callback identity change
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  useEffect(() => {
    if (!sessionId || !role) {
      console.log(`[WS] Skipping — sessionId="${sessionId}" role="${role}"`);
      return;
    }

    const url = wsUrl(`/ws/${sessionId}/${role}`);
    console.log(`[WS] Connecting to ${url}`);
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log(`[WS] CONNECTED to ${url}`);
      setConnected(true);
      reconnectAttemptsRef.current = 0;
    };
    ws.onclose = (event) => {
      console.log(`[WS] CLOSED code=${event.code} reason="${event.reason}" url=${url}`);
      setConnected(false);
      // Auto-reconnect unless intentionally closed (1000)
      // 4004 = session not found — retry because researcher may not have created it yet
      if (event.code !== 1000) {
        const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 10000);
        reconnectAttemptsRef.current++;
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
        reconnectTimeoutRef.current = setTimeout(() => {
          setReconnectCount((n) => n + 1);
        }, delay);
      }
    };
    ws.onerror = (event) => {
      console.error(`[WS] ERROR on ${url}`, event);
      setConnected(false);
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        console.log(`[WS] MSG ${msg.type}`, msg.data);
        onMessageRef.current?.(msg);
      } catch (e) {
        console.warn(`[WS] Bad message:`, event.data, e);
      }
    };

    wsRef.current = ws;

    return () => {
      console.log(`[WS] Cleanup — closing ${url}`);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      ws.close(1000);
      wsRef.current = null;
    };
  }, [sessionId, role, reconnectCount]);

  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log(`[WS] SEND ${msg.type}`, msg.data);
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.warn(`[WS] Can't send — not connected. readyState=${wsRef.current?.readyState}`);
    }
  }, []);

  return { connected, send };
}
