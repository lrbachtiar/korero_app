/**
 * ScreenDrop.jsx — Drop zone (idle) + File loaded states.
 * Matches design handoff screen-drop.jsx.
 */
import React from "react";
import { Window, Icon, IconBtn, Segmented, Stepper, Select, Btn, PrefsModal } from "./Kit.jsx";
import useDragDrop from "../hooks/useDragDrop.js";

const FORMATS = ["mp4", "m4a", "mov", "wav", "mp3"];

function formatDuration(secs) {
  if (!secs) return "—";
  const s = Math.round(secs);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function formatSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MiniWave() {
  const bars = [9, 16, 11, 20, 14, 8, 18, 13, 6, 15, 10, 19, 12, 7];
  return (
    <div className="k-mini-wave" aria-hidden="true">
      {bars.map((h, i) => <i key={i} style={{ height: h }} />)}
    </div>
  );
}

function SettingsPanel({ s, onChange }) {
  return (
    <div className="k-settings">
      <div className="k-settings-grid">
        <div className="k-setting">
          <span className="k-setting-lbl">Speakers</span>
          <div className="k-setting-row">
            <Stepper value={s.spkMin} min={1} max={s.spkMax} onChange={(v) => onChange({ spkMin: v })} />
            <span className="k-range-dash">to</span>
            <Stepper value={s.spkMax} min={s.spkMin} max={10} onChange={(v) => onChange({ spkMax: v })} />
          </div>
        </div>

        <div className="k-setting">
          <span className="k-setting-lbl">Language</span>
          <Select
            value={s.lang}
            onChange={(v) => onChange({ lang: v })}
            options={[
              { value: "auto", label: "Auto-detect" },
              { value: "en", label: "English" },
              { value: "es", label: "Spanish" },
              { value: "fr", label: "French" },
              { value: "de", label: "German" },
              { value: "zh", label: "Chinese" },
              { value: "ja", label: "Japanese" },
              { value: "pt", label: "Portuguese" },
            ]}
            style={{ width: "100%" }}
          />
        </div>

        <div className="k-setting">
          <span className="k-setting-lbl">Model</span>
          <Segmented
            value={s.model}
            onChange={(v) => onChange({ model: v })}
            options={[
              { value: "medium", label: "Medium" },
              { value: "large-v3", label: "Large-v3" },
            ]}
          />
          <span className="k-setting-note">
            {s.model === "large-v3"
              ? "Best accuracy · ~1.6× slower"
              : "Faster · good for clean audio"}
          </span>
        </div>

        <div className="k-setting">
          <span className="k-setting-lbl">Output format</span>
          <Segmented
            value={s.format}
            onChange={(v) => onChange({ format: v })}
            options={["TXT", "MD", "JSON", "SRT"]}
          />
        </div>
      </div>
    </div>
  );
}

export default function ScreenDrop({
  loaded,
  file,
  settings,
  onSettingsChange,
  onFilePick,
  onFileDrop,
  onFileRemove,
  onTranscribe,
  prefsOpen,
  onOpenPrefs,
  onClosePrefs,
  onSavePrefs,
  prefs,
}) {
  const { isDragging } = useDragDrop({ onFile: onFileDrop, enabled: !loaded });

  const gearBtn = (
    <IconBtn name="gear" title="Preferences" onClick={onOpenPrefs} />
  );

  return (
    <>
      <Window title="Kōrero" right={gearBtn}>
        <div className="k-body">
          {!loaded ? (
            // ── Idle drop zone ─────────────────────────────────────
            <div
              className={"k-drop" + (isDragging ? " hot" : "")}
              onClick={onFilePick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onFilePick()}
              aria-label="Drop audio or video file, or click to choose"
            >
              <div className="k-drop-glyph">
                <Icon name="drop" size={24} />
              </div>
              <div className="k-drop-title">Drop audio or video here</div>
              <div className="k-drop-sub">or click to choose a file</div>
              <div className="k-formats">
                {FORMATS.map((f) => (
                  <span key={f} className="k-fmt">{f}</span>
                ))}
              </div>
            </div>
          ) : (
            // ── File loaded card ───────────────────────────────────
            <div className="k-file">
              <div className="k-file-ico">
                <Icon name="audio" size={22} />
              </div>
              <div className="k-file-meta">
                <div className="k-file-name">{file?.name}</div>
                <div className="k-file-sub">
                  <span>{formatDuration(file?.duration)}</span>
                  <span className="sep">·</span>
                  <span>{formatSize(file?.size)}</span>
                  {file?.codec && (
                    <>
                      <span className="sep">·</span>
                      <span>{file.codec}</span>
                    </>
                  )}
                </div>
              </div>
              <MiniWave />
              <IconBtn name="x" title="Remove file" onClick={onFileRemove} />
            </div>
          )}

          <SettingsPanel s={settings} onChange={onSettingsChange} />

          {loaded && (
            <div className="k-footer">
              <span className="k-setting-note" style={{ color: "var(--text-3)" }}>
                Runs fully on this Mac · nothing leaves your device
              </span>
              <span className="spacer" />
              <Btn variant="primary" lg onClick={onTranscribe}>
                Transcribe
              </Btn>
            </div>
          )}
        </div>
      </Window>

      {prefsOpen && (
        <PrefsModal prefs={prefs} onSave={onSavePrefs} onClose={onClosePrefs} />
      )}
    </>
  );
}
