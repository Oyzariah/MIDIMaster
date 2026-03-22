import {
  closeOpenDropdowns,
  renderLabelWithBadges,
  wireDropdownToggle,
} from "../ui/dropdown_badges.js";

export function createSettingsFeature({
  invoke,
  dom,
  getOsdSettings,
  setOsdSettings,
  getMonitorOptions,
  setMonitorOptions,
  getAppSettings,
  setAppSettings,
}) {
  if (typeof invoke !== "function") {
    throw new Error("createSettingsFeature: invoke is required");
  }
  const d = (dom && typeof dom === "object") ? dom : {};
  let monitorDropdownEl = null;
  let monitorMenuEl = null;
  let monitorDisplayEl = null;
  let monitorDocClickBound = false;
  let settingsDocClickBound = false;
  const settingsSelectDropdowns = new Map();

  function closeSettingsPanel() {
    if (!d.settingsPanel) return;
    d.settingsPanel.classList.add("hidden");
  }

  function openSettingsPanel() {
    if (!d.settingsPanel) return;
    d.settingsPanel.classList.remove("hidden");
  }

  function updateOsdPositionSelection(anchor) {
    if (!d.osdPositionPicker) return;
    d.osdPositionPicker.querySelectorAll(".osd-position-dot").forEach((dot) => {
      dot.classList.toggle("selected", dot.dataset.anchor === anchor);
    });
  }

  async function applyOsdSettings(nextSettings) {
    const current = (typeof getOsdSettings === "function") ? (getOsdSettings() || {}) : {};
    const merged = { ...current, ...(nextSettings || {}) };
    if (typeof setOsdSettings === "function") {
      setOsdSettings(merged);
    }

    if (d.osdEnabledToggle) {
      d.osdEnabledToggle.value = merged.enabled ? "enabled" : "disabled";
      renderSettingsSelectDropdown(d.osdEnabledToggle);
    }
    if (d.osdMonitorSelect) {
      d.osdMonitorSelect.value = String(merged.monitorIndex ?? 0);
    }
    updateOsdPositionSelection(merged.anchor);
    document.body.setAttribute("data-anchor", merged.anchor || "top-right");

    try {
      await invoke("update_osd_settings", {
        enabled: merged.enabled,
        monitorIndex: merged.monitorIndex,
        monitorName: merged.monitorName || null,
        monitorId: merged.monitorId || null,
        anchor: merged.anchor,
      });
    } catch (error) {
      console.error("Failed to update OSD settings", error);
    }
  }

  async function loadOsdSettings() {
    try {
      const settings = await invoke("get_osd_settings");
      if (settings) {
        const next = {
          enabled: Boolean(settings.enabled),
          monitorIndex: Number(settings.monitor_index ?? settings.monitorIndex ?? 0),
          monitorName: settings.monitor_name ?? settings.monitorName ?? null,
          monitorId: settings.monitor_id ?? settings.monitorId ?? null,
          anchor: settings.anchor || "top-right",
        };
        if (typeof setOsdSettings === "function") {
          setOsdSettings(next);
        }
      }
    } catch (error) {
      console.error("Failed to load OSD settings", error);
    }
  }

  function formatMonitorName(name) {
    if (!name) return "Monitor";
    return String(name).trim().replace(/^\\\\\.\\/, "");
  }

  function formatMonitorOptionLabel(monitor, index) {
    const base = formatMonitorName(monitor?.name) || `Monitor ${index + 1}`;
    return base;
  }

  function resolveEffectiveMonitor(monitors, currentSettings) {
    const list = Array.isArray(monitors) ? monitors : [];
    if (list.length === 0) return null;

    const requestedId = String(currentSettings?.monitorId || "").trim();
    if (requestedId) {
      const byId = list.find((monitor) => String(monitor?.stable_id || "").trim() === requestedId);
      if (byId) return byId;
    }

    return list.find((monitor) => Boolean(monitor?.is_primary)) || list[0];
  }

  function closeMonitorDropdown() {
    if (!monitorDropdownEl) return;
    closeOpenDropdowns({ except: null });
  }

  function ensureSettingsSelectDropdown(selectEl, { title = "Select" } = {}) {
    if (!selectEl) return null;

    const existing = settingsSelectDropdowns.get(selectEl);
    if (existing && existing.root?.isConnected) return existing;

    selectEl.classList.add("hidden");

    const root = document.createElement("div");
    root.className = "target-dropdown settings-select-dropdown";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "target-button";
    button.title = title;

    const display = document.createElement("span");
    display.className = "target-display";

    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "\u25be";

    button.appendChild(display);
    button.appendChild(caret);

    const menu = document.createElement("div");
    menu.className = "target-menu hidden";

    wireDropdownToggle({ root, menu, trigger: button });

    root.appendChild(button);
    root.appendChild(menu);
    selectEl.insertAdjacentElement("afterend", root);

    const entry = { root, menu, display };
    settingsSelectDropdowns.set(selectEl, entry);

    if (!settingsDocClickBound) {
      settingsDocClickBound = true;
      document.addEventListener("click", (event) => {
        const clickedInsideMonitor = Boolean(monitorDropdownEl && monitorDropdownEl.contains(event.target));
        if (clickedInsideMonitor) return;
        const clickedInsideAnySettingsDropdown = Array.from(settingsSelectDropdowns.values())
          .some((item) => item.root && item.root.contains(event.target));
        if (clickedInsideAnySettingsDropdown) return;
        closeOpenDropdowns({ except: null });
      });
    }

    return entry;
  }

  function renderSettingsSelectDropdown(selectEl) {
    if (!selectEl) return;
    const entry = ensureSettingsSelectDropdown(selectEl, { title: selectEl.title || selectEl.id || "Select" });
    if (!entry || !entry.menu || !entry.display) return;

    const options = Array.from(selectEl.options || []).filter((opt) => String(opt.value || "").trim());
    const currentValue = String(selectEl.value || "");
    entry.menu.innerHTML = "";

    let activeOption = options.find((opt) => opt.value === currentValue) || null;

    options.forEach((opt) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "target-option";
      if (opt.value === currentValue) item.classList.add("selected");

      const textWrap = document.createElement("span");
      textWrap.className = "target-label";
      renderLabelWithBadges(textWrap, {
        text: opt.textContent || "",
        badges: [],
        truncate: false,
      });
      item.appendChild(textWrap);

      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectEl.value = opt.value;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        closeOpenDropdowns({ except: null });
      });

      entry.menu.appendChild(item);
    });

    if (!activeOption && options.length > 0) {
      activeOption = options[0];
    }

    renderLabelWithBadges(entry.display, {
      text: activeOption?.textContent || "Select",
      badges: [],
      truncate: true,
    });
  }

  function renderAllSettingsSelectDropdowns() {
    renderSettingsSelectDropdown(d.osdEnabledToggle);
    renderSettingsSelectDropdown(d.startWithWindowsSelect);
    renderSettingsSelectDropdown(d.startInTraySelect);
    renderSettingsSelectDropdown(d.minimizeToTraySelect);
    renderSettingsSelectDropdown(d.exitToTraySelect);
  }

  function renderMonitorDisplay(option) {
    if (!monitorDisplayEl) return;
    renderLabelWithBadges(monitorDisplayEl, {
      text: option?.label || "Monitor",
      badges: option?.isPrimary ? [{ text: "MAIN", kind: "neutral" }] : [],
      truncate: true,
    });
  }

  function ensureMonitorDropdown() {
    if (!d.osdMonitorSelect) return;

    if (monitorDropdownEl && monitorDropdownEl.isConnected) {
      return;
    }

    d.osdMonitorSelect.classList.add("hidden");

    monitorDropdownEl = document.createElement("div");
    monitorDropdownEl.className = "target-dropdown settings-monitor-dropdown";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "target-button";
    button.title = "Monitor";

    monitorDisplayEl = document.createElement("span");
    monitorDisplayEl.className = "target-display";

    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "\u25be";

    button.appendChild(monitorDisplayEl);
    button.appendChild(caret);

    monitorMenuEl = document.createElement("div");
    monitorMenuEl.className = "target-menu hidden";

    wireDropdownToggle({ root: monitorDropdownEl, menu: monitorMenuEl, trigger: button });

    monitorDropdownEl.appendChild(button);
    monitorDropdownEl.appendChild(monitorMenuEl);
    d.osdMonitorSelect.insertAdjacentElement("afterend", monitorDropdownEl);

    if (!monitorDocClickBound) {
      monitorDocClickBound = true;
      document.addEventListener("click", (event) => {
        if (!monitorDropdownEl) return;
        if (monitorDropdownEl.contains(event.target)) return;
        closeMonitorDropdown();
      });
    }
  }

  function renderMonitorDropdownOptions(monitors) {
    ensureMonitorDropdown();
    if (!monitorMenuEl || !d.osdMonitorSelect) return;

    const list = Array.isArray(monitors) ? monitors : [];
    monitorMenuEl.innerHTML = "";
    const currentValue = String(d.osdMonitorSelect.value || "0");
    let activeOption = null;

    list.forEach((monitor, index) => {
      const value = String(monitor.index ?? index);
      const optionModel = {
        value,
        label: formatMonitorOptionLabel(monitor, index),
        isPrimary: Boolean(monitor.is_primary),
      };
      if (value === currentValue) {
        activeOption = optionModel;
      }

      const item = document.createElement("button");
      item.type = "button";
      item.className = "target-option";
      if (value === currentValue) {
        item.classList.add("selected");
      }

      const textWrap = document.createElement("span");
      textWrap.className = "target-label";
      renderLabelWithBadges(textWrap, {
        text: optionModel.label,
        badges: optionModel.isPrimary ? [{ text: "MAIN", kind: "neutral" }] : [],
        truncate: false,
      });
      item.appendChild(textWrap);

      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        d.osdMonitorSelect.value = value;
        d.osdMonitorSelect.dispatchEvent(new Event("change", { bubbles: true }));
        renderMonitorDisplay(optionModel);
        closeMonitorDropdown();
      });

      monitorMenuEl.appendChild(item);
    });

    if (!activeOption) {
      const fallbackText = d.osdMonitorSelect.options[d.osdMonitorSelect.selectedIndex]?.textContent || "Monitor";
      activeOption = { value: currentValue, label: fallbackText, isPrimary: /\bMAIN\b/i.test(fallbackText) };
    }
    renderMonitorDisplay(activeOption);
  }

  async function loadMonitorOptions() {
    let next = [];
    try {
      const monitors = await invoke("list_monitors");
      next = Array.isArray(monitors) ? monitors : [];
    } catch (error) {
      next = [];
      console.error("Failed to load monitors", error);
    }
    if (typeof setMonitorOptions === "function") {
      setMonitorOptions(next);
    }

    // Update dropdown if it exists
    if (d.osdMonitorSelect) {
      const current = (typeof getOsdSettings === "function") ? (getOsdSettings() || {}) : {};
      d.osdMonitorSelect.innerHTML = "";
      next.forEach((monitor, index) => {
        const option = document.createElement("option");
        option.value = String(monitor.index ?? index);
        option.dataset.rawName = monitor.name || "";
        option.dataset.stableId = monitor.stable_id || "";
        option.textContent = formatMonitorOptionLabel(monitor, index);
        d.osdMonitorSelect.appendChild(option);
      });
      if (next.length === 0) {
        const option = document.createElement("option");
        option.value = "0";
        option.textContent = "Primary monitor";
        d.osdMonitorSelect.appendChild(option);
        d.osdMonitorSelect.value = "0";
      } else {
        // Mirror backend monitor resolution: prefer stable_id match, else primary monitor.
        const effective = resolveEffectiveMonitor(next, current);
        const fallbackIndex = Math.max(0, Number(current.monitorIndex ?? 0));
        const effectiveValue = String(effective?.index ?? fallbackIndex);
        d.osdMonitorSelect.value = effectiveValue;

        if (typeof setOsdSettings === "function" && effective) {
          setOsdSettings({
            ...current,
            monitorIndex: Number(effectiveValue),
            monitorName: effective.name || null,
            monitorId: effective.stable_id || null,
          });
        }
      }
      renderMonitorDropdownOptions(next);
    }
  }

  function syncAppSettingsUI(nextSettings) {
    const current = (typeof getAppSettings === "function") ? (getAppSettings() || {}) : {};
    const merged = { ...current, ...(nextSettings || {}) };
    if (typeof setAppSettings === "function") {
      setAppSettings(merged);
    }
    if (d.startWithWindowsSelect) {
      d.startWithWindowsSelect.value = merged.startWithWindows ? "enabled" : "disabled";
      renderSettingsSelectDropdown(d.startWithWindowsSelect);
    }
    if (d.startInTraySelect) {
      d.startInTraySelect.value = merged.startInTray ? "enabled" : "disabled";
      renderSettingsSelectDropdown(d.startInTraySelect);
    }
    if (d.minimizeToTraySelect) {
      d.minimizeToTraySelect.value = merged.minimizeToTray ? "enabled" : "disabled";
      renderSettingsSelectDropdown(d.minimizeToTraySelect);
    }
    if (d.exitToTraySelect) {
      d.exitToTraySelect.value = merged.exitToTray ? "enabled" : "disabled";
      renderSettingsSelectDropdown(d.exitToTraySelect);
    }
  }

  function persistAppSettings() {
    const s = (typeof getAppSettings === "function") ? (getAppSettings() || {}) : {};
    return invoke("update_app_settings", {
      startWithWindows: Boolean(s.startWithWindows),
      startInTray: Boolean(s.startInTray),
      minimizeToTray: Boolean(s.minimizeToTray),
      exitToTray: Boolean(s.exitToTray),
    }).catch((error) => {
      console.error("Failed to update app settings", error);
    });
  }

  async function loadAppSettings() {
    try {
      const settings = await invoke("get_app_settings");
      if (settings) {
        const next = {
          startWithWindows: Boolean(settings.start_with_windows ?? settings.startWithWindows),
          startInTray: Boolean(settings.start_in_tray ?? settings.startInTray),
          minimizeToTray: Boolean(settings.minimize_to_tray ?? settings.minimizeToTray),
          exitToTray: Boolean(settings.exit_to_tray ?? settings.exitToTray),
        };
        if (typeof setAppSettings === "function") {
          setAppSettings(next);
        }
      }
    } catch (error) {
      console.error("Failed to load app settings", error);
    }
  }

  function bindUi() {
    if (d.settingsPanel) {
      d.settingsPanel.addEventListener("click", (event) => {
        if (event.target === d.settingsPanel) {
          closeSettingsPanel();
        }
      });
    }
    if (d.settingsPanelClose) {
      d.settingsPanelClose.addEventListener("click", closeSettingsPanel);
    }

    if (d.settingsButton) {
      d.settingsButton.addEventListener("click", async () => {
        await loadOsdSettings();
        await loadMonitorOptions();
        await loadAppSettings();
        syncAppSettingsUI((typeof getAppSettings === "function") ? (getAppSettings() || {}) : {});
        renderAllSettingsSelectDropdowns();
        openSettingsPanel();
      });
    }

    if (d.osdEnabledToggle) {
      d.osdEnabledToggle.addEventListener("change", () => {
        applyOsdSettings({ enabled: d.osdEnabledToggle.value === "enabled" });
      });
    }

    if (d.osdMonitorSelect) {
      d.osdMonitorSelect.addEventListener("change", () => {
        const nextIndex = Number(d.osdMonitorSelect.value || 0);
        const selectedOption = d.osdMonitorSelect.options[d.osdMonitorSelect.selectedIndex];
        const monitorName = selectedOption?.dataset?.rawName || null;
        const monitorId = selectedOption?.dataset?.stableId || null;
        applyOsdSettings({ monitorIndex: nextIndex, monitorName, monitorId });
        const currentMonitors = (typeof getMonitorOptions === "function") ? (getMonitorOptions() || []) : [];
        renderMonitorDropdownOptions(currentMonitors);
      });
    }

    if (d.osdPositionPicker) {
      d.osdPositionPicker.addEventListener("click", (event) => {
        const dot = event.target.closest(".osd-position-dot");
        if (!dot) return;
        const anchor = dot.dataset.anchor || "top-right";
        applyOsdSettings({ anchor });
      });
    }

    if (d.startWithWindowsSelect) {
      d.startWithWindowsSelect.addEventListener("change", () => {
        syncAppSettingsUI({ startWithWindows: d.startWithWindowsSelect.value === "enabled" });
        persistAppSettings();
      });
    }
    if (d.startInTraySelect) {
      d.startInTraySelect.addEventListener("change", () => {
        syncAppSettingsUI({ startInTray: d.startInTraySelect.value === "enabled" });
        persistAppSettings();
      });
    }
    if (d.minimizeToTraySelect) {
      d.minimizeToTraySelect.addEventListener("change", () => {
        syncAppSettingsUI({ minimizeToTray: d.minimizeToTraySelect.value === "enabled" });
        persistAppSettings();
      });
    }
    if (d.exitToTraySelect) {
      d.exitToTraySelect.addEventListener("change", () => {
        syncAppSettingsUI({ exitToTray: d.exitToTraySelect.value === "enabled" });
        persistAppSettings();
      });
    }

    renderAllSettingsSelectDropdowns();
  }

  return {
    bindUi,
    openSettingsPanel,
    closeSettingsPanel,
    loadMonitorOptions,
    loadOsdSettings,
    applyOsdSettings,
    loadAppSettings,
    syncAppSettingsUI,
    persistAppSettings,
  };
}
