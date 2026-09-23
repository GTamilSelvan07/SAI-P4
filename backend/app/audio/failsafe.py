"""
Failsafe clip manager. Loads and serves pre-recorded condition-specific audio clips.
Auto-plays on LLM timeout.

Each `<clip>.wav` may have a `<clip>.json` sidecar holding the word and viseme
timings for that exact recording, written by `failsafe_clips/generate_clips.py`.
The timings must come from the same synthesis run as the audio — derive them
separately and the mouth visibly drifts against the voice. `duration_ms` in the
sidecar is checked against the WAV on load to catch that.

These clips play on every LLM timeout, which is the common path whenever Ollama
is slow — the moment Alex is most visible. A clip without a sidecar still
speaks; only the viseme timings are lost.
"""
import json
import random
import wave
import logging
from pathlib import Path
from typing import Optional

from app.audio.speech import SpeechAudio, resample_pcm16
from app.config import FAILSAFE_DIR, Condition, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS


log = logging.getLogger(__name__)

# A sidecar whose duration disagrees with its WAV by more than this came from a
# different synthesis run, so its timings do not describe this audio.
SIDECAR_DURATION_TOLERANCE_MS = 50


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


def _apply_sidecar(speech: SpeechAudio, sidecar: Path) -> None:
    """Attach a `<clip>.json` sidecar's timings to a clip, if it describes it.

    Silently leaves `speech` untimed when there is no sidecar: the clip is still
    audible, and the frontend derives what mouth movement it can. A sidecar that
    does not match the audio is worse than none, so a duration mismatch is
    rejected loudly rather than played as visible drift.
    """
    if not sidecar.exists():
        return
    try:
        data = json.loads(sidecar.read_text(encoding="utf-8"))
    except Exception as e:
        log.warning(f"Failsafe sidecar {sidecar.name} unreadable: {e}")
        return

    expected_ms = data.get("duration_ms")
    actual_ms = round(len(speech.pcm16) / 2 / speech.sample_rate * 1000)
    if expected_ms is None:
        log.warning(f"Failsafe sidecar {sidecar.name} has no duration_ms — cannot verify it matches the clip")
    elif abs(int(expected_ms) - actual_ms) > SIDECAR_DURATION_TOLERANCE_MS:
        log.warning(
            f"Failsafe sidecar {sidecar.name} describes {expected_ms}ms of audio but "
            f"{sidecar.stem}.wav is {actual_ms}ms — timings are from a different "
            f"synthesis run, dropping them. Regenerate both together."
        )
        return

    speech.words = list(data.get("words") or [])
    speech.wtimes = [int(t) for t in (data.get("wtimes") or [])]
    speech.wdurations = [int(d) for d in (data.get("wdurations") or [])]
    speech.visemes = list(data.get("visemes") or [])
    speech.vtimes = [int(t) for t in (data.get("vtimes") or [])]
    speech.vdurations = [int(d) for d in (data.get("vdurations") or [])]


class FailsafeManager:
    """Manages pre-recorded failsafe audio clips and their text templates."""

    def __init__(self):
        self._clips: dict[str, list[Path]] = {}  # category -> list of WAV files
        self._texts: dict[str, list[str]] = {}  # category -> list of text templates
        self._sidecar_count = 0

    def load_clips(self) -> int:
        """
        Load all failsafe clips from the failsafe directory.
        Expects files named like: c2_neutral_01.wav, c3_anchored_02.wav, etc.
        Also loads matching .txt files as text templates, and counts .json
        viseme sidecars so a missing set is visible at startup rather than
        mid-session.
        Returns number of clips loaded.
        """
        FAILSAFE_DIR.mkdir(parents=True, exist_ok=True)
        count = 0
        self._sidecar_count = 0

        for category in FAILSAFE_CATEGORIES:
            self._clips[category] = []
            self._texts[category] = []
            for wav_file in sorted(FAILSAFE_DIR.glob(f"{category}_*.wav")):
                self._clips[category].append(wav_file)
                count += 1
                if wav_file.with_suffix(".json").exists():
                    self._sidecar_count += 1
            for txt_file in sorted(FAILSAFE_DIR.glob(f"{category}_*.txt")):
                text = txt_file.read_text(encoding="utf-8").strip()
                if text:
                    self._texts[category].append(text)

        if count and self._sidecar_count < count:
            log.warning(
                f"[Failsafe] {count - self._sidecar_count} of {count} clips have no "
                f"viseme sidecar — the avatar's mouth will fall back to frontend "
                f"lipsync on LLM timeout. Regenerate with generate_clips.py --force "
                f"while the HeadTTS sidecar is running."
            )

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

    def get_clip_speech(self, category: str) -> Optional[SpeechAudio]:
        """Get a random clip from a category as a SpeechAudio.

        Carries the clip at its recorded rate for the browser and at the
        pipeline rate for the disk recorder, plus the sidecar's timings when
        they match this recording.
        """
        path = self.get_clip(category)
        if path is None or not path.exists():
            return None
        return self._read_clip(path)

    def get_clip_bytes(self, category: str) -> Optional[bytes]:
        """Get clip audio as raw PCM16 frames at AUDIO_SAMPLE_RATE."""
        speech = self.get_clip_speech(category)
        return speech.pcm16_pipeline if speech else None

    @staticmethod
    def _read_clip(path: Path) -> Optional[SpeechAudio]:
        """Read one clip WAV and, if it has one, its viseme sidecar."""
        try:
            with wave.open(str(path), "rb") as wf:
                if wf.getsampwidth() != 2:
                    log.warning(f"Failsafe clip {path} is not 16-bit PCM")
                    return None
                if wf.getnchannels() != AUDIO_CHANNELS:
                    log.warning(f"Failsafe clip {path} channel count {wf.getnchannels()} != {AUDIO_CHANNELS}")
                    return None
                rate = wf.getframerate()
                pcm = wf.readframes(wf.getnframes())
        except Exception as e:
            log.warning(f"Failed to read failsafe clip {path}: {e}")
            return None

        speech = SpeechAudio(
            pcm16=pcm,
            pcm16_pipeline=resample_pcm16(pcm, rate, AUDIO_SAMPLE_RATE),
            sample_rate=rate,
        )
        _apply_sidecar(speech, path.with_suffix(".json"))
        return speech

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
        """Get failsafe audio bytes for a condition, at AUDIO_SAMPLE_RATE."""
        category = self.get_condition_category(condition)
        return self.get_clip_bytes(category)

    def get_failsafe_speech_for_condition(self, condition: Condition) -> Optional[SpeechAudio]:
        """Get failsafe audio + viseme timings for a condition."""
        category = self.get_condition_category(condition)
        return self.get_clip_speech(category)

    @property
    def loaded(self) -> bool:
        return bool(self._texts)

    @property
    def clip_counts(self) -> dict[str, int]:
        return {cat: len(clips) for cat, clips in self._clips.items()}

    @property
    def sidecar_count(self) -> int:
        """How many loaded clips have a viseme sidecar."""
        return self._sidecar_count


# Global instance
failsafe_manager = FailsafeManager()
