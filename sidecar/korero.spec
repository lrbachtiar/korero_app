# -*- mode: python ; coding: utf-8 -*-
# Korero sidecar — PyInstaller spec
# Produces a self-contained onedir bundle with all ML dependencies.
#
# Build: pyinstaller korero.spec
# Output: dist/korero-sidecar/ (directory)
#
# The resulting korero-sidecar binary + its _internal/ directory are
# copied into src-tauri/binaries/ by build_sidecar.sh so Tauri can
# bundle them into the .app.

import sys
from pathlib import Path

block_cipher = None

# Collect data files that PyInstaller won't find automatically
from PyInstaller.utils.hooks import collect_data_files
added_datas = (
    collect_data_files("pyannote.audio")
    + collect_data_files("whisperx")   # bundled VAD model (whisperx/assets/pytorch_model.bin)
)

# ── Hidden imports ──────────────────────────────────────────────────────
# PyTorch, transformers, pyannote all use dynamic loading extensively.
hidden = [
    # Core whisperx (module layout as of current installed version)
    "whisperx",
    "whisperx.alignment",
    "whisperx.asr",
    "whisperx.audio",
    "whisperx.diarize",
    "whisperx.schema",
    "whisperx.utils",
    "whisperx.conjunctions",
    "whisperx.log_utils",
    "whisperx.vads",
    "whisperx.vads.pyannote",
    "whisperx.vads.silero",
    "whisperx.vads.vad",

    # faster-whisper
    "faster_whisper",
    "faster_whisper.audio",
    "faster_whisper.feature_extractor",
    "faster_whisper.tokenizer",
    "faster_whisper.transcribe",
    "ctranslate2",

    # pyannote
    "pyannote",
    "pyannote.audio",
    "pyannote.audio.core",
    "pyannote.audio.models",
    "pyannote.audio.models.segmentation",
    "pyannote.audio.pipelines",
    "pyannote.audio.pipelines.speaker_diarization",
    "pyannote.core",
    "pyannote.database",
    "pyannote.metrics",
    "pyannote.pipeline",

    # torch
    "torch",
    "torch.nn",
    "torch.nn.functional",
    "torchaudio",
    "torchaudio.transforms",

    # HuggingFace
    "transformers",
    "transformers.models",
    "huggingface_hub",
    "tokenizers",
    "sentencepiece",

    # audio
    "soundfile",
    "librosa",
    "librosa.core",
    "librosa.feature",
    "librosa.filters",

    # data / compute
    "sklearn",
    "sklearn.preprocessing",
    "scipy",
    "scipy.signal",
    "numpy",
    "pandas",
]

a = Analysis(
    ["transcribe.py"],
    pathex=[str(Path(".").resolve())],
    binaries=[
        # libsox is referenced via @rpath by torchaudio's sox backend;
        # PyInstaller can't resolve @rpath automatically so we pin it here.
        ("/opt/homebrew/opt/sox/lib/libsox.dylib", "."),
    ],
    datas=added_datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # torch.distributions and torch.testing are imported by torch/__init__.py
        # and must be present for a clean torch import.
        "torchcodec",           # metadata not collected by PyInstaller; excluded so is_torchcodec_available()=False
        # torchvision + PIL are in the import chain (pyannote/lightning → torchmetrics → torchvision → PIL)
        # and must be present for a clean import. Their combined size is ~15 MB.
        "matplotlib",           # not needed
        "IPython",              # not needed
        "notebook",             # not needed
        "tkinter",              # not needed, broken install
        "_tkinter",
        "tensorboard",          # not installed, not needed
        "torch.utils.tensorboard",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,  # onedir mode
    name="korero-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,              # UPX can break PyTorch shared libs on macOS
    console=True,           # stdout/stderr must be available
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,       # None = current arch; use lipo in CI for universal
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="korero-sidecar",
)
