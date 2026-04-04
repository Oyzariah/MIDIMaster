use crate::{bindings::BindingKey, model, model::Binding, AppState};
use crate::run_logger;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

fn binding_user_active(state: &AppState, key: &BindingKey, is_note: bool) -> bool {
    if is_note {
        return false;
    }
    if let Ok(states) = state.binding_state.lock() {
        if let Some(st) = states.get(key) {
            return st.last_update.elapsed().as_millis() < 500;
        }
    }
    false
}

fn update_feedback_cache_if_changed(state: &AppState, key: &BindingKey, value: f32) -> bool {
    if let Ok(mut feedback) = state.feedback_values.lock() {
        if let Some(current) = feedback.get(key) {
            if (current - value).abs() < 0.005 {
                return false;
            }
        }
        feedback.insert(key.clone(), value);
        return true;
    }
    true
}

#[tauri::command]
pub fn add_binding(state: State<AppState>, mut binding: Binding) -> Result<(), String> {
    run_logger::info(
        "bindings_cmd",
        "add_requested",
        &format!(
            "binding_id={} device_id={} channel={} controller={} action={:?} control_kind={:?}",
            binding.id,
            binding.device_id,
            binding.control.channel,
            binding.control.controller,
            binding.action,
            binding.control_kind
        ),
    );
    binding.ensure_targets();
    if binding.targets.is_empty() {
        run_logger::warn(
            "bindings_cmd",
            "add_rejected",
            &format!("binding_id={} reason=no_targets", binding.id),
        );
        return Err("Binding must have at least one target".to_string());
    }
    if binding.targets.len() > 8 {
        run_logger::warn(
            "bindings_cmd",
            "add_rejected",
            &format!("binding_id={} reason=too_many_targets", binding.id),
        );
        return Err("Binding cannot have more than 8 targets".to_string());
    }

    let mut profile_guard = state
        .active_profile
        .lock()
        .map_err(|_| "Lock poisoned".to_string())?;
    let profile = profile_guard.get_or_insert(model::Profile {
        name: "Default".to_string(),
        bindings: Vec::new(),
        osd_settings: model::OsdSettings::default(),
        plugin_settings: std::collections::HashMap::new(),
        midi_device_preference: model::MidiDevicePreference::default(),
    });
    profile.bindings.retain(|existing| {
        !(existing.device_id == binding.device_id && existing.control == binding.control)
    });
    profile.bindings.push(binding);
    state.sync_feedback_values(profile);
    run_logger::info(
        "bindings_cmd",
        "add_succeeded",
        &format!("profile={} binding_count={}", profile.name, profile.bindings.len()),
    );
    Ok(())
}

#[tauri::command]
pub async fn remove_binding(state: State<'_, AppState>, binding: Binding) -> Result<(), String> {
    run_logger::info(
        "bindings_cmd",
        "remove_requested",
        &format!("binding_id={} device_id={}", binding.id, binding.device_id),
    );
    // 1. Remove the binding from the active profile FIRST to stop the background loop
    {
        let mut profile_guard = state
            .active_profile
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;

        if let Some(profile) = profile_guard.as_mut() {
            profile
                .bindings
                .retain(|existing| existing.id != binding.id);

            // Save the updated profile to disk
            state
                .profile_store
                .save_profile(profile.clone())
                .map_err(|err| err.to_string())?;
        }
    }

    // 2. Clear internal state
    let key = BindingKey::from_binding(&binding);
    if let Ok(mut feedback) = state.feedback_values.lock() {
        feedback.remove(&key);
    }
    if let Ok(mut states) = state.binding_state.lock() {
        states.remove(&key);
    }

    // 3. Wait for any pending background loop iterations to finish
    tokio::time::sleep(Duration::from_millis(100)).await;

    // 4. Send 0.0 value to the binding's control
    if let Ok(mut midi) = state.midi.lock() {
        let _ = midi.send_feedback(
            &binding.device_id,
            binding.control.channel,
            binding.control.controller,
            0.0,
            binding.control.msg_type.clone(),
        );
    }

    Ok(())
}

#[tauri::command]
pub fn update_midi_feedback(
    state: State<AppState>,
    target: model::BindingTarget,
    value: f32,
    binding_id: Option<String>,
    action: Option<model::BindingAction>,
) -> Result<(), String> {
    let profile_guard = state.active_profile.lock().map_err(|_| "Lock poisoned")?;
    let profile = match profile_guard.as_ref() {
        Some(p) => p,
        None => return Ok(()),
    };

    for binding in &profile.bindings {
        let binding_targets = binding.normalized_targets();
        let matches = if let Some(ref id) = binding_id {
            binding.id == *id
        } else if let Some(ref act) = action {
            if binding.action != *act {
                false
            } else {
                binding_targets.iter().any(|t| *t == target)
            }
        } else {
            binding_targets.iter().any(|t| *t == target)
        };

        if matches {
            let key = BindingKey::from_binding(binding);

            let is_note = matches!(binding.control.msg_type, model::MidiMessageType::Note);
            if binding_user_active(&state, &key, is_note) {
                run_logger::debug(
                    "bindings_cmd",
                    "feedback_skipped_user_active",
                    &format!("binding_id={} is_note={}", binding.id, is_note),
                );
                continue;
            }

            if !update_feedback_cache_if_changed(&state, &key, value) {
                run_logger::debug(
                    "bindings_cmd",
                    "feedback_skipped_unchanged",
                    &format!("binding_id={} value={}", binding.id, value),
                );
                continue;
            }

            // Send the actual MIDI feedback
            if let Ok(mut midi) = state.midi.lock() {
                let _ = midi.send_feedback(
                    &binding.device_id,
                    binding.control.channel,
                    binding.control.controller,
                    value,
                    binding.control.msg_type.clone(),
                );
            }
            run_logger::debug(
                "bindings_cmd",
                "feedback_sent",
                &format!("binding_id={} value={}", binding.id, value),
            );
        }
    }

    Ok(())
}

