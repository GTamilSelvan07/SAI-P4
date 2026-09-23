"""
HeadTTS client — Kokoro synthesis with word- and viseme-level timings.

HeadTTS runs as a Node sidecar (default :8882) rather than in the browser:
synthesis has to happen once, server-side, or P1 and P2 would generate their
own audio and drift out of sync with each other, and we would lose both
`audio_alex.wav` and the TTS latency numbers the study logs.

It runs Kokoro underneath — the same engine as KokoroTTS — so the voice is
unchanged as long as `headtts.voice` matches `tts.kokoro_voice`.
"""
import asyncio
import base64
import io
import logging
import wave
from typing import Optional

import httpx

from app.audio.speech import SpeechAudio, resample_pcm16
from app.config import config, AUDIO_SAMPLE_RATE

log = logging.getLogger(__name__)


class HeadTTSClient:
    """Synchronous client for the HeadTTS sidecar's RESTful API.

    Synchronous on purpose: every call site already runs TTS in an executor
    to keep it off the event loop.
    """

    def __init__(self):
        self._cfg = config.headtts
        self._available = False
        self._client: Optional[httpx.Client] = None

    def check_available(self) -> bool:
        """Probe the sidecar with a short synthesis. Returns True if it answers."""
        if not self._cfg.enabled:
            log.info("[TTS] HeadTTS disabled in config — skipping")
            return False
        try:
            self._client = httpx.Client(timeout=httpx.Timeout(self._cfg.timeout_seconds))
            speech = self.synthesize_speech("Hello.")
            self._available = speech is not None and speech.has_lipsync
            if self._available:
                log.info(
                    f"[TTS] HeadTTS reachable at {self._cfg.url} "
                    f"(voice={self._cfg.voice}, {self._cfg.sample_rate}Hz, visemes on)"
                )
            else:
                log.info(f"[TTS] HeadTTS at {self._cfg.url} returned no timings — trying Kokoro")
        except Exception as e:
            log.info(f"[TTS] HeadTTS not reachable at {self._cfg.url}: {e} — trying Kokoro")
            self._available = False
        if not self._available:
            self.close()
        return self._available

    @property
    def available(self) -> bool:
        return self._available

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def synthesize_speech(self, text: str) -> Optional[SpeechAudio]:
        """Synthesize one utterance with its word and viseme timings."""
        if self._client is None:
            self._client = httpx.Client(timeout=httpx.Timeout(self._cfg.timeout_seconds))

        try:
            resp = self._client.post(
                f"{self._cfg.url}/v1/synthesize",
                json={
                    "input": text,
                    "voice": self._cfg.voice,
                    "language": self._cfg.language,
                    "speed": self._cfg.speed,
                    "audioEncoding": "pcm",
                },
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.TimeoutException:
            log.warning(f"[HeadTTS] synthesize timed out after {self._cfg.timeout_seconds}s")
            return None
        except httpx.HTTPStatusError as e:
            log.warning(f"[HeadTTS] HTTP {e.response.status_code}: {e.response.text[:200]}")
            return None
        except Exception as e:
            log.warning(f"[HeadTTS] synthesize failed: {type(e).__name__}: {e}")
            return None

        if data.get("error"):
            log.warning(f"[HeadTTS] sidecar error: {data['error']}")
            return None

        return speech_from_response(data, self._cfg.sample_rate)

    # ── Engine interface shared with Kokoro/Piper/Stub ─────────────────────

    def get_pcm16(self, text: str) -> Optional[bytes]:
        """Synthesize and return raw PCM16 bytes at AUDIO_SAMPLE_RATE."""
        speech = self.synthesize_speech(text)
        return speech.pcm16_pipeline if speech else None

    def synthesize(self, text: str) -> Optional[bytes]:
        """Synthesize text to WAV bytes (at AUDIO_SAMPLE_RATE)."""
        pcm = self.get_pcm16(text)
        if pcm is None:
            return None
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(AUDIO_SAMPLE_RATE)
            wf.writeframes(pcm)
        return wav_buffer.getvalue()

    async def synthesize_async(self, text: str) -> Optional[bytes]:
        """Run TTS in thread pool."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.synthesize, text)


def speech_from_response(data: dict, sample_rate: int) -> Optional[SpeechAudio]:
    """Build a SpeechAudio from a HeadTTS `/v1/synthesize` response body.

    HeadTTS already names its timing arrays the way TalkingHead's `speakAudio()`
    expects, so they pass through untouched.
    """
    try:
        pcm = base64.b64decode(data.get("audio") or "")
    except Exception as e:
        log.warning(f"[HeadTTS] audio decode failed: {e}")
        return None
    if not pcm:
        log.warning("[HeadTTS] response carried no audio")
        return None

    return SpeechAudio(
        pcm16=pcm,
        pcm16_pipeline=resample_pcm16(pcm, sample_rate, AUDIO_SAMPLE_RATE),
        sample_rate=sample_rate,
        words=list(data.get("words") or []),
        wtimes=[int(t) for t in (data.get("wtimes") or [])],
        wdurations=[int(d) for d in (data.get("wdurations") or [])],
        visemes=list(data.get("visemes") or []),
        vtimes=[int(t) for t in (data.get("vtimes") or [])],
        vdurations=[int(d) for d in (data.get("vdurations") or [])],
    )
