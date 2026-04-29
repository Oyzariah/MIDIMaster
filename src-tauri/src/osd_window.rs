use crate::model::OsdSettings;
use crate::monitors::resolve_monitor_for_osd;
use crate::AppState;
use std::time::Instant;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager};

pub(crate) fn apply_osd_settings(app: &AppHandle, settings: &OsdSettings) {
    let Some(osd_window) = app.get_webview_window("osd") else {
        return;
    };

    if !settings.enabled {
        let _ = osd_window.hide();
        return;
    }

    let _ = osd_window.set_always_on_top(true);
    force_topmost(&osd_window);

    let selected = resolve_monitor_for_osd(app, settings);
    if let Some(selected) = selected {
        let monitor = selected;
        let scale_factor = monitor.scale_factor();
        let size = monitor.size();
        let position = monitor.position();
        let width = 320.0;
        let height = 800.0;
        let padding = 24.0;
        let logical_width = size.width as f64 / scale_factor;
        let logical_height = size.height as f64 / scale_factor;
        let origin_x = position.x as f64 / scale_factor;
        let origin_y = position.y as f64 / scale_factor;
        let anchor = settings.anchor.as_str();
        let (mut x, mut y) = match anchor {
            "top-left" => (origin_x + padding, origin_y + padding),
            "top-center" => (origin_x + (logical_width - width) / 2.0, origin_y + padding),
            "top-right" => (
                origin_x + logical_width - width - padding,
                origin_y + padding,
            ),
            "center-left" => (
                origin_x + padding,
                origin_y + (logical_height - height) / 2.0,
            ),
            "center" => (
                origin_x + (logical_width - width) / 2.0,
                origin_y + (logical_height - height) / 2.0,
            ),
            "center-right" => (
                origin_x + logical_width - width - padding,
                origin_y + (logical_height - height) / 2.0,
            ),
            "bottom-left" => (
                origin_x + padding,
                origin_y + logical_height - height - padding,
            ),
            "bottom-center" => (
                origin_x + (logical_width - width) / 2.0,
                origin_y + logical_height - height - padding,
            ),
            "bottom-right" => (
                origin_x + logical_width - width - padding,
                origin_y + logical_height - height - padding,
            ),
            _ => (
                origin_x + logical_width - width - padding,
                origin_y + padding,
            ),
        };
        x = x.max(origin_x + padding);
        y = y.max(origin_y + padding);
        let _ = osd_window.set_size(LogicalSize::new(width, height));
        let _ = osd_window.set_position(LogicalPosition::new(x, y));
    }
}

pub(crate) fn emit_osd_update(
    app: &AppHandle,
    state: &AppState,
    payload: &serde_json::Value,
    silent: bool,
) {
    let settings = state
        .osd_settings
        .lock()
        .map(|settings| settings.clone())
        .unwrap_or_else(|_| OsdSettings::default());

    if !settings.enabled || silent {
        if !settings.enabled {
            if let Some(osd_window) = app.get_webview_window("osd") {
                let _ = osd_window.hide();
            }
        }
        return;
    }

    if let Ok(mut last_update) = state.osd_last_update.lock() {
        *last_update = Some(Instant::now());
    }

    apply_osd_settings(app, &settings);

    let Some(osd_window) = app.get_webview_window("osd") else {
        return;
    };

    let _ = osd_window.show();
    let _ = osd_window.set_always_on_top(true);
    force_topmost(&osd_window);

    let mut osd_payload = payload.clone();
    if let Some(map) = osd_payload.as_object_mut() {
        map.insert("osd_enabled".to_string(), serde_json::Value::Bool(true));
    }

    let event_name =
        if osd_payload.get("action").and_then(|value| value.as_str()) == Some("toggle_mute") {
            "mute_update"
        } else {
            "volume_update"
        };
    let _ = osd_window.emit(event_name, osd_payload.clone());
    if let Ok(payload_json) = serde_json::to_string(&osd_payload) {
        let script = format!(
            "window.__OSD_UPDATE__ && window.__OSD_UPDATE__({});",
            payload_json
        );
        let _ = osd_window.eval(&script);
    }
}

#[cfg(target_os = "windows")]
fn force_topmost(window: &tauri::WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE,
        };
        unsafe {
            let _ = SetWindowPos(
                HWND(hwnd.0 as _),
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn force_topmost(_window: &tauri::WebviewWindow) {}
