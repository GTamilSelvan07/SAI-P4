# Architecture

SAI-P4 is a single-machine, local-first system. Two participant browsers and a researcher dashboard talk to one FastAPI backend; participant video/audio flows peer-to-peer through a LiveKit SFU; the backend receives raw PCM audio for transcription and drives the AI facilitator.

```
Browser (P1)  ◄──►  LiveKit SFU (:7880)  ◄──►  Browser (P2)
                    (WebRTC video + audio)
   │                                                │
   │  PCM16 WS ─► FastAPI backend (:8000) ◄─ PCM16 WS
   │  JSON  WS ◄─ (session control + Alex) ─► JSON WS
   │                       │
   │              Browser (Researcher Dashboard)
```

## Backend components (`backend/app/`)

- **`main.py`** — FastAPI assembly, CORS (private-network only), lifespan (DB init, task load, graceful shutdown).
- **`config.py`** — the single source of truth for every experiment parameter: phase durations, trigger thresholds, model names, sample rates, LiveKit/security settings.
- **`models.py`** — `EventType`, `TriggerType`, `AISource`, `Phase`, and the `EventEntry` schema written to `events.jsonl`.
- **`session/orchestrator.py`** — owns the state machine + facilitator lifecycle for a session. Starts/stops the facilitator per phase, resolves the C3 anchor option, runs the live-metrics loop, and cleans up on session end.
- **`session/state_machine.py`** — the 7-phase state machine (all async): phase transitions, per-phase mic-mute rules, auto-advance.
- **`session/bibd.py`** — per-session randomisation: anchoring direction (C3), amplification target (C4), and `resolve_c3_anchor_option` (maps the "correct/incorrect" label to a concrete option id).
- **`ai/facilitator.py`** — the facilitator engine. Per intervention: Generate (Ollama) → Quality Gate → TTS → Deliver, guarded by an intervention lock, a cooldown, and a 15 s failsafe.
- **`ai/quality_gate.py`** — a second, fast Ollama call that validates the drafted response against the condition spec (PASS/FAIL).
- **`ai/triggers.py`** — when to speak: timer (with jitter), conversational lull, the keyword "alex", and turn-count.
- **`ai/ollama_client.py`** — async Ollama chat client.
- **`ai/suggestor.py`** — background pre-generation so an intervention can fire with near-zero latency.
- **`audio/`** — `transcriber.py` (Nemotron GPU ASR → faster-whisper CPU → stub), `tts.py` (Kokoro GPU → Piper CPU → stub, with scipy resampling), VAD (Silero), `manager.py` (VAD/ASR pipeline), `recorder.py` (per-channel WAV + post-hoc mix), `failsafe.py`.
- **`routes/`** — `sessions.py` (create/start/stop, task views), `groups.py`, `websockets.py` (audio PCM in, JSON control), `battery.py` (questionnaires), `general.py` (LiveKit tokens, health).
- **`logging/`** — append-only `events.py`, `transcript.py`, `lsl_markers.py`, each flushing after every write.

## The facilitator pipeline

```
ASR transcript ─► FacilitatorEngine.add_transcript()
                      │ (trigger fires: timer / lull / keyword / turn-count)
                      ▼
              generate_intervention()
                      │  intervention lock + cooldown
                      ▼
   C0 → return (no AI)         C1–C5 → build condition prompt (Ollama)
                                        │
                                  quality gate (2nd Ollama call)
                                    pass │ fail → retry once → failsafe
                                        ▼
                                  TTS (executor thread)
                                        │
                          broadcast text + base64 WAV over JSON WS
                          + write audio_alex.wav + log EventEntry + LSL marker
```

If the LLM does not return within `FAILSAFE_TIMEOUT_SECONDS` (15 s), a pre-recorded failsafe clip (or live-TTS fallback) plays so participants always hear a response.

## Session lifecycle

```
Setup → InfoReading → Preference → P1Opening → P2Opening → OpenDiscussion → Decision → Survey
```

One session = one condition × one task. Mic rules are enforced per phase (e.g. P1's opening mutes P2). C0 shares the exact same phase/mic structure as C1–C5, so the only between-condition variable is the facilitator's behaviour.

## Frontend (`frontend/src/`)

- **Participant flow** — join → info reading → preference → discussion room (LiveKit video + local recording) → survey/complete.
- **Researcher dashboard** — live transcript, intervention timeline, participant status, recording-health indicator, live metrics, emergency stop, questionnaire panel.
- **State flow** — WebSocket → Zustand store → components. State changes are broadcast (pushed), not polled, with a single 10 s HTTP fallback for `facilitator_status`.

## Why some things are the way they are

- **Base64 WAV for Alex's voice** instead of a LiveKit track: the LiveKit Python RTC SDK is not used, so Alex's audio is delivered to browsers over the JSON WebSocket.
- **Separate PCM WebSocket** for backend ASR/VAD, independent of the LiveKit media path.
- **JSONL append-only** logging for crash safety.
