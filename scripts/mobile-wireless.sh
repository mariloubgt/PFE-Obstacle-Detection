#!/usr/bin/env bash
# Wireless dev: Metro only — app already on phone, no USB needed.
# Phone + Mac must be on the same Wi‑Fi (or iPhone hotspot).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/PFE-Mobile-App"

LAN_IP=""
if command -v ipconfig >/dev/null 2>&1; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
fi

echo "=============================================="
echo "  VisionAid — wireless (no USB)"
echo "=============================================="
echo ""
echo "1. Terminal 1:  bash scripts/ai-lab-start.sh"
echo "2. This script: Metro over Wi‑Fi"
echo "3. Unplug USB — open VisionAid on the phone"
echo ""
if [[ -n "$LAN_IP" ]]; then
  echo "  Metro URL:  http://${LAN_IP}:8081"
  echo "  Server URL: http://${LAN_IP}:8787  (set in app Settings)"
else
  echo "  Set server URL in app Settings to http://YOUR_MAC_IP:8787"
fi
echo ""
echo "If app won't connect: shake phone → Dev Menu → enter Metro URL above"
echo "Reload JS: press r in this terminal"
echo ""

cd "$APP"
exec npx expo start --dev-client --lan
