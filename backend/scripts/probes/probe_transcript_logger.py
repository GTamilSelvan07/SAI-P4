"""P2: TranscriptLogger flush-on-write + round-trip."""
from __future__ import annotations
import tempfile
from pathlib import Path

from _common import ensure_pythonpath, pass_, Result, run_probe

ensure_pythonpath()

from app.logging.transcript import TranscriptLogger
from app.models import TranscriptEntry


def _probe() -> Result:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "transcript.jsonl"
        logger = TranscriptLogger(path)
        logger.open()

        entries = [
            TranscriptEntry(speaker="P1", start_ms=0, end_ms=2000, text="i think option A is best", confidence=0.92, channel=0),
            TranscriptEntry(speaker="P2", start_ms=2200, end_ms=4500, text="i prefer option B", confidence=0.88, channel=1),
            TranscriptEntry(speaker="Alex", start_ms=4600, end_ms=7000, text="both have merit", confidence=1.0, channel=2),
            TranscriptEntry(speaker="P1", start_ms=7100, end_ms=9000, text="hmm", confidence=0.55, channel=0),
            TranscriptEntry(speaker="P2", start_ms=9100, end_ms=12000, text="let me think about that", confidence=0.81, channel=1),
        ]

        sizes = []
        for e in entries:
            logger.log(e)
            sizes.append(path.stat().st_size)

        for i in range(1, len(sizes)):
            assert sizes[i] > sizes[i - 1], f"file did not grow after write #{i}"

        logger.close()

        lines = path.read_text().strip().split("\n")
        assert len(lines) == 5, f"expected 5 lines, got {len(lines)}"
        for line in lines:
            TranscriptEntry.model_validate_json(line)

    return pass_("P2 transcript_logger", f"5 entries flushed, parsed back 5/5")


def main() -> Result:
    return run_probe("P2 transcript_logger", _probe)


if __name__ == "__main__":
    import sys
    r = main()
    sys.exit(0 if r.passed else 1)
