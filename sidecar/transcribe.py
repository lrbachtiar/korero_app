#!/usr/bin/env python3
"""
Korero Transcription Sidecar
=============================
Receives one JSON object on stdin, runs the 5-stage transcription
pipeline, and writes JSON progress events to stdout line-by-line.

Protocol:
  stdin  → {"file":…, "speakers_min":…, …}
  stdout → {"type":"progress", "stage":…, "percent":…, "eta":…, "detail":…}
           {"type":"log", "line":…}
           {"type":"result", "segments":[…], "duration":…, "language":…}
           {"type":"error", "message":…, "fix":…}
"""

import sys
import json
import os
import subprocess
import tempfile
import time
import warnings
from pathlib import Path

# Suppress noisy-but-harmless warnings that would appear as log lines:
#   • pyannote warns torchcodec isn't installed — whisperx pre-loads audio, so it's never used.
#   • Lightning auto-upgrades the bundled VAD checkpoint on every load — the model still works.
warnings.filterwarnings("ignore", message="torchcodec is not installed")
warnings.filterwarnings("ignore", message="Lightning automatically upgraded")


# ── ffmpeg / ffprobe resolution ─────────────────────────────────────────
# Prefer bundled binaries (imageio-ffmpeg in _MEIPASS), fall back to PATH.

def _find_ffmpeg() -> str:
    # PyInstaller bundle: imageio_ffmpeg ships a static binary into _MEIPASS
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        import glob
        pattern = os.path.join(meipass, "imageio_ffmpeg", "binaries", "ffmpeg-*")
        matches = glob.glob(pattern)
        if matches:
            return matches[0]
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    return "ffmpeg"

def _find_ffprobe() -> str:
    # ffprobe lives alongside the imageio-ffmpeg static binary
    ffmpeg = _find_ffmpeg()
    if ffmpeg != "ffmpeg":
        ffprobe = ffmpeg.replace("ffmpeg-", "ffprobe-")
        if os.path.isfile(ffprobe):
            return ffprobe
        # Some distributions name it ffprobe without the suffix
        candidate = os.path.join(os.path.dirname(ffmpeg), "ffprobe")
        if os.path.isfile(candidate):
            return candidate
    return "ffprobe"

FFMPEG  = _find_ffmpeg()
FFPROBE = _find_ffprobe()


# ── Output helpers ──────────────────────────────────────────────────────

def emit(data: dict):
    """Write a JSON event to stdout and flush immediately."""
    print(json.dumps(data), flush=True)

_stage_starts: dict[str, float] = {}

def emit_progress(stage: str, percent: int, eta: int | None = None, detail: str = ""):
    if percent == 0:
        _stage_starts[stage] = time.time()
    if eta is None and percent > 0 and stage in _stage_starts:
        elapsed = time.time() - _stage_starts[stage]
        eta = int(elapsed / percent * (100 - percent))
    emit({"type": "progress", "stage": stage, "percent": percent,
          "eta": eta, "detail": detail})

def emit_log(line: str):
    emit({"type": "log", "line": line})

def emit_error(message: str, fix: str = "", stage: str | None = None):
    emit({"type": "error", "message": message, "fix": fix, "stage": stage})

def emit_result(segments: list, duration: float, language: str):
    emit({"type": "result", "segments": segments,
          "duration": duration, "language": language})


# ── Stage 1: Probe ──────────────────────────────────────────────────────

