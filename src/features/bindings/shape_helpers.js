export function normalizeControlKind(raw) {
  const value = String(raw || "Auto");
  if (value === "Button" || value === "Continuous" || value === "Auto") {
    return value;
  }
  return "Auto";
}

export function normalizeRelativeFormat(raw) {
  const value = String(raw || "Auto");
  if (value === "Auto") return value;
  return "Auto";
}

export function normalizeMuteBehavior(raw) {
  return raw === "SetFromValue" ? "SetFromValue" : "ToggleOnPress";
}

export function muteBehaviorLabel(raw) {
  return normalizeMuteBehavior(raw) === "SetFromValue" ? "Match" : "Toggle";
}

export function muteBehaviorTooltip(raw) {
  return normalizeMuteBehavior(raw) === "SetFromValue"
    ? "Match: for latched buttons, toggle mute whenever the button changes between off and on states."
    : "Toggle: each button press flips mute on or off; button release does nothing.";
}

export function buttonModeValue(binding) {
  return normalizeMuteBehavior(binding?.mute_behavior) === "SetFromValue"
    ? "button_match"
    : "button_toggle";
}

export function modeTooltip(raw) {
  if (raw === "button_match") {
    return muteBehaviorTooltip("SetFromValue");
  }
  if (raw === "button_toggle") {
    return muteBehaviorTooltip("ToggleOnPress");
  }
  return "";
}

export function assignModeTooltip(raw) {
  return raw === "Replace"
    ? "Replace: assigning a focused app replaces the current target list."
    : "Add: assigning a focused app appends it to the current target list.";
}

export function normalizeFaderCurve(raw) {
  const value = String(raw || "Linear");
  return ["Linear", "Exponential", "Logarithmic", "SCurve", "Custom"].includes(value)
    ? value
    : "Linear";
}

export function defaultCustomCurve() {
  return [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 1 },
  ];
}

export function presetCurvePoints(curve) {
  switch (normalizeFaderCurve(curve)) {
    case "Exponential":
      return [
        { x: 0, y: 0 },
        { x: 0.18, y: 0.04 },
        { x: 0.42, y: 0.16 },
        { x: 0.72, y: 0.5 },
        { x: 1, y: 1 },
      ];
    case "Logarithmic":
      return [
        { x: 0, y: 0 },
        { x: 0.08, y: 0.34 },
        { x: 0.24, y: 0.58 },
        { x: 0.52, y: 0.8 },
        { x: 1, y: 1 },
      ];
    case "SCurve":
      return [
        { x: 0, y: 0 },
        { x: 0.18, y: 0.06 },
        { x: 0.5, y: 0.5 },
        { x: 0.82, y: 0.94 },
        { x: 1, y: 1 },
      ];
    case "Custom":
      return defaultCustomCurve();
    case "Linear":
    default:
      return [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ];
  }
}

export function normalizeCustomCurve(points) {
  const normalized = Array.isArray(points)
    ? points
        .map((point, index) => ({
          x: Math.min(1, Math.max(0, Number(point?.x) || 0)),
          y: Math.min(1, Math.max(0, Number(point?.y) || 0)),
          index,
        }))
        .sort((a, b) => a.x - b.x)
        .map(({ x, y }) => ({ x, y }))
    : [];
  if (normalized.length < 2) {
    return defaultCustomCurve();
  }
  normalized[0].x = 0;
  normalized[normalized.length - 1].x = 1;
  return normalized;
}

export function customCurvePoints(binding) {
  const points = normalizeCustomCurve(binding?.custom_curve);
  if (Array.isArray(points) && points.length >= 3) {
    return points;
  }
  return defaultCustomCurve();
}

export function curveEditorPoints(binding) {
  return customCurvePoints(binding);
}

export function cloneBindingDraft(binding) {
  if (!binding || typeof binding !== "object") return null;
  const clone = JSON.parse(JSON.stringify(binding));
  ensureBindingShape(clone);
  ensureAuxShape(clone);
  return clone;
}

