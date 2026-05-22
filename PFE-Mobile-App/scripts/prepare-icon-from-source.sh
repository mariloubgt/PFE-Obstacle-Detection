#!/usr/bin/env bash
# Build a 1024×1024 app icon from a logo PNG (center-crop square).
# For best results use a full-bleed square export (no baked-in iOS rounded corners).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-}"
OUT="$ROOT/assets/icon.png"

if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "Usage: $0 /path/to/logo.png"
  exit 1
fi

TMP="$(mktemp -t visionaid-icon.XXXXXX.png)"
trap 'rm -f "$TMP"' EXIT

cp "$SRC" "$TMP"
W=$(sips -g pixelWidth "$TMP" | awk '/pixelWidth/{print $2}')
H=$(sips -g pixelHeight "$TMP" | awk '/pixelHeight/{print $2}')
SIDE=$(( W < H ? W : H ))
sips -c "$SIDE" "$SIDE" "$TMP" --out "$TMP" >/dev/null
sips -z 1024 1024 "$TMP" --out "$OUT" >/dev/null

echo "Wrote $OUT (${SIDE}px crop → 1024×1024)"
