#!/usr/bin/env bash
# VisionAid — production Android build (Play Store AAB).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/PFE-Mobile-App"

cd "$APP"

echo "==> VisionAid Android production deploy"
echo "    Package: com.maya.visionaid"
echo ""

if ! command -v eas >/dev/null 2>&1; then
  echo "Install EAS CLI: npm install -g eas-cli"
  exit 1
fi

echo "==> Step 1/2 — EAS production build (AAB)"
eas build --platform android --profile production

echo ""
echo "==> Step 2/2 — Submit to Google Play (optional)"
read -r -p "Submit latest AAB to Play Console now? [y/N] " SUBMIT
if [[ "${SUBMIT,,}" == "y" || "${SUBMIT,,}" == "yes" ]]; then
  eas submit --platform android --profile production --latest
else
  echo "Skipped submit. Run later:"
  echo "  cd PFE-Mobile-App && eas submit --platform android --profile production --latest"
fi
