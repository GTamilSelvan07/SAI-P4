"""
Alex Agent — joins a LiveKit room as a participant.
Subscribes to participant audio for VAD/transcription.
Publishes TTS audio as a real WebRTC track.
"""
import asyncio
import logging
import time
from typing import Optional, Callable, Awaitable
from pathlib import Path

import numpy as np
from livekit import rtc

from app.config import config, AUDIO_SAMPLE_RATE
from app.models import TranscriptEntry
from app.logging.transcript import TranscriptLogger
from app.logging.events import EventLogger
from app.logging.lsl_markers import LSLMarkerLogger
from app.audio.transcriber import create_transcriber
from app.audio.recorder import WavRecorder

log = logging.getLogger(__name__)

# 20ms of audio at 16kHz mono = 320 samples = 640 bytes
FRAME_SAMPLES = 320
FRAME_DURATION_MS = 20


class AlexAgent:
    """
    Alex joins a LiveKit room, listens to participants, and speaks via TTS.
    Replaces the old AudioManager + binary WebSocket approach.
    """

    def __init__(
        self,
        room_name: str,
        session_dir: Path,
        transcript_logger: TranscriptLogger,
        event_logger: EventLogger,
        lsl_logger: LSLMarkerLogger,
        on_transcript: Optional[Callable[[TranscriptEntry], Awaitable[None]]] = None,
        on_vad: Optional[Callable[[str, bool], Awaitable[None]]] = None,
    ):
        self._room_name = room_name
        self._session_dir = session_dir
        self._transcript_logger = transcript_logger
        self._event_logger = event_logger
        self._lsl_logger = lsl_logger
        self._on_transcript = on_transcript
        self._on_vad = on_vad

        self._room: Optional[rtc.Room] = None
        self._audio_source: Optional[rtc.AudioSource] = None
        self._connected = False
        self._session_start_time = time.time()

        # Transcription
        self._transcriber = create_transcriber()

        # Per-participant audio recording to WAV (crash-safe)
        self._recorders: dict[str, WavRecorder] = {}
        self._alex_recorder: Optional[WavRecorder] = None

        # VAD state per participant
        self._vad_buffers: dict[str, list[float]] = {}
        self._vad_speaking: dict[str, bool] = {}
        self._vad_silence_count: dict[str, int] = {}

    async def connect(self, url: str, token: str) -> None:
        """Connect to LiveKit room and publish Alex's audio track."""
        self._room = rtc.Room()

        # Event handlers
        self._room.on("track_subscribed", self._on_track_subscribed)
        self._room.on("participant_connected", self._on_participant_connected)

        await self._room.connect(url, token)
        log.info(f"[Alex] Connected to LiveKit room: {self._room_name}")

        # Create audio source for Alex's voice
        self._audio_source = rtc.AudioSource(
            sample_rate=AUDIO_SAMPLE_RATE,
            num_channels=1,
        )
        track = rtc.LocalAudioTrack.create_audio_track("alex-voice", self._audio_source)
        await self._room.local_participant.publish_track(
            track,
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
        )
        log.info("[Alex] Published audio track")

        # Set up Alex WAV recorder
        self._alex_recorder = WavRecorder(self._session_dir / "audio_alex.wav")
        self._alex_recorder.open()

        self._connected = True
        self._session_start_time = time.time()

    async def disconnect(self) -> None:
        """Leave the room and close recorders."""
        self._connected = False
        if self._room:
            await self._room.disconnect()
            self._room = None
        # Close recorders
        for rec in self._recorders.values():
            rec.close()
        if self._alex_recorder:
            self._alex_recorder.close()
        log.info("[Alex] Disconnected from LiveKit room")

    async def speak(self, pcm_bytes: bytes) -> None:
        """Push TTS audio to the LiveKit room as Alex's track."""
        if not self._audio_source or not pcm_bytes:
            return

        # Also record to disk
        if self._alex_recorder:
            self._alex_recorder.write_frames(pcm_bytes)

        # Push audio in 20ms frames
        byte_size = FRAME_SAMPLES * 2  # 16-bit = 2 bytes per sample
        for i in range(0, len(pcm_bytes), byte_size):
            chunk = pcm_bytes[i:i + byte_size]
            if len(chunk) < byte_size:
                # Pad last chunk with silence
                chunk = chunk + b'\x00' * (byte_size - len(chunk))

            frame = rtc.AudioFrame(
                data=chunk,
                sample_rate=AUDIO_SAMPLE_RATE,
                num_channels=1,
                samples_per_channel=FRAME_SAMPLES,
            )
            await self._audio_source.capture_frame(frame)

    def _on_participant_connected(self, participant: rtc.RemoteParticipant) -> None:
        log.info(f"[Alex] Participant joined: {participant.identity}")

    def _on_track_subscribed(
        self,
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        """Called when a participant's track becomes available."""
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            identity = participant.identity
            log.info(f"[Alex] Subscribed to audio from {identity}")

            # Set up WAV recorder for this participant
            if identity in ("P1", "P2") and identity not in self._recorders:
                rec = WavRecorder(self._session_dir / f"audio_{identity.lower()}.wav")
                rec.open()
                self._recorders[identity] = rec

            # Start processing audio in background (request 16kHz mono from LiveKit)
            audio_stream = rtc.AudioStream(
                track, sample_rate=AUDIO_SAMPLE_RATE, num_channels=1,
            )
            asyncio.create_task(self._process_audio_stream(identity, audio_stream))

    async def _process_audio_stream(
        self, identity: str, stream: rtc.AudioStream
    ) -> None:
        """Process incoming audio frames from a participant for VAD + transcription."""
        self._vad_buffers[identity] = []
        self._vad_speaking[identity] = False
        self._vad_silence_count[identity] = 0

        async for event in stream:
            if not self._connected:
                break

            frame = event.frame
            # Get raw PCM bytes from the frame (frame.data is a memoryview)
            pcm_bytes = bytes(frame.data)
            # Convert to float samples for VAD
            samples_int16 = np.frombuffer(pcm_bytes, dtype=np.int16)
            samples_float = samples_int16.astype(np.float32) / 32768.0

            # Record raw audio to WAV
            if identity in self._recorders:
                self._recorders[identity].write_frames(pcm_bytes)

            # Simple energy-based VAD (Silero VAD used for detailed detection)
            energy = float(np.mean(samples_float ** 2))
            is_speech = energy > 0.001  # threshold

            # VAD state machine
            if is_speech:
                self._vad_buffers[identity].extend(samples_float.tolist())
                self._vad_silence_count[identity] = 0
                if not self._vad_speaking[identity]:
                    self._vad_speaking[identity] = True
                    if self._on_vad:
                        await self._on_vad(identity, True)
            else:
                if self._vad_speaking[identity]:
                    self._vad_silence_count[identity] += len(samples_float)
                    self._vad_buffers[identity].extend(samples_float.tolist())

                    # Silence threshold: 500ms at 16kHz = 8000 samples
                    if self._vad_silence_count[identity] >= 8000:
                        # Speech segment ended — transcribe
                        if self._on_vad:
                            await self._on_vad(identity, False)
                        await self._transcribe_segment(identity)
                        self._vad_buffers[identity] = []
                        self._vad_speaking[identity] = False
                        self._vad_silence_count[identity] = 0

    async def _transcribe_segment(self, identity: str) -> None:
        """Transcribe a completed speech segment."""
        samples = self._vad_buffers.get(identity, [])
        if len(samples) < 4000:  # < 250ms, skip
            return

        ts = time.time()
        duration_ms = int(len(samples) / AUDIO_SAMPLE_RATE * 1000)
        start_ms = int((ts - duration_ms / 1000 - self._session_start_time) * 1000)
        end_ms = int((ts - self._session_start_time) * 1000)
        channel = 0 if identity == "P1" else 1

        # Transcribe in thread pool
        result = await asyncio.get_running_loop().run_in_executor(
            None, self._transcriber.transcribe, samples, AUDIO_SAMPLE_RATE
        )

        if result is None:
            entry = TranscriptEntry(
                ts=ts, speaker=identity,
                start_ms=max(0, start_ms), end_ms=max(0, end_ms),
                text="[audio segment — transcription unavailable]",
                confidence=0.0, channel=channel,
            )
        else:
            entry = TranscriptEntry(
                ts=ts, speaker=identity,
                start_ms=max(0, start_ms), end_ms=max(0, end_ms),
                text=result.text, confidence=result.confidence, channel=channel,
            )

        # Log
        self._transcript_logger.log(entry)
        self._lsl_logger.push(f"transcript_{identity}", entry.text[:50])

        # Notify
        if self._on_transcript:
            await self._on_transcript(entry)
