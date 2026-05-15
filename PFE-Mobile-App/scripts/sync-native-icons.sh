#!/usr/bin/env bash
# After updating assets/icon.png (1024×1024), run this to refresh native iOS/Android icons.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MASTER="$ROOT/assets/icon.png"

if [[ ! -f "$MASTER" ]]; then
  echo "Missing $MASTER — export a 1024×1024 PNG first."
  exit 1
fi

IOS_ICON="$ROOT/ios/PFEMobileApp/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png"
cp "$MASTER" "$IOS_ICON"
cp "$MASTER" "$ROOT/ios/PFEMobileApp/Images.xcassets/SplashScreen.imageset/image.png"

RES="$ROOT/android/app/src/main/res"

sips -z 108 108 "$MASTER" --out "$RES/mipmap-mdpi/ic_launcher_foreground.png"
sips -z 162 162 "$MASTER" --out "$RES/mipmap-hdpi/ic_launcher_foreground.png"
sips -z 216 216 "$MASTER" --out "$RES/mipmap-xhdpi/ic_launcher_foreground.png"
sips -z 324 324 "$MASTER" --out "$RES/mipmap-xxhdpi/ic_launcher_foreground.png"
sips -z 432 432 "$MASTER" --out "$RES/mipmap-xxxhdpi/ic_launcher_foreground.png"

sips -z 48 48 "$MASTER" --out "$RES/mipmap-mdpi/ic_launcher.png"
sips -z 72 72 "$MASTER" --out "$RES/mipmap-hdpi/ic_launcher.png"
sips -z 96 96 "$MASTER" --out "$RES/mipmap-xhdpi/ic_launcher.png"
sips -z 144 144 "$MASTER" --out "$RES/mipmap-xxhdpi/ic_launcher.png"
sips -z 192 192 "$MASTER" --out "$RES/mipmap-xxxhdpi/ic_launcher.png"

sips -z 48 48 "$MASTER" --out "$RES/mipmap-mdpi/ic_launcher_round.png"
sips -z 72 72 "$MASTER" --out "$RES/mipmap-hdpi/ic_launcher_round.png"
sips -z 96 96 "$MASTER" --out "$RES/mipmap-xhdpi/ic_launcher_round.png"
sips -z 144 144 "$MASTER" --out "$RES/mipmap-xxhdpi/ic_launcher_round.png"
sips -z 192 192 "$MASTER" --out "$RES/mipmap-xxxhdpi/ic_launcher_round.png"

sips -z 200 200 "$MASTER" --out "$RES/drawable-mdpi/splashscreen_image.png"
sips -z 300 300 "$MASTER" --out "$RES/drawable-hdpi/splashscreen_image.png"
sips -z 400 400 "$MASTER" --out "$RES/drawable-xhdpi/splashscreen_image.png"
sips -z 600 600 "$MASTER" --out "$RES/drawable-xxhdpi/splashscreen_image.png"
sips -z 800 800 "$MASTER" --out "$RES/drawable-xxxhdpi/splashscreen_image.png"

cp "$MASTER" "$ROOT/assets/splash-icon.png"
cp "$MASTER" "$ROOT/assets/adaptive-icon.png"
cp "$MASTER" "$ROOT/assets/favicon.png"
cp "$MASTER" "$ROOT/assets/branding/logo.png"

echo "Native icons synced from assets/icon.png"
