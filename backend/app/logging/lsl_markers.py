"""
LSL event markers for future physiology synchronisation.
Writes to CSV as fallback, and pushes to LSL outlet if pylsl is available.
"""
import csv
import logging
import time
from pathlib import Path
from typing import IO, Optional


log = logging.getLogger(__name__)


class LSLMarkerLogger:
    """Logs event markers to CSV and optionally to an LSL stream."""

    def __init__(self, filepath: Path):
        self._filepath = filepath
        self._file: Optional[IO] = None
        self._writer = None
        self._outlet = None

    def open(self) -> None:
        if self._file is not None:
            self._file.close()
        self._filepath.parent.mkdir(parents=True, exist_ok=True)
        self._file = open(self._filepath, "a", newline="", encoding="utf-8")
        self._writer = csv.writer(self._file)
        # Write header if file is empty
        try:
            if self._filepath.stat().st_size == 0:
                self._writer.writerow(["timestamp", "marker", "detail"])
                self._file.flush()
        except Exception as e:
            log.warning(f"LSL CSV header write failed: {e}")

        # Try to create LSL outlet
        try:
            import pylsl
            info = pylsl.StreamInfo(
                name="ExperimentMarkers",
                type="Markers",
                channel_count=1,
                nominal_srate=0,  # irregular rate
                channel_format=pylsl.cf_string,
                source_id="phys_guardrails_markers",
            )
            self._outlet = pylsl.StreamOutlet(info)
        except ImportError:
            self._outlet = None

    def push(self, marker: str, detail: str = "") -> None:
        ts = time.time()
        try:
            if self._writer is not None and self._file is not None and not self._file.closed:
                self._writer.writerow([ts, marker, detail])
                self._file.flush()
        except (ValueError, OSError) as e:
            log.warning(f"LSL CSV marker write failed: {e}")
        if self._outlet is not None:
            try:
                self._outlet.push_sample([f"{marker}:{detail}"])
            except Exception as e:
                log.warning(f"LSL outlet marker push failed: {e}")

    def close(self) -> None:
        if self._file is not None:
            self._file.flush()
            self._file.close()
            self._file = None
        self._outlet = None

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *args):
        self.close()
