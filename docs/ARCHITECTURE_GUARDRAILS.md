# MIDIMaster Architecture Guardrails

This document defines module ownership and cleanup rules so boundaries stay clear after refactors.

## Frontend Ownership

- `src/main.js` is the composition root only.
- Runtime plugin lifecycle and integration target normalization belong in `src/app/plugin_runtime.js`.
- Tauri API binding/retry and shared invocation helpers belong in `src/app/bootstrap.js`.
- Theme and persisted MIDI preference storage behavior belongs in `src/app/preferences.js`.
- Session/device polling behavior belongs in `src/app/session_refresh.js`.
- Plugin UI (installed/store tabs and plugin actions) belongs in `src/features/plugins/`.

## Backend Ownership

- `src-tauri/src/main.rs` should focus on app assembly: state wiring, plugin registration, invoke handler wiring, runtime startup.
- Monitor discovery and monitor selection logic belong in `src-tauri/src/monitors.rs`.
- Learn classification and media-key helper logic belong in `src-tauri/src/runtime_helpers.rs`.
- Command handlers stay in `src-tauri/src/commands/*` and should not duplicate domain logic already owned by helper modules.

## Compatibility Rules

- Plugin API v1 contract is stable: no breaking changes to plugin context (`ctx`) or manifest schema in cleanup-only passes.
- Tauri command names are stable unless an explicit migration plan is approved.
- Frontend command payload shape should use canonical camelCase arguments only.
- Do not add duplicate camelCase/snake_case aliases unless there is a proven compatibility requirement.

## Readability and Redundancy Rules

- Remove silent fallback branches when they hide actionable failures without adding compatibility value.
- Keep one source of truth per concern (plugin state, profile persistence, refresh loops, and monitor resolution).
- Prefer small focused modules over adding more cross-feature logic in composition files.
- If a function requires many unrelated dependencies, move it to the owning subsystem rather than passing globals around.
