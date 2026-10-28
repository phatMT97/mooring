use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// One lock per tab, so a shell that stops reading its input can't stall the others.
#[derive(Default)]
struct Ptys(Mutex<HashMap<u32, Arc<Mutex<Pty>>>>);

impl Ptys {
    fn get(&self, id: u32) -> Result<Arc<Mutex<Pty>>, String> {
        self.0.lock().unwrap().get(&id).cloned().ok_or_else(|| "no such tab".into())
    }
}

/// Most output arrives in bursts; past this much, a burst goes out in several messages.
const MAX_BATCH: usize = 256 * 1024;

/// Start a shell for tab `id` and stream its output, as raw bytes, through `output`.
/// `shell` is "wsl" (cwd is a Linux path) or "powershell" (cwd is a Windows path). Agents are
/// not started here: the shell's own rc/profile resumes them.
// async: off the main thread, which also delivers every tab's output
#[tauri::command(async)]
fn pty_spawn(
    app: AppHandle,
    ptys: State<Ptys>,
    output: Channel<InvokeResponseBody>,
    id: u32,
    shell: String,
    cwd: String,
    distro: String,
    cols: u16,
    rows: u16,
    restoring: Option<bool>,
    lang: Option<String>,
    session: Option<String>,
) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = if shell == "wsl" {
        let mut c = CommandBuilder::new("wsl.exe");
        c.args(["-d", &distro]);
        c.args(["--cd", if cwd.is_empty() { "~" } else { &cwd }]);
        c
    } else {
        let mut c = CommandBuilder::new("powershell.exe");
        c.arg("-NoLogo");
        if !cwd.is_empty() && PathBuf::from(&cwd).is_dir() {
            c.cwd(&cwd);
        }
        c
    };
    // which deck and tab a shell belongs to (agent-tabs finds a tab's agent by these)
    cmd.env("TERMDECK_TAB", id.to_string());
    cmd.env("TERMDECK_APP", &app.config().identifier);
    // this run of the deck: after a restart, agent-tabs knows shells of the last run are orphans
    cmd.env("TERMDECK_RUN", std::process::id().to_string());
    let mut wslenv = String::from("TERMDECK_TAB:TERMDECK_APP:TERMDECK_RUN");
    // where the `mooring` command drops requests for this deck (see inbox_loop)
    if let Ok(inbox) = inbox_dir(&app) {
        let inbox = inbox.to_string_lossy().into_owned();
        cmd.env("MOORING_INBOX", if shell == "wsl" { to_wsl_path(&inbox) } else { inbox });
        wslenv.push_str(":MOORING_INBOX");
    }
    if let Some(lang) = lang.filter(|l| !l.is_empty()) {
        // agent-tabs prints its messages in the deck's language
        cmd.env("TERMDECK_LANG", lang);
        wslenv.push_str(":TERMDECK_LANG");
    }
    if restoring.unwrap_or(false) {
        // tabs reopened at launch start together; agent-tabs waits for them before reporting leftovers
        cmd.env("TERMDECK_RESTORING", "1");
        wslenv.push_str(":TERMDECK_RESTORING");
    }
    if let Some(session) = session.filter(|s| !s.is_empty()) {
        cmd.env("TERMDECK_SESSION", &session);
        wslenv.push_str(":TERMDECK_SESSION");
    }
    if app.config().identifier.ends_with(".dev") {
        // the test build must never take over sessions waiting to be resumed in the daily one
        cmd.env("AGENT_TABS_NO_CLAIM", "1");
        wslenv.push_str(":AGENT_TABS_NO_CLAIM");
    }
    cmd.env("WSLENV", wslenv);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let pty = Pty { master: pair.master, writer, child };
    ptys.0.lock().unwrap().insert(id, Arc::new(Mutex::new(pty)));

    // The reader never waits on the webview; the sender folds whatever piled up meanwhile into
    // one message, so a flood of output costs a few big messages instead of thousands of small
    // ones, and a lone keystroke echo still goes out at once. xterm decodes the UTF-8 itself.
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        while let Ok(n @ 1..) = reader.read(&mut buf) {
            if tx.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    std::thread::spawn(move || {
        while let Ok(mut batch) = rx.recv() {
            while batch.len() < MAX_BATCH {
                match rx.try_recv() {
                    Ok(more) => batch.extend_from_slice(&more),
                    Err(_) => break,
                }
            }
            if output.send(InvokeResponseBody::Raw(batch)).is_err() {
                break;
            }
        }
        let _ = app.emit("pty-exit", id);
    });
    Ok(())
}

