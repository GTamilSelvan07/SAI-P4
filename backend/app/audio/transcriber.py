"""
Speech-to-text transcription.
Priority: Nemotron (GPU) → faster-whisper (CPU) → Stub.
"""
import time
import asyncio
import threading
from dataclasses import dataclass
from typing import Optional, Callable
from pathlib import Path

import numpy as np

from app.config import config
from app.models import TranscriptEntry


@dataclass
class TranscriptionResult:
    text: str
    start_ms: int
    end_ms: int
    confidence: float
    language: str = "en"


class NemotronTranscriber:
    """
    NVIDIA Nemotron Speech Streaming 0.6B on GPU.
    ~72ms for 9s audio on DGX Spark (126x real-time).
    """

    def __init__(self):
        self._model = None
        self._available = False
        self._lock = threading.Lock()

    def load_model(self) -> None:
        """Load the Nemotron ASR model. Call once at startup."""
        try:
            import torch
            if not torch.cuda.is_available():
                self._available = False
                return

            import os
            os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")

            import nemo.collections.asr as nemo_asr
            self._model = nemo_asr.models.ASRModel.from_pretrained(
                model_name="nvidia/nemotron-speech-streaming-en-0.6b"
            )
            self._available = True
        except ImportError:
            self._available = False
        except Exception:
            self._available = False

    @property
    def available(self) -> bool:
        return self._available

    def transcribe(
        self,
        audio_samples: list[float],
        sample_rate: int = 16000,
    ) -> Optional[TranscriptionResult]:
        """Transcribe audio samples synchronously."""
        if not self._available or self._model is None:
            return None

        import soundfile as sf
        import tempfile

        audio_np = np.array(audio_samples, dtype=np.float32)
        duration_ms = int(len(audio_samples) / sample_rate * 1000)

        tmp_path = None
        with self._lock:
            try:
                # Nemotron requires a WAV file path
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                    tmp_path = f.name
                    sf.write(tmp_path, audio_np, sample_rate)

                results = self._model.transcribe([tmp_path])

                if not results:
                    return None

                # NeMo returns Hypothesis objects
                hyp = results[0]
                text = hyp.text if hasattr(hyp, "text") else str(hyp)
                text = text.strip()
                if not text:
                    return None

                # Nemotron provides a score; convert to 0-1 confidence
                score = hyp.score if hasattr(hyp, "score") else 0.0
                confidence = min(1.0, max(0.0, 1.0 + score / 1000))

                return TranscriptionResult(
                    text=text,
                    start_ms=0,
                    end_ms=duration_ms,
                    confidence=round(confidence, 3),
                )
            except Exception:
                return None
            finally:
                if tmp_path:
                    Path(tmp_path).unlink(missing_ok=True)

    async def transcribe_async(
        self,
        audio_samples: list[float],
        sample_rate: int = 16000,
    ) -> Optional[TranscriptionResult]:
        """Run transcription in a thread pool."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self.transcribe, audio_samples, sample_rate,
        )


class WhisperTranscriber:
    """
    Wrapper around faster-whisper for CPU transcription.
    Fallback when Nemotron/GPU is unavailable.
    """

    def __init__(self):
        self._model = None
        self._available = False
        self._lock = threading.Lock()

    def load_model(self) -> None:
        """Load the Whisper model. Call once at startup."""
        try:
            from faster_whisper import WhisperModel
            self._model = WhisperModel(
                config.transcription.model_size,
                device=config.transcription.device,
                compute_type=config.transcription.compute_type,
            )
            self._available = True
        except ImportError:
            self._available = False
        except Exception:
            self._available = False

    @property
    def available(self) -> bool:
        return self._available

    def transcribe(
        self,
        audio_samples: list[float],
        sample_rate: int = 16000,
    ) -> Optional[TranscriptionResult]:
        """Transcribe audio samples synchronously."""
        if not self._available or self._model is None:
            return None

        audio_np = np.array(audio_samples, dtype=np.float32)
        duration_ms = int(len(audio_samples) / sample_rate * 1000)

        with self._lock:
            try:
                segments, info = self._model.transcribe(
                    audio_np, beam_size=5, language="en", vad_filter=False,
                )
                segments_list = list(segments)
            except Exception:
                return None

        if not segments_list:
            return None

        text = " ".join(seg.text.strip() for seg in segments_list if seg.text.strip())
        if not text:
            return None

        avg_prob = sum(seg.avg_logprob for seg in segments_list) / len(segments_list)
        confidence = min(1.0, max(0.0, 1.0 + avg_prob))

        return TranscriptionResult(
            text=text, start_ms=0, end_ms=duration_ms,
            confidence=round(confidence, 3),
        )

    async def transcribe_async(
        self,
        audio_samples: list[float],
        sample_rate: int = 16000,
    ) -> Optional[TranscriptionResult]:
        """Run transcription in a thread pool."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self.transcribe, audio_samples, sample_rate,
        )


class StubTranscriber:
    """Stub transcriber for development."""

    @property
    def available(self) -> bool:
        return False

    def load_model(self) -> None:
        pass

    def transcribe(self, *args, **kwargs) -> None:
        return None

    async def transcribe_async(self, *args, **kwargs) -> None:
        return None


def create_transcriber() -> NemotronTranscriber | WhisperTranscriber | StubTranscriber:
    """Factory: create the best available transcriber. Nemotron (GPU) → Whisper (CPU) → Stub."""
    # Try Nemotron first (GPU)
    nemotron = NemotronTranscriber()
    nemotron.load_model()
    if nemotron.available:
        return nemotron

    # Fall back to faster-whisper (CPU)
    whisper = WhisperTranscriber()
    whisper.load_model()
    if whisper.available:
        return whisper

    return StubTranscriber()
