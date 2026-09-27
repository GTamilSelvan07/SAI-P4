import { loadSpeechAudio, validateLipSync } from "./speech";
import type { AlexSpeech, LipSync } from "./speech";

export interface SpeechRenderer {
  audioContext: AudioContext;
  speak(audio: AudioBuffer, lipsync: LipSync | null): void;
  stop(): void;
}

interface PlayerCallbacks {
  onStart(speech: AlexSpeech): void;
  onEnd(speech: AlexSpeech): void;
  onBlocked(blocked: boolean): void;
  onError(message: string | null): void;
}

/** One audible source, FIFO utterances, no synthetic 15-second end timer. */
export class SpeechPlayer {
  private queue: AlexSpeech[] = [];
  private seen = new Set<string>();
  private renderer: SpeechRenderer | null = null;
  private fallbackContext: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private current: AlexSpeech | null = null;
  private abort: AbortController | null = null;
  private busy = false;
  private generation = 0;
  private disposed = false;

  constructor(private callbacks: PlayerCallbacks, private createContext = () => new AudioContext()) {}

  attachRenderer(renderer: SpeechRenderer | null) {
    // The component cancels playback before disposing the previous renderer.
    this.renderer = renderer;
    void this.drain();
  }

  enqueue(speech: AlexSpeech) {
    if (this.disposed || speech.condition === "C0") return;
    if (speech.utterance_id) {
      if (this.seen.has(speech.utterance_id)) return;
      this.seen.add(speech.utterance_id);
      // Bound duplicate protection to recent utterances, like the backend cache.
      if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    }
    this.queue.push(speech);
    void this.drain();
  }

  private context() {
    if (this.renderer) return this.renderer.audioContext;
    if (!this.fallbackContext || this.fallbackContext.state === "closed") this.fallbackContext = this.createContext();
    return this.fallbackContext;
  }

  /** Call directly inside a click/key handler to satisfy browser autoplay. */
  unlock() {
    if (this.disposed) return;
    try {
      const contexts = new Set([this.context(), this.fallbackContext].filter((ctx): ctx is AudioContext => !!ctx));
      for (const ctx of contexts) {
        if (ctx.state !== "closed") void ctx.resume().then(() => {
          if (this.disposed) return;
          this.callbacks.onBlocked(false);
          void this.drain();
        }).catch(() => this.callbacks.onBlocked(true));
      }
    } catch {
      this.callbacks.onError("Audio is unavailable in this browser. Alex’s captions are still shown.");
    }
  }

  private async drain() {
    if (this.busy || this.disposed || !this.queue.length) return;
    const generation = this.generation;
    const speech = this.queue[0];
    this.busy = true;
    const abort = new AbortController();
    this.abort = abort;
    let started = false;
    let source: AudioBufferSourceNode | null = null;
    try {
      // No-audio messages retain captions without generating false onset events.
      if (!speech.audio_url && !speech.audio) { this.queue.shift(); return; }
      const ctx = this.context();
      if (ctx.state !== "running") {
        this.callbacks.onBlocked(true);
        return; // Keep FIFO intact until a user gesture resumes this context.
      }
      const audio = await loadSpeechAudio(ctx, speech, abort.signal);
      if (generation !== this.generation || this.disposed) return;
      if (ctx.state !== "running") { this.callbacks.onBlocked(true); return; }
      this.queue.shift();
      if (!audio) return;
      source = ctx.createBufferSource();
      source.buffer = audio;
      source.connect(ctx.destination);
      const activeSource = source;
      source.onended = () => {
        if (this.source !== activeSource) return;
        activeSource.disconnect();
        this.source = null;
        this.current = null;
        this.stopAnimation();
        this.busy = false;
        this.callbacks.onEnd(speech);
        void this.drain();
      };
      // The audible source owns completion, including silent trailing samples.
      // TalkingHead animates a muted copy on the very same AudioContext clock.
      source.start();
      started = true;
      this.source = source;
      this.current = speech;
      if (this.renderer?.audioContext === ctx) {
        try { this.renderer.speak(audio, validateLipSync(speech.lipsync)); }
        catch (error) { console.warn("[Alex] Animation unavailable; audio continues.", error); }
      }
      this.callbacks.onBlocked(false);
      this.callbacks.onError(null);
      this.callbacks.onStart(speech);
    } catch (error) {
      if (generation === this.generation && !this.disposed) {
        if (this.queue[0] === speech) this.queue.shift();
        this.callbacks.onError("Alex’s audio could not be played. The message is available in the transcript.");
        console.warn("[Alex] Playback failed", error);
      }
    } finally {
      if (!started && source) { source.onended = null; source.disconnect(); }
      if (generation === this.generation) {
        this.abort = null;
        if (!started) {
          this.busy = false;
          // Do not spin while autoplay is blocked.
          if (this.queue[0] !== speech) void this.drain();
        }
      }
    }
  }

  private stopAnimation() {
    try { this.renderer?.stop(); }
    catch (error) { console.warn("[Alex] Animation cleanup failed", error); }
  }

  stop() {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.queue = [];
    const source = this.source;
    this.source = null;
    if (source) { source.onended = null; source.stop(); source.disconnect(); }
    this.stopAnimation();
    const speech = this.current;
    this.current = null;
    this.busy = false;
    this.callbacks.onBlocked(false);
    if (speech) this.callbacks.onEnd(speech);
  }

  dispose() {
    this.stop();
    this.disposed = true;
    this.renderer = null;
    if (this.fallbackContext && this.fallbackContext.state !== "closed") void this.fallbackContext.close();
    this.fallbackContext = null;
    this.seen.clear();
  }
}
