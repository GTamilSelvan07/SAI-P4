#!/bin/bash
set -e

echo "=== SAI-P4 — AI Facilitator Toolkit — Setup ==="

# Python venv
echo "→ Creating Python virtual environment..."
cd "$(dirname "$0")/.."
python3 -m venv .venv
source .venv/bin/activate

echo "→ Installing Python dependencies..."
pip install --upgrade pip
pip install -r backend/requirements.txt

# Frontend
echo "→ Installing frontend dependencies..."
cd frontend
npm install
cd ..

# Create data directories
echo "→ Creating data directories..."
mkdir -p data/sessions db

# Init database
echo "→ Initializing database..."
PYTHONPATH=backend python3 -c "from app.database import init_db; init_db()"

echo ""
echo "=== Setup complete ==="
echo "Start with: ./scripts/start.sh"
