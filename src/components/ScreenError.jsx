/**
 * ScreenError.jsx — friendly failure card.
 * Matches design handoff screen-error.jsx.
 * Never shows a raw Python traceback — always a friendly message + fix.
 */
import React from "react";
import { Window, Icon, IconBtn, Btn, PrefsModal } from "./Kit.jsx";

export default function ScreenError({
  error,
  onRetry,
  prefsOpen,
  onOpenPrefs,
  onClosePrefs,
  onSavePrefs,
  prefs,
}) {
  const message = error?.message ?? "Something went wrong during transcription.";
  const fix = error?.fix ?? "Try again, or check the log for details.";

  // Detect specific known failure modes for better messaging
  const isHfError =
    error?.stage === "diarize" && (
      message.toLowerCase().includes("401") ||
      message.toLowerCase().includes("403") ||
      message.toLowerCase().includes("token") ||
      message.toLowerCase().includes("access denied") ||
      message.toLowerCase().includes("gated") ||
      message.toLowerCase().includes("hf")
    );

  const title = isHfError
    ? "Couldn't load the speaker model"
    : "Transcription failed";

  // Show the actual sidecar error so the real cause is always visible
  const friendlyMessage = isHfError
    ? message
    : message;

  const friendlyFix = fix;

  const isCode = friendlyFix.includes("pyannote/") || friendlyFix.includes("brew ");

  const gearBtn = <IconBtn name="gear" title="Preferences" onClick={onOpenPrefs} />;

  return (
    <>
      <Window title="Kōrero" right={gearBtn}>
        <div className="k-body">
          <div className="k-error-wrap">
            <div className="k-error">
              <div className="k-error-badge">
                <Icon name="warn" size={30} />
              </div>
              <div className="k-error-title">{title}</div>
              <div className="k-error-msg">{friendlyMessage}</div>

              <div className="k-error-fix">
                <span className="ico"><Icon name="bulb" size={17} /></span>
                <div className="k-error-fix-body">
                  <b>Try this:</b>{" "}
                  {isCode ? (
                    <>
                      {friendlyFix.split(/(pyannote\/[^\s.]+|hf\.co\/[^\s.]+|brew install [^\s]+)/g).map((part, i) =>
                        i % 2 === 1 ? <code key={i}>{part}</code> : part
                      )}
                    </>
                  ) : (
                    friendlyFix
                  )}
                </div>
              </div>

              <div className="k-error-actions">
                <Btn variant="secondary" icon="key" onClick={onOpenPrefs}>
                  Open Preferences
                </Btn>
                <Btn variant="primary" onClick={onRetry}>
                  Retry from here
                </Btn>
              </div>
            </div>
          </div>
        </div>
      </Window>

      {prefsOpen && (
        <PrefsModal prefs={prefs} onSave={onSavePrefs} onClose={onClosePrefs} />
      )}
    </>
  );
}
