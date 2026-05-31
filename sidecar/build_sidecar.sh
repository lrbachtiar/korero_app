#!/usr/bin/env bash
# build_sidecar.sh — Build the Korero Python sidecar with PyInstaller.
#
# Usage:
#   cd sidecar
#   ./build_sidecar.sh                   # current arch (arm64 or x86_64)
#   KORERO_ARCH=arm64   ./build_sidecar.sh
#   KORERO_ARCH=x86_64  ./build_sidecar.sh
#
# Output:
#   dist/korero-sidecar/                 PyInstaller bundle directory
#   ../src-tauri/binaries/korero-sidecar-{triple}  → copied wrapper binary
#   ../src-tauri/binaries/korero-sidecar-{triple}_internal/ → supporting libs
#
# The triple matches Tauri's externalBin naming convention:
#   arm64   → aarch64-apple-darwin
#   x86_64  → x86_64-apple-darwin

set -euo pipefail
cd "$(dirname "$0")"

# ── Config ──────────────────────────────────────────────────────────────
PYTHON="${PYTHON:-python3.11}"
ARCH="${KORERO_ARCH:-$(uname -m)}"

if [[ "$ARCH" == "arm64" ]]; then
  TRIPLE="aarch64-apple-darwin"
elif [[ "$ARCH" == "x86_64" ]]; then
  TRIPLE="x86_64-apple-darwin"
else
  echo "❌ Unknown arch: $ARCH" >&2; exit 1
fi

echo "🔨 Building Korero sidecar for $TRIPLE (Python: $PYTHON)"

# ── Virtual environment ─────────────────────────────────────────────────
VENV=".venv"

if [[ ! -f "$VENV/bin/activate" ]]; then
  echo "📦 Creating virtual environment…"
  "$PYTHON" -m venv "$VENV" --prompt korero-build
fi

source "$VENV/bin/activate"

echo "📦 Installing/updating dependencies…"
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
pip install pyinstaller --quiet

# ── Patch torch source in venv before freezing ─────────────────────────
# PyTorch 2.8 eagerly registers pybind11 types in torch._C during PyInit__C,
# then torch.distributed.rpc tries to re-register them via _rpc_init() — causing
# "generic_type: cannot initialize type 'RpcBackendOptions': already defined".
# We patch two torch files so the frozen PKG archive contains the fix.
echo "🩹 Patching torch source for RpcBackendOptions double-registration…"
python3 - <<'PYEOF'
import sys, site

# Find site-packages path inside the active venv
sp = next((p for p in sys.path if 'site-packages' in p), None)
if not sp:
    sys.exit("Could not find site-packages in sys.path")

# ── Patch 1: torch/distributed/rpc/__init__.py ──────────────────────────
import os
rpc_init = os.path.join(sp, "torch/distributed/rpc/__init__.py")
src = open(rpc_init).read()
old = 'if is_available() and not torch._C._rpc_init():\n    raise RuntimeError("Failed to initialize torch.distributed.rpc")'
new = ('if is_available():\n'
       '    try:\n'
       '        if not torch._C._rpc_init():\n'
       '            raise RuntimeError("Failed to initialize torch.distributed.rpc")\n'
       '    except RuntimeError as _e:\n'
       '        if "already defined" not in str(_e):\n'
       '            raise\n'
       '        def is_available() -> bool:  # type: ignore[no-redef]\n'
       '            return False')
if old in src:
    open(rpc_init, 'w').write(src.replace(old, new))
    print(f"  Patched {rpc_init}")
elif 'already defined' in src:
    print(f"  Already patched: {rpc_init}")
else:
    print(f"  WARNING: unexpected content in {rpc_init}", file=sys.stderr)

# ── Patch 2: torch/_jit_internal.py ────────────────────────────────────
jit = os.path.join(sp, "torch/_jit_internal.py")
src2 = open(jit).read()
old2 = '# This is needed. `torch._jit_internal` is imported before `torch.distributed.__init__`.\n# Explicitly ask to import `torch.distributed.__init__` first.\n# Otherwise, "AttributeError: module \'torch\' has no attribute \'distributed\'" is raised.\nimport torch.distributed.rpc'
new2 = ('# This is needed. `torch._jit_internal` is imported before `torch.distributed.__init__`.\n'
        '# Explicitly ask to import `torch.distributed.__init__` first.\n'
        '# Otherwise, "AttributeError: module \'torch\' has no attribute \'distributed\'" is raised.\n'
        'try:\n'
        '    import torch.distributed.rpc\n'
        'except RuntimeError as _rpc_e:\n'
        '    if "already defined" not in str(_rpc_e):\n'
        '        raise')
if old2 in src2:
    open(jit, 'w').write(src2.replace(old2, new2))
    print(f"  Patched {jit}")
elif 'already defined' in src2:
    print(f"  Already patched: {jit}")
else:
    print(f"  WARNING: unexpected content in {jit}", file=sys.stderr)
PYEOF

# ── Build ───────────────────────────────────────────────────────────────
echo "🔨 Running PyInstaller…"
rm -rf dist/ build/
pyinstaller korero.spec --clean --noconfirm

echo "✅ PyInstaller build complete: dist/korero-sidecar/"
ls -lh dist/korero-sidecar/korero-sidecar

