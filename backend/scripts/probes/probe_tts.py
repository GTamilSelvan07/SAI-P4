"""P5: TTS synthesizes audible PCM16 at 16kHz."""
from __future__ import annotations

from _common import ensure_pythonpath, pass_, Result, run_probe

ensure_pythonpath()

from app.audio.tts import create_tts
from app.config import AUDIO_SAMPLE_RATE


def _probe() -> Result:
    tts = create_tts()
    backend = type(tts).__name__
    text = "This is a test sentence."
    pcm = tts.get_pcm16(text)
    assert pcm is not None, f"{backend} returned None"
    assert len(pcm) >= AUDIO_SAMPLE_RATE, (
        f"{backend} returned {len(pcm)} bytes, expected ≥ {AUDIO_SAMPLE_RATE} (1s of pcm16 at 16kHz)"
    )
    # All samples must be valid pcm16 (length must be even)
    assert len(pcm) % 2 == 0, f"odd byte count {len(pcm)} — not valid pcm16"
    duration = len(pcm) / 2 / AUDIO_SAMPLE_RATE
    return pass_("P5 tts", f"backend={backend}, {len(pcm)} bytes, ~{duration:.2f}s @ {AUDIO_SAMPLE_RATE}Hz")


def main() -> Result:
    return run_probe("P5 tts", _probe)


if __name__ == "__main__":
    import sys
    r = main()
    sys.exit(0 if r.passed else 1)
