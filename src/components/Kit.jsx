/**
 * Kit.jsx — shared Kōrero UI: window chrome, icons, controls.
 * Adapted from the design handoff kit.jsx for use in a real React app.
 */
import React from "react";

// ── Icons ──────────────────────────────────────────────────────────────
export function Icon({ name, size = 16 }) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
  };
  const F = { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor" };

  switch (name) {
    case "drop":
      return <svg {...p}><path d="M12 3v11m0 0 4-4m-4 4-4-4" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>;
    case "search":
      return <svg {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>;
    case "gear":
      return <svg {...p}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>;
    case "x":
      return <svg {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>;
    case "check":
      return <svg {...p} strokeWidth="2.4"><path d="M5 12.5 9.5 17 19 6.5" /></svg>;
    case "chevron":
      return <svg {...p}><path d="M9 6l6 6-6 6" /></svg>;
    case "copy":
      return <svg {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M5.5 15.5H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h9A1.5 1.5 0 0 1 15.5 5v.5" /></svg>;
    case "save":
      return <svg {...p}><path d="M12 3v11m0 0 4-4m-4 4-4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>;
    case "open":
      return <svg {...p}><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>;
    case "audio":
      return <svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 14v2M12 12.5v5M15 14v2" strokeWidth="1.6" /></svg>;
    case "warn":
      return <svg {...p}><path d="M12 4 2.5 20.5h19z" /><path d="M12 10v4.5M12 17.6v.1" strokeWidth="2.1" /></svg>;
    case "bulb":
      return <svg {...p}><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.45 1 1.15 1.1 1.9l.1.8h4.8l.1-.8c.1-.75.5-1.45 1.1-1.9A6 6 0 0 0 12 3z" /></svg>;
    case "stop":
      return <svg {...F}><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>;
    case "key":
      return <svg {...p}><circle cx="8" cy="8" r="4.5" /><path d="m11.2 11.2 8.3 8.3M16 16l2-2M18.5 18.5l1.8-1.8" /></svg>;
    case "folder":
      return <svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
    default:
      return null;
  }
}

// ── Traffic lights ──────────────────────────────────────────────────────
export function TrafficLights({ onClose }) {
  return (
    <div className="k-lights">
      <span className="k-light red" onClick={onClose} />
      <span className="k-light amber" />
      <span className="k-light green" />
    </div>
  );
}

// ── Window shell ────────────────────────────────────────────────────────
export function Window({ title, sub, right, children, onClose }) {
  return (
    <div className="korero">
      <div className="k-titlebar" data-tauri-drag-region>
        <div className="k-lights" />
        {title && (
          <div className="k-title">
            <span>{title}</span>
            {sub && (
              <>
                <span className="k-dot">—</span>
                <span style={{ fontWeight: 500, color: "var(--text-3)" }}>{sub}</span>
              </>
            )}
          </div>
        )}
        <div className="k-titlebar-right">{right}</div>
      </div>
      {children}
    </div>
  );
}

// ── Segmented control ───────────────────────────────────────────────────
export function Segmented({ options, value, onChange, accent }) {
  return (
    <div className={"k-seg" + (accent ? " accent" : "")}>
      {options.map((o) => {
        const v = typeof o === "object" ? o.value : o;
        const l = typeof o === "object" ? o.label : o;
        return (
          <button key={v} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

// ── Stepper control ─────────────────────────────────────────────────────
export function Stepper({ value, min, max, onChange }) {
  return (
    <div className="k-stepper">
      <button disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="val">{value}</span>
      <button disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

// ── Select ──────────────────────────────────────────────────────────────
export function Select({ value, options, onChange, style }) {
  return (
    <select className="k-select" style={style} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => {
        const v = typeof o === "object" ? o.value : o;
        const l = typeof o === "object" ? o.label : o;
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

// ── Button ──────────────────────────────────────────────────────────────
export function Btn({ variant = "secondary", lg, icon, children, onClick, style, disabled }) {
  return (
    <button
      className={`k-btn k-btn-${variant}${lg ? " k-btn-lg" : ""}`}
      onClick={onClick}
      style={style}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

// ── Icon button ─────────────────────────────────────────────────────────
export function IconBtn({ title, name, onClick, size = 15 }) {
  return (
    <button className="k-iconbtn" title={title} onClick={onClick}>
      <Icon name={name} size={size} />
    </button>
  );
}

// ── Preferences modal ───────────────────────────────────────────────────
export function PrefsModal({ prefs, onSave, onClose }) {
  const [local, setLocal] = React.useState(prefs);
  const patch = (k, v) => setLocal((p) => ({ ...p, [k]: v }));

  return (
    <div className="k-prefs-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="k-prefs-modal">
        <div className="k-prefs-header">
          <span className="k-prefs-title">Preferences</span>
          <button className="k-iconbtn" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>

        <div className="k-prefs-body">
          <div className="k-setting">
            <span className="k-setting-lbl">Hugging Face token</span>
            <input
              className="k-prefs-input"
              type="password"
              placeholder="hf_..."
              value={local.hfToken}
              onChange={(e) => patch("hfToken", e.target.value)}
              spellCheck={false}
            />
            <span className="k-setting-note">
              Required for speaker diarisation. Accept terms at{" "}
              <a
                href="https://huggingface.co/pyannote/speaker-diarization-3.0"
                target="_blank"
                rel="noreferrer"
                className="k-prefs-link"
              >
                pyannote/speaker-diarization-3.0
              </a>{" "}
              first.
            </span>
          </div>

          <div className="k-setting" style={{ marginTop: 18 }}>
            <span className="k-setting-lbl">Output folder</span>
            <input
              className="k-prefs-input"
              type="text"
              placeholder="~/Transcripts"
              value={local.outputDir}
              onChange={(e) => patch("outputDir", e.target.value)}
            />
            <span className="k-setting-note">Transcripts are saved here as {"{filename}.{format}"}.</span>
          </div>
        </div>

        <div className="k-prefs-footer">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={() => onSave(local)}>Save</Btn>
        </div>
      </div>
    </div>
  );
}
