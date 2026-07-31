#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# --- Flag parsing -----------------------------------------------------------
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LIVEKIT_PORT="${LIVEKIT_PORT:-7880}"
LIVEKIT_RTC_TCP_PORT="${LIVEKIT_RTC_TCP_PORT:-7881}"
export BACKEND_PORT FRONTEND_PORT LIVEKIT_PORT LIVEKIT_RTC_TCP_PORT

print_help() {
    cat <<EOF
Usage: ./scripts/start.sh [OPTIONS]

Launches the full stack: Ollama (if installed) + LiveKit + backend + frontend.

Options:
  -h, --help             Show this help and exit.

Examples:
  ./scripts/start.sh

Environment overrides:
  BACKEND_PORT=8000 FRONTEND_PORT=5173 LIVEKIT_PORT=7880 ./scripts/start.sh
  LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... ./scripts/start.sh   # production keys
EOF
}

for arg in "$@"; do
    case "$arg" in
        -h|--help)  print_help; exit 0 ;;
        *)          echo "Unknown flag: $arg"; print_help; exit 2 ;;
    esac
done

# --- Logging: capture ALL output (stdout + stderr) to a timestamped log ---
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/session_${TIMESTAMP}.log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== Log file: $LOG_FILE ==="

echo "=== SAI-P4 — AI Facilitator Toolkit — Starting ==="
echo "→ Ports: backend=${BACKEND_PORT}, frontend=${FRONTEND_PORT}, livekit=${LIVEKIT_PORT}"

# Kill any previous state first
echo "→ Cleaning up previous processes..."
BACKEND_PORT="$BACKEND_PORT" \
FRONTEND_PORT="$FRONTEND_PORT" \
LIVEKIT_PORT="$LIVEKIT_PORT" \
LIVEKIT_RTC_TCP_PORT="$LIVEKIT_RTC_TCP_PORT" \
    bash "$SCRIPT_DIR/stop.sh"
echo ""

# Activate venv
source .venv/bin/activate

# Offline mode: prevent HuggingFace Hub from DNS lookups on a LAN-only host
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1

# Check Ollama (the AI facilitator's LLM backend)
if command -v ollama &> /dev/null; then
    echo "→ Ollama found. Checking if running..."
    if ! curl -s "${OLLAMA_HOST:-http://localhost:11434}/api/tags" > /dev/null 2>&1; then
        echo "→ Starting Ollama in background..."
        ollama serve &
        sleep 2
    fi
    echo "→ Ollama OK"
else
    echo "⚠ Ollama not found. The AI facilitator (C1–C5) will not work."
    echo "  Install: https://ollama.com/download  then: ollama pull <model>"
fi

# Start LiveKit server
if command -v livekit-server &> /dev/null; then
    if [ "$LIVEKIT_PORT" != "7880" ]; then
        echo "⚠ LIVEKIT_PORT override is not supported by the dev LiveKit CLI here; using 7880."
        LIVEKIT_PORT="7880"
    fi
    echo "→ Starting LiveKit server on port ${LIVEKIT_PORT}..."
    sudo pkill -f 'livekit-server' 2>/dev/null && sleep 1 || true
    # --dev mode uses LiveKit's well-known local dev keys (devkey / secret).
    # For any non-local deployment, set real LIVEKIT_API_KEY / LIVEKIT_API_SECRET.
    livekit-server --dev --bind 0.0.0.0 &
    LIVEKIT_PID=$!
    sleep 2
    if ! kill -0 $LIVEKIT_PID 2>/dev/null; then
        echo "✗ LiveKit failed to start. Check if port ${LIVEKIT_PORT}/${LIVEKIT_RTC_TCP_PORT} is still in use."
        exit 1
    fi
    export LIVEKIT_URL="${LIVEKIT_URL:-ws://localhost:${LIVEKIT_PORT}}"
    export LIVEKIT_API_URL="${LIVEKIT_API_URL:-http://localhost:${LIVEKIT_PORT}}"
    export LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-devkey}"
    export LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-secret}"
    echo "→ LiveKit OK (port ${LIVEKIT_PORT})"
else
    echo "⚠ LiveKit not found. Participant video/audio will not work."
    echo "  Install: curl -sSL https://get.livekit.io | bash"
    LIVEKIT_PID=""
fi

# SSL certs for HTTPS (required for camera/mic access over LAN)
CERT_DIR="$PROJECT_DIR/certs"
if [ -f "$CERT_DIR/cert.pem" ] && [ -f "$CERT_DIR/key.pem" ]; then
    SSL_ARGS="--ssl-certfile $CERT_DIR/cert.pem --ssl-keyfile $CERT_DIR/key.pem"
    echo "→ SSL enabled (HTTPS/WSS)"
else
    SSL_ARGS=""
    echo "⚠ No SSL certs in certs/. Camera/mic will only work on localhost."
    echo "  Generate with: openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes"
fi

# Start backend
echo "→ Starting FastAPI backend on port ${BACKEND_PORT}..."
cd backend
uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" $SSL_ARGS --reload &
BACKEND_PID=$!
cd ..

# Start frontend dev server
echo "→ Starting frontend on port ${FRONTEND_PORT}..."
cd frontend
npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" --strictPort &
FRONTEND_PID=$!
cd ..

sleep 2

# Get LAN IP for participant/researcher URLs
LAN_IP=$(ip -4 addr show | grep -oP '(?<=inet\s)192\.\d+\.\d+\.\d+|(?<=inet\s)172\.\d+\.\d+\.\d+|(?<=inet\s)10\.\d+\.\d+\.\d+' | head -1)
PROTO="https"
[ -z "$SSL_ARGS" ] && PROTO="http"

echo ""
echo "=== Services running ==="
echo "  Backend:    ${PROTO}://localhost:${BACKEND_PORT}"
echo "  Frontend:   ${PROTO}://localhost:${FRONTEND_PORT}"
echo "  LiveKit:    ws://localhost:${LIVEKIT_PORT}"
echo "  API docs:   ${PROTO}://localhost:${BACKEND_PORT}/docs"
if [ -n "$LAN_IP" ]; then
    echo ""
    echo "  Researcher UI:        ${PROTO}://${LAN_IP}:${FRONTEND_PORT}"
    echo "  Group intake pattern: ${PROTO}://${LAN_IP}:${FRONTEND_PORT}/group/<group_id>/P1"
    echo "  Participant pattern:  ${PROTO}://${LAN_IP}:${FRONTEND_PORT}/session/<session_id>/P1"
fi
echo ""
echo "  ⚠ Participants must accept the self-signed certificate in their browser."
echo ""
echo "Press Ctrl+C to stop all services."

# Trap Ctrl+C to kill all
trap "kill $BACKEND_PID $FRONTEND_PID $LIVEKIT_PID 2>/dev/null; exit" INT TERM
wait