# ── Copy to Tauri binaries dir ──────────────────────────────────────────
DEST="../src-tauri/binaries"
mkdir -p "$DEST"

# Copy the main binary with the Tauri triple suffix
cp "dist/korero-sidecar/korero-sidecar" "$DEST/korero-sidecar-$TRIPLE"
chmod +x "$DEST/korero-sidecar-$TRIPLE"

# Copy the _internal support directory
# PyInstaller looks for _internal relative to the binary, so it must be at $DEST/_internal
INTERNAL_SRC="dist/korero-sidecar/_internal"
INTERNAL_DEST="$DEST/_internal"

rm -rf "$INTERNAL_DEST"

if [[ -d "$INTERNAL_SRC" ]]; then
  cp -r "$INTERNAL_SRC" "$INTERNAL_DEST"
  echo "📦 Copied _internal to $INTERNAL_DEST"
else
  # Older PyInstaller: copy entire onedir contents except the binary
  mkdir -p "$INTERNAL_DEST"
  find "dist/korero-sidecar/" -not -name "korero-sidecar" -mindepth 1 -maxdepth 1 \
    -exec cp -r {} "$INTERNAL_DEST/" \;
fi

# ── Deduplicate torch dylibs to prevent pybind11 double-registration ─────
# PyInstaller hoists torch dylibs to _internal/ root AND keeps copies in
# torch/lib/. macOS dyld loads both paths as separate libraries, which
# causes "cannot initialize type RpcBackendOptions: already defined".
# Replacing the root copies with symlinks makes dyld resolve both to the
# same canonical path and only initialize the library once.
echo "🔗 Symlinking duplicate torch dylibs to torch/lib/…"
for lib in libc10.dylib libomp.dylib libshm.dylib libtorch.dylib libtorch_cpu.dylib libtorch_python.dylib; do
  if [[ -f "$INTERNAL_DEST/$lib" && -f "$INTERNAL_DEST/torch/lib/$lib" ]]; then
    rm -f "$INTERNAL_DEST/$lib"
    ln -s "torch/lib/$lib" "$INTERNAL_DEST/$lib"
    echo "   $lib → torch/lib/$lib"
  fi
done

# ── Ensure _internal/ filesystem files match the frozen PKG archive patches ─
# (The venv was already patched before PyInstaller ran, so the PKG archive
# has the correct bytecode. These patches keep the filesystem .py files in
# sync as a fallback for modules loaded outside the frozen archive.)
RPC_INIT="$INTERNAL_DEST/torch/distributed/rpc/__init__.py"
if [[ -f "$RPC_INIT" ]]; then
  python3 - "$RPC_INIT" <<'PYEOF'
import sys
path = sys.argv[1]
src = open(path).read()
old = 'if is_available() and not torch._C._rpc_init():\n    raise RuntimeError("Failed to initialize torch.distributed.rpc")'
new = ('if is_available():\n'
       '    try:\n'
       '        if not torch._C._rpc_init():\n'
       '            raise RuntimeError("Failed to initialize torch.distributed.rpc")\n'
       '    except RuntimeError as _e:\n'
       '        if "already defined" not in str(_e):\n'
       '            raise\n'
       '        def is_available() -> bool:  # type: ignore[no-redef]\n'
       '            return False')
if old in src:
    open(path, 'w').write(src.replace(old, new))
    print("   Patched torch/distributed/rpc/__init__.py")
elif 'already defined' in src:
    print("   torch/distributed/rpc/__init__.py already patched")
PYEOF
fi

# ── Ad-hoc sign so macOS allows the binary and its libs when spawned ─────
echo "🔏 Ad-hoc signing sidecar and bundled libraries…"
codesign --force --sign - "$DEST/korero-sidecar-$TRIPLE" 2>/dev/null
find "$INTERNAL_DEST" \( -name "*.so" -o -name "*.dylib" \) \
  -exec codesign --force --sign - {} \; 2>/dev/null
echo "✅ Signing done"

# ── Copy binary + symlink _internal into target/debug for tauri dev ──────
# Tauri dev mode runs the sidecar from target/debug/. We copy the binary there
# and symlink _internal so PyInstaller's bootloader finds its support files.
DEV_TARGET="../target/debug"
if [[ -d "$DEV_TARGET" ]]; then
  cp "$DEST/korero-sidecar-$TRIPLE" "$DEV_TARGET/korero-sidecar"
  chmod +x "$DEV_TARGET/korero-sidecar"
  ln -sfn "$(pwd)/$INTERNAL_DEST" "$DEV_TARGET/_internal"
  echo "🔗 Deployed sidecar to $DEV_TARGET for tauri dev"
fi

# ── Invalidate the release runtime cache ────────────────────────────────
# The release app copies the sidecar to $TMPDIR/korero_sidecar (see
# prepare_sidecar_tmp in lib.rs). Clear it so the next launch re-copies the
# binary we just built instead of serving a same-size stale copy.
echo "🧹 Clearing stale release sidecar cache…"
rm -rf "${TMPDIR:-/tmp}/korero_sidecar" "/tmp/korero_sidecar" 2>/dev/null || true

echo ""
echo "✅ Sidecar ready:"
echo "   $DEST/korero-sidecar-$TRIPLE"
echo "   $DEST/_internal/"
echo ""
echo "Next: npm run tauri build (or tauri dev)"
