import { describe, expect, it } from "vitest";
import { createMouthEnvelope, mouthLevelAt } from "../src/avatar/mouthEnvelope";

function audio(rate: number, signal: (seconds: number) => number, channels = 1, duration = 1) {
  const samples = Float32Array.from({ length: Math.round(rate * duration) }, (_, i) => signal(i / rate));
  return {
    sampleRate: rate, length: samples.length, duration, numberOfChannels: channels,
    // Opposite phases must not cancel when measuring stereo energy.
    getChannelData: (channel: number) => channel ? samples.map((s) => -s) : samples,
  } as AudioBuffer;
}

describe("audio-driven mouth envelope", () => {
  it.each([16000, 22050, 24000, 48000])("opens for sound and closes in pauses at %i Hz", (rate) => {
    const envelope = createMouthEnvelope(audio(rate, (t) => t >= 0.2 && t < 0.6 ? 0.2 * Math.sin(t * 440 * Math.PI) : 0));
    expect(mouthLevelAt(envelope, 0.1)).toBe(0);
    expect(mouthLevelAt(envelope, 0.3)).toBeGreaterThan(0.5);
    expect(mouthLevelAt(envelope, 0.8)).toBe(0);
    expect(mouthLevelAt(envelope, -0.1)).toBe(0);
    expect(mouthLevelAt(envelope, 1)).toBe(0);
  });

  it("keeps silent stub audio and low-level noise still", () => {
    for (const level of [0, 0.005]) {
      const envelope = createMouthEnvelope(audio(24000, () => level));
      expect(envelope.levels.every((v) => v === 0)).toBe(true);
    }
  });

  it("responds to changing loudness without exceeding restrained mouth opening", () => {
    const envelope = createMouthEnvelope(audio(24000, (t) => (t < 0.5 ? 0.03 : 0.8) * Math.sin(t * 440 * Math.PI), 2));
    expect(mouthLevelAt(envelope, 0.25)).toBeGreaterThan(0);
    expect(mouthLevelAt(envelope, 0.75)).toBeGreaterThan(mouthLevelAt(envelope, 0.25));
    expect(Math.max(...envelope.levels)).toBeLessThanOrEqual(0.65);
  });

  it("handles a final partial window without NaN and stops at the buffer boundary", () => {
    const envelope = createMouthEnvelope(audio(22050, () => 0.2, 1, 0.013));
    expect(mouthLevelAt(envelope, 0.006)).toBeGreaterThan(0);
    expect(mouthLevelAt(envelope, 0.013)).toBe(0);
    expect(envelope.levels.every(Number.isFinite)).toBe(true);
  });
});
