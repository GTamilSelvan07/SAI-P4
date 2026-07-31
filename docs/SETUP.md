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
- **GPU TTS** — Kokoro; otherwise Piper on CPU; otherwise a stub.

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

## 3. HTTPS certificates (LAN use)

Browsers only grant camera/mic access over `https`/`localhost`. For participants on other devices, generate a self-signed cert:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
    -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes
```

Participants must accept the self-signed certificate in their browser once.

## 4. Configure (optional)

```bash
cp .env.example .env
```

Edit `.env` to override LiveKit credentials (required for any non-local deployment), set `EXPERIMENT_API_KEY` to protect researcher endpoints, or point `OLLAMA_HOST` elsewhere. Everything has a working local default.

## 5. Run

```bash
./scripts/start.sh
```

This starts Ollama (if needed), LiveKit (`--dev`), the FastAPI backend (`:8000`), and the Vite frontend (`:5173`), tee-ing all output to a timestamped file in `logs/`. Stop with `./scripts/stop.sh` (frees ports 8000 / 5173 / 7880 / 7881).

For backend-only development:

```bash
source .venv/bin/activate
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## 6. Verify the install

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
- **Camera/mic blocked:** you are on `http` over the LAN — generate certs (step 3) and use `https`.
- **Participants can't connect video:** confirm the LiveKit server started (check the start.sh output) and that ports 7880/7881 are free.
- **Ports busy:** run `./scripts/stop.sh` to free 8000 / 5173 / 7880 / 7881.
