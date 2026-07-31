"""
AudioManager — orchestrates recording, VAD, and transcription for a session.
Each participant's audio flows: WebSocket PCM → WAV recorder → VAD → Whisper → transcript log.
"""
import time
import asyncio
import concurrent.futures
import logging
from pathlib import Path
from typing import Optional, Callable, Awaitable

from app.config import AUDIO_SAMPLE_RATE, TRANSCRIPT_SHUTDOWN_DRAIN_TIMEOUT_SECONDS
from app.models import TranscriptEntry
from app.logging.transcript import TranscriptLogger
from app.logging.events import EventLogger
from app.logging.lsl_markers import LSLMarkerLogger
from app.audio.recorder import MultiChannelRecorder
from app.audio.vad import SileroVAD
from app.audio.transcriber import create_transcriber, TranscriptionResult


log = logging.getLogger(__name__)


class AudioManager:
    """
    Manages audio processing for one session.
    - Records per-channel WAV files
    - Runs VAD per channel
    - Transcribes speech segments
    - Logs transcripts
    - Notifies via callback for real-time UI updates
    """

    def __init__(
        self,
        session_dir: Path,
        transcript_logger: TranscriptLogger,
        event_logger: EventLogger,
        lsl_logger: LSLMarkerLogger,
        on_transcript: Optional[Callable[[TranscriptEntry], Awaitable[None]]] = None,
        on_vad: Optional[Callable[[str, bool], Awaitable[None]]] = None,
    ):
        self._session_dir = session_dir
        self._transcript_logger = transcript_logger
        self._event_logger = event_logger
        self._lsl_logger = lsl_logger
        self._on_transcript = on_transcript  # async callback for real-time WebSocket push
        self._on_vad = on_vad  # async callback for speaking indicator

        # Recorders
        self._recorder = MultiChannelRecorder(session_dir)

        # VAD per channel
        self._vad_p1 = SileroVAD()
        self._vad_p2 = SileroVAD()

        # Transcriber (shared across channels)
        self._transcriber = create_transcriber()

        # Timing
        self._session_start_time: float = 0.0

        # Async event loop reference
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._pending_transcripts: set[concurrent.futures.Future] = set()

    def start(self) -> None:
        """Open all recorders and initialize VAD + transcriber."""
        self._recorder.open_all()
        self._session_start_time = time.time()

        # Load VAD models
        self._vad_p1.load_model()
        self._vad_p2.load_model()

        # Set VAD callbacks
        self._vad_p1.set_callback(
            lambda samples, ts: self._on_speech_segment("P1", samples, ts, 0)
        )
        self._vad_p2.set_callback(
            lambda samples, ts: self._on_speech_segment("P2", samples, ts, 1)
        )

        # Store event loop for async callbacks from sync VAD threads
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

    async def stop(self) -> None:
        """Flush VAD, drain pending transcripts, and close all recorders."""
        self._vad_p1.flush()
        self._vad_p2.flush()
        await self._drain_pending_transcripts()
        self._recorder.close_all()

    def process_audio(self, role: str, pcm_data: bytes) -> None:
        """
        Process incoming PCM16 audio from a participant.
        Called from WebSocket handler.
        """
        # Record to WAV
        self._recorder.write_participant(role, pcm_data)

        # Run VAD
        if role == "P1":
            is_speech = self._vad_p1.process_pcm16(pcm_data)
        elif role == "P2":
            is_speech = self._vad_p2.process_pcm16(pcm_data)
        else:
            return

        # Notify speaking state change
        if self._on_vad and self._loop:
            asyncio.run_coroutine_threadsafe(
                self._on_vad(role, is_speech),
                self._loop,
            )

    def write_alex_audio(self, pcm_data: bytes) -> None:
        """Write AI facilitator audio to disk."""
        self._recorder.write_alex(pcm_data)

    def _on_speech_segment(
        self,
        speaker: str,
        samples: list[float],
        timestamp: float,
        channel: int,
    ) -> None:
        """Called by VAD when a complete speech segment is detected.
        Schedules async transcription to avoid blocking the event loop."""
        if self._loop:
            future = asyncio.run_coroutine_threadsafe(
                self._on_speech_segment_async(speaker, samples, timestamp, channel),
                self._loop,
            )
            self._pending_transcripts.add(future)

            def _done(done: concurrent.futures.Future) -> None:
                self._pending_transcripts.discard(done)
                try:
                    done.result()
                except concurrent.futures.CancelledError:
                    pass
                except Exception as e:
                    log.warning(f"Transcript task failed for {speaker}: {e}")

            future.add_done_callback(_done)
        else:
            log.warning(f"Dropped speech segment for {speaker}: audio event loop unavailable")

    async def _drain_pending_transcripts(self) -> None:
        """Wait for transcript writes scheduled by the final VAD flush."""
        if not self._pending_transcripts:
            return
        pending = list(self._pending_transcripts)
        try:
            await asyncio.wait_for(
                asyncio.gather(
                    *(asyncio.wrap_future(f) for f in pending),
                    return_exceptions=True,
                ),
                timeout=TRANSCRIPT_SHUTDOWN_DRAIN_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            log.warning(
                "Timed out waiting for %d pending transcript task(s) during audio shutdown",
                len([f for f in pending if not f.done()]),
            )

    async def _on_speech_segment_async(
        self,
        speaker: str,
        samples: list[float],
        timestamp: float,
        channel: int,
    ) -> None:
        """Async handler: runs transcription in thread pool, then logs + notifies."""
        duration_ms = int(len(samples) / AUDIO_SAMPLE_RATE * 1000)
        start_ms = int((timestamp - duration_ms / 1000 - self._session_start_time) * 1000)
        end_ms = int((timestamp - self._session_start_time) * 1000)

        # Transcribe in thread pool to avoid blocking event loop
        try:
            result = await asyncio.get_running_loop().run_in_executor(
                None, self._transcriber.transcribe, samples, AUDIO_SAMPLE_RATE
            )
        except Exception as e:
            log.error(f"Transcription error for {speaker}: {e}")
            result = None

        if result is None:
            entry = TranscriptEntry(
                ts=timestamp,
                speaker=speaker,
                start_ms=max(0, start_ms),
                end_ms=max(0, end_ms),
                text="[audio segment — transcription unavailable]",
                confidence=0.0,
                channel=channel,
            )
        else:
            entry = TranscriptEntry(
                ts=timestamp,
                speaker=speaker,
                start_ms=max(0, start_ms),
                end_ms=max(0, end_ms),
                text=result.text,
                confidence=result.confidence,
                channel=channel,
            )

        # Log transcript
        self._transcript_logger.log(entry)
        self._lsl_logger.push(f"transcript_{speaker}", entry.text[:50])

        # Notify real-time listeners
        if self._on_transcript:
            await self._on_transcript(entry)


class AudioManagerRegistry:
    """Registry of active AudioManagers by session_id."""

    def __init__(self):
        self._managers: dict[str, AudioManager] = {}

    def create(
        self,
        session_id: str,
        session_dir: Path,
        transcript_logger: TranscriptLogger,
        event_logger: EventLogger,
        lsl_logger: LSLMarkerLogger,
        on_transcript=None,
        on_vad=None,
    ) -> AudioManager:
        mgr = AudioManager(
            session_dir=session_dir,
            transcript_logger=transcript_logger,
            event_logger=event_logger,
            lsl_logger=lsl_logger,
            on_transcript=on_transcript,
            on_vad=on_vad,
        )
        self._managers[session_id] = mgr
        return mgr

    def get(self, session_id: str) -> Optional[AudioManager]:
        return self._managers.get(session_id)

    async def remove_async(self, session_id: str) -> None:
        mgr = self._managers.pop(session_id, None)
        if mgr:
            await mgr.stop()

    def remove(self, session_id: str) -> None:
        mgr = self._managers.pop(session_id, None)
        if not mgr:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            asyncio.run(mgr.stop())
            return

        task = loop.create_task(mgr.stop())

        def _done(done: asyncio.Task) -> None:
            try:
                done.result()
            except Exception as e:
                log.warning(f"Audio manager cleanup task failed for {session_id}: {e}")

        task.add_done_callback(_done)


# Global registry
audio_registry = AudioManagerRegistry()
