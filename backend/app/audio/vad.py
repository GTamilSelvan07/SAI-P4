"""
Voice Activity Detection using Silero VAD.
Detects speech segments and triggers transcription.
"""
import logging
import time
import struct
from typing import Callable, Optional

import numpy as np

log = logging.getLogger(__name__)


class SileroVAD:
    """
    Silero VAD wrapper for detecting speech in audio streams.
    Accumulates audio, runs VAD, and emits speech segments.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        threshold: float = 0.5,
        min_speech_ms: int = 250,
        min_silence_ms: int = 500,
        chunk_size_ms: int = 30,
    ):
        self._sample_rate = sample_rate
        self._threshold = threshold
        self._min_speech_samples = int(sample_rate * min_speech_ms / 1000)
        self._min_silence_samples = int(sample_rate * min_silence_ms / 1000)
        self._chunk_size = int(sample_rate * chunk_size_ms / 1000)

        self._model = None
        self._speech_buffer: list[float] = []
        self._is_speaking = False
        self._silence_count = 0
        self._on_speech_segment: Optional[Callable] = None
        # Silero requires exactly 512 samples at 16kHz per inference call
        self._vad_window_size = 512 if sample_rate == 16000 else 256
        self._vad_accumulator: list[float] = []

    def load_model(self) -> None:
        """Load Silero VAD model. Call once at startup."""
        try:
            import torch
            model, utils = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                force_reload=False,
                trust_repo=True,
            )
            self._model = model
            self._get_speech_prob = utils[0]  # not used, we call model directly
        except ImportError:
            # Fallback: simple energy-based VAD
            self._model = None

    def set_callback(self, callback: Callable[[list[float], float], None]) -> None:
        """Set callback for when a speech segment is complete.
        callback(samples: list[float], timestamp: float)
        """
        self._on_speech_segment = callback

    def process_pcm16(self, pcm_data: bytes) -> bool:
        """
        Process raw PCM16 audio data. Returns True if speech detected.
        """
        # Convert PCM16 to float32 (truncate trailing odd byte if present)
        if len(pcm_data) % 2 != 0:
            pcm_data = pcm_data[:-1]
        n_samples = len(pcm_data) // 2
        if n_samples == 0:
            return False
        samples = struct.unpack(f"<{n_samples}h", pcm_data)
        float_samples = [s / 32768.0 for s in samples]
        return self._process_samples(float_samples)

    def _process_samples(self, samples: list[float]) -> bool:
        """Process float samples and detect speech.
        Buffers incoming samples and runs VAD in fixed-size windows
        (512 samples at 16kHz) as required by Silero.
        """
        self._vad_accumulator.extend(samples)
        last_is_speech = False

        # Process all complete windows
        while len(self._vad_accumulator) >= self._vad_window_size:
            window = self._vad_accumulator[:self._vad_window_size]
            self._vad_accumulator = self._vad_accumulator[self._vad_window_size:]

            is_speech = self._detect_speech(window)
            last_is_speech = is_speech

            if is_speech:
                self._speech_buffer.extend(window)
                self._silence_count = 0
                if not self._is_speaking:
                    self._is_speaking = True
            else:
                if self._is_speaking:
                    self._silence_count += len(window)
                    self._speech_buffer.extend(window)  # include trailing silence

                    if self._silence_count >= self._min_silence_samples:
                        # Speech segment ended
                        if len(self._speech_buffer) >= self._min_speech_samples:
                            if self._on_speech_segment:
                                self._on_speech_segment(
                                    self._speech_buffer.copy(),
                                    time.time(),
                                )
                        self._speech_buffer.clear()
                        self._is_speaking = False
                        self._silence_count = 0

        return last_is_speech

    def _detect_speech(self, samples: list[float]) -> bool:
        """Run VAD on samples."""
        if self._model is not None:
            try:
                import torch
                tensor = torch.FloatTensor(samples)
                prob = self._model(tensor, self._sample_rate).item()
                return prob >= self._threshold
            except Exception as e:
                log.warning(f"Silero VAD inference failed: {e}")

        # Fallback: energy-based detection
        energy = sum(s * s for s in samples) / max(len(samples), 1)
        return energy > 0.001  # rough threshold

    def flush(self) -> None:
        """Flush any remaining speech buffer."""
        if self._is_speaking and len(self._speech_buffer) >= self._min_speech_samples:
            if self._on_speech_segment:
                self._on_speech_segment(self._speech_buffer.copy(), time.time())
        self._speech_buffer.clear()
        self._vad_accumulator.clear()
        self._is_speaking = False
        self._silence_count = 0
