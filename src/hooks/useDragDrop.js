import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

const AUDIO_VIDEO_EXTS = new Set([
  "mp4", "m4a", "mov", "wav", "mp3", "aac", "ogg", "flac", "mkv", "webm", "opus",
]);

function isAudioVideo(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_VIDEO_EXTS.has(ext);
}

/**
 * Handles drag-and-drop for the whole Kōrero window.
 *
 * Returns:
 *   isDragging  — true when a drag is over the window
 *   onBodyClick — call on the drop zone click to open file dialog
 *
 * Calls `onFile(path)` when a valid file is dropped or picked.
 */
export default function useDragDrop({ onFile, enabled = true }) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // Tauri drag-drop events (works in the native Tauri window)
  useEffect(() => {
    if (!enabled) return;

    let unlistenDrop;
    let unlistenOver;
    let unlistenLeave;

    listen("tauri://drag-drop", (e) => {
      setIsDragging(false);
      dragCounter.current = 0;
      const paths = e.payload?.paths ?? [];
      const valid = paths.find(isAudioVideo);
      if (valid) onFile(valid);
    }).then((fn) => { unlistenDrop = fn; });

    listen("tauri://drag-over", () => {
      setIsDragging(true);
    }).then((fn) => { unlistenOver = fn; });

    listen("tauri://drag-leave", () => {
      setIsDragging(false);
      dragCounter.current = 0;
    }).then((fn) => { unlistenLeave = fn; });

    return () => {
      unlistenDrop?.();
      unlistenOver?.();
      unlistenLeave?.();
    };
  }, [enabled, onFile]);

  // Also support browser-style drag events (useful in dev mode / webview)
  useEffect(() => {
    if (!enabled) return;

    const onDragEnter = (e) => {
      e.preventDefault();
      dragCounter.current++;
      setIsDragging(true);
    };
    const onDragOver = (e) => {
      e.preventDefault();
    };
    const onDragLeave = () => {
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsDragging(false);
      }
    };
    const onDrop = (e) => {
      e.preventDefault();
      setIsDragging(false);
      dragCounter.current = 0;
      const files = Array.from(e.dataTransfer?.files ?? []);
      const valid = files.find((f) => isAudioVideo(f.name));
      if (valid?.path) onFile(valid.path);
    };

    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);

    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [enabled, onFile]);

  return { isDragging };
}