#[tauri::command]
pub fn set_binding_feedback(
    app: AppHandle,
    state: State<AppState>,
    binding_id: String,
    value: f32,
    action: Option<model::BindingAction>,
    silent: Option<bool>,
) -> Result<(), String> {
    let profile_guard = state.active_profile.lock().map_err(|_| "Lock poisoned")?;
    let profile = match profile_guard.as_ref() {
        Some(p) => p,
        None => return Ok(()),
    };

    let binding = match profile.bindings.iter().find(|b| b.id == binding_id) {
        Some(b) => b,
        None => return Ok(()),
    };
    let primary_target = binding.primary_target();
    let effective_action = action.clone().unwrap_or_else(|| binding.action.clone());
    let action_matches_binding = action.is_none() || effective_action == binding.action;

    let key = BindingKey::from_binding(binding);

    let silent = silent.unwrap_or(false);

    let user_active;
    if action_matches_binding {
        let is_note = matches!(binding.control.msg_type, model::MidiMessageType::Note);
        user_active = binding_user_active(&state, &key, is_note);

        // Ignore background (silent) sync updates while the user is actively moving.
        // Otherwise a slightly delayed poll/notification can overwrite the latched value and
        // make the motor snap or jitter.
        if user_active && silent {
            run_logger::debug(
                "bindings_cmd",
                "set_feedback_silent_ignored_user_active",
                &format!("binding_id={}", binding.id),
            );
            return Ok(());
        }

        if !update_feedback_cache_if_changed(&state, &key, value) {
            run_logger::debug(
                "bindings_cmd",
                "set_feedback_skipped_unchanged",
                &format!("binding_id={} value={}", binding.id, value),
            );
            return Ok(());
        }

        // Send MIDI feedback to hardware.
        // Suppress during active user movement to avoid motor jitter.
        if !user_active {
            if let Ok(mut midi) = state.midi.lock() {
                let _ = midi.send_feedback(
                    &binding.device_id,
                    binding.control.channel,
                    binding.control.controller,
                    value,
                    binding.control.msg_type.clone(),
                );
            }
        }
    } else {
        run_logger::warn(
            "bindings_cmd",
            "set_feedback_action_mismatch",
            &format!(
                "binding_id={} binding_action={:?} requested_action={:?}",
                binding.id, binding.action, effective_action
            ),
        );
    }

    if let Ok(mut last_update) = state.osd_last_update.lock() {
        *last_update = Some(Instant::now());
    }

    // Emit UI/OSD updates.
    let settings_enabled = state
        .osd_settings
        .lock()
        .map(|settings| settings.enabled)
        .unwrap_or(true);

    match effective_action {
        model::BindingAction::ToggleMute => {
            let muted = value > 0.5;
            let focus_session = if matches!(&primary_target, model::BindingTarget::Focus) {
                state.audio.focused_session().ok().flatten()
            } else {
                None
            };
            let payload = serde_json::json!({
              "target": primary_target,
              "muted": muted,
              "action": "toggle_mute",
              "focus_session": focus_session,
              "binding_id": binding.id,
              "silent": silent
            });
            let _ = app.emit("mute_update", payload.clone());
            if settings_enabled && !silent {
                if let Some(osd_window) = app.get_webview_window("osd") {
                    let _ = osd_window.show();
                    let _ = osd_window.set_always_on_top(true);
                    #[cfg(target_os = "windows")]
                    if let Ok(hwnd) = osd_window.hwnd() {
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
                    let _ = osd_window.emit("mute_update", payload.clone());
                    if let Ok(payload_json) = serde_json::to_string(&payload) {
                        let script = format!(
                            "window.__OSD_UPDATE__ && window.__OSD_UPDATE__({});",
                            payload_json
                        );
                        let _ = osd_window.eval(&script);
                    }
                }
            }
        }
        model::BindingAction::Volume => {
            let focus_session = if matches!(&primary_target, model::BindingTarget::Focus) {
                state.audio.focused_session().ok().flatten()
            } else {
                None
            };
            let payload = serde_json::json!({
              "target": primary_target,
              "volume": value,
              "focus_session": focus_session,
              "binding_id": binding.id,
              "silent": silent
            });
            let _ = app.emit("volume_update", payload.clone());
            if settings_enabled && !silent {
                if let Some(osd_window) = app.get_webview_window("osd") {
                    let _ = osd_window.show();
                    let _ = osd_window.set_always_on_top(true);
                    #[cfg(target_os = "windows")]
                    if let Ok(hwnd) = osd_window.hwnd() {
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
                    let _ = osd_window.emit("volume_update", payload.clone());
                    if let Ok(payload_json) = serde_json::to_string(&payload) {
                        let script = format!(
                            "window.__OSD_UPDATE__ && window.__OSD_UPDATE__({});",
                            payload_json
                        );
                        let _ = osd_window.eval(&script);
                    }
                }
            }
        }
        _ => {}
    }

    Ok(())
}
