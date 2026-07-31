"""
Experiment configuration. All settings in one place.
"""
from pathlib import Path
from enum import Enum
from pydantic import BaseModel


# ── Paths ──────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "sessions"
DB_PATH = PROJECT_ROOT / "db" / "experiment.db"
PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
TASKS_DIR = Path(__file__).resolve().parent.parent / "tasks"
FAILSAFE_DIR = Path(__file__).resolve().parent.parent / "failsafe_clips"


# ── Conditions ─────────────────────────────────────────────────────────────

class Condition(str, Enum):
    C0_NO_AI = "C0"
    C1_SHAM = "C1"
    C2_NEUTRAL = "C2"
    C3_ANCHORING = "C3"
    C4_AMPLIFICATION = "C4"
    C5_DEVIL_ADVOCATE = "C5"


class SessionMode(str, Enum):
    STUDY = "study"   # single live-LLM facilitation mode (the only mode)


CONDITION_LABELS = {
    Condition.C0_NO_AI: "No AI",
    Condition.C1_SHAM: "Sham AI",
    Condition.C2_NEUTRAL: "Neutral AI",
    Condition.C3_ANCHORING: "Anchoring AI",
    Condition.C4_AMPLIFICATION: "Amplification AI",
    Condition.C5_DEVIL_ADVOCATE: "Devil's Advocate AI",
}


# ── Phases ─────────────────────────────────────────────────────────────────

class Phase(str, Enum):
    SETUP = "setup"
    INFO_READING = "info_reading"
    PREFERENCE = "preference"
    P1_OPENING = "p1_opening"
    P2_OPENING = "p2_opening"
    OPEN_DISCUSSION = "open_discussion"
    DECISION = "decision"
    SURVEY = "survey"
    WASHOUT = "washout"
    DEBRIEF = "debrief"


# Phase durations in seconds
PHASE_DURATIONS = {
    Phase.INFO_READING: 330,       # 5.5 min — extended for redesigned hidden-profile tasks (3+6+6)
    Phase.PREFERENCE: 60,          # 1 min
    Phase.P1_OPENING: 120,         # 2 min
    Phase.P2_OPENING: 120,         # 2 min
    Phase.OPEN_DISCUSSION: 720,    # 12 min
    Phase.DECISION: 120,           # 2 min
    Phase.SURVEY: 180,             # 3 min
    Phase.WASHOUT: 300,            # 5 min
}

# Phase order within a single task block
TASK_BLOCK_PHASES = [
    Phase.INFO_READING,
    Phase.PREFERENCE,
    Phase.P1_OPENING,
    Phase.P2_OPENING,
    Phase.OPEN_DISCUSSION,
    Phase.DECISION,
    Phase.SURVEY,
]


# ── C3 Anchoring ───────────────────────────────────────────────────────────

# C3 is intended to bias dyads away from the hidden-profile correct answer.
# Keep the assignment label for analysis, but resolve it to the task's
# incorrect lure at runtime.
C3_ANCHORING_ASSIGNMENT = "incorrect"


# ── AI Facilitator ─────────────────────────────────────────────────────────

class OllamaConfig(BaseModel):
    base_url: str = "http://localhost:11434"
    model: str = "gemma4:26b"
    quality_gate_model: str = "gemma4:26b"  # can use smaller model
    timeout_seconds: float = 15.0
    temperature: float = 0.7
    num_gpu: int = 999
    flash_attention: bool = True


class TTSConfig(BaseModel):
    model: str = "en_US-amy-medium"  # Piper fallback model
    sample_rate: int = 22050         # Piper native sample rate
    output_format: str = "wav"
    kokoro_voice: str = "af_heart"   # Kokoro voice ID


class TranscriptionConfig(BaseModel):
    model_size: str = "medium.en"    # faster-whisper fallback model
    device: str = "auto"
    compute_type: str = "default"
    vad_threshold: float = 0.5
    chunk_length_seconds: float = 5.0
    nemotron_model: str = "nvidia/nemotron-speech-streaming-en-0.6b"


class ParticipantAudioConfig(BaseModel):
    # Co-located study setup: both participant browsers may stream mic audio
    # to backend transcription, but participant audio is not shared over LiveKit.
    capture_role: str = "both"  # "both", "P1", or "P2"
    livekit_microphone_enabled: bool = False
    remote_participant_playback_enabled: bool = False


# ── Trigger Thresholds ─────────────────────────────────────────────────────

class TriggerConfig(BaseModel):
    timer_interval_seconds: float = 90.0
    timer_jitter_seconds: float = 15.0
    lull_threshold_seconds: float = 5.0
    keyword: str = "alex"
    turn_count_threshold: int = 8
    cooldown_seconds: float = 5.0  # min seconds between back-to-back interventions


# ── Conditions ─────────────────────────────────────────────────────────────

ALL_CONDITIONS = list(Condition)


# ── Audio ──────────────────────────────────────────────────────────────────

AUDIO_SAMPLE_RATE = 16000  # 16kHz mono for recording and Whisper
AUDIO_CHANNELS = 1
TRANSCRIPT_SHUTDOWN_DRAIN_TIMEOUT_SECONDS = 10.0


# ── Video Recording ────────────────────────────────────────────────────────

# Browser-side MediaRecorder writes WebM chunks to the participant's local
# folder (File System Access API) AND streams the same chunks to the backend
# as a server-side backup. See useLocalRecording.ts.
VIDEO_RECORDING_ENABLED = True
VIDEO_CODEC = "video/webm;codecs=vp9,opus"  # MediaRecorder mimeType
VIDEO_BITRATE_BPS = 2_500_000  # 2.5 Mbps video
VIDEO_AUDIO_BITRATE_BPS = 128_000  # 128 kbps Opus
VIDEO_CHUNK_MS = 1000  # MediaRecorder timeslice — flush per second


# ── Failsafe ──────────────────────────────────────────────────────────────

FAILSAFE_TIMEOUT_SECONDS = 15.0  # auto-play failsafe if LLM exceeds this


# ── LiveKit ───────────────────────────────────────────────────────────────

import os

class LiveKitConfig(BaseModel):
    url: str = os.environ.get("LIVEKIT_URL", "ws://localhost:7880")
    api_url: str = os.environ.get("LIVEKIT_API_URL", "http://localhost:7880")
    api_key: str = os.environ.get("LIVEKIT_API_KEY", "devkey")
    api_secret: str = os.environ.get("LIVEKIT_API_SECRET", "secret")


# ── Composite Config ──────────────────────────────────────────────────────

class ExperimentConfig(BaseModel):
    ollama: OllamaConfig = OllamaConfig()
    tts: TTSConfig = TTSConfig()
    transcription: TranscriptionConfig = TranscriptionConfig()
    participant_audio: ParticipantAudioConfig = ParticipantAudioConfig()
    triggers: TriggerConfig = TriggerConfig()
    livekit: LiveKitConfig = LiveKitConfig()


# Default config instance
config = ExperimentConfig()


# ── Security ──────────────────────────────────────────────────────────────

RESEARCHER_API_KEY = os.environ.get("EXPERIMENT_API_KEY", "")
