"""
Generate failsafe audio clips using the app's offline TTS factory.
Run before data collection:

    PYTHONPATH=backend python3 backend/failsafe_clips/generate_clips.py

Each clip gets a `.wav`, a `.txt` with its text, and — when the engine produces
timings — a `.json` sidecar with the word and viseme arrays for that exact
recording. The avatar needs the sidecars, so start the HeadTTS sidecar first;
without it the clips are audible but the mouth falls back to frontend lipsync.

Timings and audio must come from the same synthesis run, so regenerating one
means regenerating both. Existing clips are skipped unless you pass --force.
"""
from __future__ import annotations

import argparse
import json
import sys
import wave
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.audio.speech import SpeechAudio  # noqa: E402
from app.audio.tts import create_tts  # noqa: E402
from app.config import AUDIO_CHANNELS  # noqa: E402


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


def _write_wav(path: Path, pcm: bytes, sample_rate: int) -> None:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(AUDIO_CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)


def _write_sidecar(path: Path, speech: SpeechAudio, text: str) -> None:
    """Write the viseme sidecar for a clip.

    `duration_ms` lets the loader reject a sidecar that no longer describes its
    WAV, which is what happens when only one of the pair is regenerated.
    """
    duration_ms = round(len(speech.pcm16) / 2 / speech.sample_rate * 1000)
    path.write_text(json.dumps({
        "text": text,
        "sample_rate": speech.sample_rate,
        "duration_ms": duration_ms,
        "words": speech.words,
        "wtimes": speech.wtimes,
        "wdurations": speech.wdurations,
        "visemes": speech.visemes,
        "vtimes": speech.vtimes,
        "vdurations": speech.vdurations,
    }, indent=1), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force", action="store_true",
        help="regenerate clips that already exist (needed to add viseme sidecars)",
    )
    args = parser.parse_args()

    tts = create_tts()
    print(f"Engine: {type(tts).__name__}")
    total = 0
    failed = 0
    untimed = 0

    for category, texts in CLIP_TEMPLATES.items():
        for i, text in enumerate(texts):
            stem = f"{category}_{i + 1:02d}"
            wav_path = CLIPS_DIR / f"{stem}.wav"
            json_path = CLIPS_DIR / f"{stem}.json"
            txt_path = CLIPS_DIR / f"{stem}.txt"

            if wav_path.exists() and not args.force:
                if not json_path.exists():
                    print(f"  SKIP {stem} (exists, but has NO viseme sidecar — rerun with --force)")
                    untimed += 1
                else:
                    print(f"  SKIP {stem} (already exists)")
                total += 1
                continue

            speech = tts.synthesize_speech(text)
            if speech is None or not speech.pcm16:
                print(f"  FAIL {stem} - offline TTS returned no audio")
                failed += 1
                continue

            _write_wav(wav_path, speech.pcm16, speech.sample_rate)
            # Rewritten only alongside the audio, so the .txt always describes
            # the recording rather than whatever the template now says.
            txt_path.write_text(text, encoding="utf-8")
            if speech.has_lipsync:
                _write_sidecar(json_path, speech, text)
                print(f"  OK   {stem} ({speech.sample_rate}Hz, {len(speech.visemes)} visemes)")
            else:
                json_path.unlink(missing_ok=True)  # never leave stale timings beside new audio
                print(f"  WARN {stem} ({speech.sample_rate}Hz, no timings — engine returned none)")
                untimed += 1
            total += 1

    print(f"\nGenerated {total} clips, {failed} failed, {untimed} without viseme sidecars")
    if untimed:
        print(
            "Clips without sidecars still play, but the avatar's mouth falls back to\n"
            "frontend lipsync — and these clips play on every LLM timeout. Start the\n"
            "HeadTTS sidecar (docs/SETUP.md step 3) and rerun with --force."
        )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
