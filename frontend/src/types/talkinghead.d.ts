// The pinned TalkingHead 1.7.0 package does not ship TypeScript declarations.
// Keep its compatibility surface confined to the renderer adapter.
declare module "@met4citizen/talkinghead" {
  interface SpeechAudio {
    audio: AudioBuffer;
    words: string[];
    wtimes: number[];
    wdurations: number[];
    visemes?: string[];
    vtimes?: number[];
    vdurations?: number[];
  }

  export class TalkingHead {
    constructor(container: HTMLElement, options: Record<string, unknown>);
    readonly audioCtx: AudioContext;
    readonly audioReverbNode: ConvolverNode;
    readonly lipsync: Record<string, unknown>;
    animQueue: Array<{ template: { name: string } }>;
    showAvatar(avatar: Record<string, unknown>): Promise<void>;
    playPose(name: string, onProgress: null, duration: number): Promise<void>;
    setMixerGain(speech: number, background?: number): void;
    speakAudio(audio: SpeechAudio, options: { lipsyncLang: string; isRaw: boolean }): void;
    stopSpeaking(): void;
    dispose(): void;
  }
}

declare module "@met4citizen/talkinghead/modules/lipsync-en.mjs" {
  export class LipsyncEn {
    preProcessText(text: string): string;
    wordsToVisemes(text: string): {
      visemes: string[];
      times: number[];
      durations: number[];
    };
  }
}
