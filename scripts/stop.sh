#!/bin/bash
echo "=== Stopping all services ==="

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LIVEKIT_PORT="${LIVEKIT_PORT:-7880}"
LIVEKIT_RTC_TCP_PORT="${LIVEKIT_RTC_TCP_PORT:-7881}"

# Kill LiveKit Docker container if running
if docker ps -q --filter "name=a2videocall-livekit" 2>/dev/null | grep -q .; then
    echo "→ Stopping Docker LiveKit container..."
    docker stop a2videocall-livekit 2>/dev/null
    docker rm a2videocall-livekit 2>/dev/null
fi

# Kill native LiveKit server
if pgrep -f 'livekit-server' > /dev/null 2>&1; then
    echo "→ Killing livekit-server..."
    sudo pkill -f 'livekit-server' 2>/dev/null
fi

# Kill by port. Include 5174 because older Vite runs could silently fall back
# there when 5173 was occupied.
PORTS=("$BACKEND_PORT" "$FRONTEND_PORT" "$LIVEKIT_PORT" "$LIVEKIT_RTC_TCP_PORT" 8000 5173 5174 7880 7881)
SEEN_PORTS=" "
for PORT in "${PORTS[@]}"; do
    case "$SEEN_PORTS" in
        *" $PORT "*) continue ;;
    esac
    SEEN_PORTS="${SEEN_PORTS}${PORT} "
    PIDS=$(fuser ${PORT}/tcp 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "→ Killing port $PORT (PIDs:$PIDS)"
        fuser -k ${PORT}/tcp 2>/dev/null
    fi
done

# Kill by process name
for PROC in "uvicorn" "vite" "node.*vite"; do
    pkill -f "$PROC" 2>/dev/null && echo "→ Killed $PROC"
done

sleep 1

# Verify ports are free
STILL_BOUND=""
SEEN_PORTS=" "
for PORT in "${PORTS[@]}"; do
    case "$SEEN_PORTS" in
        *" $PORT "*) continue ;;
    esac
    SEEN_PORTS="${SEEN_PORTS}${PORT} "
    if fuser ${PORT}/tcp 2>/dev/null | grep -q .; then
        STILL_BOUND="$STILL_BOUND $PORT"
    fi
done

if [ -n "$STILL_BOUND" ]; then
    echo "⚠ Ports still in use:$STILL_BOUND"
    echo "  Try: sudo fuser -k <port>/tcp"
else
    echo "=== All stopped ==="
fi
