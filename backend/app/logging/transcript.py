"""
Append-only JSONL transcript logger. Flush after every write.
"""
import logging
from pathlib import Path
from typing import IO, Optional

from app.models import TranscriptEntry

_log = logging.getLogger(__name__)


class TranscriptLogger:
    def __init__(self, filepath: Path):
        self._filepath = filepath
        self._file: Optional[IO] = None

    def open(self) -> None:
        if self._file is not None:
            self._file.close()
        self._filepath.parent.mkdir(parents=True, exist_ok=True)
        self._file = open(self._filepath, "a", encoding="utf-8")

    def log(self, entry: TranscriptEntry) -> None:
        if self._file is None:
            _log.warning("TranscriptLogger.log() called before open() — entry dropped: %s", entry.speaker)
            return
        line = entry.model_dump_json() + "\n"
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
