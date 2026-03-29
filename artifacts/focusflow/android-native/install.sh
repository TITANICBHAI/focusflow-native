#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# FocusDay — Android native module installer
#
# Run this AFTER: npx expo prebuild --platform android
#
# Usage:
#   chmod +x android-native/install.sh
#   ./android-native/install.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
PKG_DIR="$ANDROID_DIR/app/src/main/java/com/tbtechs/focusday"
RES_DIR="$ANDROID_DIR/app/src/main/res"

if [ ! -d "$ANDROID_DIR" ]; then
  echo "❌  android/ directory not found."
  echo "    Run 'npx expo prebuild --platform android' first."
  exit 1
fi

echo "📦  Copying Kotlin source files..."

# Modules
mkdir -p "$PKG_DIR/modules"
cp "$SCRIPT_DIR/app/src/main/java/com/tbtechs/focusday/modules/"*.kt "$PKG_DIR/modules/"

# Services
mkdir -p "$PKG_DIR/services"
cp "$SCRIPT_DIR/app/src/main/java/com/tbtechs/focusday/services/"*.kt "$PKG_DIR/services/"

echo "🖼   Copying resource files..."

# XML config
mkdir -p "$RES_DIR/xml"
cp "$SCRIPT_DIR/app/src/main/res/xml/accessibility_service_config.xml" "$RES_DIR/xml/"

echo "📝  Patching strings.xml..."

STRINGS_FILE="$RES_DIR/values/strings.xml"

if ! grep -q "accessibility_service_description" "$STRINGS_FILE" 2>/dev/null; then
  # Insert the string before </resources>
  sed -i 's|</resources>|    <string name="accessibility_service_description">FocusDay uses Accessibility to detect and block distracting apps during your focus sessions. No personal data or messages are read.</string>\n</resources>|' "$STRINGS_FILE"
  echo "   ✓ strings.xml patched"
else
  echo "   ✓ strings.xml already contains accessibility_service_description"
fi

echo ""
echo "✅  Kotlin files installed."
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  MANUAL STEPS STILL REQUIRED (see manifest_additions.xml):"
echo "────────────────────────────────────────────────────────────"
echo ""
echo "  1. Add permissions + service/receiver entries to:"
echo "     android/app/src/main/AndroidManifest.xml"
echo ""
echo "  2. Register FocusDayPackage in:"
echo "     android/app/src/main/java/com/tbtechs/focusday/MainApplication.kt"
echo ""
echo "     Add import:"
echo "       import com.tbtechs.focusday.modules.FocusDayPackage"
echo ""
echo "     In getPackages():"
echo "       packages.add(FocusDayPackage())"
echo ""
echo "  3. Then build:"
echo "     eas build --platform android --profile preview"
echo ""
