"""One-shot: generate p1_speech.wav and p2_speech.wav via the active TTS.
Run: python backend/scripts/probes/fixtures/generate_fixtures.py
"""
from __future__ import annotations
import sys
import wave
from pathlib import Path

# Make `app.*` and `_common` importable
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))  # backend/scripts/probes
sys.path.insert(0, str(HERE.parent.parent.parent))  # backend

from _common import ensure_pythonpath  # type: ignore

ensure_pythonpath()

from app.audio.tts import create_tts
from app.config import AUDIO_SAMPLE_RATE


SENTENCES = {
    "p1_speech.wav": "I think we should go with option A because it has the best track record.",
    "p2_speech.wav": "I would lean toward option B, the new candidate has stronger qualifications.",
}


def write_wav(path: Path, pcm16: bytes) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(AUDIO_SAMPLE_RATE)
        w.writeframes(pcm16)


def main() -> int:
    tts = create_tts()
    print(f"[fixtures] TTS backend: {type(tts).__name__}")
    for fname, text in SENTENCES.items():
        out = HERE / fname
        print(f"[fixtures] synthesizing {fname}: {text!r}")
        pcm = tts.get_pcm16(text)
        if pcm is None or len(pcm) == 0:
            print(f"[fixtures] FAIL: TTS returned empty for {fname}")
            return 1
        write_wav(out, pcm)
        dur = len(pcm) / 2 / AUDIO_SAMPLE_RATE
        print(f"[fixtures] wrote {out.name}: {len(pcm)} bytes, ~{dur:.2f}s")
    print("[fixtures] done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
