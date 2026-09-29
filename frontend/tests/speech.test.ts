import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSpeechAudio, pcmToAudioBuffer, validateLipSync } from "../src/avatar/speech";

function audioContext() {
  const decoded = { sampleRate: 22050 } as AudioBuffer;
  const createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => {
    const samples = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;
  });
  const decodeAudioData = vi.fn(async (_data: ArrayBuffer) => decoded);
  return {
    context: { createBuffer, decodeAudioData } as unknown as BaseAudioContext,
    createBuffer,
    decodeAudioData,
    decoded,
  };
}

const wordTimings = { words: ["Hello", "Alex"], wtimes: [0, 420], wdurations: [350, 300] };

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PCM16 audio contract", () => {
  it.each([16000, 22050, 24000])("decodes little-endian signed samples at the native %i Hz rate", (rate) => {
    const { context, createBuffer } = audioContext();
    // Explicit bytes catch both endianness errors and unsigned interpretation.
    const pcm = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0x00, 0x40, 0x00, 0xc0]);
    const audio = pcmToAudioBuffer(context, pcm.buffer, rate);

    expect(createBuffer).toHaveBeenCalledWith(1, 5, rate);
    expect(audio.sampleRate).toBe(rate);
    expect(Array.from(audio.getChannelData(0))).toEqual([-1, 32767 / 32768, 0, 0.5, -0.5]);
  });

  it.each([0, NaN, Infinity, 7999, 96001, 22050.5])("rejects invalid sample rate %s", (rate) => {
    expect(() => pcmToAudioBuffer(audioContext().context, new ArrayBuffer(2), rate)).toThrow("sample rate");
  });

  it.each([0, 1, 3])("rejects a malformed %i-byte PCM payload", (length) => {
    expect(() => pcmToAudioBuffer(audioContext().context, new ArrayBuffer(length), 24000)).toThrow("PCM16");
  });
});

describe("lip-sync validation", () => {
  it("retains valid backend words and visemes without changing millisecond timings", () => {
    const input = { ...wordTimings, visemes: ["PP", "aa", "sil"], vtimes: [0, 120, 700], vdurations: [120, 580, 40] };
    expect(validateLipSync(input)).toEqual(input);
  });

  it.each([
    { visemes: [], vtimes: [], vdurations: [] },
    { visemes: ["unknown"], vtimes: [0], vdurations: [100] },
    { visemes: ["aa"], vtimes: [], vdurations: [100] },
    { visemes: ["aa"], vtimes: [-1], vdurations: [100] },
    { visemes: ["aa"], vtimes: [0], vdurations: [Infinity] },
  ])("omits unusable visemes to permit TalkingHead's word-timing fallback (%j)", (visemes) => {
    const validated = validateLipSync({ ...wordTimings, ...visemes });
    expect(validated).toEqual(wordTimings);
    expect(validated).not.toHaveProperty("visemes");
    expect(validated).not.toHaveProperty("vtimes");
    expect(validated).not.toHaveProperty("vdurations");
  });

  it.each([
    null,
    {},
    { ...wordTimings, words: [] },
    { ...wordTimings, words: ["Hello", 1] },
    { ...wordTimings, wtimes: [0] },
    { ...wordTimings, wtimes: [0, NaN] },
    { ...wordTimings, wdurations: [350, -1] },
  ])("rejects invalid word timing metadata (%j)", (input) => {
    expect(validateLipSync(input)).toBeNull();
  });
});

describe("speech audio loading", () => {
  it("prefers same-origin PCM and the frame's engine sample rate over embedded WAV", async () => {
    const { context, decodeAudioData } = audioContext();
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([0, 64, 0, 192])));
    const controller = new AbortController();
    const audio = await loadSpeechAudio(context, {
      text: "Hello",
      audio_url: "/api/sessions/session/utterances/utterance.pcm",
      audio_sample_rate: 24000,
      audio: btoa("WAV fallback"),
    }, controller.signal);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("http://localhost:5173/api/sessions/session/utterances/utterance.pcm");
    expect(options?.cache).toBe("no-store");
    expect(options?.signal?.aborted).toBe(false);
    expect(audio?.sampleRate).toBe(24000);
    expect(Array.from(audio!.getChannelData(0))).toEqual([0.5, -0.5]);
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it("falls back to WAV decoding if the PCM cache entry has expired (404)", async () => {
    const { context, decoded, decodeAudioData } = audioContext();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    const wavBytes = new Uint8Array([82, 73, 70, 70, 0, 255]);
    const audio = await loadSpeechAudio(context, {
      text: "Hello",
      audio_url: "/api/sessions/session/utterances/expired.pcm",
      audio: btoa(String.fromCharCode(...wavBytes)),
      audio_sample_rate: 24000,
    }, new AbortController().signal);

    expect(audio).toBe(decoded);
    expect(decodeAudioData).toHaveBeenCalledOnce();
    expect(new Uint8Array(decodeAudioData.mock.calls[0][0])).toEqual(wavBytes);
    // The WAV decoder determines its actual rate; a PCM frame rate is not applied.
    expect(audio?.sampleRate).toBe(22050);
  });

  it("uses WAV when PCM has no valid sample rate", async () => {
    const { context, decoded } = audioContext();
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([0, 0])));
    await expect(loadSpeechAudio(context, {
      text: "Hello", audio_url: "/api/sessions/session/utterances/u.pcm", audio: btoa("WAV"),
    }, new AbortController().signal)).resolves.toBe(decoded);
  });

  it("does not make cross-origin audio requests", async () => {
    const { context } = audioContext();
    await expect(loadSpeechAudio(context, {
      text: "Hello", audio_url: "https://another-server.example/api/sessions/session/utterances/u.pcm",
      audio_sample_rate: 24000,
    }, new AbortController().signal)).rejects.toThrow("must belong to this server");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("propagates cancellation without decoding the fallback WAV", async () => {
    const { context, decodeAudioData } = audioContext();
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(loadSpeechAudio(context, {
      text: "Hello", audio_url: "/api/sessions/session/utterances/u.pcm", audio: btoa("WAV"),
    }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it("returns no audio for caption-only frames", async () => {
    const { context, decodeAudioData } = audioContext();
    await expect(loadSpeechAudio(context, { text: "Caption only" }, new AbortController().signal)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(decodeAudioData).not.toHaveBeenCalled();
  });
  it("uses the WAV fallback after an HTTP timeout without treating it as session cancellation", async () => {
    vi.useFakeTimers();
    try {
      const { context, decoded } = audioContext();
      vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options!.signal!.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
      }));
      const controller = new AbortController();
      const loading = loadSpeechAudio(context, {
        text: "Fallback", audio_url: "/api/sessions/s/utterances/u.pcm", audio: btoa("WAV"),
      }, controller.signal);
      await vi.advanceTimersByTimeAsync(10000);
      await expect(loading).resolves.toBe(decoded);
      expect(controller.signal.aborted).toBe(false);
    } finally { vi.useRealTimers(); }
  });

});
