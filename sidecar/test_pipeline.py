#!/usr/bin/env python3
"""
test_pipeline.py — local sanity-check for the Korero transcription pipeline.

Usage (with the sidecar venv active):
  cd sidecar
  source .venv/bin/activate
  python test_pipeline.py /path/to/your/audio.m4a [hf_token]

This script imports transcribe.py directly (not as a sidecar) so you can
verify the pipeline works before doing a full PyInstaller build.
"""

import sys
import json

def main():
    if len(sys.argv) < 2:
        print("Usage: python test_pipeline.py <audio_file> [hf_token]")
        sys.exit(1)

    file_path = sys.argv[1]
    hf_token = sys.argv[2] if len(sys.argv) > 2 else ""

    request = {
        "file": file_path,
        "speakers_min": 1,
        "speakers_max": 4,
        "language": "auto",
        "model": "medium",   # Use medium for faster local testing
        "hf_token": hf_token,
        "output_dir": "~/Transcripts",
    }

    # Monkey-patch stdin so transcribe.py reads our test request
    import io
    sys.stdin = io.StringIO(json.dumps(request) + "\n")

    # Capture and pretty-print output
    import builtins
    original_print = builtins.print
    events = []

    def capture_print(*args, **kwargs):
        line = " ".join(str(a) for a in args)
        try:
            event = json.loads(line)
            events.append(event)
            t = event.get("type", "?")
            if t == "progress":
                pct = event.get("percent", 0)
                stage = event.get("stage", "?")
                detail = event.get("detail", "")
                bar = "█" * (pct // 5) + "░" * (20 - pct // 5)
                original_print(f"[{stage:12s}] {bar} {pct:3d}% {detail}")
            elif t == "log":
                original_print(f"  LOG: {event.get('line', '')}")
            elif t == "result":
                segs = event.get("segments", [])
                dur = event.get("duration", 0)
                lang = event.get("language", "?")
                original_print(f"\n✅ RESULT: {len(segs)} segments, {dur:.1f}s, lang={lang}")
                for seg in segs[:5]:
                    spk = seg.get("speaker", "?")
                    text = seg.get("text", "")[:80]
                    original_print(f"   [{spk}] {text}")
                if len(segs) > 5:
                    original_print(f"   … and {len(segs)-5} more")
            elif t == "error":
                msg = event.get("message", "?")
                fix = event.get("fix", "")
                original_print(f"\n❌ ERROR: {msg}")
                if fix:
                    original_print(f"   FIX: {fix}")
        except json.JSONDecodeError:
            original_print(line)

    builtins.print = capture_print

    try:
        import transcribe
        transcribe.main()
    finally:
        builtins.print = original_print
        sys.stdin = sys.__stdin__

if __name__ == "__main__":
    main()
