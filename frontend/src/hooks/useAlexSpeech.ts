import { useCallback, useEffect, useRef, useState } from "react";
import { SpeechPlayer } from "../avatar/SpeechPlayer";
import type { SpeechRenderer } from "../avatar/SpeechPlayer";
import type { AlexSpeech } from "../avatar/speech";
import type { WSMessage } from "../types";

export function useAlexSpeech(sessionId: string, report: (message: WSMessage) => void) {
  const playerRef = useRef<SpeechPlayer | null>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  const [speaking, setSpeaking] = useState(false);
  const [text, setText] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    setSpeaking(false);
    setText("");
    setAudioError(null);
    const marker = (type: string, speech: AlexSpeech) => {
      if (speech.utterance_id) reportRef.current({ type, data: {
        utterance_id: speech.utterance_id, client_ts: Date.now() / 1000,
      } });
    };
    const player = new SpeechPlayer({
      onStart: (speech) => { setSpeaking(true); setText(speech.text); marker("avatar_speech_started", speech); },
      onEnd: (speech) => { setSpeaking(false); marker("avatar_speech_ended", speech); },
      onBlocked: setAudioBlocked,
      onError: setAudioError,
    });
    playerRef.current = player;
    const unlock = () => player.unlock();
    // Also unlock before the first utterance when participants interact with
    // task controls. Web Audio still needs a gesture, even when using HTTP PCM.
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      player.dispose();
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [sessionId]);

  const enqueue = useCallback((speech: AlexSpeech) => playerRef.current?.enqueue(speech), []);
  const stop = useCallback(() => playerRef.current?.stop(), []);
  const unlock = useCallback(() => playerRef.current?.unlock(), []);
  const attachRenderer = useCallback((renderer: SpeechRenderer | null) => {
    if (!renderer) playerRef.current?.stop();
    playerRef.current?.attachRenderer(renderer);
  }, []);

  return { speaking, text, audioBlocked, audioError, enqueue, stop, unlock, attachRenderer };
}
