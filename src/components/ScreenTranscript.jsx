/**
 * ScreenTranscript.jsx — transcript reader, search, speaker rename, export.
 * Matches design handoff screen-transcript.jsx.
 */
import React, { useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Window, Icon, IconBtn, Btn, PrefsModal } from "./Kit.jsx";

const SPEAKER_LABELS = ["A", "B", "C", "D", "E"];

function formatTime(secs) {
  if (secs == null) return "0:00";
  const s = Math.round(secs);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function formatDuration(secs) {
  if (!secs) return "0:00";
  const s = Math.round(secs);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// Highlight all matches of `query` in `text`, returning React nodes
function highlight(text, query) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const ql = query.toLowerCase();
  const nodes = [];
  let cur = 0;
  let p;
  while ((p = lower.indexOf(ql, cur)) !== -1) {
    if (p > cur) nodes.push(text.slice(cur, p));
    nodes.push(<mark key={p}>{text.slice(p, p + query.length)}</mark>);
    cur = p + query.length;
  }
  if (cur < text.length) nodes.push(text.slice(cur));
  return nodes.length ? nodes : text;
}

// Map raw speaker labels (SPEAKER_00, SPEAKER_01 …) to A, B, C …
function buildSpeakerMap(segments) {
  const map = {};
  let idx = 0;
  for (const seg of segments) {
    const raw = seg.speaker ?? "SPEAKER_00";
    if (!(raw in map)) {
      map[raw] = SPEAKER_LABELS[idx % SPEAKER_LABELS.length];
      idx++;
    }
  }
  return map;
}

function SpeakerLabel({ label, name, editing, onEdit, onChange, onCommit }) {
  if (editing) {
    return (
      <span className="k-spk">
        <span className="dot" />
        <input
          className="k-spk-input"
          autoFocus
          value={name}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
          }}
          style={{ width: `${Math.max(4, name.length + 1)}ch` }}
        />
      </span>
    );
  }
  return (
    <span className="k-spk" title="Click to rename speaker" onClick={onEdit}>
      <span className="dot" />{name}
    </span>
  );
}

// Serialise transcript for export
function serializeTranscript(segments, speakerMap, speakerNames, format) {
  const entries = segments.map((seg) => {
    const label = speakerMap[seg.speaker ?? "SPEAKER_00"] ?? "A";
    const name = speakerNames[label] ?? `Speaker ${label}`;
    const time = formatTime(seg.start);
    return { name, time, text: seg.text?.trim() ?? "" };
  });

  if (format === "SRT") {
    return entries.map((e, i) => {
      const start = new Date(segments[i].start * 1000).toISOString().slice(11, 23).replace(".", ",");
      const end = new Date(segments[i].end * 1000).toISOString().slice(11, 23).replace(".", ",");
      return `${i + 1}\n${start} --> ${end}\n[${e.name}] ${e.text}`;
    }).join("\n\n");
  }

  if (format === "JSON") {
    return JSON.stringify(
      entries.map((e, i) => ({
        speaker: e.name,
        start: segments[i].start,
        end: segments[i].end,
        text: e.text,
      })),
      null,
      2
    );
  }

  if (format === "MD") {
    return entries.map((e) => `**[${e.time}] ${e.name}:** ${e.text}`).join("\n\n");
  }

  // TXT default
  return entries.map((e) => `[${e.time}] ${e.name}: ${e.text}`).join("\n");
}

