export type SessionMode = "study";

export type Condition = "C0" | "C1" | "C2" | "C3" | "C4" | "C5";

export type Phase =
  | "setup"
  | "info_reading"
  | "preference"
  | "p1_opening"
  | "p2_opening"
  | "open_discussion"
  | "decision"
  | "post_task"
  | "survey"      // legacy alias for post_task; backend still emits this name
  | "washout"
  | "debrief";

export type Role = "P1" | "P2" | "researcher";

export type MicState = "open" | "muted";

export interface SessionStatus {
  session_id: string;
  session_started: boolean;
  session_ended: boolean;
  current_block: number | null;
  total_blocks: number;
  condition: Condition | null;
  mode?: SessionMode;
  task_id: string | null;
  phase: Phase | null;
  phase_elapsed: number | null;
  phase_remaining: number | null;
  phase_paused: boolean | null;
  mic_p1: MicState;
  mic_p2: MicState;
  participant_audio_capture_role?: "both" | "P1" | "P2" | null;
  livekit_participant_audio_enabled?: boolean;
  remote_participant_audio_enabled?: boolean;
  anchoring_direction?: string | null;
  amplification_target?: string | null;
}

export interface TranscriptLine {
  ts: number;
  speaker: string;
  text: string;
  confidence: number;
}

export interface AICaption {
  text: string;
  ts: number;
  source?: string;
}

export type Framing = string;
export type Angle = string;

export interface SlotMap {
  [key: string]: string;
}

export interface ComposerState {
  framing: Framing;
  target: "A" | "B" | "C";
  angle: Angle;
  resolved: string;
}

export interface PromptCardData {
  id: string;
  archetype?: number;
  title: string;
  template?: string;
  slot_bindings?: Record<string, string>;
  resolved: string;
  played: boolean;
  played_ts?: number;
}

export interface WSMessage {
  type: string;
  data: Record<string, unknown>;
}

export interface AIIntervention {
  ts: number;
  text: string;
  trigger: string;
  source: string;
  condition: string;
  llm_latency_ms: number;
  tts_latency_ms: number;
}

export interface TaskFull {
  id: string;
  title: string;
  description: string;
  p1_persona: string;
  p2_persona: string;
  candidates: Array<{ id: string; name: string }>;
  correct_answer: string;
  correct_rationale: string;
  shared_info: string[];
  p1_unique_info: string[];
  p2_unique_info: string[];
  anchor_option: string;
  session_anchor_option?: string | null;
  anchor_rationale: string;
  slots?: Record<string, string>;
}
