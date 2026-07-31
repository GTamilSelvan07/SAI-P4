"""
Per-channel WAV recorder with streaming writes.
Data is on disk continuously — crash-safe.
"""
import logging
import wave
import struct
import threading
from pathlib import Path
from typing import Optional

import numpy as np

from app.config import AUDIO_SAMPLE_RATE, AUDIO_CHANNELS

log = logging.getLogger(__name__)


class WavRecorder:
    """Streams audio frames to a WAV file in real time."""

    def __init__(self, filepath: Path, sample_rate: int = AUDIO_SAMPLE_RATE):
        self._filepath = filepath
        self._sample_rate = sample_rate
        self._file: Optional[wave.Wave_write] = None
        self._lock = threading.Lock()
        self._frame_count = 0

    def open(self) -> None:
        self._filepath.parent.mkdir(parents=True, exist_ok=True)
        self._file = wave.open(str(self._filepath), "wb")
        self._file.setnchannels(AUDIO_CHANNELS)
        self._file.setsampwidth(2)  # 16-bit
        self._file.setframerate(self._sample_rate)

    def write_frames(self, pcm_data: bytes) -> None:
        """Write raw PCM16 audio data. Thread-safe."""
        with self._lock:
            if self._file is not None:
                self._file.writeframes(pcm_data)
                raw_file = getattr(self._file, "_file", None)
                if raw_file is not None:
                    raw_file.flush()
                self._frame_count += len(pcm_data) // 2  # 16-bit = 2 bytes per sample

    def write_samples(self, samples: list[float]) -> None:
        """Write float samples [-1.0, 1.0] as PCM16."""
        pcm = struct.pack(f"<{len(samples)}h", *[
            max(-32768, min(32767, int(s * 32767))) for s in samples
        ])
        self.write_frames(pcm)

    @property
    def duration_seconds(self) -> float:
        return self._frame_count / self._sample_rate if self._sample_rate > 0 else 0.0

    def close(self) -> None:
        with self._lock:
            if self._file is not None:
                self._file.close()
                self._file = None

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *args):
        self.close()


class MultiChannelRecorder:
    """Manages WAV recorders for P1, P2, Alex, and mixed audio."""

    def __init__(self, session_dir: Path):
        self.p1 = WavRecorder(session_dir / "audio_p1.wav")
        self.p2 = WavRecorder(session_dir / "audio_p2.wav")
        self.alex = WavRecorder(session_dir / "audio_alex.wav")
        self._mixed_filepath = session_dir / "audio_mixed.wav"

    def open_all(self) -> None:
        self.p1.open()
        self.p2.open()
        self.alex.open()
        # Mixed is generated post-hoc in close_all() — not opened here

    def close_all(self) -> None:
        self.p1.close()
        self.p2.close()
        self.alex.close()
        self._generate_mixed()

    def write_participant(self, role: str, pcm_data: bytes) -> None:
        """Write audio from a participant channel."""
        if role == "P1":
            self.p1.write_frames(pcm_data)
        elif role == "P2":
            self.p2.write_frames(pcm_data)

    def write_alex(self, pcm_data: bytes) -> None:
        """Write AI facilitator audio."""
        self.alex.write_frames(pcm_data)

    def _generate_mixed(self) -> None:
        """Post-hoc mix of P1 + P2 + Alex channels using sample-by-sample addition."""
        try:
            channels = [self.p1._filepath, self.p2._filepath, self.alex._filepath]
            arrays = []
            for path in channels:
                if path.exists() and path.stat().st_size > 44:  # WAV header = 44 bytes
                    with wave.open(str(path), "rb") as wf:
                        frames = wf.readframes(wf.getnframes())
                        data = np.frombuffer(frames, dtype="<i2")
                        if wf.getnchannels() > 1:
                            data = data.reshape(-1, wf.getnchannels()).mean(axis=1).astype(np.int16)
                        arrays.append(data.astype(np.int32))

            if not arrays:
                return

            max_len = max(len(a) for a in arrays)
            mixed = np.zeros(max_len, dtype=np.int32)
            for a in arrays:
                mixed[:len(a)] += a

            mixed = np.clip(mixed, -32768, 32767).astype(np.int16)
            with wave.open(str(self._mixed_filepath), "wb") as wf:
                wf.setnchannels(AUDIO_CHANNELS)
                wf.setsampwidth(2)
                wf.setframerate(AUDIO_SAMPLE_RATE)
                wf.writeframes(mixed.astype("<i2").tobytes())
        except Exception as e:
            log.warning(f"Failed to generate mixed audio: {e}")
