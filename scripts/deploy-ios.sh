#!/usr/bin/env bash
# VisionAid — production iOS build + optional TestFlight submit.
# First run: EAS will prompt for your Apple Developer login to create signing credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/PFE-Mobile-App"

cd "$APP"

export EXPO_APPLE_TEAM_ID=F6M3TUBLP7

echo "==> VisionAid iOS production deploy"
echo "    Bundle ID: com.maya.visionaid"
echo "    Apple Team: F6M3TUBLP7"
echo ""

if ! command -v eas >/dev/null 2>&1; then
  echo "Install EAS CLI: npm install -g eas-cli"
  exit 1
fi

echo "==> Step 1/2 — EAS production build (cloud, ~15–25 min)"
echo "    Log in with your Apple Developer account when prompted (one-time setup)."
echo ""
eas build --platform ios --profile production

echo ""
echo "==> Step 2/2 — Submit latest build to App Store Connect / TestFlight"
read -r -p "Submit to TestFlight now? [y/N] " SUBMIT
if [[ "${SUBMIT,,}" == "y" || "${SUBMIT,,}" == "yes" ]]; then
  eas submit --platform ios --profile production --latest
  echo ""
  echo "Done. Open App Store Connect → TestFlight to add testers and install on iPhone."
else
  echo "Skipped submit. Run later:"
  echo "  cd PFE-Mobile-App && eas submit --platform ios --profile production --latest"
fi
