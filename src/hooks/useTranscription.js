import { useCallback, useReducer, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Pipeline state ──────────────────────────────────────────────────────
const INITIAL_PIPELINE = {
  stage: null,     // current stage name
  percent: 0,      // 0–100
  eta: null,       // seconds remaining
  detail: "",      // e.g. "segment 14/64"
  logLines: [],    // streaming CLI log
  resumeFrom: null, // stage name to resume from after error
};

function pipelineReducer(state, action) {
  switch (action.type) {
    case "RESET":
      return { ...INITIAL_PIPELINE };
    case "PROGRESS":
      return {
        ...state,
        stage: action.stage,
        percent: action.percent,
        eta: action.eta ?? state.eta,
        detail: action.detail || state.detail,
      };
    case "LOG":
      return {
        ...state,
        logLines: [...state.logLines.slice(-200), action.line], // cap at 200 lines
      };
    case "SET_RESUME":
      return { ...state, resumeFrom: action.stage };
    default:
      return state;
  }
}

// ── Hook ────────────────────────────────────────────────────────────────
export default function useTranscription({ onResult, onError }) {
  const [pipeline, dispatch] = useReducer(pipelineReducer, INITIAL_PIPELINE);
  const transcriptRef = useRef(null);
  const errorRef = useRef(null);

  // Tauri event unlisten handles
  const unlistenRefs = useRef([]);

  const attachListeners = useCallback(async (handlers) => {
    // Remove any previous listeners
    unlistenRefs.current.forEach((fn) => fn());
    unlistenRefs.current = [];

    const [u1, u2, u3, u4] = await Promise.all([
      listen("transcription-progress", (e) => {
        const { stage, percent, eta, detail } = e.payload;
        dispatch({ type: "PROGRESS", stage, percent, eta, detail });
      }),

      listen("transcription-log", (e) => {
        dispatch({ type: "LOG", line: e.payload.line });
      }),

      listen("transcription-result", (e) => {
        transcriptRef.current = e.payload;
        onResult(e.payload);
      }),

      listen("transcription-error", (e) => {
        errorRef.current = e.payload;
        // If the error has a resume stage, store it so we can retry
        if (e.payload.stage) {
          dispatch({ type: "SET_RESUME", stage: e.payload.stage });
        }
        onError(e.payload);
      }),
    ]);

    unlistenRefs.current = [u1, u2, u3, u4];
  }, [onResult, onError]);

  // ── Start a fresh transcription ───────────────────────────────────
  const startTranscription = useCallback(async (request) => {
    dispatch({ type: "RESET" });
    errorRef.current = null;
    await attachListeners();
    try {
      await invoke("start_transcription", { request });
    } catch (e) {
      errorRef.current = { message: e.toString(), fix: "Check the console for details." };
      onError(errorRef.current);
    }
  }, [attachListeners, onError]);

  // ── Cancel running transcription ──────────────────────────────────
  const cancelTranscription = useCallback(async () => {
    try {
      await invoke("cancel_transcription");
    } catch (e) {
      console.error("Cancel failed:", e);
    } finally {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];
    }
  }, []);

  // ── Retry from the failed stage ───────────────────────────────────
  const retryFrom = useCallback(async (request) => {
    dispatch({ type: "RESET" });
    errorRef.current = null;
    await attachListeners();
    try {
      const resumeRequest = {
        ...request,
        resume_from: pipeline.resumeFrom,
      };
      await invoke("start_transcription", { request: resumeRequest });
    } catch (e) {
      errorRef.current = { message: e.toString(), fix: "Check the console for details." };
      onError(errorRef.current);
    }
  }, [attachListeners, onError, pipeline.resumeFrom]);

  return {
    pipeline,
    transcript: transcriptRef.current,
    error: errorRef.current,
    startTranscription,
    cancelTranscription,
    retryFrom,
  };
}
