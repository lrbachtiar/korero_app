import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import ScreenDrop from "./components/ScreenDrop.jsx";
import ScreenProcessing from "./components/ScreenProcessing.jsx";
import ScreenTranscript from "./components/ScreenTranscript.jsx";
import ScreenError from "./components/ScreenError.jsx";
import useTranscription from "./hooks/useTranscription.js";

// Default settings that persist between sessions
const DEFAULT_SETTINGS = {
  spkMin: 1,
  spkMax: 4,
  model: "large-v3",
  format: "TXT",
  lang: "auto",
};

export default function App() {
  // ── Screen state machine ────────────────────────────────────────────
  // idle | loaded | processing | transcript | error
  const [screen, setScreen] = useState("idle");

  // ── File ──────────────────────────────────────────────────────────
  const [file, setFile] = useState(null);
  // { path, name, duration, size, codec }

  // ── Settings ──────────────────────────────────────────────────────
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const patchSettings = useCallback((patch) => setSettings((s) => ({ ...s, ...patch })), []);

  // ── Preferences (HF token, output dir) ────────────────────────────
  const [prefs, setPrefs] = useState({ hfToken: "", outputDir: "~/Transcripts" });
  const [prefsOpen, setPrefsOpen] = useState(false);

  // ── Transcription pipeline ─────────────────────────────────────────
  const {
    pipeline,       // { stage, percent, eta, detail, logLines }
    transcript,     // { segments, duration, language }
    error,          // { message, fix } | null
    startTranscription,
    cancelTranscription,
    retryFrom,
  } = useTranscription({
    onResult: () => setScreen("transcript"),
    onError: () => setScreen("error"),
  });

  // ── Appearance (follow system) ──────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (e) => {
      document.documentElement.dataset.koreroTheme = e.matches ? "dark" : "light";
    };
    apply(mq);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ── Load preferences from Tauri ─────────────────────────────────────
  useEffect(() => {
    invoke("get_preferences")
      .then((p) => {
        setPrefs(p);
        // If no HF token and we've been used before, nudge user
        if (!p.hfToken) setPrefsOpen(true);
      })
      .catch(() => {
        // First run — prefs don't exist yet, open prefs
        setPrefsOpen(true);
      });
  }, []);

  // ── File handling ───────────────────────────────────────────────────
  const handleFilePick = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          { name: "Audio / Video", extensions: ["mp4", "m4a", "mov", "wav", "mp3", "aac", "ogg", "flac", "mkv", "webm"] },
        ],
      });
      if (!selected) return;
      await loadFile(selected);
    } catch (e) {
      console.error("File pick failed:", e);
    }
  }, []);

  const loadFile = useCallback(async (path) => {
    try {
      const info = await invoke("probe_file", { filePath: path });
      const fmt = info.format || {};
      const stream = (info.streams || []).find((s) => s.codec_type === "audio") || {};
      const duration = parseFloat(fmt.duration || 0);
      const size = parseInt(fmt.size || 0, 10);

      setFile({
        path,
        name: path.split("/").pop(),
        duration,
        size,
        codec: [stream.codec_name, stream.sample_rate ? `${Math.round(stream.sample_rate / 1000)} kHz` : ""].filter(Boolean).join(" "),
      });
      setScreen("loaded");
    } catch (e) {
      console.error("Probe failed:", e);
      // Still load the file even if probe fails
      setFile({ path, name: path.split("/").pop(), duration: 0, size: 0, codec: "" });
      setScreen("loaded");
    }
  }, []);

  const handleFileDrop = useCallback((path) => {
    loadFile(path);
  }, [loadFile]);

  const handleFileRemove = useCallback(() => {
    setFile(null);
    setScreen("idle");
  }, []);

  // ── Transcription ───────────────────────────────────────────────────
  const handleTranscribe = useCallback(async () => {
    if (!file) return;
    setScreen("processing");
    await startTranscription({
      file: file.path,
      speakers_min: settings.spkMin,
      speakers_max: settings.spkMax,
      language: settings.lang,
      model: settings.model,
      hf_token: prefs.hfToken,
      output_dir: prefs.outputDir,
      format: settings.format,
    });
  }, [file, settings, prefs, startTranscription]);

  const handleCancel = useCallback(async () => {
    await cancelTranscription();
    setScreen("loaded");
  }, [cancelTranscription]);

  const handleRetry = useCallback(async () => {
    if (!file) return;
    setScreen("processing");
    await retryFrom({
      file: file.path,
      speakers_min: settings.spkMin,
      speakers_max: settings.spkMax,
      language: settings.lang,
      model: settings.model,
      hf_token: prefs.hfToken,
      output_dir: prefs.outputDir,
      format: settings.format,
    });
  }, [file, settings, prefs, retryFrom]);

  // ── Preferences save ─────────────────────────────────────────────────
  const handleSavePrefs = useCallback(async (newPrefs) => {
    setPrefs(newPrefs);
    setPrefsOpen(false);
    try {
      await invoke("set_preferences", { prefs: newPrefs });
    } catch (e) {
      console.error("Could not save preferences:", e);
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────
  const sharedProps = {
    prefsOpen,
    onOpenPrefs: () => setPrefsOpen(true),
    onClosePrefs: () => setPrefsOpen(false),
    onSavePrefs: handleSavePrefs,
    prefs,
  };

  switch (screen) {
    case "idle":
    case "loaded":
      return (
        <ScreenDrop
          {...sharedProps}
          loaded={screen === "loaded"}
          file={file}
          settings={settings}
          onSettingsChange={patchSettings}
          onFilePick={handleFilePick}
          onFileDrop={handleFileDrop}
          onFileRemove={handleFileRemove}
          onTranscribe={handleTranscribe}
        />
      );

    case "processing":
      return (
        <ScreenProcessing
          {...sharedProps}
          file={file}
          settings={settings}
          pipeline={pipeline}
          onCancel={handleCancel}
        />
      );

    case "transcript":
      return (
        <ScreenTranscript
          {...sharedProps}
          file={file}
          transcript={transcript}
          outputFormat={settings.format}
          outputDir={prefs.outputDir}
          onNewFile={() => { setFile(null); setScreen("idle"); }}
        />
      );

    case "error":
      return (
        <ScreenError
          {...sharedProps}
          error={error}
          onRetry={handleRetry}
        />
      );

    default:
      return null;
  }
}
