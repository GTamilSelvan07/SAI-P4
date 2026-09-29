"""
Rich TTS result type.

`SpeechAudio` carries one synthesised utterance at two sample rates plus the
word- and viseme-level timings the browser avatar needs. Engines that cannot
produce timings return the same object with empty arrays, so call sites treat
lipsync as optional rather than branching on which engine is running.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from math import gcd
from typing import Optional

import numpy as np
from scipy.signal import resample_poly

log = logging.getLogger(__name__)


def resample_pcm16(pcm: bytes, src_rate: int, dst_rate: int) -> bytes:
    """Resample raw mono PCM16 with anti-aliasing. No-op when rates match."""
    if src_rate == dst_rate or not pcm:
        return pcm
    raw = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)
    g = gcd(src_rate, dst_rate)
    resampled = resample_poly(raw, dst_rate // g, src_rate // g)
    return np.clip(resampled, -32768, 32767).astype(np.int16).tobytes()


@dataclass
class SpeechAudio:
    """One utterance, at both the browser and the pipeline sample rate."""

    pcm16: bytes            # at `sample_rate` — what the browser plays
    pcm16_pipeline: bytes   # at AUDIO_SAMPLE_RATE — disk recorder + LiveKit
    sample_rate: int

    # Word-level timings, milliseconds from utterance start
    words: list[str] = field(default_factory=list)
    wtimes: list[int] = field(default_factory=list)
    wdurations: list[int] = field(default_factory=list)

    # Oculus viseme IDs and their timings, milliseconds from utterance start
    visemes: list[str] = field(default_factory=list)
    vtimes: list[int] = field(default_factory=list)
    vdurations: list[int] = field(default_factory=list)

    @property
    def has_lipsync(self) -> bool:
        """True when there is enough timing data to drive a mouth.

        Word timings alone are enough: TalkingHead's built-in English lipsync
        module derives visemes from `words` + `wtimes` when none are supplied.
        """
        return bool(self.words and self.wtimes)

    def lipsync(self) -> Optional[dict]:
        """The `lipsync` block of the `alex_speaking` frame, or None if untimed.

        Key names match TalkingHead's `speakAudio()` options exactly, so the
        frontend can spread them straight in with no renaming.
        """
        if not self.has_lipsync:
            return None
        return {
            "words": self.words,
            "wtimes": self.wtimes,
            "wdurations": self.wdurations,
            "visemes": self.visemes,
            "vtimes": self.vtimes,
            "vdurations": self.vdurations,
        }
