"""
Failsafe clip manager. Loads and serves pre-recorded condition-specific audio clips.
Auto-plays on LLM timeout.
"""
import random
import wave
import logging
from pathlib import Path
from typing import Optional

from app.config import FAILSAFE_DIR, Condition, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS


log = logging.getLogger(__name__)


# Clip categories matching PRD Section 4.5
FAILSAFE_CATEGORIES = {
    "c2_neutral": "Pre-recorded balanced summary",
    "c3_anchored": "Pre-recorded anchored summary",
    "c4_amplified": "Pre-recorded amplified follow-up",
    "c5_challenge": "Pre-recorded devil's advocate challenge",
    "sham_neutral": "Sham neutral filler message",
    "2min_warning": "Two-minute time warning",
    "transition": "Phase transition prompt",
}


UNIVERSAL_CATEGORIES = ["sham_neutral", "2min_warning", "transition"]

CONDITION_CLIP_CATEGORIES = {
    Condition.C1_SHAM: ["sham_neutral"],
    Condition.C2_NEUTRAL: ["c2_neutral"],
    Condition.C3_ANCHORING: ["c3_anchored"],
    Condition.C4_AMPLIFICATION: ["c4_amplified"],
    Condition.C5_DEVIL_ADVOCATE: ["c5_challenge"],
}


class FailsafeManager:
    """Manages pre-recorded failsafe audio clips and their text templates."""

    def __init__(self):
        self._clips: dict[str, list[Path]] = {}  # category -> list of WAV files
        self._texts: dict[str, list[str]] = {}  # category -> list of text templates

    def load_clips(self) -> int:
        """
        Load all failsafe clips from the failsafe directory.
        Expects files named like: c2_neutral_01.wav, c3_anchored_02.wav, etc.
        Also loads matching .txt files as text templates.
        Returns number of clips loaded.
        """
        FAILSAFE_DIR.mkdir(parents=True, exist_ok=True)
        count = 0

        for category in FAILSAFE_CATEGORIES:
            self._clips[category] = []
            self._texts[category] = []
            for wav_file in sorted(FAILSAFE_DIR.glob(f"{category}_*.wav")):
                self._clips[category].append(wav_file)
                count += 1
            for txt_file in sorted(FAILSAFE_DIR.glob(f"{category}_*.txt")):
                text = txt_file.read_text(encoding="utf-8").strip()
                if text:
                    self._texts[category].append(text)

        return count

    def get_clip_text(self, category: str, index: Optional[int] = None) -> Optional[str]:
        """Get text for a clip by category. Random if index is None."""
        texts = self._texts.get(category, [])
        if not texts:
            return None
        if index is not None and 0 <= index < len(texts):
            return texts[index]
        return random.choice(texts)

    def list_clips_for_condition(self, condition: Condition) -> list[dict]:
        """Return all clips (category + text) relevant to a condition + universal clips."""
        categories = CONDITION_CLIP_CATEGORIES.get(condition, []) + UNIVERSAL_CATEGORIES
        result = []
        for cat in categories:
            texts = self._texts.get(cat, [])
            for i, text in enumerate(texts):
                result.append({"category": cat, "index": i, "text": text})
        return result

    def get_clip(self, category: str) -> Optional[Path]:
        """Get a random clip from a category. Returns file path or None."""
        clips = self._clips.get(category, [])
        if not clips:
            return None
        return random.choice(clips)

    def get_clip_bytes(self, category: str) -> Optional[bytes]:
        """Get clip audio as raw PCM16 frames for the facilitator pipeline."""
        path = self.get_clip(category)
        if path and path.exists():
            try:
                with wave.open(str(path), "rb") as wf:
                    if wf.getsampwidth() != 2:
                        log.warning(f"Failsafe clip {path} is not 16-bit PCM")
                        return None
                    if wf.getnchannels() != AUDIO_CHANNELS:
                        log.warning(f"Failsafe clip {path} channel count {wf.getnchannels()} != {AUDIO_CHANNELS}")
                        return None
                    if wf.getframerate() != AUDIO_SAMPLE_RATE:
                        log.warning(f"Failsafe clip {path} sample rate {wf.getframerate()} != {AUDIO_SAMPLE_RATE}")
                        return None
                    return wf.readframes(wf.getnframes())
            except Exception as e:
                log.warning(f"Failed to read failsafe clip {path}: {e}")
        return None

    def get_condition_category(self, condition: Condition) -> str:
        """Map a condition to its failsafe category."""
        mapping = {
            Condition.C1_SHAM: "sham_neutral",
            Condition.C2_NEUTRAL: "c2_neutral",
            Condition.C3_ANCHORING: "c3_anchored",
            Condition.C4_AMPLIFICATION: "c4_amplified",
            Condition.C5_DEVIL_ADVOCATE: "c5_challenge",
        }
        return mapping.get(condition, "sham_neutral")

    def get_failsafe_for_condition(self, condition: Condition) -> Optional[bytes]:
        """Get failsafe audio bytes for a condition."""
        category = self.get_condition_category(condition)
        return self.get_clip_bytes(category)

    @property
    def loaded(self) -> bool:
        return bool(self._texts)

    @property
    def clip_counts(self) -> dict[str, int]:
        return {cat: len(clips) for cat, clips in self._clips.items()}


# Global instance
failsafe_manager = FailsafeManager()
