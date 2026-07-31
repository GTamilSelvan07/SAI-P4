import { useEffect, useRef, useCallback, useState } from "react";
import { wsUrl } from "../config";

const SAMPLE_RATE = 16000;

interface UseAudioStreamOptions {
  sessionId: string;
  role: string;
  enabled: boolean;
}

/**
 * Captures mic audio, resamples to 16kHz mono PCM16,
 * and streams to the backend via binary WebSocket.
 * Uses AudioWorklet (replaces deprecated ScriptProcessorNode).
 */
export function useAudioStream({
  sessionId,
  role,
  enabled,
}: UseAudioStreamOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (!sessionId || !role || !enabled) return;

    try {
      // Get mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Audio processing
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      contextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);

      // WebSocket connection
      const url = wsUrl(`/ws/audio/${sessionId}/${role}`);
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = async () => {
        setActive(true);
        setError(null);

        try {
          // Use AudioWorklet for PCM conversion
          await audioContext.audioWorklet.addModule("/audio-worklet-processor.js");
          const workletNode = new AudioWorkletNode(audioContext, "pcm16-processor");

          workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(event.data);
            }
          };

          const silentSink = audioContext.createGain();
          silentSink.gain.value = 0;
          source.connect(workletNode);
          workletNode.connect(silentSink);
          silentSink.connect(audioContext.destination);
        } catch {
          // Fallback to ScriptProcessor if AudioWorklet unavailable
          const processor = audioContext.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (event) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const input = event.inputBuffer.getChannelData(0);
            const pcm16 = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
              const s = Math.max(-1, Math.min(1, input[i]));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            ws.send(pcm16.buffer);
          };
          const silentSink = audioContext.createGain();
          silentSink.gain.value = 0;
          source.connect(processor);
          processor.connect(silentSink);
          silentSink.connect(audioContext.destination);
        }
      };

      ws.onclose = () => setActive(false);
      ws.onerror = () => setError("Audio WebSocket connection failed");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to access microphone"
      );
    }
  }, [sessionId, role, enabled]);

  const stop = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (contextRef.current) {
      contextRef.current.close();
      contextRef.current = null;
    }
    setActive(false);
  }, []);

  useEffect(() => {
    if (enabled) {
      start();
    } else {
      stop();
    }
    return stop;
  }, [enabled, start, stop]);

  return { active, error, stop };
}
