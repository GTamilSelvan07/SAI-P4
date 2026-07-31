"""
Append-only JSONL event logger. Flush after every write.
Crash-safe: at most one line lost on process death.
"""
import json
import logging
from pathlib import Path
from typing import IO, Optional

from app.models import EventEntry

_log = logging.getLogger(__name__)


class EventLogger:
    def __init__(self, filepath: Path):
        self._filepath = filepath
        self._file: Optional[IO] = None

    def open(self) -> None:
        if self._file is not None:
            self._file.close()
        self._filepath.parent.mkdir(parents=True, exist_ok=True)
        self._file = open(self._filepath, "a", encoding="utf-8")

    def log(self, event: EventEntry) -> None:
        if self._file is None:
            _log.warning("EventLogger.log() called before open() — event dropped: %s", event.type)
            return
        line = event.model_dump_json() + "\n"
        self._file.write(line)
        self._file.flush()

    def close(self) -> None:
        if self._file is not None:
            self._file.flush()
            self._file.close()
            self._file = None

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *args):
        self.close()
