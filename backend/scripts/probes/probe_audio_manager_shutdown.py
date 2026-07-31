"""P13: AudioManager stop drains final transcription before loggers close."""
from __future__ import annotations

import asyncio
import tempfile
import time
from pathlib import Path

from _common import ensure_pythonpath, pass_, Result, run_probe

ensure_pythonpath()

from app.audio.manager import AudioManager
from app.audio.transcriber import TranscriptionResult
from app.logging.events import EventLogger
from app.logging.lsl_markers import LSLMarkerLogger
from app.logging.transcript import TranscriptLogger


class _DummyVad:
    def flush(self) -> None:
        pass


class _SlowTranscriber:
    def transcribe(self, samples: list[float], sample_rate: int) -> TranscriptionResult:
        time.sleep(0.05)
        return TranscriptionResult(
            text="final utterance",
            start_ms=0,
            end_ms=int(len(samples) / sample_rate * 1000),
            confidence=0.99,
        )


async def _exercise(tmp: Path) -> str:
    event_logger = EventLogger(tmp / "events.jsonl")
    transcript_logger = TranscriptLogger(tmp / "transcript.jsonl")
    lsl_logger = LSLMarkerLogger(tmp / "lsl_markers.csv")
    event_logger.open()
    transcript_logger.open()
    lsl_logger.open()

    mgr = AudioManager(tmp, transcript_logger, event_logger, lsl_logger)
    mgr._vad_p1 = _DummyVad()
    mgr._vad_p2 = _DummyVad()
    mgr._transcriber = _SlowTranscriber()
    mgr._loop = asyncio.get_running_loop()
    mgr._session_start_time = time.time()
    mgr._recorder.open_all()

    mgr._on_speech_segment("P1", [0.1] * 1600, time.time(), 0)
    await mgr.stop()
    transcript_logger.close()
    event_logger.close()
    lsl_logger.close()

    text = (tmp / "transcript.jsonl").read_text()
    assert "final utterance" in text, "pending final transcript was not written before stop returned"
    return "pending final transcript drained before logger close"


def _probe() -> Result:
    with tempfile.TemporaryDirectory() as t:
        msg = asyncio.run(_exercise(Path(t)))
    return pass_("P13 audio manager shutdown", msg)


def main() -> Result:
    return run_probe("P13 audio manager shutdown", _probe)


if __name__ == "__main__":
    import sys
    r = main()
    sys.exit(0 if r.passed else 1)
