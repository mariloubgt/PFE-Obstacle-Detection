#!/usr/bin/env bash
# Dev on iPhone WITH Metro bundler — JS reloads live (press r in Metro).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/PFE-Mobile-App"
DEVICE="${1:-neila phone}"

echo "=============================================="
echo "  VisionAid — iOS dev (Metro bundler ON)"
echo "=============================================="
echo ""
echo "Terminal 1 (server):  bash scripts/ai-lab-start.sh"
echo "Terminal 2 (this):    Metro + install on phone"
echo ""
echo "After install: edit JS → press r in Metro to reload."
echo "Do NOT use --no-bundler unless you want a standalone Release build."
echo ""

cd "$APP"
exec npx expo run:ios --device "$DEVICE"
