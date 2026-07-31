"""
Video recording — receives WebM chunks from participant browsers and writes to disk.
Lazy-open: file is only created on first chunk to avoid 0-byte zombie files.

Tracks chunk timing/byte counts so a researcher dashboard can show recording health.
"""
import threading
import time
from pathlib import Path
from typing import Optional, BinaryIO


class WebMRecorder:
    """Streams WebM chunks to a file. Lazy-open, thread-safe, flush-on-write (crash-safe)."""

    def __init__(self, filepath: Path):
        self._filepath = filepath
        self._file: Optional[BinaryIO] = None
        self._lock = threading.Lock()
        self._bytes_written = filepath.stat().st_size if filepath.exists() else 0
        self._first_chunk_at: Optional[float] = None
        self._last_chunk_at: Optional[float] = None
        self._closed = False

    def write_chunk(self, chunk: bytes) -> bool:
        """Write a WebM chunk to disk. Lazy-opens the file on first chunk. Flush for crash safety."""
        if not chunk:
            return False
        with self._lock:
            if self._closed:
                return False
            if self._file is None:
                self._filepath.parent.mkdir(parents=True, exist_ok=True)
                # Never truncate an existing recording. If the backend restarts
                # or a late websocket reconnect arrives, preserving bytes already
                # on disk is more important than starting a fresh container.
                mode = "ab" if self._filepath.exists() and self._filepath.stat().st_size > 0 else "wb"
                self._file = open(self._filepath, mode)
                self._first_chunk_at = time.time()
            self._file.write(chunk)
            self._file.flush()
            self._bytes_written += len(chunk)
            self._last_chunk_at = time.time()
            return True

    def close(self) -> None:
        with self._lock:
            if self._file:
                self._file.close()
                self._file = None
            self._closed = True

    @property
    def is_active(self) -> bool:
        """True iff at least one chunk has been written."""
        return self._first_chunk_at is not None

    @property
    def bytes_written(self) -> int:
        return self._bytes_written

    @property
    def last_chunk_at(self) -> Optional[float]:
        return self._last_chunk_at

    @property
    def first_chunk_at(self) -> Optional[float]:
        return self._first_chunk_at

    @property
    def filepath(self) -> Path:
        return self._filepath

    def status(self) -> dict:
        """Snapshot for /api/sessions/{id}/recording_status."""
        now = time.time()
        return {
            "active": self.is_active,
            "bytes_written": self._bytes_written,
            "last_chunk_age_s": (now - self._last_chunk_at) if self._last_chunk_at else None,
            "first_chunk_at": self._first_chunk_at,
        }


class VideoRecorderManager:
    """Manages video recording files for P1 and P2."""

    def __init__(self, session_dir: Path):
        self._session_dir = session_dir
        self._p1 = WebMRecorder(session_dir / "video_p1.webm")
        self._p2 = WebMRecorder(session_dir / "video_p2.webm")

    def close_all(self) -> None:
        self._p1.close()
        self._p2.close()

    def write_participant(self, role: str, chunk: bytes) -> bool:
        if role == "P1":
            return self._p1.write_chunk(chunk)
        elif role == "P2":
            return self._p2.write_chunk(chunk)
        return False

    def get_recorder(self, role: str) -> Optional[WebMRecorder]:
        if role == "P1":
            return self._p1
        if role == "P2":
            return self._p2
        return None

    def status(self) -> dict:
        return {"P1": self._p1.status(), "P2": self._p2.status()}


class VideoRegistry:
    """Registry of active VideoRecorderManagers by session_id."""

    def __init__(self):
        self._managers: dict[str, VideoRecorderManager] = {}

    def create(self, session_id: str, session_dir: Path) -> VideoRecorderManager:
        """Create a manager. Files are NOT opened here — they're lazy-opened on first chunk."""
        mgr = VideoRecorderManager(session_dir)
        self._managers[session_id] = mgr
        return mgr

    def get(self, session_id: str) -> Optional[VideoRecorderManager]:
        return self._managers.get(session_id)

    def remove(self, session_id: str) -> None:
        mgr = self._managers.pop(session_id, None)
        if mgr:
            mgr.close_all()


video_registry = VideoRegistry()