def probe_file(file_path: str) -> dict:
    result = subprocess.run(
        [FFPROBE, "-v", "quiet", "-print_format", "json",
         "-show_format", "-show_streams", file_path],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffprobe returned non-zero exit code")
    return json.loads(result.stdout)


# ── Stage 2: Extract audio ──────────────────────────────────────────────

def extract_audio(input_path: str, output_path: str, duration_secs: float | None) -> None:
    """Convert to 16kHz mono WAV using ffmpeg."""
    cmd = [
        FFMPEG, "-y",
        "-i", input_path,
        "-ac", "1",            # mono
        "-ar", "16000",        # 16 kHz
        "-sample_fmt", "s16",  # 16-bit
        output_path,
    ]
    process = subprocess.Popen(cmd, stderr=subprocess.PIPE, text=True)

    for raw_line in process.stderr:
        line = raw_line.rstrip()
        emit_log(f"ffmpeg: {line}")

        if "time=" in line and duration_secs:
            try:
                time_str = line.split("time=")[1].strip().split(" ")[0]
                h, m, s = time_str.split(":")
                current = int(h) * 3600 + int(m) * 60 + float(s)
                pct = min(98, int(current / duration_secs * 100))
                emit_progress("extract", pct)
            except Exception:
                pass

    process.wait()
    if process.returncode != 0:
        raise RuntimeError("ffmpeg exited with non-zero status. Check file format.")


# ── Stage 3: Transcribe ─────────────────────────────────────────────────

def run_transcribe(wav_path: str, model_size: str, language: str | None, device: str) -> dict:
    import whisperx

    # ctranslate2 (faster-whisper backend) only supports "cpu" and "cuda".
    # MPS is Apple Silicon GPU — supported by PyTorch but not ctranslate2.
    ct2_device = "cpu" if device == "mps" else device
    compute_type = "float16" if ct2_device == "cuda" else "int8"

    emit_log(f"Loading Whisper {model_size} model on {ct2_device} ({compute_type})…")
    emit_progress("transcribe", 5, detail="Loading model")

    model = whisperx.load_model(
        model_size, ct2_device, compute_type=compute_type,
        language=language,
    )

    emit_progress("transcribe", 15, detail="Model loaded — transcribing")
    emit_log(f"Transcribing {wav_path}…")

    audio = whisperx.load_audio(wav_path)
    result = model.transcribe(audio, batch_size=8, language=language)

    detected = result.get("language", "unknown")
    emit_log(f"Detected language: {detected} ({len(result.get('segments', []))} segments)")
    emit_progress("transcribe", 100, detail=f"Detected: {detected}")

    return result


# ── Stage 4: Word alignment ─────────────────────────────────────────────

def run_align(result: dict, wav_path: str, device: str) -> dict:
    import whisperx

    language = result.get("language", "en")
    emit_log(f"Loading alignment model for: {language}")
    emit_progress("align", 10, detail="Loading aligner")

    try:
        model_a, metadata = whisperx.load_align_model(language_code=language, device=device)
        audio = whisperx.load_audio(wav_path)
        emit_progress("align", 40, detail="Aligning words")
        result = whisperx.align(
            result["segments"], model_a, metadata, audio, device,
            return_char_alignments=False,
        )
        emit_progress("align", 100, detail="Alignment complete")
    except Exception as e:
        emit_log(f"Warning: alignment skipped ({e})")
        emit_progress("align", 100, detail="Skipped (no aligner for this language)")

    return result


# ── Stage 5: Speaker diarisation ────────────────────────────────────────

def run_diarize(wav_path: str, result: dict, spk_min: int, spk_max: int,
                hf_token: str, device: str) -> list:
    import whisperx
    from whisperx.diarize import DiarizationPipeline, assign_word_speakers

    emit_log("Loading pyannote diarisation pipeline…")
    emit_progress("diarize", 5, detail="Loading model")

    diarize_model = DiarizationPipeline(
        model_name="pyannote/speaker-diarization-3.0",
        token=hf_token or None,
        device=device,
    )

    emit_progress("diarize", 25, detail="Running diarisation")
    emit_log(f"Diarising (min={spk_min}, max={spk_max})…")

    audio = whisperx.load_audio(wav_path)
    kwargs = {}
    if spk_min: kwargs["min_speakers"] = spk_min
    if spk_max: kwargs["max_speakers"] = spk_max
    diarize_segments = diarize_model(audio, **kwargs)

    emit_progress("diarize", 75, detail="Assigning speakers to segments")
    result = assign_word_speakers(diarize_segments, result)

    emit_progress("diarize", 100, detail="Diarisation complete")
    return result.get("segments", [])


# ── Format segments for Korero ──────────────────────────────────────────

def format_segments(segments: list) -> list:
    """Normalise pyannote speaker labels to A, B, C, D, E."""
    speaker_map: dict[str, str] = {}
    labels = "ABCDE"
    out = []

    for seg in segments:
        raw = seg.get("speaker", "SPEAKER_00")
        if raw not in speaker_map:
            idx = len(speaker_map) % len(labels)
            speaker_map[raw] = labels[idx]

        out.append({
            "speaker": speaker_map[raw],
            "start": round(seg.get("start", 0), 3),
            "end": round(seg.get("end", 0), 3),
            "text": seg.get("text", "").strip(),
        })

    return out


# ── Device detection ────────────────────────────────────────────────────

def detect_device() -> str:
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"


# ── Main ────────────────────────────────────────────────────────────────

def main():
    # Read the JSON request from stdin (one line)
    raw = sys.stdin.readline().strip()
    if not raw:
        emit_error("No request received on stdin", "Internal error — empty stdin")
        return

    try:
        req = json.loads(raw)
    except json.JSONDecodeError as e:
        emit_error(f"Invalid JSON request: {e}", "Internal error")
        return

    file_path  = req.get("file", "")
    spk_min    = int(req.get("speakers_min", 1))
    spk_max    = int(req.get("speakers_max", 5))
    language   = req.get("language", "auto") or "auto"
    if language == "auto":
        language = None          # WhisperX auto-detects when None
    model_size = req.get("model", "large-v3")
    hf_token   = req.get("hf_token", "") or ""

    emit_log(f"Korero sidecar started — file: {Path(file_path).name}")
    device = detect_device()
    emit_log(f"Device: {device} | HF token: {'set' if hf_token else 'not set'}")

    # ── Stage 1: Probe ──────────────────────────────────────────────
    emit_progress("probe", 0, detail="Probing file…")
    try:
        probe = probe_file(file_path)
        fmt_info = probe.get("format", {})
        duration = float(fmt_info.get("duration", 0))
        fmt_name = fmt_info.get("format_name", "?")
        streams  = probe.get("streams", [])
        audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), {})
        codec = audio_stream.get("codec_name", "?")
        emit_log(f"Duration: {duration:.1f}s | Format: {fmt_name} | Codec: {codec}")
        emit_progress("probe", 100)
    except Exception as e:
        emit_error(
            f"Could not read file: {e}",
            "Ensure the file is a valid audio/video format. "
            "Try: ffprobe your-file.mp4",
            stage="probe",
        )
        return

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "audio.wav")

        # ── Stage 2: Extract ────────────────────────────────────────
        emit_progress("extract", 0, detail="Extracting audio…")
        try:
            extract_audio(file_path, wav, duration)
            emit_progress("extract", 100)
        except Exception as e:
            emit_error(
                f"Audio extraction failed: {e}",
                "Make sure ffmpeg is available. If using the bundled app, "
                "this is a packaging error — please file an issue.",
                stage="extract",
            )
            return

        # ── Stage 3: Transcribe ─────────────────────────────────────
        emit_progress("transcribe", 0, detail="Loading model…")
        try:
            result = run_transcribe(wav, model_size, language, device)
        except ModuleNotFoundError as e:
            emit_error(
                f"WhisperX not found: {e}",
                "The sidecar binary may be missing ML dependencies. "
                "Re-run: ./sidecar/build_sidecar.sh",
                stage="transcribe",
            )
            return
        except Exception as e:
            import traceback
            emit_error(f"Transcription failed: {e}", traceback.format_exc(), stage="transcribe")
            return

        # ── Stage 4: Align ──────────────────────────────────────────
        emit_progress("align", 0, detail="Aligning words…")
        try:
            result = run_align(result, wav, device)
        except Exception as e:
            emit_log(f"Alignment warning: {e}")
            emit_progress("align", 100, detail="Skipped")

        # ── Stage 5: Diarise ────────────────────────────────────────
        emit_progress("diarize", 0, detail="Identifying speakers…")
        if hf_token:
            try:
                segments = run_diarize(wav, result, spk_min, spk_max, hf_token, device)
            except Exception as e:
                import traceback
                err_str = str(e)
                err_lower = err_str.lower()
                is_auth = any(x in err_lower for x in (
                    "401", "403", "unauthorized", "forbidden",
                    "gated", "token", "terms", "access",
                ))
                emit_log(f"Diarisation error ({type(e).__name__}): {e}")
                if is_auth:
                    emit_error(
                        f"Hugging Face access denied: {e}",
                        "The diarisation model requires a Hugging Face token with access. "
                        "Make sure your token has at least Read access and re-enter it in Preferences.",
                        stage="diarize",
                    )
                    return
                else:
                    emit_error(
                        f"Speaker diarisation failed: {e}",
                        traceback.format_exc(),
                        stage="diarize",
                    )
                    return
        else:
            emit_log("No HF token — skipping speaker diarisation")
            segments = result.get("segments", [])
            for s in segments:
                s.setdefault("speaker", "SPEAKER_00")
            emit_progress("diarize", 100, detail="Skipped (no token)")

        # ── Done ────────────────────────────────────────────────────
        formatted = format_segments(segments)
        language_out = result.get("language", "en") or "en"
        emit_log(f"Done — {len(formatted)} segments, language={language_out}")
        emit_result(formatted, duration, language_out)


if __name__ == "__main__":
    # freeze_support() must be called before anything else when running as a
    # PyInstaller binary.  Without it, child processes spawned internally by
    # torch / ctranslate2 re-enter this binary as __main__, hit main(), find
    # stdin empty, and emit "No request received on stdin".
    import multiprocessing
    multiprocessing.freeze_support()

    try:
        main()
    except KeyboardInterrupt:
        emit_log("Cancelled")
        os._exit(0)
    except Exception as e:
        import traceback
        emit_error(f"Unexpected error: {e}", traceback.format_exc())
        os._exit(1)
    # os._exit skips Python/PyTorch C-extension cleanup which can segfault
    # or call exit(-1) when ML modules are only partially initialized.
    os._exit(0)
