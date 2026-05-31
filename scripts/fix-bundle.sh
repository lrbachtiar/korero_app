#!/usr/bin/env bash
# fix-bundle.sh — Post-build code-signing for PyInstaller + Tauri bundles.
#
# Tauri does NOT properly code-sign the .app: the main binary carries only the
# linker's automatic ad-hoc signature and the bundle has no sealed resources
# (Sealed Resources=none). On Apple Silicon every app must have a *valid*
# signature, so an unsealed bundle is reported as "damaged and can't be opened"
# on any Mac that didn't build it. This script fixes that by signing from the
# inside out:
#   1. every bundled dylib/.so in _internal/   (innermost code)
#   2. the korero-sidecar executable
#   3. the whole .app bundle, with entitlements (creates the resource seal)
#
# The signature is ad-hoc (-): no Apple Developer ID, so the app is NOT
# notarized. End users must still clear quarantine after download
# (`xattr -cr "/Applications/Kōrero.app"`) or use System Settings →
# Privacy & Security → Open Anyway. The signature itself is now valid, which is
# what stops the "damaged" error.
#
# We do NOT enable the hardened runtime: notarization isn't possible without a
# Developer ID anyway, and leaving it off keeps the sidecar's PyTorch JIT /
# unsigned-executable-memory working without per-process entitlement tuning.
#
# Run after `tauri build` or `tauri build --target universal-apple-darwin`.

set -euo pipefail
cd "$(dirname "$0")/.."

ENTITLEMENTS="src-tauri/entitlements.plist"

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

  echo "🔏 1/3 Signing _internal/ libraries in $APP …"
  find "$INTERNAL" \( -name "*.so" -o -name "*.dylib" \) \
    -exec codesign --force --sign - {} \; 2>/dev/null || true

  echo "🔏 2/3 Signing nested executables (sidecar, ffmpeg, ffprobe) …"
  SIDECAR="$APP/Contents/MacOS/korero-sidecar"
  [[ -f "$SIDECAR" ]] && codesign --force --sign - "$SIDECAR" 2>/dev/null || true
  for exe in "$INTERNAL/imageio_ffmpeg/binaries/"ffmpeg-* "$INTERNAL/imageio_ffmpeg/binaries/ffprobe"; do
    [[ -f "$exe" ]] && codesign --force --sign - "$exe" 2>/dev/null || true
  done

  echo "🔏 3/3 Sealing app bundle (ad-hoc + entitlements) …"
  codesign --force --entitlements "$ENTITLEMENTS" --sign - "$APP"

  # Verify the seal is valid — this is exactly what Apple Silicon enforces.
  if codesign --verify --deep --strict --verbose=1 "$APP" 2>/dev/null; then
    echo "✅ Signed & verified: $APP"
    (( fixed++ )) || true
  else
    echo "❌ Signature verification FAILED for $APP" >&2
    codesign --verify --deep --strict --verbose=2 "$APP" || true
    exit 1
  fi
done

if [[ $fixed -eq 0 ]]; then
  echo "⚠️  No built .app bundles found — run 'npm run tauri:build' first" >&2
  exit 1
fi
