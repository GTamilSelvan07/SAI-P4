// Test-only harness: exercise the production player/adapter and inspect the
// actual loaded mesh weights. No debug hooks are added to the participant app.
import { TalkingHead } from "@met4citizen/talkinghead";
import { createTalkingHeadRenderer } from "../../src/avatar/talkingHead";
import { SpeechPlayer } from "../../src/avatar/SpeechPlayer";
import type { AlexSpeech, LipSync } from "../../src/avatar/speech";

interface ObservedHead extends TalkingHead {
  morphs: Array<{ morphTargetDictionary: Record<string, number>; morphTargetInfluences: number[] }>;
  render(): void;
}
interface MouthSample { time: number; opening: number }
interface MouthFixture {
  play(lipsync: LipSync | null, seconds?: number): void;
  playSpeech(speech: AlexSpeech): void;
  stop(): void;
  samples: MouthSample[];
  events: string[];
  opening(): number;
  diagnostics(): object;
  images: { closed?: string; speaking?: string };
}
declare global { interface Window { mouthTest: MouthFixture } }

let head: ObservedHead;
const showAvatar = TalkingHead.prototype.showAvatar;
TalkingHead.prototype.showAvatar = function (avatar) {
  head = this as ObservedHead;
  return showAvatar.call(this, avatar);
};
const renderer = await createTalkingHeadRenderer(document.querySelector("#avatar")!, {
  modelUrl: "/avatars/alex.glb", reducedMotion: true,
});
TalkingHead.prototype.showAvatar = showAvatar;
let startedAt: number | null = null;
let endedAt: number | null = null;
let sequence = 0;

const player = new SpeechPlayer({
  onStart: () => { fixture.events.push("start"); },
  onEnd: () => { fixture.events.push("end"); endedAt = renderer.audioContext.currentTime; },
  onBlocked: () => {},
  onError: (error) => { if (error) throw new Error(error); },
});
player.attachRenderer({
  audioContext: renderer.audioContext,
  speak(buffer, lipsync, time) {
    startedAt = time;
    endedAt = null;
    fixture.samples = [];
    renderer.speak(buffer, lipsync, time);
  },
  stop: () => renderer.stop(),
});

const fixture: MouthFixture = {
  play(lipsync, seconds = 3) {
    fixture.playSpeech({
      text: "Caption is deliberately unrelated to this test tone.",
      utterance_id: String(++sequence), condition: "C2",
      audio_url: `/api/sessions/mouth-test/utterances/test.pcm?seconds=${seconds}`,
      audio_sample_rate: 24000, lipsync,
    });
  },
  playSpeech(speech) {
    fixture.events = [];
    player.enqueue(speech);
  },
  stop: () => player.stop(),
  samples: [], events: [], images: {},
  diagnostics: () => ({ state: renderer.audioContext.state, currentTime: renderer.audioContext.currentTime, startedAt, endedAt, samples: fixture.samples }),
  opening: () => Math.max(0, ...head.morphs.flatMap((mesh) =>
    Object.entries(mesh.morphTargetDictionary)
      .filter(([name]) => name.startsWith("viseme_") && name !== "viseme_sil")
      .map(([, index]) => mesh.morphTargetInfluences[index]),
  )),
};
window.mouthTest = fixture;
const render = head!.render;
head!.render = function () {
  render.call(this);
  // Capture immediately after WebGL rendering, while the measured shape is
  // still on screen. A later automation screenshot can miss a short phoneme.
  const opening = fixture.opening();
  const kind = startedAt === null ? "closed" : opening > 0.2 ? "speaking" : null;
  if (kind && !fixture.images[kind]) {
    fixture.images[kind] = document.querySelector("canvas")!.toDataURL("image/png");
  }
};
function sample() {
  const now = renderer.audioContext.currentTime;
  if (startedAt !== null && (endedAt === null || now - endedAt < 0.3)) {
    fixture.samples.push({ time: now - startedAt, opening: fixture.opening() });
  }
  requestAnimationFrame(sample);
}
sample();
document.querySelector("#enable")!.addEventListener("click", () => player.unlock());
window.addEventListener("pagehide", () => { player.dispose(); renderer.dispose(); });
