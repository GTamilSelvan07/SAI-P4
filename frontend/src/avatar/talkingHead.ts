import { TalkingHead } from "@met4citizen/talkinghead";
import { LipsyncEn } from "@met4citizen/talkinghead/modules/lipsync-en.mjs";

/** Backend-provided alignment, in milliseconds, relative to the audio buffer. */
export interface AvatarLipSync {
  words: string[];
  wtimes: number[];
  wdurations: number[];
  visemes?: string[];
  vtimes?: number[];
  vdurations?: number[];
}

export interface TalkingHeadRenderer {
  /** Reuse this context for audible playback; this renderer owns its lifetime. */
  readonly audioContext: AudioContext;
  /** Animate an already-started utterance. The renderer's audio output is muted. */
  speak(buffer: AudioBuffer, lipsync?: AvatarLipSync | null): void;
  stop(): void;
  /** Stop controller playback before disposal, which closes audioContext. */
  dispose(): void;
}

export interface TalkingHeadOptions {
  modelUrl: string;
  body?: "M" | "F";
  reducedMotion?: boolean;
  signal?: AbortSignal;
}

/**
 * TalkingHead 1.7.0 owns its AudioContext (unlike unreleased upstream code).
 * The audio controller shares that context and owns the audible source and its
 * completion events. This adapter never turns animation events into study
 * playback acknowledgements.
 */
export async function createTalkingHeadRenderer(
  container: HTMLElement,
  options: TalkingHeadOptions,
): Promise<TalkingHeadRenderer> {
  options.signal?.throwIfAborted();
  const modelUrl = new URL(options.modelUrl, window.location.href);
  if (modelUrl.origin !== window.location.origin) {
    throw new Error("The avatar model must be served by this application.");
  }

  // The upstream constructor allocates audio before WebGL. Probe first so the
  // common unsupported-WebGL fallback does not leave an unreachable context.
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2");
  if (!gl) throw new Error("3D avatar rendering requires WebGL 2.");
  gl.getExtension("WEBGL_lose_context")?.loseContext();

  const head = new TalkingHead(container, {
    // Static import below makes the English processor part of the Vite build.
    // Upstream's import(moduleName) cannot be discovered by a bundler.
    lipsyncModules: [],
    lipsyncLang: "en",
    ttsEndpoint: "",
    cameraView: "upper",
    cameraRotateEnable: false,
    cameraPanEnable: false,
    cameraZoomEnable: false,
    modelFPS: 30,
    modelPixelRatio: Math.min(window.devicePixelRatio || 1, 2)
      / (window.devicePixelRatio || 1),
    modelMovementFactor: options.reducedMotion ? 0 : 0.25,
    avatarMood: "neutral",
    avatarIdleHeadMove: 0,
    avatarSpeakingHeadMove: 0,
    avatarIdleEyeContact: 1,
    avatarSpeakingEyeContact: 1,
    mixerGainSpeech: 0,
    mixerGainBackground: 0,
    dracoEnabled: false,
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      // Removes the renderer canvas, its ResizeObserver, controls, animation
      // frame, model geometry/materials and speech sources in pinned 1.7.0.
      head.dispose();
    } finally {
      // Upstream disposal omits the convolver and leaves its context suspended.
      head.audioReverbNode.disconnect();
      if (head.audioCtx.state !== "closed") {
        void head.audioCtx.close().catch(() => undefined);
      }
    }
  };

  try {
    head.lipsync.en = new LipsyncEn();
    head.setMixerGain(0, 0);
    await head.showAvatar({
      url: modelUrl.href,
      ...(options.body ? { body: options.body } : {}),
      avatarMood: "neutral",
      lipsyncLang: "en",
    });
    options.signal?.throwIfAborted();

    // Use the same restrained neutral presentation in every study condition.
    // This version-pinned filter removes scripted gestures and expression
    // tracks. Reduced motion also removes breathing/blink tracks; upstream
    // still interpolates poses, lip shapes and subtle facial baseline changes.
    head.animQueue = head.animQueue.filter(({ template }) =>
      !options.reducedMotion && ["breathing", "blink"].includes(template.name),
    );
    await head.playPose("straight", null, Number.POSITIVE_INFINITY);
    options.signal?.throwIfAborted();
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    audioContext: head.audioCtx,
    speak(buffer, lipsync) {
      if (disposed) return;
      // The controller invokes this immediately after starting its own source
      // on audioContext. isRaw avoids upstream pre-roll, pauses and gestures.
      head.stopSpeaking();
      if (!lipsync) return; // Do not fabricate timings from the transcript.
      head.speakAudio({ audio: buffer, ...lipsync }, {
        lipsyncLang: "en",
        isRaw: true,
      });
    },
    stop() {
      if (!disposed) head.stopSpeaking();
    },
    dispose,
  };
}
