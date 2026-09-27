/** Server-side HeadTTS → speech_frame.py → participant browser contract. */
export interface LipSync {
  words: string[];
  wtimes: number[];
  wdurations: number[];
  visemes?: string[];
  vtimes?: number[];
  vdurations?: number[];
}

export interface AlexSpeech {
  text: string;
  utterance_id?: string;
  audio_url?: string | null;
  audio?: string | null;
  audio_sample_rate?: number;
  lipsync?: LipSync | null;
  condition?: string | null;
  source?: string;
  slot?: string;
}

const VISEMES = new Set(["aa", "E", "I", "O", "U", "PP", "SS", "TH", "CH", "FF", "kk", "nn", "RR", "DD", "sil"]);

function validTimes(values: unknown, length: number): values is number[] {
  return Array.isArray(values) && values.length === length
    && values.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
}

/** Invalid animation metadata must never prevent speech playback. */
export function validateLipSync(value: unknown): LipSync | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const words = v.words;
  if (!Array.isArray(words) || !words.length || !words.every((w) => typeof w === "string")
    || !validTimes(v.wtimes, words.length) || !validTimes(v.wdurations, words.length)) return null;
  const result: LipSync = { words, wtimes: v.wtimes, wdurations: v.wdurations };
  // Omit empty arrays: TalkingHead treats [] as supplied visemes and will not
  // derive mouth shapes from valid word timings unless this field is absent.
  if (Array.isArray(v.visemes) && v.visemes.length
    && v.visemes.every((s) => typeof s === "string" && VISEMES.has(s))
    && validTimes(v.vtimes, v.visemes.length) && validTimes(v.vdurations, v.visemes.length)) {
    result.visemes = v.visemes;
    result.vtimes = v.vtimes;
    result.vdurations = v.vdurations;
  }
  return result;
}

export function pcmToAudioBuffer(ctx: BaseAudioContext, pcm: ArrayBuffer, sampleRate: number): AudioBuffer {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    throw new Error("Alex audio has an invalid sample rate.");
  }
  if (!pcm.byteLength || pcm.byteLength % 2) throw new Error("Alex audio is not valid PCM16.");
  const buffer = ctx.createBuffer(1, pcm.byteLength / 2, sampleRate);
  const samples = buffer.getChannelData(0);
  const view = new DataView(pcm);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return buffer;
}

/** Prefer native-rate PCM; evicted URLs and old servers can use the WAV copy. */
export async function loadSpeechAudio(
  ctx: BaseAudioContext,
  speech: AlexSpeech,
  signal: AbortSignal,
): Promise<AudioBuffer | null> {
  if (speech.audio_url) {
    try {
      const url = new URL(speech.audio_url, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/sessions/")) {
        throw new Error("Alex audio URL must belong to this server.");
      }
      const response = await fetch(url, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Alex audio fetch failed (${response.status}).`);
      return pcmToAudioBuffer(ctx, await response.arrayBuffer(), speech.audio_sample_rate ?? NaN);
    } catch (error) {
      if (signal.aborted || !speech.audio) throw error;
    }
  }
  if (!speech.audio) return null;
  signal.throwIfAborted();
  const wav = Uint8Array.from(atob(speech.audio), (c) => c.charCodeAt(0));
  return ctx.decodeAudioData(wav.buffer);
}
