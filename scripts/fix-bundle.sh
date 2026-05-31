#!/usr/bin/env bash
# fix-bundle.sh — Post-build signing fixup for PyInstaller + Tauri bundles.
#
# Tauri's `tauri build` signs the app bundle, but the sidecar's bundled
# libraries in _internal/ need individual ad-hoc signatures so macOS allows
# them to load. This script signs them without touching the bundle seal.
#
# The PyInstaller .app bundle-mode issue (exit 255) is now handled in Rust:
# start_via_tmp() runs the sidecar from a temp-dir symlink whose path does
# not contain .app/Contents/MacOS/, so PyInstaller's bundle-mode detection
# never triggers. No Frameworks symlink or bundle re-signing needed.
#
# Run after `tauri build` or `tauri build --target universal-apple-darwin`.

set -euo pipefail
cd "$(dirname "$0")/.."

APP_PATHS=(
  "target/release/bundle/macos/Kōrero.app"
  "src-tauri/target/release/bundle/macos/Kōrero.app"
  "target/universal-apple-darwin/release/bundle/macos/Kōrero.app"
  "src-tauri/target/universal-apple-darwin/release/bundle/macos/Kōrero.app"
)

fixed=0
for APP in "${APP_PATHS[@]}"; do
  [[ -d "$APP" ]] || continue

  INTERNAL="$APP/Contents/Resources/MacOS/_internal"
  if [[ ! -d "$INTERNAL" ]]; then
    echo "⚠️  $APP: _internal not found in Resources/MacOS/ — skipping"
    continue
  fi

  echo "🔏 Signing _internal/ libraries in $APP …"
  find "$INTERNAL" \( -name "*.so" -o -name "*.dylib" \) \
    -exec codesign --force --sign - {} \; 2>/dev/null || true

  echo "✅ Signed: $APP"
  (( fixed++ )) || true
done

if [[ $fixed -eq 0 ]]; then
  echo "⚠️  No built .app bundles found — run 'npm run tauri:build' first" >&2
  exit 1
fi
