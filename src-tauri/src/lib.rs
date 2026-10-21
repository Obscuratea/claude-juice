use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use std::fs;

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Where `claude-juice --statusline` saves the limits.
fn own_usage_file() -> Option<PathBuf> {
    Some(dirs::cache_dir()?.join("claude-juice").join("usage.json"))
}

/// Every file we read limits from. The obscura one is written by the Noctalia
/// status-line script and uses the same format.
fn usage_files() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = own_usage_file().into_iter().collect();
    if let Some(cache) = dirs::cache_dir() {
        files.push(cache.join("obscura").join("claude-usage.json"));
    }
    files
}

/// Status-line mode: Claude Code pipes its session JSON to stdin. We keep the
/// rate-limit windows for the app and print a short line for Claude Code to show.
pub fn statusline() {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let payload: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
    let limits = &payload["rate_limits"];

    // Before the session's first API response there are no limits yet; keep the old file.
    if limits.is_object() {
        if let Some(path) = own_usage_file() {
            let out = json!({
                "updated": now(),
                "five_hour": limits.get("five_hour").cloned().unwrap_or(Value::Null),
                "seven_day": limits.get("seven_day").cloned().unwrap_or(Value::Null),
            });
            if let Some(dir) = path.parent() {
                let _ = fs::create_dir_all(dir);
            }
            let tmp = path.with_extension("json.tmp");
            if fs::write(&tmp, out.to_string()).is_ok() {
                let _ = fs::rename(&tmp, &path);
            }
        }
    }

    let pct = |w: &str| {
        limits[w]["used_percentage"]
            .as_f64()
            .map(|p| format!("{}%", p.floor()))
            .unwrap_or_else(|| "–".into())
    };
    let model = payload["model"]["display_name"].as_str().unwrap_or("Claude");
    println!("{model}  5h {}  7d {}", pct("five_hour"), pct("seven_day"));
}

/// All usage snapshots we can find; the frontend picks the freshest window.
#[tauri::command]
fn read_usage() -> Vec<Value> {
    usage_files()
        .iter()
        .filter_map(|p| fs::read_to_string(p).ok())
        .filter_map(|s| serde_json::from_str(&s).ok())
        .collect()
}

#[cfg(target_os = "linux")]
fn hyprland_socket() -> Option<PathBuf> {
    let sig = std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE")?;
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")?;
    Some(PathBuf::from(runtime).join("hypr").join(sig).join(".socket.sock"))
}

/// Hyprland doesn't tell windows where they are while they're dragged, so ask
/// it directly every few milliseconds and pass changes to the frontend.
#[cfg(target_os = "linux")]
fn watch_hyprland(app: tauri::AppHandle, socket: PathBuf) {
    use std::io::Write;
    use std::os::unix::net::UnixStream;
    use tauri::Emitter;

    std::thread::spawn(move || {
        let pid = std::process::id() as u64;
        let mut last: Option<[i64; 4]> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(8));
            let Ok(mut stream) = UnixStream::connect(&socket) else { continue };
            let mut reply = String::new();
            if stream.write_all(b"j/clients").is_err() || stream.read_to_string(&mut reply).is_err() {
                continue;
            }
            let Ok(Value::Array(clients)) = serde_json::from_str::<Value>(&reply) else { continue };
            let Some(c) = clients.iter().find(|c| c["pid"].as_u64() == Some(pid)) else { continue };
            let n = |v: &Value| v.as_i64().unwrap_or(0);
            let geo = [n(&c["at"][0]), n(&c["at"][1]), n(&c["size"][0]), n(&c["size"][1])];
            if last != Some(geo) {
                last = Some(geo);
                let _ = app.emit("hypr-geometry", json!({ "x": geo[0], "y": geo[1], "w": geo[2], "h": geo[3] }));
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Plain Wayland never tells a window where it is, so the liquid could never
    // feel a move. Hyprland can be asked over IPC; other compositors get XWayland,
    // unless the user picked a backend themselves.
    #[cfg(target_os = "linux")]
    let hyprland = hyprland_socket();
    #[cfg(target_os = "linux")]
    if hyprland.is_none()
        && std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::env::var_os("GDK_BACKEND").is_none()
    {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    tauri::Builder::default()
        .setup(move |_app| {
            #[cfg(target_os = "linux")]
            if let Some(socket) = hyprland.clone() {
                watch_hyprland(_app.handle().clone(), socket);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_usage])
        .run(tauri::generate_context!())
        .expect("error while running Claude Juice");
}
