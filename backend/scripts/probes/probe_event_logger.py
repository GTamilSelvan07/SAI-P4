"""P1: EventLogger flush-on-write + round-trip."""
from __future__ import annotations
import json
import tempfile
from pathlib import Path

from _common import ensure_pythonpath, pass_, fail_, Result, run_probe

ensure_pythonpath()

from app.logging.events import EventLogger
from app.models import EventEntry, EventType, AISource, TriggerType


def _probe() -> Result:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "events.jsonl"
        logger = EventLogger(path)
        logger.open()

        events = [
            EventEntry(type=EventType.SESSION_START, content="probe"),
            EventEntry(type=EventType.PHASE_CHANGE, phase="info_reading", condition="C2"),
            EventEntry(
                type=EventType.AI_INTERVENTION,
                condition="C2",
                content="hello world",
                trigger=TriggerType.TIMER,
                source=AISource.LIVE_LLM,
                model="gemma4:26b",
                llm_latency_ms=234,
                tts_latency_ms=120,
            ),
            EventEntry(type=EventType.DECISION_VOTE, speaker="P1", content="A"),
            EventEntry(type=EventType.SESSION_END, extra={"duration": 60}),
        ]

        sizes = []
        for ev in events:
            logger.log(ev)
            sizes.append(path.stat().st_size)

        # Each write must grow the file (flush-on-write proof)
        for i in range(1, len(sizes)):
            assert sizes[i] > sizes[i - 1], (
                f"file did not grow after write #{i}: {sizes}"
            )

        logger.close()

        # Round-trip parse
        lines = path.read_text().strip().split("\n")
        assert len(lines) == 5, f"expected 5 lines, got {len(lines)}"
        for line in lines:
            parsed = EventEntry.model_validate_json(line)
            assert parsed.type is not None

    return pass_("P1 event_logger", f"5 events flushed, parsed back {len(lines)}/5")


def main() -> Result:
    return run_probe("P1 event_logger", _probe)


if __name__ == "__main__":
    import sys
    r = main()
    sys.exit(0 if r.passed else 1)
