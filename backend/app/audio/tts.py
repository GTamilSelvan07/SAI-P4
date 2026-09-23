"""
Text-to-speech for Alex's voice.
Priority: HeadTTS sidecar (Kokoro + visemes) → Kokoro (GPU) → Piper (CPU) → Stub.

Only HeadTTS produces the lipsync timings the browser avatar needs; the others
return a SpeechAudio with empty timing arrays, so Alex still speaks — the mouth
just falls back to the frontend's own lipsync module.
"""
import io
import logging
import time
import wave
import asyncio
import subprocess
import struct
from pathlib import Path
from typing import Optional

import numpy as np

from app.audio.headtts import HeadTTSClient
from app.audio.speech import SpeechAudio, resample_pcm16
from app.config import config, AUDIO_SAMPLE_RATE

log = logging.getLogger(__name__)


class KokoroTTS:
    """
    Kokoro TTS 82M on GPU.
    ~130ms for a sentence on DGX Spark (67x real-time).
    Outputs 24kHz audio, resampled to AUDIO_SAMPLE_RATE (16kHz) for the pipeline.
    """

    KOKORO_SAMPLE_RATE = 24000

    def __init__(self):
        self._pipeline = None
        self._available = False
        self._voice = config.tts.kokoro_voice

    def check_available(self) -> bool:
        """Load Kokoro pipeline. Returns True if successful."""
        try:
            import os
            # Prevent HuggingFace Hub from trying to resolve DNS on offline systems
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
            from kokoro import KPipeline
            self._pipeline = KPipeline(lang_code="a")  # American English
            self._available = True
            log.info("[TTS] Kokoro TTS loaded successfully (GPU)")
        except ImportError:
            log.info("[TTS] Kokoro not installed — trying Piper")
            self._available = False
        except Exception as e:
            log.warning(f"[TTS] Kokoro init failed: {e}")
            self._available = False
        return self._available

    @property
    def available(self) -> bool:
        return self._available

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

    def synthesize_speech(self, text: str) -> Optional[SpeechAudio]:
        """Synthesize to a SpeechAudio at 24kHz. Kokoro produces no timings."""
        if not self._available or self._pipeline is None:
            return None

        try:
            # Kokoro returns generator of (graphemes, phonemes, audio_tensor) tuples
            audio_chunks = []
            for _, _, audio in self._pipeline(text, voice=self._voice):
                audio_chunks.append(audio.numpy())

            if not audio_chunks:
                return None

            # Concatenate all chunks and convert float32 [-1, 1] to PCM16 bytes
            audio_24k = np.concatenate(audio_chunks)
            pcm_24k = np.clip(audio_24k * 32767, -32768, 32767).astype(np.int16).tobytes()

            return SpeechAudio(
                pcm16=pcm_24k,
                pcm16_pipeline=resample_pcm16(
                    pcm_24k, self.KOKORO_SAMPLE_RATE, AUDIO_SAMPLE_RATE
                ),
                sample_rate=self.KOKORO_SAMPLE_RATE,
            )

        except Exception as e:
            log.warning(f"Kokoro TTS synthesis failed: {e}")
            return None

    def get_pcm16(self, text: str) -> Optional[bytes]:
        """Synthesize and return raw PCM16 bytes at AUDIO_SAMPLE_RATE."""
        speech = self.synthesize_speech(text)
        return speech.pcm16_pipeline if speech else None


class PiperTTS:
    """
    Text-to-speech using Piper TTS (CPU).
    Fallback when Kokoro/GPU is unavailable.
    """

    def __init__(self):
        self._available = False
        self._model = self._resolve_model_path(config.tts.model)

    @staticmethod
    def _resolve_model_path(model_name: str) -> str:
        """Resolve model name to full path, checking common locations."""
        if Path(model_name).exists():
            return model_name
        voices_dir = Path.home() / ".local" / "share" / "piper_voices"
        onnx_path = voices_dir / f"{model_name}.onnx"
        if onnx_path.exists():
            return str(onnx_path)
        return model_name

    def check_available(self) -> bool:
        """Check if piper CLI is installed."""
        try:
            subprocess.run(["piper", "--help"], capture_output=True, timeout=5)
            self._available = True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            self._available = False
        return self._available

    @property
    def available(self) -> bool:
        return self._available

    def synthesize_speech(self, text: str) -> Optional[SpeechAudio]:
        """Synthesize to a SpeechAudio at Piper's native rate. No timings."""
        if not self._available:
            return None
        try:
            result = subprocess.run(
                ["piper", "--model", self._model, "--output_raw"],
                input=text.encode("utf-8"), capture_output=True, timeout=10,
            )
            if result.returncode != 0 or not result.stdout:
                return None
            native_rate = config.tts.sample_rate
            return SpeechAudio(
                pcm16=result.stdout,
                pcm16_pipeline=resample_pcm16(result.stdout, native_rate, AUDIO_SAMPLE_RATE),
                sample_rate=native_rate,
            )
        except Exception as e:
            log.warning(f"Piper TTS synthesis failed: {e}")
            return None

    def synthesize(self, text: str) -> Optional[bytes]:
        """Synthesize text to PCM16 WAV bytes (at AUDIO_SAMPLE_RATE)."""
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

    def get_pcm16(self, text: str) -> Optional[bytes]:
        """Synthesize and return raw PCM16 bytes at AUDIO_SAMPLE_RATE."""
        speech = self.synthesize_speech(text)
        return speech.pcm16_pipeline if speech else None


class StubTTS:
    """Stub TTS for development. Generates silence."""

    @property
    def available(self) -> bool:
        return False

    def check_available(self) -> bool:
        return False

    def synthesize(self, text: str) -> Optional[bytes]:
        return None

    async def synthesize_async(self, text: str) -> Optional[bytes]:
        return None

    def get_pcm16(self, text: str) -> Optional[bytes]:
        duration_samples = AUDIO_SAMPLE_RATE * 2
        return b"\x00\x00" * duration_samples

    def synthesize_speech(self, text: str) -> Optional[SpeechAudio]:
        """Two seconds of silence at the pipeline rate. No timings."""
        pcm = self.get_pcm16(text)
        return SpeechAudio(
            pcm16=pcm, pcm16_pipeline=pcm, sample_rate=AUDIO_SAMPLE_RATE
        )


def create_tts() -> HeadTTSClient | KokoroTTS | PiperTTS | StubTTS:
    """Factory: create the best available TTS.
    HeadTTS sidecar → Kokoro (GPU) → Piper (CPU) → Stub."""
    # Try the HeadTTS sidecar first — the only engine that returns visemes
    headtts = HeadTTSClient()
    if headtts.check_available():
        return headtts

    # Fall back to in-process Kokoro (GPU) — same voice, no timings
    kokoro = KokoroTTS()
    if kokoro.check_available():
        return kokoro

    # Fall back to Piper (CPU)
    piper = PiperTTS()
    if piper.check_available():
        log.info("[TTS] Using Piper TTS (CPU fallback)")
        return piper

    log.warning("[TTS] No TTS engine available — using Stub (silence). Alex will have no voice.")
    return StubTTS()
