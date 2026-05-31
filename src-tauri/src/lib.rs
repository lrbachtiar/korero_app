use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

// ── State ─────────────────────────────────────────────────────────────

enum SidecarHandle {
    Shell(CommandChild),
    Process(tokio::process::Child),
}

/// Holds the running sidecar process so we can cancel it.
struct SidecarState(Arc<Mutex<Option<SidecarHandle>>>);

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionRequest {
    pub file: String,
    pub speakers_min: u32,
    pub speakers_max: u32,
    pub language: String,
    pub model: String,
    pub hf_token: Option<String>,
    pub output_dir: String,
    pub format: Option<String>,
    pub resume_from: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub hf_token: String,
    pub output_dir: String,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            hf_token: String::new(),
            output_dir: "~/Transcripts".to_string(),
        }
    }
}

// ── Commands ───────────────────────────────────────────────────────────

// ── Sidecar launch helpers ─────────────────────────────────────────────


/// Copies the sidecar binary to a temp dir and symlinks _internal/ next to it.
///
/// macOS's _NSGetExecutablePath() always returns the canonical (resolved) path,
/// so a symlink to the bundle binary still shows .app/Contents/MacOS/ to
/// PyInstaller's bundle-mode detector. A real copy gets a fresh inode at the
/// temp path, so the executable path PyInstaller sees is /tmp/korero_sidecar/…
/// with no .app in it — disabling bundle-mode and letting it find _internal/.
fn prepare_sidecar_tmp() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let macos = exe.parent().ok_or("no exe parent dir")?;
    let contents = macos.parent().ok_or("no Contents dir")?;

    let sidecar_src = macos.join("korero-sidecar");
    if !sidecar_src.exists() {
        return Err(format!("korero-sidecar not found at {sidecar_src:?}"));
    }

    // _internal lands in Resources/MacOS/ via Tauri resources map, or MacOS/ via fix-bundle.sh
    let internal_src = [
        macos.join("_internal"),
        contents.join("Resources").join("MacOS").join("_internal"),
    ]
    .into_iter()
    .find(|p| p.exists())
    .ok_or("_internal/ not found — run npm run tauri:build")?;

    // canonicalize resolves symlinks + normalises Unicode (NFD on APFS),
    // giving symlink targets that the filesystem can actually resolve.
    let internal_canonical = internal_src.canonicalize().unwrap_or(internal_src);

    let tmp = std::env::temp_dir().join("korero_sidecar");
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let sidecar_dst = tmp.join("korero-sidecar");
    let internal_link = tmp.join("_internal");

    // Copy the binary when it has changed. A size-only guard is unsafe here:
    // transcribe.py is frozen *into* this binary by PyInstaller, so backend
    // logic edits change the bytes but often not the total file size — a stale
    // /tmp copy would then keep running old code after a rebuild. We refresh
    // when the dst is missing, the sizes differ, OR the source is newer than
    // the cached copy. std::fs::copy stamps dst with the copy time, so the
    // source (stamped at build/install time) only looks "newer" right after a
    // fresh build — steady state still skips the 82 MB copy.
    let src_meta = sidecar_src.metadata().map_err(|e| e.to_string())?;
    let needs_copy = match sidecar_dst.metadata() {
        Ok(dst_meta) => {
            let size_differs = src_meta.len() != dst_meta.len();
            let src_newer = match (src_meta.modified(), dst_meta.modified()) {
                (Ok(s), Ok(d)) => s > d,
                _ => true, // can't compare → err on the side of refreshing
            };
            size_differs || src_newer
        }
        Err(_) => true, // dst missing/unreadable → copy
    };
    if needs_copy {
        std::fs::copy(&sidecar_src, &sidecar_dst).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&sidecar_dst, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }
    }

    // Symlink _internal (1.5 GB — too large to copy; file I/O through the
    // symlink works fine because macOS normalises Unicode on APFS reads).
    if internal_link.exists() || internal_link.is_symlink() {
        std::fs::remove_file(&internal_link).ok();
    }
    std::os::unix::fs::symlink(&internal_canonical, &internal_link)
        .map_err(|e| e.to_string())?;

    Ok(sidecar_dst)
}

// ── Commands ───────────────────────────────────────────────────────────

/// Start the Python sidecar and begin transcription.
/// Progress events are emitted to the frontend via Tauri events.
#[tauri::command]
async fn start_transcription(
    app: AppHandle,
    state: tauri::State<'_, SidecarState>,
    request: TranscriptionRequest,
) -> Result<(), String> {
    let request_json = serde_json::to_string(&request).map_err(|e| e.to_string())?;

    // dev (debug build): Tauri resolves the sidecar from ./binaries/ — no .app
    // bundle path, so PyInstaller works normally via start_via_shell.
    // release (tauri build): the sidecar lives inside .app/Contents/MacOS/,
    // which triggers PyInstaller's macOS bundle-mode and breaks _internal/
    // lookup. We copy the binary to a temp dir so PyInstaller sees a plain
    // /tmp path with _internal/ right next to it.
    #[cfg(debug_assertions)]
    return start_via_shell(app, state, request_json).await;

    #[cfg(not(debug_assertions))]
    return start_via_tmp(app, state, request_json).await;
}