export function curveHelpText(curve) {
  const current = normalizeFaderCurve(curve);
  if (current === "Exponential") {
    return "Exponential response. Small movements rise faster for more sensitivity near the bottom of the throw.";
  }
  if (current === "Logarithmic") {
    return "Logarithmic response. Small movements stay gentler for finer low-end control.";
  }
  if (current === "SCurve") {
    return "S-Curve response. Soft at the edges with a more assertive response through the center.";
  }
  if (current === "Custom") {
    return "Custom response. Drag the control points to shape how MIDI movement maps to output.";
  }
  return "Linear response. Output value changes at the same rate as the fader movement.";
}

export function curveDisplayName(curve) {
  return normalizeFaderCurve(curve) === "SCurve" ? "S-Curve" : normalizeFaderCurve(curve);
}

export function applyCurveToNormalized(binding, normalized) {
  const clamped = Math.min(1, Math.max(0, Number(normalized) || 0));
  switch (normalizeFaderCurve(binding?.fader_curve)) {
    case "Exponential":
      return Math.pow(clamped, 0.55);
    case "Logarithmic":
      return Math.pow(clamped, 2.2);
    case "SCurve":
      return clamped * clamped * (3 - (2 * clamped));
    case "Custom": {
      const points = normalizeCustomCurve(binding?.custom_curve);
      if (clamped <= points[0].x) return points[0].y;
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        if (clamped > end.x) continue;
        const span = end.x - start.x;
        if (Math.abs(span) < 0.00001) return end.y;
        const t = Math.min(1, Math.max(0, (clamped - start.x) / span));
        return start.y + ((end.y - start.y) * t);
      }
      return points[points.length - 1].y;
    }
    default:
      return clamped;
  }
}

export function ensureBindingShape(binding) {
  if (!binding || typeof binding !== "object") return;
  if (!binding.mode || (binding.mode !== "Absolute" && binding.mode !== "Relative")) {
    binding.mode = "Absolute";
  }
  // Backend auto-detect is always used for relative controls.
  binding.relative_format = "Auto";
  binding.fader_curve = normalizeFaderCurve(binding.fader_curve);
  binding.custom_curve = customCurvePoints(binding);
  binding.mute_behavior = normalizeMuteBehavior(binding.mute_behavior);
  if (binding.mute_control && typeof binding.mute_control === "object") {
    binding.mute_control.mute_behavior = normalizeMuteBehavior(binding.mute_control.mute_behavior);
  }
}

export function effectiveIsButton(binding) {
  const controlKind = normalizeControlKind(binding?.control_kind);
  if (controlKind === "Button") return true;
  if (controlKind === "Continuous") return false;
  return binding?.control?.msg_type === "Note";
}

export function isHotkeyTarget(target) {
  return target === "Hotkey";
}

export function isOpenApplicationTarget(target) {
  return target === "OpenApplication";
}

export function getTargets(binding) {
  if (!binding || typeof binding !== "object") return [];
  if (Array.isArray(binding.targets) && binding.targets.length > 0) {
    const normalized = binding.targets.filter(Boolean).filter((t) => t !== "Unset").slice(0, 8);
    if (normalized.length > 0) return normalized;
  }
  if (binding.target != null) {
    return [binding.target];
  }
  return [];
}

export function setTargets(binding, targets) {
  const normalized = Array.isArray(targets) ? targets.filter(Boolean).slice(0, 8) : [];
  if (normalized.length === 0) normalized.push("Unset");
  binding.targets = normalized;
  binding.target = normalized[0] || "Unset";
}

export function getPrimaryTarget(binding) {
  return getTargets(binding)[0] || "Unset";
}

export function ensureAuxShape(binding) {
  if (!binding) return;
  if (!("mute_control" in binding)) binding.mute_control = null;
  if (!("assign_control" in binding)) binding.assign_control = null;
  if (binding.mute_control && typeof binding.mute_control === "object") {
    binding.mute_control.mute_behavior = normalizeMuteBehavior(binding.mute_control.mute_behavior);
  }
  if (binding.assign_mode !== "Replace") binding.assign_mode = "Add";
}

