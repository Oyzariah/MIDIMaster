export function normalizeProfileMidiPreference(source) {
  const current = (source && typeof source === "object") ? source : {};
  return {
    inputDeviceId: String(current.inputDeviceId || current.input_device_id || "").trim(),
    outputDeviceId: String(current.outputDeviceId || current.output_device_id || "").trim(),
    inputDeviceName: String(current.inputDeviceName || current.input_device_name || "").trim(),
    outputDeviceName: String(current.outputDeviceName || current.output_device_name || "").trim(),
  };
}

export function hasProfileMidiPreference(source) {
  const pref = normalizeProfileMidiPreference(source);
  return Boolean(pref.inputDeviceId && pref.outputDeviceId);
}

export function createPreferencesRuntime({ invoke, applyTheme, keys }) {
  const storageKeys = {
    theme: keys?.theme || "uiTheme",
    midiInputId: keys?.midiInputId || "midiDeviceId",
    midiOutputId: keys?.midiOutputId || "midiOutputDeviceId",
    midiInputName: keys?.midiInputName || "midiDeviceName",
    midiOutputName: keys?.midiOutputName || "midiOutputDeviceName",
    activeProfile: keys?.activeProfile || "activeProfileName",
  };

  const persisted = {
    midiInputId: "",
    midiOutputId: "",
    midiInputName: "",
    midiOutputName: "",
    activeProfileName: "",
  };

  function loadStoredTheme() {
    try {
      const stored = localStorage.getItem(storageKeys.theme);
      if (stored === "light" || stored === "dark") {
        return stored;
      }
    } catch {
      // ignore storage failures
    }
    return "light";
  }

  async function toggleTheme() {
    const nextTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
    applyTheme(nextTheme);
    try {
      localStorage.setItem(storageKeys.theme, nextTheme);
    } catch {
      // ignore storage failures
    }
    invoke("set_theme_preference", { theme: nextTheme }).catch(() => { });
  }

  function getSavedMidiDeviceIds() {
    let inputId = "";
    let outputId = "";
    let inputName = "";
    let outputName = "";
    try {
      inputId = localStorage.getItem(storageKeys.midiInputId) || "";
      outputId = localStorage.getItem(storageKeys.midiOutputId) || "";
      inputName = localStorage.getItem(storageKeys.midiInputName) || "";
      outputName = localStorage.getItem(storageKeys.midiOutputName) || "";
    } catch {
      // ignore storage failures
    }

    return {
      inputId: inputId || persisted.midiInputId || "",
      outputId: outputId || persisted.midiOutputId || "",
      inputName: inputName || persisted.midiInputName || "",
      outputName: outputName || persisted.midiOutputName || "",
    };
  }

  async function saveMidiDeviceIds(inputId, outputId, inputName = "", outputName = "") {
    persisted.midiInputId = inputId || "";
    persisted.midiOutputId = outputId || "";
    persisted.midiInputName = inputName || "";
    persisted.midiOutputName = outputName || "";
    try {
      if (persisted.midiInputId) {
        localStorage.setItem(storageKeys.midiInputId, persisted.midiInputId);
      }
      if (persisted.midiOutputId) {
        localStorage.setItem(storageKeys.midiOutputId, persisted.midiOutputId);
      }
      if (persisted.midiInputName) {
        localStorage.setItem(storageKeys.midiInputName, persisted.midiInputName);
      }
      if (persisted.midiOutputName) {
        localStorage.setItem(storageKeys.midiOutputName, persisted.midiOutputName);
      }
    } catch {
      // ignore storage failures
    }
    if (persisted.midiInputId && persisted.midiOutputId) {
      await invoke("set_midi_device_preferences", {
        inputDeviceId: persisted.midiInputId,
        outputDeviceId: persisted.midiOutputId,
        inputDeviceName: persisted.midiInputName || null,
        outputDeviceName: persisted.midiOutputName || null,
      }).catch(() => { });
    }
  }

  async function clearSavedMidiDeviceIds() {
    persisted.midiInputId = "";
    persisted.midiOutputId = "";
    persisted.midiInputName = "";
    persisted.midiOutputName = "";
    try {
      localStorage.removeItem(storageKeys.midiInputId);
      localStorage.removeItem(storageKeys.midiOutputId);
      localStorage.removeItem(storageKeys.midiInputName);
      localStorage.removeItem(storageKeys.midiOutputName);
    } catch {
      // ignore storage failures
    }
    await invoke("clear_midi_device_preferences").catch(() => { });
  }

  async function hydrateClientPreferences() {
    try {
      const settings = await invoke("get_app_settings");
      if (!settings || typeof settings !== "object") {
        return;
      }

      const savedTheme = settings.ui_theme ?? settings.uiTheme;
      if (savedTheme === "light" || savedTheme === "dark") {
        applyTheme(savedTheme);
        try {
          localStorage.setItem(storageKeys.theme, savedTheme);
        } catch {
          // ignore storage failures
        }
      }

      const savedInputId = settings.midi_input_device_id ?? settings.midiInputDeviceId ?? "";
      const savedOutputId = settings.midi_output_device_id ?? settings.midiOutputDeviceId ?? "";
      const savedInputName = settings.midi_input_device_name ?? settings.midiInputDeviceName ?? "";
      const savedOutputName = settings.midi_output_device_name ?? settings.midiOutputDeviceName ?? "";
      persisted.midiInputId = savedInputId || "";
      persisted.midiOutputId = savedOutputId || "";
      persisted.midiInputName = savedInputName || "";
      persisted.midiOutputName = savedOutputName || "";
      const savedActiveProfileName = settings.active_profile_name ?? settings.activeProfileName ?? "";
      persisted.activeProfileName = String(savedActiveProfileName || "").trim();

      try {
        if (persisted.midiInputId && !localStorage.getItem(storageKeys.midiInputId)) {
          localStorage.setItem(storageKeys.midiInputId, persisted.midiInputId);
        }
        if (persisted.midiOutputId && !localStorage.getItem(storageKeys.midiOutputId)) {
          localStorage.setItem(storageKeys.midiOutputId, persisted.midiOutputId);
        }
        if (persisted.midiInputName && !localStorage.getItem(storageKeys.midiInputName)) {
          localStorage.setItem(storageKeys.midiInputName, persisted.midiInputName);
        }
        if (persisted.midiOutputName && !localStorage.getItem(storageKeys.midiOutputName)) {
          localStorage.setItem(storageKeys.midiOutputName, persisted.midiOutputName);
        }
        if (persisted.activeProfileName) {
          localStorage.setItem(storageKeys.activeProfile, persisted.activeProfileName);
        }
      } catch {
        // ignore storage failures
      }
    } catch {
      // ignore preference hydration failures
    }
  }

  return {
    loadStoredTheme,
    toggleTheme,
    getSavedMidiDeviceIds,
    saveMidiDeviceIds,
    clearSavedMidiDeviceIds,
    hydrateClientPreferences,
    getPersistedActiveProfileName: () => persisted.activeProfileName,
  };
}
