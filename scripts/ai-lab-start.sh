#!/usr/bin/env bash
# Start VisionAid inference server for mobile AI Lab testing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  echo "Creating .venv..."
  python3 -m venv .venv
  .venv/bin/pip install -q -r api/requirements_api.txt
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

LAN_IP=""
if command -v ipconfig >/dev/null 2>&1; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
fi

PORT="${PORT:-8787}"

print_urls() {
  echo ""
  echo "=============================================="
  echo "  VisionAid AI Lab — inference server"
  echo "=============================================="
  echo "  Simulator app URL:  http://127.0.0.1:${PORT}"
  if [[ -n "$LAN_IP" ]]; then
    echo "  Physical phone URL: http://${LAN_IP}:${PORT}"
  fi
  echo ""
  echo "  In the app: Settings → AI Lab → Test & load config"
  echo "  API docs:     http://127.0.0.1:${PORT}/docs"
  echo "  Lab config:   PUT http://127.0.0.1:${PORT}/lab/config"
  echo "=============================================="
  echo ""
}

# Port already taken — use existing server if healthy
if lsof -i ":${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  if curl -sf -m 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "Port ${PORT} is already in use — VisionAid server is running."
    print_urls
    echo "No need to start again. To restart:"
    echo "  kill \$(lsof -t -i :${PORT})"
    echo "  npm run ai-lab"
    exit 0
  fi
  echo "ERROR: Port ${PORT} is in use but /health did not respond."
  echo "Free the port:  kill \$(lsof -t -i :${PORT})"
  exit 1
fi

print_urls
exec .venv/bin/python api/inference_server.py
