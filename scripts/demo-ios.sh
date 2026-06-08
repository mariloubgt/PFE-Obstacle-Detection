#!/usr/bin/env bash
# VisionAid — standalone demo on your iPhone (free Apple ID, no TestFlight).
# Builds Release with JS bundled inside the app — no Metro needed during the demo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/PFE-Mobile-App"
DEVICE_ARG="${1:-}"

LAN_IP=""
if command -v ipconfig >/dev/null 2>&1; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
fi

# Physical iOS devices from Xcode (name + UDID). Skips simulators.
collect_devices() {
  xcrun xctrace list devices 2>/dev/null | awk '
    /^== Devices ==$/ { section="devices"; next }
    /^== Simulators ==$/ { section="sim"; next }
    section == "devices" && /\([0-9]+\.[0-9]+\)[[:space:]]+\([0-9A-Fa-f-]{20,}\)[[:space:]]*$/ {
      line = $0
      udid = $0
      match(udid, /\([0-9A-Fa-f-]{20,}\)[[:space:]]*$/)
      udid = substr(udid, RSTART + 1, RLENGTH - 2)
      sub(/[[:space:]]+\([0-9]+\.[0-9]+\)[[:space:]]+\([0-9A-Fa-f-]{20,}\)[[:space:]]*$/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      print udid "|" line
    }
  '
}

echo "=============================================="
echo "  VisionAid — iPhone demo (Option C)"
echo "=============================================="
echo ""
echo "Before the demo:"
echo "  • iPhone connected by USB (for install only)"
echo "  • Same Wi‑Fi as this Mac (for AI detection)"
echo "  • Terminal 1:  bash scripts/ai-lab-start.sh"
echo ""
if [[ -n "$LAN_IP" ]]; then
  echo "  AI server URL in app Settings:  http://${LAN_IP}:8787"
else
  echo "  AI server URL in app Settings:  http://YOUR_MAC_IP:8787"
fi
echo ""
echo "Note: Free Apple ID builds expire after ~7 days."
echo "      Re-run this script to reinstall before your presentation."
echo ""

cd "$APP"

DEVICE_ROWS=()
while IFS= read -r row; do
  [[ -n "$row" ]] && DEVICE_ROWS+=("$row")
done <<EOF
$(collect_devices)
EOF

DEVICE_UDID=""
DEVICE_NAME=""

if [[ -n "$DEVICE_ARG" ]]; then
  # Accept UDID directly or a name fragment
  if [[ "$DEVICE_ARG" =~ ^[0-9A-Fa-f-]{20,}$ ]]; then
    DEVICE_UDID="$DEVICE_ARG"
  else
    needle="$(echo "$DEVICE_ARG" | tr '[:upper:]' '[:lower:]')"
    for row in "${DEVICE_ROWS[@]}"; do
      udid="${row%%|*}"
      name="${row#*|}"
      name_lc="$(echo "$name" | tr '[:upper:]' '[:lower:]')"
      if [[ "$name_lc" == *"$needle"* ]]; then
        DEVICE_UDID="$udid"
        DEVICE_NAME="$name"
        break
      fi
    done
  fi
elif [[ "${#DEVICE_ROWS[@]}" -eq 1 ]]; then
  row="${DEVICE_ROWS[0]}"
  DEVICE_UDID="${row%%|*}"
  DEVICE_NAME="${row#*|}"
  echo "Found one connected device: $DEVICE_NAME"
elif [[ "${#DEVICE_ROWS[@]}" -gt 1 ]]; then
  echo "Connected devices:"
  i=1
  for row in "${DEVICE_ROWS[@]}"; do
    udid="${row%%|*}"
    name="${row#*|}"
    echo "  $i) $name  ($udid)"
    ((i++)) || true
  done
  echo ""
  read -r -p "Pick number or paste UDID: " PICK
  if [[ "$PICK" =~ ^[0-9]+$ ]] && (( PICK >= 1 && PICK <= ${#DEVICE_ROWS[@]} )); then
    row="${DEVICE_ROWS[$((PICK - 1))]}"
    DEVICE_UDID="${row%%|*}"
    DEVICE_NAME="${row#*|}"
  elif [[ "$PICK" =~ ^[0-9A-Fa-f-]{20,}$ ]]; then
    DEVICE_UDID="$PICK"
  fi
else
  echo "No physical iPhone/iPad detected."
  echo ""
  echo "Checklist:"
  echo "  • USB cable connected (unlock the phone)"
  echo "  • Tap Trust This Computer on the iPhone"
  echo "  • Xcode installed and opened once"
  echo ""
  xcrun xctrace list devices 2>/dev/null | sed -n '/^== Devices ==$/,/^== Simulators ==$/p' || true
  exit 1
fi

if [[ -z "$DEVICE_UDID" ]]; then
  echo "Could not match device: ${DEVICE_ARG:-(none selected)}"
  echo "Usage: bash scripts/demo-ios.sh"
  echo "   or: bash scripts/demo-ios.sh 00008120-000824313AEBC01E"
  exit 1
fi

echo ""
echo "==> Building Release and installing on: ${DEVICE_NAME:-$DEVICE_UDID}"
echo "    UDID: $DEVICE_UDID"
echo "    (first build may take several minutes)"
echo ""

export RCT_NO_LAUNCH_PACKAGER=1

npx expo run:ios --configuration Release --device "$DEVICE_UDID" --no-bundler

echo ""
echo "=============================================="
echo "  Install complete"
echo "=============================================="
echo ""
echo "  1. Open VisionAid on your iPhone (unplug USB if you want)"
echo "  2. Terminal 1:  bash scripts/ai-lab-start.sh"
echo "  3. App Settings → AI server:  http://${LAN_IP:-YOUR_MAC_IP}:8787"
echo ""
echo "  If this terminal still says 'Waiting on localhost:8081', press Ctrl+C — safe after 'Build Succeeded'."
echo ""
