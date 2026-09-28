/** Audio-energy fallback, not phoneme recognition or transcript alignment. */
export interface MouthEnvelope {
  levels: number[];
  frameSeconds: number;
  duration: number;
}

/** Measure the actual decoded audio, at its own rate, in 20 ms windows. */
export function createMouthEnvelope(buffer: AudioBuffer): MouthEnvelope {
  const frameSize = Math.max(1, Math.round(buffer.sampleRate * 0.02));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const levels: number[] = [];
  let peak = 0;
  for (let start = 0; start < buffer.length; start += frameSize) {
    const end = Math.min(start + frameSize, buffer.length);
    let energy = 0;
    for (const samples of channels) {
      for (let i = start; i < end; i++) energy += samples[i] * samples[i];
    }
    const rms = Math.sqrt(energy / ((end - start) * channels.length));
    levels.push(rms);
    peak = Math.max(peak, rms);
  }
  // A fixed noise floor keeps silence quiet; a minimum reference level avoids
  // turning very quiet background noise into a wide-open mouth.
  const noiseFloor = 0.008;
  const reference = Math.max(0.08, peak - noiseFloor);
  return {
    levels: levels.map((rms) => 0.65 * Math.sqrt(Math.max(0, rms - noiseFloor) / reference)),
    frameSeconds: frameSize / buffer.sampleRate,
    duration: buffer.duration,
  };
}

/** Interpolate on the audible source's clock, including silence and pauses. */
export function mouthLevelAt(envelope: MouthEnvelope, seconds: number): number {
  if (seconds < 0 || seconds >= envelope.duration) return 0;
  const position = seconds / envelope.frameSeconds - 0.5;
  const index = Math.floor(position);
  const fraction = position - index;
  const from = envelope.levels[index] ?? 0;
  const to = envelope.levels[index + 1] ?? 0;
  return from + (to - from) * fraction;
}
