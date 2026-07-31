"""
Generate failsafe audio clips using the app's offline TTS factory.
Run before data collection:

    PYTHONPATH=backend python3 backend/failsafe_clips/generate_clips.py
"""
from __future__ import annotations

import sys
import wave
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.audio.tts import create_tts  # noqa: E402
from app.config import AUDIO_CHANNELS, AUDIO_SAMPLE_RATE  # noqa: E402


CLIPS_DIR = Path(__file__).parent

# 3 variants per category (PRD Section 4.5 — 21 total)
CLIP_TEMPLATES = {
    "c2_neutral": [
        "Both of you have raised important points. Participant 1 mentioned some key factors, and Participant 2 raised relevant considerations. What other information should we consider?",
        "Let me summarise where things stand. Both of you have shared valuable perspectives. Are there any points that haven't been fully explored yet?",
        "Thank you both for your contributions. I want to make sure we've covered all the important aspects. Is there anything else either of you would like to add?",
    ],
    "c3_anchored": [
        "It sounds like this option has some strong points that both of you have touched on. What do you think about it as the leading choice?",
        "Building on what we've discussed, this option seems to have significant advantages. How does the group feel about moving in this direction?",
        "Several of the points raised seem to support this particular option. Can we explore what makes it stand out from the alternatives?",
    ],
    "c4_amplified": [
        "That's a really interesting point you made. Could you tell us more about your thinking there?",
        "You raised something important earlier that I think deserves more attention. Could you elaborate on that?",
        "I noticed you have a unique perspective on this. What additional details can you share with the group?",
    ],
    "c5_challenge": [
        "Before you decide, I want to play devil's advocate. What are the potential downsides of the option you're leaning toward? Is there information you might be overlooking?",
        "Hold on, let's make sure we're not converging too quickly. What are the strongest arguments against the current favourite? What would need to be true for a different option to be better?",
        "I notice the group may be moving toward a decision. But have you fully considered the alternatives? What unique strengths do the other options have?",
    ],
    "sham_neutral": [
        "The discussion is progressing well. Both of you have been contributing.",
        "The discussion is ongoing. Both participants have shared their thoughts.",
        "Thank you for your contributions so far. The conversation is moving forward.",
    ],
    "2min_warning": [
        "You have about 2 minutes remaining to reach a decision.",
        "Just a reminder, there are approximately 2 minutes left in this discussion.",
        "We're approaching the end of the discussion. About 2 minutes remain.",
    ],
    "transition": [
        "Thank you. Now, Participant 2, please share your initial thoughts.",
        "Thank you for sharing. Now let's hear from the other participant.",
        "That's helpful context. Let's now hear the other perspective.",
    ],
}


def _write_wav(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(AUDIO_CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(AUDIO_SAMPLE_RATE)
        wf.writeframes(pcm)


def main() -> int:
    tts = create_tts()
    total = 0
    failed = 0

    for category, texts in CLIP_TEMPLATES.items():
        for i, text in enumerate(texts):
            filename = f"{category}_{i + 1:02d}.wav"
            output_path = CLIPS_DIR / filename

            if output_path.exists():
                print(f"  SKIP {filename} (already exists)")
                total += 1
                continue

            pcm = tts.get_pcm16(text)
            if not pcm:
                print(f"  FAIL {filename} - offline TTS returned no audio")
                failed += 1
                txt_path = CLIPS_DIR / f"{category}_{i + 1:02d}.txt"
                txt_path.write_text(text, encoding="utf-8")
                continue

            _write_wav(output_path, pcm)
            print(f"  OK   {filename}")
            total += 1

    print(f"\nGenerated {total} clips, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
