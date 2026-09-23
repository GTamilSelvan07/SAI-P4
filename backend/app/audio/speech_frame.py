"""
The one builder for the `alex_speaking` WebSocket frame.

Two places emit Alex's speech — the facilitator path in `session/orchestrator.py`
and the researcher failsafe override in `routes/websockets.py`. Both used to
carry their own copy of the WAV-and-base64 block, which is exactly how an avatar
frame drifts between paths. Everything now goes through `build_alex_speaking`.

The frame is additive: every field the caption strip, transcript line and
researcher dashboard already read is unchanged.
"""
from __future__ import annotations

import base64
import io
import logging
import uuid
import wave
from typing import Optional

from app.audio.speech import SpeechAudio
from app.config import AUDIO_CHANNELS, AUDIO_SAMPLE_RATE

log = logging.getLogger(__name__)


def new_utterance_id() -> str:
    """Short, session-unique handle for one utterance's audio."""
    return uuid.uuid4().hex[:8]


def wav_bytes(pcm: bytes, sample_rate: int) -> Optional[bytes]:
    """Wrap raw PCM16 in a WAV container."""
    try:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(AUDIO_CHANNELS)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm)
        return buf.getvalue()
    except Exception as e:
        log.warning(f"[speech_frame] WAV encode failed: {e}")
        return None


def build_alex_speaking(
    *,
    text: str,
    source: str,
    trigger: str,
    condition: Optional[str] = None,
    speech: Optional[SpeechAudio] = None,
    audio_pcm: Optional[bytes] = None,
    utterance_id: Optional[str] = None,
    llm_latency_ms: int = 0,
    tts_latency_ms: int = 0,
    **extra,
) -> dict:
    """Build the `alex_speaking` frame for one utterance.

    Pass `speech` when the TTS engine produced a SpeechAudio; its browser-rate
    audio and lipsync timings are used. Pass `audio_pcm` for audio that never
    went through an engine — a pre-recorded failsafe clip off disk — which is at
    the pipeline rate and carries no timings.

    `lipsync` is None whenever no timings are available. The frontend must still
    play the utterance in that case: participants have to hear Alex even when
    the sidecar is down.
    """
    if speech is not None:
        pcm = speech.pcm16
        sample_rate = speech.sample_rate
        lipsync = speech.lipsync()
    else:
        pcm = audio_pcm
        sample_rate = AUDIO_SAMPLE_RATE
        lipsync = None

    audio_b64 = None
    if pcm:
        wav = wav_bytes(pcm, sample_rate)
        if wav is not None:
            audio_b64 = base64.b64encode(wav).decode("ascii")

    return {
        "type": "alex_speaking",
        "data": {
            "text": text,
            "utterance_id": utterance_id or new_utterance_id(),
            # Filled in once the utterance is in the audio cache; until then the
            # base64 WAV below is the only source.
            "audio_url": None,
            "audio": audio_b64,
            "audio_sample_rate": sample_rate,
            "lipsync": lipsync,
            "source": source,
            "condition": condition,
            "trigger": trigger,
            "llm_latency_ms": llm_latency_ms,
            "tts_latency_ms": tts_latency_ms,
            **extra,
        },
    }
