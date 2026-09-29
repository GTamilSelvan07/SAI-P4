"""
In-memory cache of Alex's recent utterances, served over HTTP.

At 24 kHz a 12-second utterance is roughly 576 KB of PCM — about 770 KB once
base64-encoded — sent to three clients over the same WebSocket that carries
transcripts and control messages. Handing out a URL instead keeps that socket
free, and lets the frontend fetch straight into an AudioContext rather than
round-tripping through a data: URL on an <audio> element.

Memory only: these are transient playback buffers. The session's audio of
record is `audio_alex.wav`, written by the audio manager at the pipeline rate.
"""
from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)

# Per session. An utterance is only fetched moments after it is broadcast, so
# this only has to outlive the round trip — the bound is for a long session
# with a slow or reconnecting client, not for history.
MAX_UTTERANCES_PER_SESSION = 32


@dataclass(frozen=True)
class CachedUtterance:
    """Raw PCM16 LE mono, at `sample_rate`."""
    pcm: bytes
    sample_rate: int


def utterance_url(session_id: str, utterance_id: str) -> str:
    """The path the frontend fetches this utterance's audio from."""
    return f"/api/sessions/{session_id}/utterances/{utterance_id}.pcm"


class UtteranceCache:
    """Bounded per-session store of recently broadcast utterance audio."""

    def __init__(self):
        self._sessions: dict[str, OrderedDict[str, CachedUtterance]] = {}
        self._lock = threading.Lock()

    def put(self, session_id: str, utterance_id: str, pcm: bytes, sample_rate: int) -> str:
        """Store one utterance, evicting the oldest past the cap. Returns its URL."""
        with self._lock:
            utterances = self._sessions.setdefault(session_id, OrderedDict())
            utterances[utterance_id] = CachedUtterance(pcm=pcm, sample_rate=sample_rate)
            utterances.move_to_end(utterance_id)
            while len(utterances) > MAX_UTTERANCES_PER_SESSION:
                utterances.popitem(last=False)
        return utterance_url(session_id, utterance_id)

    def get(self, session_id: str, utterance_id: str) -> Optional[CachedUtterance]:
        with self._lock:
            return self._sessions.get(session_id, {}).get(utterance_id)

    def drop_session(self, session_id: str) -> None:
        """Release a session's buffers. Called when the session ends."""
        with self._lock:
            self._sessions.pop(session_id, None)


utterance_cache = UtteranceCache()
