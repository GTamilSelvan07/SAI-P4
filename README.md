# SAI-P4 — AI Facilitator Toolkit

An open-source research toolkit for studying **how an AI meeting facilitator's behaviour steers group decision-making.** Two participants join a video call, work through a hidden-profile decision task, and an AI facilitator ("Alex") intervenes live — neutrally, or with a built-in bias — while every utterance, event, and audio channel is logged for analysis.

SAI-P4 runs one clean pipeline, fully local, with no Wizard-of-Oz scripting:

```
 Participant mics ──► Whisper / Nemotron ASR ──► Ollama LLM facilitator (condition prompt)
                                                        │
                                                 Quality Gate (2nd LLM call)
                                                        │
                                        Kokoro / Piper TTS ──► Alex speaks into the room
```

The facilitator is a real LLM agent: it listens (ASR), decides when to speak (timer / lull / keyword / turn-count triggers), generates a condition-specific intervention (Ollama), validates it against the condition spec (a second "quality gate" LLM call), synthesises speech (TTS), and delivers it — all offline on the local machine.

## Experimental conditions

Each session runs **one condition**. C0 is the human-only baseline; **C1–C5 are all driven by the local LLM.**

| Code | Name | Facilitator behaviour |
|------|------|-----------------------|
| C0 | No AI | No facilitator — human-only baseline (same phases + mic rules as C1–C5) |
| C1 | Minimal Neutral | Brief, generic, content-agnostic pacing on a fixed timer |
| C2 | Neutral | Balanced, even-handed summaries and follow-ups |
| C3 | Anchoring | Subtly frames the discussion toward a preset "anchor" option |
| C4 | Amplification | Disproportionately elaborates one participant's voice |
| C5 | Devil's Advocate | Openly challenges the emerging majority position |

Condition behaviour is defined entirely by the prompt files in `backend/prompts/` (see [`docs/CONDITIONS.md`](docs/CONDITIONS.md)). C3 fills an `{anchor_option}` and C4 a `{target_participant}`, both randomised per session and recorded in `session_meta.json`.

## Quickstart

**Prerequisites:** Python 3.11+, Node 20+, [Ollama](https://ollama.com) with a chat model pulled, and (for participant video) the [LiveKit server](https://docs.livekit.io/home/self-hosting/local/). See [`docs/SETUP.md`](docs/SETUP.md) for details.

```bash
# 1. Install backend venv + frontend deps + init DB
./scripts/setup.sh

# 2. (One time) HTTPS certs — required for camera/mic access over a LAN
mkdir -p certs && openssl req -x509 -newkey rsa:2048 \
    -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes

# 3. Configure (optional) — copy the env template and edit
cp .env.example .env

# 4. Launch Ollama + LiveKit + backend + frontend
./scripts/start.sh          # backend :8000  frontend :5173  livekit :7880

# Stop everything
./scripts/stop.sh
```

Open the frontend, create a session (pick a condition + task), and share the participant links. The researcher dashboard shows the live transcript, facilitator interventions, participant status, and recording health.

## Repository layout

```
SAI-P4/
├── backend/
│   ├── app/                 # FastAPI app: session orchestrator, facilitator, audio, routes
│   │   ├── ai/              # facilitator engine + quality gate + Ollama client + triggers
│   │   ├── audio/           # ASR (Nemotron/Whisper), TTS (Kokoro/Piper), VAD, recording
│   │   ├── session/         # orchestrator + state machine (7 phases) + per-session randomisation
│   │   └── routes/          # sessions, groups, websockets, battery, general
│   ├── prompts/             # the 5 condition prompts (c1–c5) + quality_gate
│   ├── tasks/               # hidden-profile decision scenarios (example stimuli)
│   ├── failsafe_clips/      # fallback lines played if the LLM times out
│   └── scripts/             # probes + end-to-end verification harness
├── frontend/                # React 19 + TypeScript + Vite + Tailwind researcher & participant UI
├── scripts/                 # setup.sh / start.sh / stop.sh
└── docs/                    # ARCHITECTURE, CONDITIONS, SETUP
```

## Data output (per session)

```
data/sessions/{session_id}_{timestamp}/
├── session_meta.json    # condition, task, anchor direction, amplification target
├── events.jsonl         # every event: interventions, phase changes, votes, mic states
├── transcript.jsonl     # every utterance: speaker, text, confidence, timing
├── audio_p1.wav         # per-channel audio (16 kHz mono)
├── audio_p2.wav
├── audio_alex.wav
├── audio_mixed.wav      # post-hoc mix
└── lsl_markers.csv      # event markers for physiology sync
```

All logging is append-only JSONL with flush-on-write — crash-safe by design.

## Design notes

- **Local-first / offline.** Ollama LLM, ASR, and TTS all run on the host — no cloud calls during a session.
- **LiveKit SFU** carries participant video/audio. Alex's voice is delivered as base64 WAV over the JSON WebSocket (the LiveKit Python RTC SDK is not used).
- **One config source.** All experiment parameters live in `backend/app/config.py`.
- **Single-run sessions.** One session = one condition × one task × 7 phases (`Setup → InfoReading → Preference → P1Opening → P2Opening → OpenDiscussion → Decision → Survey`).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full component map.

## Provenance

SAI-P4 is a cleaned, open-source derivative of a research platform built in the Empathic Computing Lab, University of Auckland. It ships the live-LLM facilitator only — the Wizard-of-Oz scripting used in the original pilots has been removed.

## License

[MIT](LICENSE).