// Sync on purpose: commands on the main thread run in call order, so keystrokes can't overtake.
#[tauri::command]
fn pty_write(ptys: State<Ptys>, id: u32, data: String) -> Result<(), String> {
    let pty = ptys.get(id)?;
    let mut pty = pty.lock().unwrap();
    pty.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    pty.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(ptys: State<Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let pty = ptys.get(id)?;
    let pty = pty.lock().unwrap();
    pty.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_kill(ptys: State<Ptys>, id: u32) {
    let pty = ptys.0.lock().unwrap().remove(&id);
    if let Some(pty) = pty {
        let _ = pty.lock().unwrap().child.kill();
    }
}

/// Nearest ancestor of `path` that contains `.git` (works for \\wsl.localhost\... paths too).
#[tauri::command(async)]
fn repo_root(path: String) -> Option<String> {
    let mut dir = PathBuf::from(path);
    loop {
        if dir.join(".git").exists() {
            return Some(dir.to_string_lossy().into_owned());
        }
        if !dir.pop() {
            return None;
        }
    }
}

/// "file", "dir" or None, for underlining only paths that exist.
#[tauri::command(async)]
fn path_kind(path: String) -> Option<&'static str> {
    let meta = std::fs::metadata(&path).ok()?;
    Some(if meta.is_dir() { "dir" } else { "file" })
}

/// Open a file/folder/URL with its default handler, or reveal it selected in Explorer.
#[tauri::command(async)]
fn open_path(path: String, reveal: bool) -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = if reveal {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("explorer.exe");
        c.raw_arg(format!("/select,\"{}\"", path));
        c
    } else {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("rundll32.exe");
        c.raw_arg(format!("url.dll,FileProtocolHandler \"{}\"", path));
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(if reveal { format!("/select,{path}") } else { path });
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Clipboard through the OS, not navigator.clipboard: WebView2 asks the user for permission
/// before a page may read it, and a terminal pastes all day.
#[tauri::command(async)]
fn clipboard_read() -> Result<String, String> {
    arboard::Clipboard::new().and_then(|mut c| c.get_text()).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn clipboard_write(text: String) -> Result<(), String> {
    arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| e.to_string())
}

// ---- the `mooring` command: agents asking the deck to do things ----------------------------------
//
// A request is a JSON file `<id>.req.json` dropped in the inbox (a folder under the app's local
// data, which WSL sees under /mnt/c). The UI acts on it and the answer comes back as
// `<id>.res.json` next to it. A folder instead of a socket: WSL in NAT mode can't reach a Windows
// localhost port, but both sides see this folder.

fn inbox_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("inbox");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// C:\Users\me\x -> /mnt/c/Users/me/x
fn to_wsl_path(win: &str) -> String {
    match win.as_bytes() {
        [d, b':', rest @ ..] => format!("/mnt/{}{}", (*d as char).to_ascii_lowercase(),
            String::from_utf8_lossy(rest).replace('\\', "/")),
        _ => win.replace('\\', "/"),
    }
}

#[derive(Clone, serde::Serialize)]
struct Request {
    id: String,
    body: String,
}

/// Hand each new request to the UI. Polling a local NTFS folder a few times a second costs
/// nothing and has no watcher edge cases.
fn inbox_loop(app: AppHandle) {
    let Ok(dir) = inbox_dir(&app) else { return };
    // requests left over from a previous run are stale: nobody waits for them any more
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let _ = std::fs::remove_file(entry.path());
    }
    loop {
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(id) = name.strip_suffix(".req.json") else { continue };
            let path = entry.path();
            if let Ok(body) = std::fs::read_to_string(&path) {
                let _ = std::fs::remove_file(&path);
                let _ = app.emit("mooring-request", Request { id: id.to_string(), body });
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(120));
    }
}

#[tauri::command(async)]
fn mooring_reply(app: AppHandle, id: String, body: String) -> Result<(), String> {
    let dir = inbox_dir(&app)?;
    let tmp = dir.join(format!("{id}.res.tmp"));
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(format!("{id}.res.json"))).map_err(|e| e.to_string())
}

/// Run `script` (sh, with `args` as $1…) in a WSL distro without flashing a console; its stdout.
fn wsl_sh(distro: &str, script: &str, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = std::process::Command::new("wsl.exe");
    cmd.args(["-d", distro, "-e", "sh", "-c", script, "sh"]).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.output().map_err(|e| e.to_string())
}

/// $HOME of the default user in a WSL distro, to resolve "~/..." links.
#[tauri::command(async)]
fn wsl_home(distro: String) -> Result<String, String> {
    let out = wsl_sh(&distro, "echo $HOME", &[])?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The conversation of the agent running in WSL tab `tab`, as agent-tabs' JSON digest;
/// empty when there is none it can read (the caller then uses the terminal's text).
#[tauri::command(async)]
fn agent_context(app: AppHandle, distro: String, tab: u32, last: Option<bool>) -> Result<String, String> {
    let mut args = vec!["context".into(), tab.to_string(), app.config().identifier.clone()];
    if last.unwrap_or(false) {
        args.push("--last".into());
    }
    agent_tabs(distro, args)
}

/// Run `agent-tabs <args>` in WSL; its stdout, or "" when it fails (e.g. nothing to take).
#[tauri::command(async)]
fn agent_tabs(distro: String, args: Vec<String>) -> Result<String, String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = wsl_sh(&distro, r#"exec "$HOME/.local/bin/agent-tabs" "$@""#, &args)?;
    Ok(if out.status.success() { String::from_utf8_lossy(&out.stdout).into_owned() } else { String::new() })
}

fn state_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("state.json");
    // the app was called termdeck: bring its tabs and settings over on the first start
    if !path.exists() {
        if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
            let old = dir.with_file_name(name.replace("mooring", "termdeck")).join("state.json");
            if old.exists() {
                let _ = std::fs::copy(old, &path);
            }
        }
    }
    Ok(path)
}

#[tauri::command(async)]
fn load_state(app: AppHandle) -> Result<String, String> {
    Ok(std::fs::read_to_string(state_file(&app)?).unwrap_or_default())
}

static STATE_SAVE_LOCK: Mutex<()> = Mutex::new(());

// Keep disk writes off the main thread and serialize access to the shared temp file.
#[tauri::command(async)]
fn save_state(app: AppHandle, json: String) -> Result<(), String> {
    let _save = STATE_SAVE_LOCK.lock().unwrap();
    let path = state_file(&app)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // one deck per app id (the dev build has its own): launching it again brings this one up
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(Ptys::default())
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || inbox_loop(handle));
            // The window starts hidden and the UI shows it once placed; if the UI ever fails
            // before that, show it anyway.
            if let Some(window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn, pty_write, pty_resize, pty_kill, repo_root, load_state, save_state,
            path_kind, open_path, wsl_home, agent_context, agent_tabs, clipboard_read, clipboard_write, mooring_reply
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mooring");
}
