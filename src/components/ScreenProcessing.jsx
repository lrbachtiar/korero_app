/**
 * ScreenProcessing.jsx — animated 5-stage pipeline tracker.
 * Matches design handoff screen-processing.jsx, driven by real Tauri events.
 */
import React, { useMemo } from "react";
import { Window, Icon, IconBtn, Btn, PrefsModal } from "./Kit.jsx";

const STAGES = [
  { key: "probe",      name: "Probing file" },
  { key: "extract",    name: "Extracting audio" },
  { key: "transcribe", name: "Transcribing" },
  { key: "align",      name: "Aligning words" },
  { key: "diarize",    name: "Diarising speakers" },
];

function fmtTime(sec) {
  if (sec == null || sec < 0) return "--:--";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function StageIndicator({ state }) {
  if (state === "done") {
    return (
      <div className="k-step-ind done">
        <Icon name="check" size={13} />
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className="k-step-ind active">
        <span className="k-spinner" />
      </div>
    );
  }
  return <div className="k-step-ind pending" />;
}

export default function ScreenProcessing({
  file,
  settings,
  pipeline,
  onCancel,
  prefsOpen,
  onOpenPrefs,
  onClosePrefs,
  onSavePrefs,
  prefs,
}) {
  // Determine state for each stage based on pipeline.stage
  const activeIdx = useMemo(() => {
    if (!pipeline.stage) return 0;
    const idx = STAGES.findIndex((s) => s.key === pipeline.stage);
    return idx >= 0 ? idx : 0;
  }, [pipeline.stage]);

  const stateFor = (i) => {
    if (i < activeIdx) return "done";
    if (i === activeIdx) return "active";
    return "pending";
  };

  const elapsed = pipeline.logLines?.length > 0
    ? pipeline.logLines.length // crude proxy for elapsed display
    : 0;

  const elapsedLabel = pipeline.detail || STAGES[activeIdx]?.name || "—";

  const right = (
    <span style={{
      fontSize: 12,
      color: "var(--text-2)",
      fontVariantNumeric: "tabular-nums",
      fontFamily: "var(--mono)",
    }}>
      {pipeline.eta != null ? `~${fmtTime(pipeline.eta)} left` : "…"}
    </span>
  );

  return (
    <>
      <Window title={file?.name ?? "Recording"} sub="transcribing" right={right}>
        <div className="k-body">
          {/* File header */}
          <div className="k-proc-head">
            <div className="k-file-ico">
              <Icon name="audio" size={18} />
            </div>
            <div className="k-file-meta">
              <div className="k-file-name" style={{ fontSize: 14 }}>{file?.name}</div>
              <div className="k-file-sub">
                <span>{settings?.model ?? "large-v3"}</span>
                <span className="sep">·</span>
                <span>{settings?.lang === "auto" ? "auto-detect" : settings?.lang}</span>
              </div>
            </div>
          </div>

          {/* Vertical tracker */}
          <div className="k-track">
            {STAGES.map((st, i) => {
              const state = stateFor(i);
              const isActive = state === "active";
              return (
                <div key={st.key} className={`k-step ${state}`}>
                  <StageIndicator state={state} />
                  <div className="k-step-main">
                    <div className="k-step-row">
                      <span className="k-step-name">{st.name}</span>
                      {isActive && (
                        <span className="k-step-time">{elapsedLabel}</span>
                      )}
                    </div>
                    {isActive && (
                      <div className="k-bar">
                        <i style={{ width: `${pipeline.percent ?? 0}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="k-footer">
            <Btn variant="danger" icon="stop" onClick={onCancel}>Cancel</Btn>
            <span className="spacer" />
            <span className="k-footer-eta">
              {pipeline.eta != null ? (
                <>Estimated <b>{fmtTime(pipeline.eta)}</b> remaining</>
              ) : (
                "Estimating time…"
              )}
            </span>
            <span className="k-setting-note" style={{ color: "var(--text-3)" }}>
              Step {activeIdx + 1} of {STAGES.length}
            </span>
          </div>
        </div>


      </Window>

      {prefsOpen && (
        <PrefsModal prefs={prefs} onSave={onSavePrefs} onClose={onClosePrefs} />
      )}
    </>
  );
}
