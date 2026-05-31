# Kōrero

**Local, private meeting transcription for macOS.**

Kōrero converts audio and video recordings into timestamped, speaker-labelled transcripts — entirely on your Mac, with no cloud, no accounts, and nothing ever leaving your device.

<p align="center">
  <img src="docs/assets/screenshot.png" alt="Kōrero screenshot" width="760" />
</p>

---

## What it does

Drop an audio or video file → Kōrero runs a five-stage local pipeline:

```
ffmpeg (extract audio) → WhisperX (transcribe) → word alignment → pyannote 3.0 (diarise) → merge
```

The result is a searchable transcript with colour-coded, renameable speaker labels, exported as TXT, Markdown, JSON, or SRT.

---

## Requirements

| Requirement | Minimum | Notes |
|---|---|---|
| macOS | 13 Ventura | Apple Silicon or Intel |
| RAM | 8 GB | 16 GB recommended for `large-v3` |
| Storage | 4 GB free | For models on first run |
| HF token | Required for speaker labels | Free at huggingface.co |

The app is **fully self-contained** — no Python installation required. The ML runtime is bundled inside the `.app`.

---

## Download

→ **[Latest release](https://github.com/lrbachtiar/korero_app/releases/latest)** — download the `.dmg` for your Mac.

Kōrero is not notarized, so macOS will block it on first launch. To open it:

1. Mount the DMG and drag **Kōrero.app** to `/Applications`
2. Open Terminal and run:
   ```
   xattr -cr /Applications/Kōrero.app
   ```
3. Double-click Kōrero to launch

You only need to do this once. The `xattr -cr` command strips the quarantine flag that Gatekeeper uses to block unsigned apps.

---

## First-run setup

On first launch Kōrero will ask for a **Hugging Face access token**. This is needed to download the pyannote speaker diarisation model.

1. Sign in at [huggingface.co](https://huggingface.co)
2. Accept the model terms at [pyannote/speaker-diarization-3.0](https://huggingface.co/pyannote/speaker-diarization-3.0) and [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0)
3. Create a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) (read access is enough)
4. Paste it in Kōrero → Preferences

You can skip this and still get a transcript without speaker labels.

Models are downloaded automatically on first use and cached at:
```
~/Library/Application Support/Kōrero/models/
```

---

## Tech stack

| Layer | Technology |
|---|---|
| App shell | [Tauri v2](https://tauri.app) (Rust + WKWebView) |
| UI | React 18 + Vite |
| ML backend | Python 3.11 sidecar (bundled via PyInstaller) |
| Transcription | [WhisperX](https://github.com/m-bain/whisperX) |
| Diarisation | [pyannote.audio 3.0](https://github.com/pyannote/pyannote-audio) |
| Audio processing | [ffmpeg](https://ffmpeg.org) (bundled static binary) |

---

## Project structure

```
korero/
├── src/                    React UI (5 screens)
│   ├── App.jsx             State machine + screen router
│   ├── hooks/              useTranscription, useDragDrop
│   ├── components/         Kit, ScreenDrop, ScreenProcessing, …
│   └── styles/korero.css   Design tokens + all component styles
├── src-tauri/              Rust/Tauri backend
│   └── src/lib.rs          IPC commands (transcription, prefs, export)
├── sidecar/                Python ML pipeline
│   ├── transcribe.py       Sidecar entry point (JSON stdin/stdout)
│   ├── requirements.txt    Python dependencies
│   ├── korero.spec         PyInstaller bundling spec
│   └── build_sidecar.sh    Build script
├── samples/                Sample audio files for dev testing
├── docs/                   GitHub Pages site
└── .github/workflows/      CI/CD (build + release + Pages)
```

---

## Development

### Prerequisites

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) ≥ 20
- [Python](https://python.org) 3.11
- Xcode Command Line Tools

### Running in dev mode

```bash
# Install JS dependencies
npm install

# Build and deploy the Python sidecar (needed once, or after sidecar changes)
cd sidecar && ./build_sidecar.sh && cd ..

# Start dev server (hot-reload React + Tauri window)
npm run tauri dev
```

`build_sidecar.sh` copies the sidecar binary and `_internal/` into `src-tauri/target/debug/` so Tauri's dev runner can find them.

### Building the sidecar

```bash
cd sidecar
./build_sidecar.sh
```

This creates `sidecar/dist/korero-sidecar/` and copies the binary + `_internal/` to `src-tauri/binaries/`.

### Building the app

```bash
# Apple Silicon only (faster for local testing)
npm run tauri:build

# Universal binary (arm64 + x86_64)
npm run tauri:build:universal
```

These scripts run `tauri build` and then `scripts/fix-bundle.sh`, which moves `_internal/` from the location Tauri places it (`Contents/Resources/MacOS/`) to where PyInstaller expects it (`Contents/MacOS/`), then re-signs the bundle.

The `.dmg` appears at `src-tauri/target/release/bundle/dmg/` (or `universal-apple-darwin/…/dmg/` for universal).

---

## Privacy

- **No network calls** — all processing runs locally
- **No telemetry** — Kōrero collects nothing
- **HF token** is stored only in your macOS Keychain
- **Models** live in `~/Library/Application Support/Kōrero/models/` (delete any time)

---

## License

MIT — see [LICENSE](LICENSE).
