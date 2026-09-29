import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechPlayer } from "../src/avatar/SpeechPlayer";
import type { SpeechRenderer } from "../src/avatar/SpeechPlayer";
import type { AlexSpeech } from "../src/avatar/speech";

// These doubles only provide the Web Audio operations the player owns. There is
// no timer-driven fake completion: each test explicitly ends the audible source.
class AudioSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  playing = false;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn(() => { this.playing = true; });
  stop = vi.fn(() => { this.playing = false; });
  finish() {
    this.playing = false;
    this.onended?.();
  }
}

class AudioContextDouble {
  currentTime = 12.5;
  state: AudioContextState = "running";
  destination = {};
  sources: AudioSource[] = [];
  decoded = { sampleRate: 24000, duration: 30 } as AudioBuffer;
  decodeAudioData = vi.fn(async (_bytes: ArrayBuffer) => this.decoded);
  createBuffer = vi.fn((_channels: number, length: number, sampleRate: number) => {
    const samples = new Float32Array(length);
    return { sampleRate, length, getChannelData: () => samples } as unknown as AudioBuffer;
  });
  createBufferSource = vi.fn(() => {
    const source = new AudioSource();
    this.sources.push(source);
    return source;
  });
  resume = vi.fn(async () => { this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
  asContext() { return this as unknown as AudioContext; }
}

function speech(id: string, extra: Partial<AlexSpeech> = {}): AlexSpeech {
  return { text: `Utterance ${id}`, utterance_id: id, audio: btoa("WAV"), condition: "C3", ...extra };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const players: SpeechPlayer[] = [];

function setup(state: AudioContextState = "running") {
  const context = new AudioContextDouble();
  context.state = state;
  const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onBlocked: vi.fn(), onError: vi.fn() };
  const createContext = vi.fn(() => context.asContext());
  const player = new SpeechPlayer(callbacks, createContext);
  players.push(player);
  return { context, callbacks, createContext, player };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const player of players.splice(0)) player.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SpeechPlayer", () => {
  it("plays utterances FIFO without overlapping sources and deduplicates repeated IDs", async () => {
    const { context, callbacks, player } = setup();
    const first = speech("first");
    const second = speech("second");
    player.enqueue(first);
    player.enqueue(first);
    player.enqueue(second);
    player.enqueue(second);
    await settle();

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].playing).toBe(true);
    expect(callbacks.onStart.mock.calls.map(([frame]) => frame.utterance_id)).toEqual(["first"]);
    context.sources[0].finish();
    await settle();

    expect(context.sources).toHaveLength(2);
    expect(context.sources.filter((source) => source.playing)).toHaveLength(1);
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(callbacks.onEnd).toHaveBeenCalledWith(first);
    expect(callbacks.onStart.mock.calls.map(([frame]) => frame.utterance_id)).toEqual(["first", "second"]);
    context.sources[1].finish();
    player.enqueue(first);
    player.enqueue(second);
    await settle();

    expect(context.sources).toHaveLength(2);
    expect(callbacks.onEnd.mock.calls.map(([frame]) => frame.utterance_id)).toEqual(["first", "second"]);
  });

  it("reports start only once audio starts and end only from the audible source's real onended", async () => {
    const { context, callbacks, player } = setup();
    const decoding = deferred<AudioBuffer>();
    context.decodeAudioData.mockReturnValueOnce(decoding.promise);
    const frame = speech("boundaries");
    player.enqueue(frame);
    await settle();
    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);

    callbacks.onStart.mockImplementation(() => {
      expect(context.sources[0].start).toHaveBeenCalledOnce();
    });
    decoding.resolve(context.decoded);
    await settle();
    expect(callbacks.onStart).toHaveBeenCalledExactlyOnceWith(frame);
    await vi.advanceTimersByTimeAsync(60000);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    expect(context.sources[0].playing).toBe(true);

    context.sources[0].finish();
    expect(callbacks.onEnd).toHaveBeenCalledExactlyOnceWith(frame);
    // A late duplicate native callback must not emit another end event.
    context.sources[0].finish();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
  });

  it("keeps blocked autoplay speech in FIFO order and replays it after a user unlock", async () => {
    const { context, callbacks, player } = setup("suspended");
    player.enqueue(speech("first"));
    player.enqueue(speech("second"));
    await settle();
    expect(callbacks.onBlocked).toHaveBeenCalledWith(true);
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    expect(callbacks.onStart).not.toHaveBeenCalled();

    player.unlock();
    expect(context.resume).toHaveBeenCalledOnce();
    await settle();
    expect(callbacks.onBlocked).toHaveBeenLastCalledWith(false);
    expect(callbacks.onStart.mock.calls.map(([frame]) => frame.utterance_id)).toEqual(["first"]);
    context.sources[0].finish();
    await settle();
    expect(callbacks.onStart.mock.calls.map(([frame]) => frame.utterance_id)).toEqual(["first", "second"]);
  });

  it("aborts pending fetch, clears queued speech and ignores a stale response after stop", async () => {
    const { context, callbacks, player } = setup();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    player.enqueue(speech("pending", { audio_url: "/api/sessions/s/utterances/pending.pcm", audio_sample_rate: 24000 }));
    player.enqueue(speech("queued"));
    await settle();
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    expect(signal.aborted).toBe(false);

    player.stop();
    expect(signal.aborted).toBe(true);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    // Resolve despite cancellation to simulate a response already in flight.
    pending.resolve(new Response(new Uint8Array([0, 0])));
    await settle();
    expect(context.sources).toHaveLength(0);
    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();

    player.enqueue(speech("new"));
    await settle();
    expect(callbacks.onStart.mock.calls.map(([frame]) => frame.utterance_id)).toEqual(["new"]);
  });

  it("stops active audio and animation, ends it once, and discards the remaining queue", async () => {
    const { context, callbacks, player } = setup();
    const renderer: SpeechRenderer = { audioContext: context.asContext(), speak: vi.fn(), stop: vi.fn() };
    player.attachRenderer(renderer);
    const first = speech("active");
    player.enqueue(first);
    player.enqueue(speech("discarded"));
    await settle();
    const lateEnd = context.sources[0].onended!;

    player.stop();
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(renderer.stop).toHaveBeenCalledOnce();
    expect(callbacks.onEnd).toHaveBeenCalledExactlyOnceWith(first);
    lateEnd();
    await settle();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(1);
  });

  it("continues audible playback if the avatar renderer fails", async () => {
    const { context, callbacks, createContext, player } = setup();
    const renderer: SpeechRenderer = {
      audioContext: context.asContext(),
      speak: vi.fn(() => { throw new Error("Model unavailable"); }),
      stop: vi.fn(),
    };
    player.attachRenderer(renderer);
    const frame = speech("model-failed");
    player.enqueue(frame);
    await settle();

    expect(createContext).not.toHaveBeenCalled();
    expect(renderer.speak).toHaveBeenCalledWith(context.decoded, null, context.currentTime);
    expect(context.sources[0].start).toHaveBeenCalledWith(context.currentTime);
    expect(context.sources[0].playing).toBe(true);
    expect(callbacks.onStart).toHaveBeenCalledExactlyOnceWith(frame);
    expect(callbacks.onError).toHaveBeenLastCalledWith(null);
    context.sources[0].finish();
    expect(callbacks.onEnd).toHaveBeenCalledExactlyOnceWith(frame);
  });

  it("passes valid word metadata without empty viseme arrays to the renderer", async () => {
    const { context, player } = setup();
    const renderer: SpeechRenderer = { audioContext: context.asContext(), speak: vi.fn(), stop: vi.fn() };
    player.attachRenderer(renderer);
    player.enqueue(speech("words", {
      lipsync: { words: ["Hello"], wtimes: [0], wdurations: [350], visemes: [], vtimes: [], vdurations: [] },
    }));
    await settle();
    expect(renderer.speak).toHaveBeenCalledWith(context.decoded, { words: ["Hello"], wtimes: [0], wdurations: [350] }, context.currentTime);
  });

  it("plays audio with invalid animation metadata without inventing timings", async () => {
    const { context, player } = setup();
    const renderer: SpeechRenderer = { audioContext: context.asContext(), speak: vi.fn(), stop: vi.fn() };
    player.attachRenderer(renderer);
    player.enqueue(speech("invalid-metadata", { lipsync: { words: ["Hello"], wtimes: [], wdurations: [] } }));
    await settle();
    expect(renderer.speak).toHaveBeenCalledWith(context.decoded, null, context.currentTime);
    expect(context.sources[0].playing).toBe(true);
  });

  it("suppresses C0 audio without creating an audio context or emitting playback events", async () => {
    const { context, callbacks, createContext, player } = setup();
    player.enqueue(speech("control", { condition: "C0", audio_url: "/api/sessions/s/utterances/control.pcm" }));
    await settle();
    expect(createContext).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);
    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it("skips caption-only speech without false playback events and continues the queue", async () => {
    const { context, callbacks, player } = setup();
    player.enqueue(speech("caption", { audio: null }));
    player.enqueue(speech("audio"));
    await settle();
    expect(context.sources).toHaveLength(1);
    expect(callbacks.onStart.mock.calls.map(([frame]) => frame.utterance_id)).toEqual(["audio"]);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it("continues the queue after audio decoding fails without emitting false onset or end", async () => {
    const { context, callbacks, player } = setup();
    context.decodeAudioData.mockRejectedValueOnce(new Error("Corrupt WAV"));
    player.enqueue(speech("bad"));
    player.enqueue(speech("good"));
    await settle();
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("could not be played"));
    expect(callbacks.onStart.mock.calls.map(([frame]) => frame.utterance_id)).toEqual(["good"]);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it("closes its fallback context and ignores new speech and unlock after disposal", async () => {
    const { context, callbacks, player } = setup();
    player.enqueue(speech("active"));
    await settle();
    player.dispose();
    player.enqueue(speech("ignored"));
    player.unlock();
    await settle();
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(1);
    expect(context.resume).not.toHaveBeenCalled();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
  });
  it("continues with the next utterance after a source cannot start, without false markers", async () => {
    const { context, callbacks, player } = setup();
    const failedSource = new AudioSource();
    failedSource.start.mockImplementation(() => { throw new Error("Audio device unavailable"); });
    context.createBufferSource.mockReturnValueOnce(failedSource);
    player.enqueue(speech("cannot-start"));
    player.enqueue(speech("next"));
    await settle();
    expect(failedSource.disconnect).toHaveBeenCalledOnce();
    expect(callbacks.onStart.mock.calls.map(([frame]) => frame.utterance_id)).toEqual(["next"]);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it("renderer cleanup failure cannot block end markers or the next utterance", async () => {
    const { context, callbacks, player } = setup();
    player.attachRenderer({ audioContext: context.asContext(), speak: vi.fn(), stop: () => { throw new Error("Lost WebGL context"); } });
    player.enqueue(speech("first"));
    player.enqueue(speech("second"));
    await settle();
    context.sources[0].finish();
    await settle();
    expect(callbacks.onEnd.mock.calls.map(([frame]) => frame.utterance_id)).toEqual(["first"]);
    expect(callbacks.onStart.mock.calls.map(([frame]) => frame.utterance_id)).toEqual(["first", "second"]);
  });

});
