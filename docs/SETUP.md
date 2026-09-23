# Setup

SAI-P4 runs entirely on one machine. There are no cloud dependencies during a session.

## Prerequisites

| Component | Why | Notes |
|-----------|-----|-------|
| Python 3.11+ | backend | `python3 --version` |
| Node 20+ | frontend | `node --version` |
| [Ollama](https://ollama.com) | LLM facilitator (C1–C5) | install, then `ollama pull <model>` |
| [LiveKit server](https://docs.livekit.io/home/self-hosting/local/) | participant video/audio | run in `--dev` mode locally |
| OpenSSL | HTTPS certs for camera/mic over LAN | usually preinstalled |

Optional accelerators (auto-detected, with CPU fallbacks):
- **GPU ASR** — NVIDIA Nemotron Speech Streaming; otherwise faster-whisper on CPU.
- **TTS** — [HeadTTS](https://github.com/met4citizen/HeadTTS) sidecar (step 3); otherwise Kokoro in-process on GPU; otherwise Piper on CPU; otherwise a stub.

## 1. Install

```bash
./scripts/setup.sh
```

This creates `.venv`, installs `backend/requirements.txt`, runs `npm install` in `frontend/`, creates `data/sessions` + `db/`, and initialises the SQLite database.

## 2. Pull an Ollama model

The default model is set in `backend/app/config.py` (`OllamaConfig.model`). Pull a matching chat model, e.g.:

```bash
ollama pull llama3.1        # then set OllamaConfig.model = "llama3.1" if different
```

Any Ollama chat model works — pick one that fits your hardware. The facilitator makes two calls per intervention (generation + quality gate); a smaller `quality_gate_model` can be configured separately.

## 3. HeadTTS sidecar (optional, needed for the avatar)

[HeadTTS](https://github.com/met4citizen/HeadTTS) is a Node service that wraps the
same Kokoro engine already producing Alex's voice, but also returns word- and
viseme-level timings. Those timings are what drive the browser avatar's mouth;
without them Alex still speaks, the frontend just falls back to its own lipsync.

```bash
git clone https://github.com/met4citizen/HeadTTS
cd HeadTTS && npm install
```

**Install Alex's voice.** HeadTTS ships only `af_bella` and `am_fenrir`, but Alex
uses `af_heart` (`TTSConfig.kokoro_voice`). Fetch it into HeadTTS's `voices/`
before first start:

```bash
curl -L -o voices/af_heart.bin \
  https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/resolve/main/voices/af_heart.bin
npm start                                  # listens on :8882
```

**`headtts.voice` must match `tts.kokoro_voice`.** The two engines are
interchangeable only while the voice is identical — changing Alex's voice partway
through data collection is a stimulus change across conditions. Note that HeadTTS
runs the ONNX build of Kokoro rather than the Python package, so the waveform is
close but not bit-identical; if pilot data already exists, listen to both before
committing to the switch.

Keep it running alongside uvicorn and Ollama. The backend probes it on facilitator
start and silently falls back to in-process Kokoro when it is unreachable or the
voice is missing — watch the startup log line for which engine was picked.

Other settings live in `HeadTTSConfig` in `backend/app/config.py`; `HEADTTS_URL`
overrides the address.

## 4. HTTPS certificates (LAN use)

Browsers only grant camera/mic access over `https`/`localhost`. For participants on other devices, generate a self-signed cert:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
    -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes
```

Participants must accept the self-signed certificate in their browser once.

## 5. Configure (optional)

```bash
cp .env.example .env
```

Edit `.env` to override LiveKit credentials (required for any non-local deployment), set `EXPERIMENT_API_KEY` to protect researcher endpoints, or point `OLLAMA_HOST` elsewhere. Everything has a working local default.

## 6. Run

```bash
./scripts/start.sh
```

This starts Ollama (if needed), LiveKit (`--dev`), the FastAPI backend (`:8000`), and the Vite frontend (`:5173`), tee-ing all output to a timestamped file in `logs/`. Stop with `./scripts/stop.sh` (frees ports 8000 / 5173 / 7880 / 7881).

For backend-only development:

```bash
source .venv/bin/activate
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## 7. Verify the install

```bash
# Backend imports cleanly
PYTHONPATH=backend python3 -c "from app.main import app; print('OK')"

# Module probes
PYTHONPATH=backend python3 backend/scripts/probes/run_probes.py

# Frontend type check
cd frontend && npm run typecheck
```

## Running a session

1. Open the researcher UI, create a session — choose a **condition** (C0–C5) and a **task**.
2. Share the participant links (`/session/<session_id>/P1` and `/P2`).
3. Start the session. The dashboard shows the live transcript, facilitator interventions, participant/mic status, and recording health.
4. On completion, per-session artefacts are written to `data/sessions/{session_id}_{timestamp}/` (see the README for the file list).

## Troubleshooting

- **No AI interventions (C1–C5):** confirm Ollama is running (`curl http://localhost:11434/api/tags`) and the configured model is pulled.
- **Avatar's mouth doesn't move:** the HeadTTS sidecar is down, so the frame carries no viseme timings. Confirm it is up (`curl -X POST http://localhost:8882/v1/synthesize -H 'Content-Type: application/json' -d '{"input":"test","audioEncoding":"pcm"}'`) and restart the session — the engine is chosen once, at facilitator start.
- **Camera/mic blocked:** you are on `http` over the LAN — generate certs (step 4) and use `https`.
- **Participants can't connect video:** confirm the LiveKit server started (check the start.sh output) and that ports 7880/7881 are free.
- **Ports busy:** run `./scripts/stop.sh` to free 8000 / 5173 / 7880 / 7881.