/// Dev mode: use Tauri's shell sidecar mechanism directly.
async fn start_via_shell(
    app: AppHandle,
    state: tauri::State<'_, SidecarState>,
    request_json: String,
) -> Result<(), String> {
    let sidecar = app
        .shell()
        .sidecar("korero-sidecar")
        .map_err(|e| format!("Sidecar not found: {e}. Run ./sidecar/build_sidecar.sh first."))?;

    let (mut rx, mut child) = sidecar.spawn().map_err(|e| format!("Failed to start sidecar: {e}"))?;

    let write_result = child.write((request_json + "\n").as_bytes());
    *state.0.lock().unwrap() = Some(SidecarHandle::Shell(child));
    if let Err(e) = write_result {
        let ev = serde_json::json!({
            "type": "error",
            "message": format!("Failed to send request to sidecar: {e}"),
            "fix": "Run ./sidecar/build_sidecar.sh and rebuild the app."
        });
        let _ = app.emit("transcription-error", &ev);
        return Ok(());
    }

    let app_handle = app.clone();
    let state_arc = state.0.clone();

    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    if let Ok(line) = std::str::from_utf8(&bytes) {
                        let line = line.trim();
                        if line.is_empty() { continue; }
                        if let Ok(json) = serde_json::from_str::<Value>(line) {
                            match json["type"].as_str() {
                                Some("progress") => { let _ = app_handle.emit("transcription-progress", &json); }
                                Some("log") => { let _ = app_handle.emit("transcription-log", &json); }
                                Some("result") => {
                                    let _ = app_handle.emit("transcription-result", &json);
                                    *state_arc.lock().unwrap() = None;
                                }
                                Some("error") => {
                                    let _ = app_handle.emit("transcription-error", &json);
                                    *state_arc.lock().unwrap() = None;
                                }
                                _ => {}
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    if let Ok(line) = std::str::from_utf8(&bytes) {
                        let line = line.trim();
                        if !line.is_empty() {
                            let log = serde_json::json!({ "type": "log", "line": line });
                            let _ = app_handle.emit("transcription-log", &log);
                        }
                    }
                }
                CommandEvent::Error(err) => {
                    let ev = serde_json::json!({
                        "type": "error",
                        "message": format!("Sidecar error: {err}"),
                        "fix": "Check that the sidecar binary is present."
                    });
                    let _ = app_handle.emit("transcription-error", &ev);
                    *state_arc.lock().unwrap() = None;
                    break;
                }
                CommandEvent::Terminated(status) => {
                    if let Some(code) = status.code {
                        if code != 0 {
                            let ev = serde_json::json!({
                                "type": "error",
                                "message": format!("Sidecar exited with code {code}"),
                                "fix": "See the log panel for details."
                            });
                            let _ = app_handle.emit("transcription-error", &ev);
                        }
                    }
                    *state_arc.lock().unwrap() = None;
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Release mode: run sidecar from a temp-dir symlink to avoid PyInstaller's
/// .app bundle-mode detection, which breaks its Python library search.
async fn start_via_tmp(
    app: AppHandle,
    state: tauri::State<'_, SidecarState>,
    request_json: String,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let sidecar_path = prepare_sidecar_tmp().map_err(|e| {
        format!("Sidecar setup failed: {e}")
    })?;

    // GUI-launched apps inherit only the minimal macOS PATH
    // (/usr/bin:/bin:/usr/sbin:/sbin), which omits Homebrew/MacPorts. The
    // sidecar bundles ffmpeg (via imageio-ffmpeg) but NOT ffprobe, so it falls
    // back to a system `ffprobe` on PATH — which isn't found when launched from
    // Finder. `tauri dev` works only because it inherits the shell PATH. Prepend
    // the usual install dirs so release resolves ffprobe the same way dev does.
    let augmented_path = {
        let existing = std::env::var("PATH").unwrap_or_default();
        format!("/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:{existing}")
    };

    let mut child = tokio::process::Command::new(&sidecar_path)
        .env("PATH", augmented_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start sidecar: {e}"))?;

    // Write request and close stdin so the sidecar sees EOF after one line.
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all((request_json + "\n").as_bytes()).await
            .map_err(|e| format!("Failed to send request to sidecar: {e}"))?;
    }

    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");

    *state.0.lock().unwrap() = Some(SidecarHandle::Process(child));

    let app_stdout = app.clone();
    let app_stderr = app.clone();
    let state_arc = state.0.clone();

    // Read stdout line-by-line and emit Tauri events.
    // When the reader reaches EOF (process exited), if no final event was
    // received, emit an error so the UI doesn't silently hang.
    tokio::spawn(async move {
        let mut got_final = false;
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim().to_string();
            if line.is_empty() { continue; }
            if let Ok(json) = serde_json::from_str::<Value>(&line) {
                match json["type"].as_str() {
                    Some("progress") => { let _ = app_stdout.emit("transcription-progress", &json); }
                    Some("log") => { let _ = app_stdout.emit("transcription-log", &json); }
                    Some("result") => {
                        got_final = true;
                        let _ = app_stdout.emit("transcription-result", &json);
                        *state_arc.lock().unwrap() = None;
                    }
                    Some("error") => {
                        got_final = true;
                        let _ = app_stdout.emit("transcription-error", &json);
                        *state_arc.lock().unwrap() = None;
                    }
                    _ => {}
                }
            }
        }
        if !got_final {
            let ev = serde_json::json!({
                "type": "error",
                "message": "Sidecar exited without producing a result. Check the log panel for details.",
                "fix": "Run npm run tauri:build to get a fresh build."
            });
            let _ = app_stdout.emit("transcription-error", &ev);
            *state_arc.lock().unwrap() = None;
        }
    });

    // Forward stderr lines as log events
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim().to_string();
            if !line.is_empty() {
                let log = serde_json::json!({ "type": "log", "line": line });
                let _ = app_stderr.emit("transcription-log", &log);
            }
        }
    });

    Ok(())
}

