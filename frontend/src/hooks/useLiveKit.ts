import { useEffect, useRef, useState, useCallback } from "react";
import {
  Room,
  RoomEvent,
  Track,
} from "livekit-client";

interface UseLiveKitOptions {
  sessionId: string;
  role: string;
  enabled: boolean;
  initialMicEnabled: boolean;
}

/**
 * LiveKit room hook — replaces useWebRTC + useAudioStream + useVideoRecorder.
 * Single hook handles: video/audio publishing, subscribing, and Alex's audio playback.
 */
export function useLiveKit({ sessionId, role, enabled, initialMicEnabled }: UseLiveKitOptions) {
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Store remote MediaStreams keyed by participant identity — stable references
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  // Track IDs to detect when we need to rebuild a stream
  const remoteTrackIdsRef = useRef<Record<string, string>>({});

  // Mic-state coalescing: only the latest desired state is applied.
  // Prevents out-of-order setMicrophoneEnabled() awaits leaving LiveKit in the wrong state.
  const micApplyingRef = useRef(false);
  const pendingMicRef = useRef<boolean | null>(null);
  const lastAppliedMicRef = useRef<boolean | null>(null);

  const rebuildRemoteStreams = useCallback((room: Room) => {
    // Use functional setState to avoid stale closure on remoteStreams
    setRemoteStreams((prev) => {
      const newStreams: Record<string, MediaStream> = {};
      const newTrackIds: Record<string, string> = {};

      for (const [, participant] of room.remoteParticipants) {
        const identity = participant.identity;
        const trackIds: string[] = [];
        const mediaTracks: MediaStreamTrack[] = [];

        for (const [, pub] of participant.trackPublications) {
          if (pub.track?.mediaStreamTrack) {
            mediaTracks.push(pub.track.mediaStreamTrack);
            trackIds.push(pub.track.sid ?? pub.track.kind);
          }
        }

        const idKey = trackIds.sort().join(",");
        newTrackIds[identity] = idKey;

        // Only create a new MediaStream if tracks actually changed
        if (idKey === remoteTrackIdsRef.current[identity] && prev[identity]) {
          newStreams[identity] = prev[identity]; // reuse existing
        } else if (mediaTracks.length > 0) {
          newStreams[identity] = new MediaStream(mediaTracks);
        }
      }

      remoteTrackIdsRef.current = newTrackIds;
      return newStreams;
    });
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId || !role) return;

    let cancelled = false;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    const onStateChange = () => { if (!cancelled) rebuildRemoteStreams(room); };

    room.on(RoomEvent.Connected, () => { if (!cancelled) setConnected(true); });
    room.on(RoomEvent.Disconnected, () => { if (!cancelled) setConnected(false); });
    room.on(RoomEvent.TrackSubscribed, onStateChange);
    room.on(RoomEvent.TrackUnsubscribed, onStateChange);
    room.on(RoomEvent.ParticipantConnected, onStateChange);
    room.on(RoomEvent.ParticipantDisconnected, onStateChange);

    async function connect() {
      try {
        setError(null); // Clear stale errors on reconnect attempt
        const resp = await fetch(`/api/livekit/token?session_id=${sessionId}&identity=${role}`);
        if (!resp.ok) { setError(`Token fetch failed: ${resp.status}`); return; }
        const { token } = await resp.json();
        if (!token) { setError("Empty token from server"); return; }
        if (cancelled) return;

        // Connect via Vite proxy (/rtc → LiveKit) so remote clients
        // use the same HTTPS origin they're already on.
        const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const lkUrl = `${wsProto}//${window.location.host}`;
        await room.connect(lkUrl, token);
        if (cancelled) { await room.disconnect(); return; }

        // Enable camera always, but mic only if backend says it should be open
        await room.localParticipant.setCameraEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(initialMicEnabled);

        // Build local stream for self-view
        for (const [, pub] of room.localParticipant.trackPublications) {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.track.mediaStreamTrack) {
            setLocalStream(new MediaStream([pub.track.mediaStreamTrack]));
            break;
          }
        }

        rebuildRemoteStreams(room);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "LiveKit connection failed");
      }
    }

    connect();

    return () => {
      cancelled = true;
      room.removeAllListeners();
      room.disconnect();
      roomRef.current = null;
      setConnected(false);
      setLocalStream(null);
      setRemoteStreams({});
      remoteTrackIdsRef.current = {};
      micApplyingRef.current = false;
      pendingMicRef.current = null;
      lastAppliedMicRef.current = null;
    };
  }, [enabled, sessionId, role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mute/unmute local mic. Coalesces concurrent calls so only the latest target wins.
  const setMicEnabled = useCallback(async (micEnabled: boolean) => {
    pendingMicRef.current = micEnabled;
    if (micApplyingRef.current) return; // an in-flight apply will pick up the latest value
    micApplyingRef.current = true;
    try {
      while (pendingMicRef.current !== null) {
        const target = pendingMicRef.current;
        pendingMicRef.current = null;
        if (lastAppliedMicRef.current === target) continue; // no-op
        const room = roomRef.current;
        if (!room) break;
        try {
          await room.localParticipant.setMicrophoneEnabled(target);
          lastAppliedMicRef.current = target;
        } catch (err) {
          console.warn(`[LiveKit] setMicEnabled(${target}) failed:`, err);
          break;
        }
      }
    } finally {
      micApplyingRef.current = false;
    }
  }, []);

  return {
    connected,
    localStream,
    remoteStreams,
    setMicEnabled,
    error,
  };
}
