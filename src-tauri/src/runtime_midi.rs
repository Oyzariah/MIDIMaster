use crate::bindings::{apply_midi_event as apply_binding_midi_event, find_binding, BindingKey, BindingState};
use crate::device_target::{parse_device_target, DeviceTargetKind};
use crate::model::{self, LearnedControl, MidiEvent};
use crate::run_logger;
use crate::runtime_helpers::{send_hotkey, send_media_key, LearnCandidate};
use crate::{app_state::focused_application_name, AppState};
use std::path::Path;
use std::process::Command as ProcessCommand;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub(crate) fn apply_midi_event(state: &AppState, app: &AppHandle, event: MidiEvent) -> Result<(), String> {
        let mut learn_pending = state.learn_pending.lock().map_err(|_| "Lock poisoned")?;
        if *learn_pending {
            run_logger::debug(
                "learn",
                "event_received",
                &format!(
                    "device_id={} channel={} controller={} value={} msg_type={:?}",
                    event.device_id, event.channel, event.controller, event.value, event.msg_type
                ),
            );
            let msg_type = event.msg_type.clone();
            let base_learned = LearnedControl {
                device_id: event.device_id.clone(),
                channel: event.channel,
                controller: event.controller,
                msg_type: msg_type.clone(),
                control_kind: model::BindingControlKind::Auto,
            };

            if matches!(msg_type, model::MidiMessageType::Note) {
                // Buffer note events first. Touch-sensitive faders may emit a Note before
                // the actual CC/PitchBend movement event, which should win.
                if let Ok(mut candidate_guard) = state.learn_candidate.lock() {
                    let now = Instant::now();
                    *candidate_guard = Some(LearnCandidate {
                        control: base_learned,
                        last_seen_at: now,
                        saw_zero: event.value == 0,
                        saw_max: event.value == 127,
                    });
                }
                return Ok(());
            }

            if matches!(msg_type, model::MidiMessageType::PitchBend) {
                // Pitch bend is continuous by definition.
                let mut learned = base_learned.clone();
                learned.control_kind = model::BindingControlKind::Continuous;
                run_logger::info(
                    "learn",
                    "pitch_bend_classified",
                    &format!(
                        "device_id={} channel={} controller={} control_kind={:?}",
                        learned.device_id,
                        learned.channel,
                        learned.controller,
                        learned.control_kind
                    ),
                );
                *learn_pending = false;
                drop(learn_pending);
                if let Ok(mut candidate) = state.learn_candidate.lock() {
                    *candidate = None;
                }
                *state.learned_control.lock().map_err(|_| "Lock poisoned")? = Some(learned);
                return Ok(());
            }

            // For CC, sample a short stream to detect button-like 127/0 press-release pairs.
            if let Ok(mut candidate_guard) = state.learn_candidate.lock() {
                let now = Instant::now();
                let is_zero = event.value == 0;
                let is_max = event.value == 127;
                match candidate_guard.as_mut() {
                    Some(candidate)
                        if candidate.control.device_id == base_learned.device_id
                            && candidate.control.channel == base_learned.channel
                            && candidate.control.controller == base_learned.controller
                            && candidate.control.msg_type == base_learned.msg_type =>
                    {
                        candidate.last_seen_at = now;
                        candidate.saw_zero |= is_zero;
                        candidate.saw_max |= is_max;
                    }
                    _ => {
                        *candidate_guard = Some(LearnCandidate {
                            control: base_learned,
                            last_seen_at: now,
                            saw_zero: is_zero,
                            saw_max: is_max,
                        });
                    }
                }
            }
            return Ok(());
        }

        let profile = match state
            .active_profile
            .lock()
            .map_err(|_| "Lock poisoned")?
            .clone()
        {
            Some(profile) => profile,
            None => return Ok(()),
        };
        let key = BindingKey::from_event(&event);
        let binding = match find_binding(&profile, &key) {
            Some(binding) => binding.clone(),
            None => {
                let aux_match = profile.bindings.iter().find_map(|candidate| {
                    if let Some(mapping) = candidate.mute_control.as_ref() {
                        if AppState::binding_matches_aux(mapping, &event) {
                            return Some((candidate.clone(), "mute", mapping.clone()));
                        }
                    }
                    if let Some(mapping) = candidate.assign_control.as_ref() {
                        if AppState::binding_matches_aux(mapping, &event) {
                            return Some((candidate.clone(), "assign", mapping.clone()));
                        }
                    }
                    None
                });

                if let Some((owner, role, aux_mapping)) = aux_match {
                    let mut targets = owner.normalized_targets();
                    targets.retain(|t| *t != model::BindingTarget::Unset);
                    if role == "mute" && targets.is_empty() {
                        return Ok(());
                    }

                    let resolve_target_muted = |target: &model::BindingTarget| -> Option<bool> {
                        match target {
                            model::BindingTarget::Master => state
                                .audio
                                .list_sessions()
                                .ok()
                                .and_then(|sessions| sessions.iter().find(|s| s.is_master).cloned())
                                .map(|s| s.is_muted)
                                .or(Some(false)),
                            model::BindingTarget::Focus => state
                                .audio
                                .focused_session()
                                .ok()
                                .flatten()
                                .map(|s| s.is_muted)
                                .or(Some(false)),
                            model::BindingTarget::Session { session_id } => state
                                .audio
                                .list_sessions()
                                .ok()
                                .and_then(|sessions| {
                                    sessions.into_iter().find(|s| s.id == *session_id)
                                })
                                .map(|s| s.is_muted)
                                .or(Some(false)),
                            model::BindingTarget::Application { name, .. } => state
                                .audio
                                .list_sessions()
                                .ok()
                                .and_then(|sessions| {
                                    sessions.into_iter().find(|s| {
                                        let base = s.process_name.as_deref().unwrap_or_default();
                                        let stem = base.strip_suffix(".exe").unwrap_or(base);
                                        stem.eq_ignore_ascii_case(name)
                                            || s.display_name.eq_ignore_ascii_case(name)
                                    })
                                })
                                .map(|s| s.is_muted),
                            model::BindingTarget::Device { device_id } => {
                                let (kind, raw_id) = parse_device_target(device_id);
                                match kind {
                                    DeviceTargetKind::Playback => state
                                        .audio
                                        .list_playback_devices()
                                        .ok()
                                        .and_then(|devices| {
                                            devices.into_iter().find(|d| d.id == raw_id)
                                        })
                                        .map(|d| d.is_muted)
                                        .or(Some(false)),
                                    DeviceTargetKind::Recording => state
                                        .audio
                                        .list_recording_devices()
                                        .ok()
                                        .and_then(|devices| {
                                            devices.into_iter().find(|d| d.id == raw_id)
                                        })
                                        .map(|d| d.is_muted)
                                        .or(Some(false)),
                                }
                            }
                            model::BindingTarget::Integration { .. } => None,
                            _ => Some(false),
                        }
                    };

                    if event.value == 0
                        && (role != "mute"
                            || aux_mapping.mute_behavior == model::MuteBehavior::ToggleOnPress)
                    {
                        if role == "mute" {
                            let fallback_muted = state
                                .feedback_values
                                .lock()
                                .ok()
                                .and_then(|feedback| feedback.get(&key).cloned())
                                .map(|v| v > 0.5)
                                .unwrap_or(false);
                            let muted_now = targets
                                .first()
                                .and_then(&resolve_target_muted)
                                .unwrap_or(fallback_muted);
                            let midi_arc = state.midi.clone();
                            let device_id = aux_mapping.device_id.clone();
                            let channel = aux_mapping.channel;
                            let controller = aux_mapping.controller;
                            let msg_type = aux_mapping.msg_type.clone();
                            tauri::async_runtime::spawn(async move {
                                tokio::time::sleep(Duration::from_millis(20)).await;
                                if let Ok(mut midi) = midi_arc.lock() {
                                    let _ = midi.send_feedback(
                                        &device_id,
                                        channel,
                                        controller,
                                        if muted_now { 1.0 } else { 0.0 },
                                        msg_type,
                                    );
                                }
                            });
                        }
                        return Ok(());
                    }

                    if role == "assign" {
                        let focused = state
                            .audio
                            .focused_session()
                            .map_err(|err| err.to_string())?;
                        let (app_name, app_display_name, app_icon_data) =
                            if let Some(focused) = focused {
                                focused
                                    .process_name
                                    .as_deref()
                                    .and_then(|name| name.strip_suffix(".exe").or(Some(name)))
                                    .map(|name| name.trim().to_string())
                                    .filter(|name| !name.is_empty())
                                    .map(|name| {
                                        (
                                            name,
                                            Some(focused.display_name.clone()),
                                            focused.icon_data.clone(),
                                        )
                                    })
                                    .unwrap_or_else(|| {
                                        (
                                            focused.display_name.clone(),
                                            Some(focused.display_name.clone()),
                                            focused.icon_data.clone(),
                                        )
                                    })
                            } else {
                                (focused_application_name().unwrap_or_default(), None, None)
                            };
                        if !app_name.is_empty() {
                            let new_target = model::BindingTarget::Application {
                                name: app_name,
                                display_name: app_display_name,
                                icon_data: app_icon_data,
                            };
                            let already_present = targets.iter().any(|t| *t == new_target);
                            let should_replace =
                                matches!(owner.assign_mode, model::AssignMode::Replace);
                            if should_replace || !already_present {
                                if !should_replace && targets.len() >= 8 {
                                    let _ = app.emit(
                                        "binding_aux_error",
                                        serde_json::json!({
                                            "binding_id": owner.id,
                                            "kind": "assign",
                                            "reason": "target_list_full"
                                        }),
                                    );
                                } else {
                                    let mut updated_targets: Option<Vec<model::BindingTarget>> =
                                        None;
                                    let mut guard = state
                                        .active_profile
                                        .lock()
                                        .map_err(|_| "Lock poisoned".to_string())?;
                                    if let Some(active_profile) = guard.as_mut() {
                                        if let Some(stored) = active_profile
                                            .bindings
                                            .iter_mut()
                                            .find(|b| b.id == owner.id)
                                        {
                                            stored.ensure_targets();
                                            if should_replace {
                                                stored.targets = vec![new_target.clone()];
                                                stored.ensure_targets();
                                                updated_targets = Some(stored.normalized_targets());
                                            } else if !stored
                                                .targets
                                                .iter()
                                                .any(|t| *t == new_target)
                                            {
                                                stored.targets.push(new_target.clone());
                                                stored.ensure_targets();
                                                updated_targets = Some(stored.normalized_targets());
                                            }
                                        }
                                        if updated_targets.is_some() {
                                            state.profile_store
                                                .save_profile(active_profile.clone())
                                                .map_err(|err| err.to_string())?;
                                            state.sync_feedback_values(active_profile);
                                        }
                                    }
                                    if let Some(updated_targets) = updated_targets {
                                        let _ = app.emit(
                                            "binding_aux_assign_update",
                                            serde_json::json!({
                                                "binding_id": owner.id,
                                                "target": new_target,
                                                "targets": updated_targets
                                            }),
                                        );
                                    }
                                }
                            }
                        } else {
                            let _ = app.emit(
                                "binding_aux_error",
                                serde_json::json!({
                                    "binding_id": owner.id,
                                    "kind": "assign",
                                    "reason": "focused_app_unavailable"
                                }),
                            );
                        }
                        return Ok(());
                    }

                    let fallback_muted = state
                        .feedback_values
                        .lock()
                        .ok()
                        .and_then(|feedback| feedback.get(&key).cloned())
                        .map(|v| v > 0.5)
                        .unwrap_or(false);
                    let current_muted = targets
                        .first()
                        .and_then(&resolve_target_muted)
                        .unwrap_or(fallback_muted);
                    let previous_input_active =
                        if aux_mapping.mute_behavior == model::MuteBehavior::SetFromValue {
                            state.last_mute_input_active
                                .lock()
                                .ok()
                                .and_then(|inputs| inputs.get(&key).copied())
                        } else {
                            None
                        };
                    let Some(next_muted) = AppState::resolve_target_mute_state(
                        event.value,
                        current_muted,
                        aux_mapping.mute_behavior.clone(),
                        previous_input_active,
                    ) else {
                        if aux_mapping.mute_behavior == model::MuteBehavior::SetFromValue {
                            if let Ok(mut inputs) = state.last_mute_input_active.lock() {
                                inputs.insert(key.clone(), event.value > 0);
                            }
                        }
                        return Ok(());
                    };
                    if aux_mapping.mute_behavior == model::MuteBehavior::SetFromValue {
                        if let Ok(mut inputs) = state.last_mute_input_active.lock() {
                            inputs.insert(key.clone(), event.value > 0);
                        }
                    }
                    for (target_index, target) in targets.iter().enumerate() {
                        match target {
                            model::BindingTarget::Master => {
                                let _ = state.audio.set_master_mute(next_muted);
                            }
                            model::BindingTarget::Focus => {
                                let _ = state.audio.set_focused_session_mute(next_muted);
                            }
                            model::BindingTarget::Session { session_id } => {
                                let _ = state.audio.set_session_mute(session_id, next_muted);
                            }
                            model::BindingTarget::Application { name, .. } => {
                                let _ = state.audio.set_application_mute(name, next_muted);
                            }
                            model::BindingTarget::Device { device_id } => {
                                let _ = state.audio.set_device_mute(device_id, next_muted);
                            }
                            model::BindingTarget::Integration {
                                integration_id,
                                kind,
                                data,
                            } => {
                                let payload = serde_json::json!({
                                  "binding_id": owner.id,
                                  "action": "ToggleMute",
                                  "value": if next_muted { 1.0 } else { 0.0 },
                                  "target_index": target_index,
                                  "target_count": targets.len(),
                                  "is_primary_target": target_index == 0,
                                  "target": {
                                    "integration_id": integration_id,
                                    "kind": kind,
                                    "data": data,
                                  }
                                });
                                let _ = app.emit("integration_binding_triggered", payload);
                            }
                            _ => {}
                        }
                    }
                    if let Ok(mut feedback) = state.feedback_values.lock() {
                        feedback.insert(key.clone(), if next_muted { 1.0 } else { 0.0 });
                    }
                    if let Ok(mut midi) = state.midi.lock() {
                        let _ = midi.send_feedback(
                            &aux_mapping.device_id,
                            aux_mapping.channel,
                            aux_mapping.controller,
                            if next_muted { 1.0 } else { 0.0 },
                            aux_mapping.msg_type.clone(),
                        );
                    }

                    if let Ok(mut last_update) = state.osd_last_update.lock() {
                        *last_update = Some(Instant::now());
                    }

                    let _ = app.emit(
                        "binding_aux_mute_update",
                        serde_json::json!({
                            "binding_id": owner.id,
                            "muted": next_muted
                        }),
                    );

                    let settings_enabled = state
                        .osd_settings
                        .lock()
                        .map(|settings| settings.enabled)
                        .unwrap_or(true);

                    for target in &targets {
                        let focus_session = if matches!(target, model::BindingTarget::Focus) {
                            state.audio.focused_session().ok().flatten()
                        } else {
                            None
                        };
                        let payload = serde_json::json!({
                          "target": target,
                          "muted": next_muted,
                          "action": "toggle_mute",
                          "focus_session": focus_session,
                          "binding_id": owner.id
                        });
                        let _ = app.emit("mute_update", payload.clone());

                        if settings_enabled {
                            AppState::emit_osd_update(app, state, &payload, false);
                        }
                    }
                    return Ok(());
                }

                run_logger::debug(
                    "bindings",
                    "event_unmatched",
                    &format!(
                        "device_id={} channel={} controller={} value={} msg_type={:?}",
                        event.device_id,
                        event.channel,
                        event.controller,
                        event.value,
                        event.msg_type
                    ),
                );
                return Ok(());
            }
        };
        let targets = binding.normalized_targets();
        if targets.is_empty() {
            run_logger::warn(
                "bindings",
                "binding_has_no_targets",
                &format!("binding_id={} action={:?}", binding.id, binding.action),
            );
            return Ok(());
        }
        run_logger::debug(
            "bindings",
            "event_matched",
            &format!(
                "binding_id={} action={:?} targets={} control_kind={:?} msg_type={:?}",
                binding.id,
                binding.action,
                targets.len(),
                binding.control_kind,
                binding.control.msg_type
            ),
        );

        let volume = {
            let mut states = state.binding_state.lock().map_err(|_| "Lock poisoned")?;
            let state = states.entry(key.clone()).or_insert_with(|| BindingState {
                last_value: 0.0,
                last_update: Instant::now(),
                relative_auto_format: None,
                relative_seen_midpoint: false,
                relative_seen_sign_band: false,
                relative_seen_high_negative: false,
                relative_seen_low_negative_hint: false,
            });
            apply_binding_midi_event(&binding, &event, state)
        };

        let volume = match volume {
            Some(v) => v,
            None => return Ok(()),
        };

        // Handle media key actions (fire-and-forget, no state tracking)
        if matches!(
            binding.action,
            model::BindingAction::MediaPlayPause
                | model::BindingAction::MediaNextTrack
                | model::BindingAction::MediaPrevTrack
                | model::BindingAction::MediaStop
        ) {
            if event.value == 0 {
                run_logger::debug(
                    "bindings",
                    "media_action_ignored_release",
                    &format!("binding_id={} action={:?}", binding.id, binding.action),
                );
                return Ok(());
            }
            let vk: u16 = match binding.action {
                model::BindingAction::MediaPlayPause => 0xB3,
                model::BindingAction::MediaNextTrack => 0xB0,
                model::BindingAction::MediaPrevTrack => 0xB1,
                model::BindingAction::MediaStop => 0xB2,
                _ => unreachable!(),
            };
            send_media_key(vk);
            run_logger::info(
                "bindings",
                "media_action_sent",
                &format!(
                    "binding_id={} action={:?} keycode={}",
                    binding.id, binding.action, vk
                ),
            );
            return Ok(());
        }

        if binding.action == model::BindingAction::Hotkey {
            if event.value == 0 {
                run_logger::debug(
                    "bindings",
                    "hotkey_action_ignored_release",
                    &format!("binding_id={} action={:?}", binding.id, binding.action),
                );
                return Ok(());
            }
            if let Some(hotkey) = &binding.hotkey {
                if !hotkey.keys.is_empty() {
                    send_hotkey(&hotkey.keys);
                    run_logger::info(
                        "bindings",
                        "hotkey_action_sent",
                        &format!(
                            "binding_id={} action={:?} hotkey={}",
                            binding.id, binding.action, hotkey.display
                        ),
                    );
                }
            }
            return Ok(());
        }

        if binding.action == model::BindingAction::OpenApplication {
            if event.value == 0 {
                run_logger::debug(
                    "bindings",
                    "open_application_ignored_release",
                    &format!("binding_id={} action={:?}", binding.id, binding.action),
                );
                return Ok(());
            }

            let Some(open_app) = binding.open_application.as_ref() else {
                run_logger::warn(
                    "bindings",
                    "open_application_missing_config",
                    &format!("binding_id={}", binding.id),
                );
                let _ = app.emit(
                    "binding_action_error",
                    serde_json::json!({
                        "reason": "open_application_missing_config",
                        "binding_id": binding.id,
                        "title": "Open Application Not Configured",
                        "message": "Choose an executable for this binding's Open Application action.",
                    }),
                );
                return Ok(());
            };

            let app_path = open_app.path.trim();
            if app_path.is_empty() || !Path::new(app_path).is_file() {
                run_logger::warn(
                    "bindings",
                    "open_application_path_missing",
                    &format!("binding_id={} path={}", binding.id, app_path),
                );
                let app_name = open_app.display.trim();
                let display = if app_name.is_empty() {
                    app_path
                } else {
                    app_name
                };
                let _ = app.emit(
                    "binding_action_error",
                    serde_json::json!({
                        "reason": "open_application_path_missing",
                        "binding_id": binding.id,
                        "title": "Application Not Found",
                        "message": format!("MIDIMaster couldn't find \"{}\". Re-select the .exe path in this binding.", display),
                    }),
                );
                return Ok(());
            }

            match ProcessCommand::new(app_path).spawn() {
                Ok(_) => {
                    run_logger::info(
                        "bindings",
                        "open_application_launched",
                        &format!("binding_id={} path={}", binding.id, app_path),
                    );
                }
                Err(err) => {
                    run_logger::error(
                        "bindings",
                        "open_application_launch_failed",
                        &format!("binding_id={} path={} error={}", binding.id, app_path, err),
                    );
                    let _ = app.emit(
                        "binding_action_error",
                        serde_json::json!({
                            "reason": "open_application_launch_failed",
                            "binding_id": binding.id,
                            "title": "Launch Failed",
                            "message": format!("MIDIMaster couldn't open this application: {}", err),
                        }),
                    );
                }
            }
            return Ok(());
        }

        if binding.action == model::BindingAction::SetDefaultDevice {
            if event.value == 0 {
                run_logger::debug(
                    "bindings",
                    "set_default_device_ignored_release",
                    &format!("binding_id={} action={:?}", binding.id, binding.action),
                );
                return Ok(());
            }

            let mut any_applied = false;
            for target in &targets {
                if let model::BindingTarget::Device { device_id } = target {
                    if let Err(err) = state.audio.set_default_device(device_id) {
                        run_logger::error(
                            "bindings",
                            "set_default_device_failed",
                            &format!(
                                "binding_id={} device_id={} error={}",
                                binding.id, device_id, err
                            ),
                        );
                    } else {
                        any_applied = true;
                    }
                }
            }

            if !any_applied {
                run_logger::warn(
                    "bindings",
                    "set_default_device_no_target_applied",
                    &format!("binding_id={} targets={}", binding.id, targets.len()),
                );
            }

            return Ok(());
        }

        // Handle toggle mute action for button bindings
        if binding.action == model::BindingAction::ToggleMute {
            // Mark user activity to prevent stale feedback loop
            if let Ok(mut states) = state.binding_state.lock() {
                if let Some(state) = states.get_mut(&key) {
                    state.last_update = Instant::now();
                }
            }

            // On button release (value == 0), re-send current state to enforce latching check
            // This fixes controllers that turn off LED on release (momentary behavior)
            if event.value == 0 && binding.mute_behavior == model::MuteBehavior::ToggleOnPress {
                run_logger::debug(
                    "bindings",
                    "toggle_mute_release_resend",
                    &format!("binding_id={} device_id={}", binding.id, binding.device_id),
                );
                let key_clone = key.clone();
                // Clone Arcs for async task
                let feedback_arc = state.feedback_values.clone();
                let midi_arc = state.midi.clone();

                let device_id = binding.device_id.clone();
                let channel = binding.control.channel;
                let controller = binding.control.controller;
                let msg_type = binding.control.msg_type.clone();

                tauri::async_runtime::spawn(async move {
                    // Sleep for 20ms to allow the hardware to process the "Note Off" completely
                    tokio::time::sleep(Duration::from_millis(20)).await;

                    if let Ok(feedback) = feedback_arc.lock() {
                        let current_val = feedback.get(&key_clone).cloned().unwrap_or(0.0);
                        if let Ok(mut midi) = midi_arc.lock() {
                            let _ = midi.send_feedback(
                                &device_id,
                                channel,
                                controller,
                                current_val,
                                msg_type,
                            );
                        }
                    }
                });
                return Ok(());
            }

            let current_val = state
                .feedback_values
                .lock()
                .ok()
                .and_then(|fb| fb.get(&key).cloned())
                .unwrap_or(0.0);
            let current_muted = current_val > 0.5;
            let previous_input_active =
                if binding.mute_behavior == model::MuteBehavior::SetFromValue {
                    state.last_mute_input_active
                        .lock()
                        .ok()
                        .and_then(|inputs| inputs.get(&key).copied())
                } else {
                    None
                };
            let Some(muted) = AppState::resolve_target_mute_state(
                event.value,
                current_muted,
                binding.mute_behavior.clone(),
                previous_input_active,
            ) else {
                if binding.mute_behavior == model::MuteBehavior::SetFromValue {
                    if let Ok(mut inputs) = state.last_mute_input_active.lock() {
                        inputs.insert(key.clone(), event.value > 0);
                    }
                }
                return Ok(());
            };
            if binding.mute_behavior == model::MuteBehavior::SetFromValue {
                if let Ok(mut inputs) = state.last_mute_input_active.lock() {
                    inputs.insert(key.clone(), event.value > 0);
                }
            }
            let mut any_applied = false;

            for (target_index, target) in targets.iter().enumerate() {
                match target {
                    model::BindingTarget::Master => {
                        if let Err(err) = state.audio.set_master_mute(muted) {
                            run_logger::error(
                                "bindings",
                                "toggle_mute_master_failed",
                                &format!("binding_id={} error={}", binding.id, err),
                            );
                        } else {
                            any_applied = true;
                        }
                    }
                    model::BindingTarget::Focus => {
                        if let Some(_focused) = state.audio.focused_session().ok().flatten() {
                            if let Err(err) = state.audio.set_focused_session_mute(muted) {
                                run_logger::error(
                                    "bindings",
                                    "toggle_mute_focus_failed",
                                    &format!("binding_id={} error={}", binding.id, err),
                                );
                            } else {
                                any_applied = true;
                            }
                        }
                    }
                    model::BindingTarget::Session { session_id } => {
                        if let Err(err) = state.audio.set_session_mute(session_id, muted) {
                            run_logger::error(
                                "bindings",
                                "toggle_mute_session_failed",
                                &format!(
                                    "binding_id={} session_id={} error={}",
                                    binding.id, session_id, err
                                ),
                            );
                        } else {
                            any_applied = true;
                        }
                    }
                    model::BindingTarget::Application { name, .. } => {
                        if let Err(err) = state.audio.set_application_mute(name, muted) {
                            run_logger::error(
                                "bindings",
                                "toggle_mute_application_failed",
                                &format!("binding_id={} app={} error={}", binding.id, name, err),
                            );
                        } else {
                            any_applied = true;
                        }
                    }
                    model::BindingTarget::Device { device_id } => {
                        if let Err(err) = state.audio.set_device_mute(device_id, muted) {
                            run_logger::error(
                                "bindings",
                                "toggle_mute_device_failed",
                                &format!(
                                    "binding_id={} device_id={} error={}",
                                    binding.id, device_id, err
                                ),
                            );
                        } else {
                            any_applied = true;
                        }
                    }
                    model::BindingTarget::Integration {
                        integration_id,
                        kind,
                        data,
                    } => {
                        let payload = serde_json::json!({
                          "binding_id": binding.id,
                          "action": "ToggleMute",
                          "value": if muted { 1.0 } else { 0.0 },
                          "target_index": target_index,
                          "target_count": targets.len(),
                          "is_primary_target": target_index == 0,
                          "target": {
                            "integration_id": integration_id,
                            "kind": kind,
                            "data": data,
                          }
                        });
                        let _ = app.emit("integration_binding_triggered", payload);
                        any_applied = true;
                    }
                    model::BindingTarget::Unset
                    | model::BindingTarget::MediaControl
                    | model::BindingTarget::Hotkey
                    | model::BindingTarget::OpenApplication => {}
                }
            }

            if !any_applied {
                run_logger::warn(
                    "bindings",
                    "toggle_mute_no_target_applied",
                    &format!("binding_id={} targets={}", binding.id, targets.len()),
                );
                return Ok(());
            }

            if let Ok(mut last_update) = state.osd_last_update.lock() {
                *last_update = Some(Instant::now());
            }

            if let Ok(mut feedback) = state.feedback_values.lock() {
                feedback.insert(key.clone(), if muted { 1.0 } else { 0.0 });
            }

            if let Ok(mut midi) = state.midi.lock() {
                // println!("MIDI Event Matched Binding: {:?} -> {:?}", binding.name, binding.target);
                let _ = midi.send_feedback(
                    &binding.device_id,
                    binding.control.channel,
                    binding.control.controller,
                    if muted { 1.0 } else { 0.0 },
                    binding.control.msg_type.clone(),
                );
            }

            let settings_enabled = state
                .osd_settings
                .lock()
                .map(|settings| settings.enabled)
                .unwrap_or(true);

            for target in &targets {
                let focus_session = if matches!(target, model::BindingTarget::Focus) {
                    state.audio.focused_session().ok().flatten()
                } else {
                    None
                };
                let payload = serde_json::json!({
                  "target": target,
                  "muted": muted,
                  "action": "toggle_mute",
                  "focus_session": focus_session,
                  "binding_id": binding.id
                });
                let _ = app.emit("mute_update", payload.clone());

                if settings_enabled {
                    AppState::emit_osd_update(app, state, &payload, false);
                }
            }

            return Ok(());
        }

        let mut any_applied = false;
        for (target_index, target) in targets.iter().enumerate() {
            match target {
                model::BindingTarget::Master => {
                    if let Err(err) = state.audio.set_master_volume(volume) {
                        run_logger::error(
                            "bindings",
                            "set_master_volume_failed",
                            &format!("binding_id={} error={}", binding.id, err),
                        );
                    } else {
                        any_applied = true;
                    }
                }
                model::BindingTarget::Focus => {
                    if state.apply_focus_volume_with_retry(&binding.id, volume) {
                        any_applied = true;
                    }
                }
                model::BindingTarget::Session { session_id } => {
                    if let Err(err) = state.audio.set_session_volume(session_id, volume) {
                        run_logger::error(
                            "bindings",
                            "set_session_volume_failed",
                            &format!(
                                "binding_id={} session_id={} error={}",
                                binding.id, session_id, err
                            ),
                        );
                    } else {
                        any_applied = true;
                    }
                }
                model::BindingTarget::Application { name, .. } => {
                    if let Err(err) = state.audio.set_application_volume(name, volume) {
                        run_logger::error(
                            "bindings",
                            "set_application_volume_failed",
                            &format!("binding_id={} app={} error={}", binding.id, name, err),
                        );
                    } else {
                        any_applied = true;
                    }
                }
                model::BindingTarget::Device { device_id } => {
                    if let Err(err) = state.audio.set_device_volume(device_id, volume) {
                        run_logger::error(
                            "bindings",
                            "set_device_volume_failed",
                            &format!(
                                "binding_id={} device_id={} error={}",
                                binding.id, device_id, err
                            ),
                        );
                    } else {
                        any_applied = true;
                    }
                }
                model::BindingTarget::Integration {
                    integration_id,
                    kind,
                    data,
                } => {
                    let payload = serde_json::json!({
                      "binding_id": binding.id,
                      "action": "Volume",
                      "value": volume,
                      "target_index": target_index,
                      "target_count": targets.len(),
                      "is_primary_target": target_index == 0,
                      "target": {
                        "integration_id": integration_id,
                        "kind": kind,
                        "data": data,
                      },
                      "source": "midi_fader"
                    });
                    let _ = app.emit("integration_binding_triggered", payload);
                    any_applied = true;
                }
                model::BindingTarget::Unset
                | model::BindingTarget::MediaControl
                | model::BindingTarget::Hotkey
                | model::BindingTarget::OpenApplication => {}
            }
        }

        if !any_applied {
            run_logger::warn(
                "bindings",
                "volume_no_target_applied",
                &format!("binding_id={} targets={}", binding.id, targets.len()),
            );
            return Ok(());
        }

        if let Ok(mut feedback) = state.feedback_values.lock() {
            feedback.insert(key.clone(), volume);
        }

        if let Ok(mut last_update) = state.osd_last_update.lock() {
            *last_update = Some(Instant::now());
        }

        if let Ok(mut midi) = state.midi.lock() {
            let _ = midi.send_feedback(
                &binding.device_id,
                binding.control.channel,
                binding.control.controller,
                volume,
                binding.control.msg_type.clone(),
            );
        }

        let settings_enabled = state
            .osd_settings
            .lock()
            .map(|settings| settings.enabled)
            .unwrap_or(true);
        for target in &targets {
            let focus_session = if matches!(target, model::BindingTarget::Focus) {
                state.audio.focused_session().ok().flatten()
            } else {
                None
            };
            let payload = serde_json::json!({
              "target": target,
              "volume": volume,
              "focus_session": focus_session,
              "binding_id": binding.id
            });
            let _ = app.emit("volume_update", payload.clone());

            if settings_enabled {
                AppState::emit_osd_update(app, state, &payload, false);
            }
        }

        Ok(())
    }
