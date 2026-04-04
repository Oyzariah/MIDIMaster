use crate::model::OsdSettings;
use crate::windows_display::{display_device_id, monitor_display_name};
use std::thread::sleep as thread_sleep;
use std::time::Duration as StdDuration;
use tauri::AppHandle;

#[derive(Clone)]
pub(crate) struct MonitorDescriptor {
    pub index: usize,
    pub friendly_name: String,
    pub stable_id: String,
    pub is_primary: bool,
    pub monitor: tauri::Monitor,
}

pub(crate) fn collect_monitor_descriptors(
    app: &AppHandle,
) -> Result<Vec<MonitorDescriptor>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|_| "Failed to load monitors".to_string())?;
    let primary = app.primary_monitor().ok().flatten();

    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let raw_name = monitor
                .name()
                .cloned()
                .unwrap_or_else(|| format!("Monitor {}", index + 1));
            let stable_id = display_device_id(&raw_name).unwrap_or_else(|| raw_name.clone());
            let friendly_name = monitor_display_name(&raw_name).unwrap_or_else(|| raw_name.clone());
            let is_primary = primary
                .as_ref()
                .map(|p| {
                    p.name() == monitor.name()
                        && p.size() == monitor.size()
                        && p.position() == monitor.position()
                })
                .unwrap_or(false);

            MonitorDescriptor {
                index,
                friendly_name,
                stable_id,
                is_primary,
                monitor: monitor.clone(),
            }
        })
        .collect())
}

pub(crate) fn resolve_monitor_for_osd(
    app: &AppHandle,
    settings: &OsdSettings,
) -> Option<tauri::Monitor> {
    let requested_id = settings.monitor_id.as_ref().and_then(|id| {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    let max_attempts = if requested_id.is_some() { 7 } else { 1 };

    for attempt in 0..max_attempts {
        let descriptors = collect_monitor_descriptors(app).ok()?;

        if let Some(ref id) = requested_id {
            if let Some(found) = descriptors.iter().find(|m| m.stable_id == *id) {
                return Some(found.monitor.clone());
            }

            if attempt + 1 < max_attempts {
                thread_sleep(StdDuration::from_millis(250));
                continue;
            }
        }

        if let Some(primary) = descriptors
            .iter()
            .find(|m| m.is_primary)
            .or_else(|| descriptors.first())
        {
            return Some(primary.monitor.clone());
        }
    }

    None
}