export default function ScreenTranscript({
  file,
  transcript,
  outputFormat,
  outputDir,
  onNewFile,
  prefsOpen,
  onOpenPrefs,
  onClosePrefs,
  onSavePrefs,
  prefs,
}) {
  const segments = transcript?.segments ?? [];
  const duration = transcript?.duration ?? 0;

  // Build speaker label mapping (SPEAKER_00 → A, etc.)
  const speakerMap = useMemo(() => buildSpeakerMap(segments), [segments]);

  // Editable display names per label (A, B, C…)
  const [speakerNames, setSpeakerNames] = useState(() => {
    const names = {};
    Object.values(speakerMap).forEach((label) => {
      names[label] = `Speaker ${label}`;
    });
    return names;
  });

  const [editingLabel, setEditingLabel] = useState(null);
  const [query, setQuery] = useState("");
  const [copyDone, setCopyDone] = useState(false);

  // Total word count
  const wordCount = useMemo(
    () => segments.reduce((n, s) => n + (s.text?.trim().split(/\s+/).length ?? 0), 0),
    [segments]
  );

  // Match count for current query
  const matchCount = useMemo(() => {
    if (!query) return 0;
    const ql = query.toLowerCase();
    return segments.reduce((n, s) => {
      let c = 0;
      let from = 0;
      const t = s.text?.toLowerCase() ?? "";
      let p;
      while ((p = t.indexOf(ql, from)) !== -1) { c++; from = p + ql.length; }
      return n + c;
    }, 0);
  }, [query, segments]);

  const handleCopy = useCallback(async () => {
    const text = serializeTranscript(segments, speakerMap, speakerNames, outputFormat);
    try {
      await writeText(text);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 1800);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  }, [segments, speakerMap, speakerNames, outputFormat]);

  const handleSave = useCallback(async () => {
    const text = serializeTranscript(segments, speakerMap, speakerNames, outputFormat);
    const ext = outputFormat.toLowerCase();
    const defaultName = (file?.name ?? "transcript").replace(/\.[^.]+$/, "") + `.${ext}`;

    try {
      const savePath = await saveDialog({
        defaultPath: `${outputDir}/${defaultName}`,
        filters: [{ name: outputFormat, extensions: [ext] }],
      });
      if (savePath) {
        await writeTextFile(savePath, text);
      }
    } catch (e) {
      console.error("Save failed:", e);
    }
  }, [segments, speakerMap, speakerNames, outputFormat, file, outputDir]);

  const handleOpenIn = useCallback(async () => {
    // Save to a temp file and open with the default app
    try {
      const text = serializeTranscript(segments, speakerMap, speakerNames, outputFormat);
      await invoke("open_in_default_app", { content: text, format: outputFormat.toLowerCase() });
    } catch (e) {
      console.error("Open in failed:", e);
    }
  }, [segments, speakerMap, speakerNames, outputFormat]);

  // Unique speaker labels present in the transcript
  const activeSpeakers = useMemo(() => {
    return [...new Set(Object.values(speakerMap))].sort();
  }, [speakerMap]);

  const right = (
    <div className="k-search" style={{ margin: 0 }}>
      <div className="k-searchbox" style={{ minWidth: 220 }}>
        <Icon name="search" size={15} />
        <input
          placeholder="Search transcript…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {query && (
        <span className="k-search-count">
          {matchCount} {matchCount === 1 ? "match" : "matches"}
        </span>
      )}
    </div>
  );

  return (
    <>
      <Window title={file?.name?.replace(/\.[^.]+$/, "") ?? "Transcript"} sub="transcript" right={right}>
        <div className="k-body" style={{ gap: "calc(14px * var(--pad))" }}>
          {/* Transcript blocks */}
          <div className="k-transcript" data-spk="chips">
            {segments.length === 0 ? (
              <div style={{ color: "var(--text-3)", fontSize: 14, textAlign: "center", padding: "40px 0" }}>
                No segments found.
              </div>
            ) : (
              segments.map((seg, i) => {
                const rawSpeaker = seg.speaker ?? "SPEAKER_00";
                const label = speakerMap[rawSpeaker] ?? "A";
                const name = speakerNames[label] ?? `Speaker ${label}`;
                const isEditing = editingLabel === label;

                return (
                  <div key={i} className={`k-blk spk-${label}`}>
                    <div className="k-blk-meta">
                      <span className="k-time">{formatTime(seg.start)}</span>
                      <SpeakerLabel
                        label={label}
                        name={name}
                        editing={isEditing}
                        onEdit={() => setEditingLabel(label)}
                        onChange={(v) => setSpeakerNames((n) => ({ ...n, [label]: v }))}
                        onCommit={() => setEditingLabel(null)}
                      />
                    </div>
                    <div className="k-blk-text">{highlight(seg.text?.trim() ?? "", query)}</div>
                  </div>
                );
              })
            )}
          </div>

          {/* Status bar */}
          <div className="k-statusbar">
            <span className="stat"><b>{wordCount}</b> words</span>
            <span className="stat"><b>{formatDuration(duration)}</b> duration</span>
            <span className="spacer" />
            <div className="k-speakerlist">
              {activeSpeakers.map((label) => (
                <span key={label} className="s">
                  <span
                    className="dot"
                    style={{ background: `var(--spk-${label.toLowerCase()})` }}
                  />
                  {speakerNames[label] ?? `Speaker ${label}`}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Export bar */}
        <div className="k-exportbar">
          <Btn variant="secondary" icon={copyDone ? "check" : "copy"} onClick={handleCopy}>
            {copyDone ? "Copied!" : "Copy"}
          </Btn>
          <Btn variant="secondary" icon="save" onClick={handleSave}>Save as…</Btn>
          <Btn variant="ghost" icon="open" onClick={handleOpenIn}>Open in…</Btn>
          <span className="spacer" />
          <span className="k-setting-note" style={{ color: "var(--text-3)" }}>
            {outputFormat} · {outputDir}
          </span>
          <Btn variant="ghost" onClick={onNewFile} style={{ marginLeft: 8 }}>
            New file
          </Btn>
        </div>
      </Window>

      {prefsOpen && (
        <PrefsModal prefs={prefs} onSave={onSavePrefs} onClose={onClosePrefs} />
      )}
    </>
  );
}
