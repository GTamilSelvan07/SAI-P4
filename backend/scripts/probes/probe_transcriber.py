"""P4: Transcriber returns text for a known fixture WAV."""
from __future__ import annotations
import wave
from pathlib import Path

import numpy as np

from _common import ensure_pythonpath, pass_, fail_, FIXTURES_DIR, Result, run_probe

ensure_pythonpath()

from app.audio.transcriber import create_transcriber


def _load_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        n = w.getnframes()
        raw = w.readframes(n)
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def _probe() -> Result:
    fixture = FIXTURES_DIR / "p1_speech.wav"
    if not fixture.exists():
        return fail_("P4 transcriber", f"fixture missing: {fixture} — run generate_fixtures.py first")

    transcriber = create_transcriber()
    backend = type(transcriber).__name__

    samples = _load_wav(fixture)
    result = transcriber.transcribe(samples, sample_rate=16000)
    assert result is not None, f"{backend} returned None"
    text = (result.text or "").strip()
    assert len(text) > 0, f"{backend} returned empty text"
    return pass_("P4 transcriber", f"backend={backend}, text={text!r}")


def main() -> Result:
    return run_probe("P4 transcriber", _probe)


if __name__ == "__main__":
    import sys
    r = main()
    sys.exit(0 if r.passed else 1)
