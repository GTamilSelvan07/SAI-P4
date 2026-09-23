"""
Pydantic models for all data structures.
"""
import time
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


# ── Event Types ────────────────────────────────────────────────────────────

class EventType(str, Enum):
    SESSION_START = "session_start"
    SESSION_END = "session_end"
    PHASE_CHANGE = "phase_change"
    AI_INTERVENTION = "ai_intervention"
    AI_QUALITY_GATE_FAIL = "ai_quality_gate_fail"
    AI_TIMEOUT = "ai_timeout"
    # Client-reported playback boundaries. AI_INTERVENTION is logged when the
    # text is generated; these are when a participant actually heard it.
    AVATAR_SPEECH_START = "avatar_speech_start"
    AVATAR_SPEECH_END = "avatar_speech_end"
    FAILSAFE_OVERRIDE = "failsafe_override"
    EMERGENCY_STOP = "emergency_stop"
    PARTICIPANT_JOIN = "participant_join"
    PARTICIPANT_LEAVE = "participant_leave"
    TRIGGER_FIRED = "trigger_fired"
    MIC_MUTE = "mic_mute"
    MIC_UNMUTE = "mic_unmute"
    DECISION_VOTE = "decision_vote"
    PREFERENCE_VOTE = "preference_vote"
    DECISION_CONSENSUS = "decision_consensus"
    SURVEY_RESPONSE = "survey_response"
    RESEARCHER_ACTION = "researcher_action"
    RESEARCHER_FLAG = "researcher_flag"
    VIDEO_RECORDING_START = "video_recording_start"
    VIDEO_RECORDING_STOP = "video_recording_stop"
    VIDEO_RECORDING_HEARTBEAT = "video_recording_heartbeat"
    VIDEO_RECORDING_FAILED = "video_recording_failed"
    BATTERY_SCALE_SUBMITTED = "battery_scale_submitted"


class TriggerType(str, Enum):
    TIMER = "timer"
    LULL = "lull"
    KEYWORD = "keyword"
    TURN_COUNT = "turn_count"
    FAILSAFE = "failsafe"
    RESEARCHER = "researcher"


class AISource(str, Enum):
    LIVE_LLM = "live_llm"
    REGENERATED_LLM = "regenerated_llm"
    PRE_GENERATED = "pre_generated"
    FAILSAFE_CLIP = "failsafe_clip"


# ── Event Log Entry ───────────────────────────────────────────────────────

class EventEntry(BaseModel):
    ts: float = Field(default_factory=time.time)
    type: EventType
    phase: Optional[str] = None
    condition: Optional[str] = None
    content: Optional[str] = None
    trigger: Optional[TriggerType] = None
    failure_mode: Optional[str] = None  # F0, F3, F4, F5 etc.
    model: Optional[str] = None
    llm_latency_ms: Optional[int] = None
    tts_latency_ms: Optional[int] = None
    source: Optional[AISource] = None
    speaker: Optional[str] = None
    extra: Optional[dict] = None


# ── Transcript Entry ──────────────────────────────────────────────────────

class TranscriptEntry(BaseModel):
    ts: float = Field(default_factory=time.time)
    speaker: str  # "P1", "P2", "Alex"
    start_ms: int
    end_ms: int
    text: str
    confidence: float
    channel: int  # 0=P1, 1=P2, 2=Alex


# ── Session Metadata ──────────────────────────────────────────────────────

class ParticipantInfo(BaseModel):
    id: str
    role: str  # "P1" or "P2"
    connected: bool = False


class SessionMeta(BaseModel):
    session_id: str
    group_id: str
    created_at: float = Field(default_factory=time.time)
    mode: str = "study"  # single live-LLM facilitation mode
    conditions: list[str]  # always exactly one in single-run mode
    task_order: list[str]  # always exactly one in single-run mode
    condition_task_map: dict[str, str]  # condition -> task_id
    anchoring_direction: Optional[str] = None  # "correct" or "incorrect" for C3
    amplification_target: Optional[str] = None  # "P1" or "P2" for C4
    model: str = "gemma4:26b"  # default mirrors config.ollama.model; both call sites override explicitly
    participants: list[ParticipantInfo] = []


# ── Survey Response ───────────────────────────────────────────────────────

class SurveyResponse(BaseModel):
    ts: float = Field(default_factory=time.time)
    session_id: str
    participant_id: str
    condition: str
    task_id: str
    phase: str  # "pre_preference" or "post_task" or "debrief"
    responses: dict[str, str | int | float]


# ── WebSocket Messages ────────────────────────────────────────────────────

class WSMessage(BaseModel):
    type: str
    data: dict = {}