/// Kill the running sidecar process.
#[tauri::command]
async fn cancel_transcription(state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    let handle = state.0.lock().unwrap().take();
    match handle {
        Some(SidecarHandle::Shell(child)) => child.kill().map_err(|e| e.to_string())?,
        Some(SidecarHandle::Process(mut child)) => child.kill().await.map_err(|e| e.to_string())?,
        None => {}
    }
    Ok(())
}

/// Run ffprobe to get file metadata (duration, size, codec…).
#[tauri::command]
async fn probe_file(app: AppHandle, file_path: String) -> Result<Value, String> {
    // Use the ffprobe bundled alongside the sidecar's ffmpeg, so the app is
    // self-contained and works on Macs without a system ffmpeg install. The
    // _internal/ dir lands in Resources/MacOS/ (release) or next to the exe in
    // target/debug/ (dev). Fall back to a system ffprobe on PATH only if the
    // bundled one is somehow absent.
    const FFPROBE_REL: &str = "imageio_ffmpeg/binaries/ffprobe";
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("MacOS").join("_internal").join(FFPROBE_REL));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("_internal").join(FFPROBE_REL));
        }
    }
    let ffprobe_path = candidates
        .into_iter()
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "ffprobe".to_string());

    let output = tokio::process::Command::new(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            &file_path,
        ])
        .output()
        .await
        .map_err(|e| format!("ffprobe failed: {e}"))?;

    serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}

/// Get stored preferences (HF token from Keychain + output dir from config).
#[tauri::command]
async fn get_preferences(app: AppHandle) -> Result<Preferences, String> {
    let config_path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("prefs.json");

    // Load output_dir from config file
    let output_dir = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).unwrap_or_default();
        serde_json::from_str::<Value>(&content)
            .ok()
            .and_then(|v| v["output_dir"].as_str().map(String::from))
            .unwrap_or_else(|| "~/Transcripts".to_string())
    } else {
        "~/Transcripts".to_string()
    };

    // Load HF token from macOS Keychain
    let hf_token = keyring::Entry::new("Kōrero", "hf_token")
        .and_then(|e| e.get_password())
        .unwrap_or_default();

    Ok(Preferences { hf_token, output_dir })
}

/// Save preferences (HF token to Keychain, output dir to config file).
#[tauri::command]
async fn set_preferences(app: AppHandle, prefs: Preferences) -> Result<(), String> {
    // Save HF token to macOS Keychain
    if !prefs.hf_token.is_empty() {
        keyring::Entry::new("Kōrero", "hf_token")
            .and_then(|e| e.set_password(&prefs.hf_token))
            .map_err(|e| format!("Keychain write failed: {e}"))?;
    }

    // Save output_dir to config file
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let config = serde_json::json!({ "output_dir": prefs.output_dir });
    std::fs::write(config_dir.join("prefs.json"), config.to_string())
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Save content to a temp file and open it with the default app.
#[tauri::command]
async fn open_in_default_app(content: String, format: String) -> Result<(), String> {
    let tmp = std::env::temp_dir().join(format!("korero_export.{format}"));
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;

    tokio::process::Command::new("open")
        .arg(&tmp)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Reveal a path in Finder.
#[tauri::command]
async fn reveal_in_finder(path: String) -> Result<(), String> {
    tokio::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── App setup ──────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(SidecarState(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![
            start_transcription,
            cancel_transcription,
            probe_file,
            get_preferences,
            set_preferences,
            open_in_default_app,
            reveal_in_finder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running korero");
}
