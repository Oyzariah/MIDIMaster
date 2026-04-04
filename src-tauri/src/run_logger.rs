use chrono::Local;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const LOGS_DIR_NAME: &str = "logs";
const MAX_LOG_FILES: usize = 50;

struct RunLogger {
    file: Mutex<File>,
    run_id: String,
}

static LOGGER: OnceLock<RunLogger> = OnceLock::new();

pub fn logs_dir_from_app_data(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(LOGS_DIR_NAME)
}

pub fn init(app_data_dir: &Path) -> Result<(), String> {
    if LOGGER.get().is_some() {
        return Ok(());
    }

    let logs_dir = logs_dir_from_app_data(app_data_dir);
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed creating logs dir: {e}"))?;

    let run_id = make_run_id();
    let file_name = format!("run-{}-{}.log", unix_ts_millis(), &run_id);
    let file_path = logs_dir.join(file_name);

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .map_err(|e| format!("Failed creating log file {}: {e}", file_path.display()))?;

    let logger = RunLogger {
        file: Mutex::new(file),
        run_id,
    };

    if LOGGER.set(logger).is_err() {
        return Ok(());
    }

    prune_old_logs(&logs_dir, MAX_LOG_FILES);

    info(
        "logger",
        "initialized",
        &format!(
            "logs_dir={} max_files={}",
            logs_dir.display(),
            MAX_LOG_FILES
        ),
    );

    Ok(())
}

pub fn info(component: &str, event: &str, details: &str) {
    log("INFO", component, event, details);
}

pub fn warn(component: &str, event: &str, details: &str) {
    log("WARN", component, event, details);
}

pub fn error(component: &str, event: &str, details: &str) {
    log("ERROR", component, event, details);
}

pub fn debug(component: &str, event: &str, details: &str) {
    log("DEBUG", component, event, details);
}

fn log(level: &str, component: &str, event: &str, details: &str) {
    let line = format!(
        "{} | {} | run={} | {}::{} | {}\n",
        formatted_timestamp(),
        level,
        LOGGER
            .get()
            .map(|logger| logger.run_id.as_str())
            .unwrap_or("uninitialized"),
        component,
        event,
        sanitize(details)
    );

    if let Some(logger) = LOGGER.get() {
        if let Ok(mut file) = logger.file.lock() {
            if let Err(e) = file.write_all(line.as_bytes()) {
                eprintln!(
                    "[midimaster-log-write-failed] {e}; line={}",
                    line.trim_end()
                );
            }
            return;
        }
    }

    eprintln!("[midimaster-log-fallback] {}", line.trim_end());
}

fn sanitize(input: &str) -> String {
    input
        .replace(['\r', '\n', '\t'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn unix_ts_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn formatted_timestamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn make_run_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[0..8].to_string()
}

fn prune_old_logs(logs_dir: &Path, keep: usize) {
    let read_dir = match fs::read_dir(logs_dir) {
        Ok(dir) => dir,
        Err(_) => return,
    };

    let mut files: Vec<PathBuf> = read_dir
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("log"))
        .collect();

    files.sort_by(|a, b| {
        let a_name = a.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        let b_name = b.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        b_name.cmp(a_name)
    });

    for path in files.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
}
