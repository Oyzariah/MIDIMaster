export function createTargetsFeature({
  dom,
  masterIconData,
  focusIconData,
  mediaPlayPauseIconData,
  mediaNextTrackIconData,
  mediaPrevTrackIconData,
  mediaStopIconData,
  getPluginHost,
  getSessions,
  getPlaybackDevices,
  getRecordingDevices,
  normalizeSessionKey,
  integrationTargetKey,
  resolveOsdTarget,
}) {
  const d = (dom && typeof dom === "object") ? dom : {};
  const getHost = (typeof getPluginHost === "function") ? getPluginHost : (() => null);
  const getSess = (typeof getSessions === "function") ? getSessions : (() => []);
  const getPlayback = (typeof getPlaybackDevices === "function") ? getPlaybackDevices : (() => []);
  const getRecording = (typeof getRecordingDevices === "function") ? getRecordingDevices : (() => []);
  const normalizeKey = (typeof normalizeSessionKey === "function") ? normalizeSessionKey : (() => "");
  const targetKey = (typeof integrationTargetKey === "function") ? integrationTargetKey : (() => "");
  const resolveDisplay = (typeof resolveOsdTarget === "function") ? resolveOsdTarget : (() => null);

  let activeTargetPanelSelect = null;
  let activeTargetPanelBack = null;

  function mediaIconForAction(action) {
    if (action === "MediaNextTrack") return mediaNextTrackIconData;
    if (action === "MediaPrevTrack") return mediaPrevTrackIconData;
    if (action === "MediaStop") return mediaStopIconData;
    return mediaPlayPauseIconData;
  }

  function parseLabelParts(rawLabel) {
    const label = String(rawLabel || "").trim();
    if (!label) {
      return { base: "", tags: [] };
    }

    const tags = [];
    const tagPattern = /\(([^()]+)\)/g;
    let match = null;
    while ((match = tagPattern.exec(label)) !== null) {
      const tag = String(match[1] || "").trim();
      if (tag) tags.push(tag);
    }

    const base = label.replace(/\s*\([^()]+\)/g, " ").replace(/\s+/g, " ").trim();
    return { base: base || label, tags };
  }

  function tagVariant(tag) {
    const text = String(tag || "").toLowerCase();
    if (!text) return "neutral";
    if (text.includes("mix")) return "mix";
    if (text.includes("unavailable") || text.includes("disconnected") || text.includes("connecting")) {
      return "state";
    }
    if (
      text.includes("toggle")
      || text.includes("mute")
      || text.includes("media")
      || text.includes("stop")
      || text.includes("play")
      || text.includes("next")
      || text.includes("prev")
      || text.includes("record")
      || text.includes("stream")
      || text.includes("visibility")
      || text.includes("trigger")
      || text.includes("action")
    ) {
      return "action";
    }
    return "neutral";
  }

  function appendLabelWithTags(labelEl, rawLabel, extraTags = [], truncateMain = true) {
    labelEl.textContent = "";
    const { base, tags } = parseLabelParts(rawLabel);
    const allTags = [...tags, ...extraTags.filter(Boolean).map((t) => String(t).trim()).filter(Boolean)];
    const uniqueTags = [];
    const seenTags = new Set();
    for (const tag of allTags) {
      const key = tag.toLowerCase();
      if (seenTags.has(key)) continue;
      seenTags.add(key);
      uniqueTags.push(tag);
    }

    let visibleTags = uniqueTags.map((tag) => ({ text: tag, kind: tagVariant(tag), hiddenTags: [] }));
    if (truncateMain && uniqueTags.length > 1) {
      const baseLen = (base || rawLabel || "").length;
      const tagTextLen = uniqueTags.reduce((sum, t) => sum + String(t).length, 0);
      const shouldCollapse = uniqueTags.length > 2 || (baseLen + tagTextLen > 24);

      if (!shouldCollapse) {
        const keepAll = uniqueTags.map((tag) => ({ text: tag, kind: tagVariant(tag), hiddenTags: [] }));
        visibleTags = keepAll;
      } else {
      const tagPriority = (tag) => {
        const variant = tagVariant(tag);
        if (variant === "action") return 0;
        if (variant === "mix") return 1;
        if (variant === "state") return 2;
        return 3;
      };
      const sorted = [...uniqueTags].sort((a, b) => tagPriority(a) - tagPriority(b));
      const first = sorted[0];
      const hidden = sorted.slice(1);
      const restCount = hidden.length;
      visibleTags = [{ text: first, kind: tagVariant(first), hiddenTags: [] }];
      if (restCount > 0) {
        visibleTags.push({ text: `+${restCount}`, kind: "count", hiddenTags: hidden });
      }
      }
    }

    const content = document.createElement("span");
    content.className = "target-label-content";

    const main = document.createElement("span");
    main.className = `target-label-main${truncateMain ? " is-truncated" : ""}`;
    main.textContent = base || rawLabel || "Target";
    content.appendChild(main);

    if (visibleTags.length > 0) {
      const tagsWrap = document.createElement("span");
      tagsWrap.className = "target-label-tags";
      visibleTags.forEach((tag) => {
        const badge = document.createElement("span");
        badge.className = `target-tag target-tag--${tag.kind}`;
        badge.textContent = tag.text;
        if (tag.kind === "count" && tag.hiddenTags.length > 0) {
          const hiddenList = tag.hiddenTags.join(", ");
          badge.title = hiddenList;
          badge.setAttribute("aria-label", `Additional tags: ${hiddenList}`);
        }
        tagsWrap.appendChild(badge);
      });
      content.appendChild(tagsWrap);
    }

    labelEl.appendChild(content);
  }

  function closeTargetMenus(except = null) {
    document.querySelectorAll(".target-dropdown.open").forEach((dropdown) => {
      if (dropdown === except) {
        return;
      }
      dropdown.classList.remove("open");
      dropdown.querySelector(".target-menu")?.classList.add("hidden");
    });
  }

  function createTargetIcon(option) {
    if (option?.icon_data) {
      const icon = document.createElement("img");
      icon.className = "target-icon";
      icon.alt = "";
      const src = String(option.icon_data);
      icon.src = src.startsWith("data:") || src.startsWith("assets/")
        ? src
        : `data:image/png;base64,${src}`;
      return icon;
    }
    const fallback = document.createElement("span");
    fallback.className = "target-icon fallback";
    fallback.textContent = option?.label?.[0]?.toUpperCase() || "?";
    return fallback;
  }

  function closeTargetPanel() {
    if (!d.targetPanel) {
      return;
    }
    d.targetPanel.classList.add("hidden");
    if (d.targetPanelList) {
      d.targetPanelList.innerHTML = "";
    }
    activeTargetPanelSelect = null;
    activeTargetPanelBack = null;

    if (d.targetPanelBack) {
      d.targetPanelBack.style.display = "none";
      d.targetPanelBack.onclick = null;
    }
  }

  function openTargetPanel(options, selectedValue, selectedKind, onSelect, title = "Select Target", nav = null) {
    if (!d.targetPanel || !d.targetPanelList) {
      return;
    }
    activeTargetPanelSelect = onSelect;
    activeTargetPanelBack = nav && typeof nav === "object" ? (nav.onBack || null) : null;

    if (d.targetPanelBack) {
      if (typeof activeTargetPanelBack === "function") {
        d.targetPanelBack.style.display = "inline-flex";
        d.targetPanelBack.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          activeTargetPanelBack();
        };
      } else {
        d.targetPanelBack.style.display = "none";
        d.targetPanelBack.onclick = null;
      }
    }

    d.targetPanelList.innerHTML = "";
    if (d.targetPanelTitle) {
      d.targetPanelTitle.textContent = title;
    }
    (options || []).forEach((option) => {
      if (option.kind === "divider") {
        const divider = document.createElement("div");
        divider.className = "target-divider";
        divider.textContent = option.label;
        d.targetPanelList.appendChild(divider);
        return;
      }
      const item = document.createElement("button");
      item.type = "button";
      item.className = "target-option";
      item.appendChild(createTargetIcon(option));
      const label = document.createElement("span");
      label.className = "target-label";
      appendLabelWithTags(label, option.label, [], false);
      item.appendChild(label);
      item.classList.toggle(
        "selected",
        option.value === selectedValue && option.kind === selectedKind,
      );
      if (option.ghost) {
        item.classList.add("unavailable");
        item.style.opacity = "0.6";
      }

      if (option.kind === "placeholder" || option.disabled) {
        item.disabled = true;
      }
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (activeTargetPanelSelect) {
          const res = activeTargetPanelSelect(option);
          if (res === false) {
            return;
          }
        }
        closeTargetPanel();
      });
      d.targetPanelList.appendChild(item);
    });
    d.targetPanel.classList.remove("hidden");
  }

  function buildTargetOptions(currentTarget, isButton = false) {
    const pluginHost = getHost();
    const sessions = getSess();
    const playbackDevices = getPlayback();
    const recordingDevices = getRecording();

    const integration = currentTarget?.Integration || currentTarget?.integration;
    const selectedAppName = currentTarget?.Application?.name || currentTarget?.application?.name;
    const sessionContainer = currentTarget?.Session || currentTarget?.session;
    const selectedSessionId = (sessionContainer && typeof sessionContainer === "object")
      ? (sessionContainer.session_id ?? sessionContainer.sessionId)
      : (sessionContainer != null ? sessionContainer : null);
    const selectedSessionKey = (selectedSessionId != null)
      ? (() => {
        const s = sessions.find((x) => String(x.id) === String(selectedSessionId));
        return s ? normalizeKey(s) : null;
      })()
      : null;
    const selectedDeviceId = currentTarget?.Device?.device_id || currentTarget?.device?.device_id;

    const isUnset = currentTarget == null || currentTarget === "" || currentTarget === "Unset";
    const selectedKind = isUnset
      ? "placeholder"
      : (integration ? "integration-target"
        : (currentTarget?.Session || currentTarget?.session || currentTarget?.Application || currentTarget?.application) ? "session"
          : (currentTarget?.Device || currentTarget?.device) ? "device"
            : (currentTarget === "Master" || currentTarget?.Master != null) ? "master"
              : (currentTarget === "Focus" || currentTarget?.Focus != null) ? "focus"
                : currentTarget === "MediaControl" ? "media-control"
                : "placeholder"
      );

    let selectedValue = "";
    if (selectedKind === "integration-target") selectedValue = targetKey(integration);
    else if (selectedKind === "session") selectedValue = selectedAppName || selectedSessionKey || "";
    else if (selectedKind === "device") selectedValue = selectedDeviceId || "";
    else if (selectedKind === "master" || selectedKind === "focus" || selectedKind === "media-control") selectedValue = selectedKind;
    else if (selectedKind === "placeholder") selectedValue = "placeholder";

    const options = [
      {
        value: "master",
        label: "Master",
        icon_data: masterIconData,
        kind: "master",
      },
      {
        value: "focus",
        label: "Focus",
        icon_data: focusIconData,
        kind: "focus",
      },
    ];

    if (isButton) {
      options.push({
        value: "media-control",
        label: "Media Controls",
        icon_data: mediaPlayPauseIconData,
        kind: "media-control",
      });
    }

    if (pluginHost) {
      const integrations = pluginHost.getIntegrations();
      if (Array.isArray(integrations) && integrations.length > 0) {
        options.push({ kind: "divider", label: "Integrations" });
        for (const integ of integrations) {
          if (!integ || !integ.id) continue;
          options.push({
            kind: "integration-root",
            value: String(integ.id),
            label: integ.name || String(integ.id),
            icon_data: integ.icon_data || null,
          });
        }
      }
    }

    const seen = new Set();
    const sessionsAdded = sessions.filter((session) => !session.is_master && session.id !== "master");
    if (sessionsAdded.length > 0) {
      options.push({ kind: "divider", label: "Applications" });
      sessionsAdded.forEach((session) => {
        const key = normalizeKey(session);
        if (!key) return;

        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        options.push({
          value: key,
          label: session.display_name,
          icon_data: session.icon_data,
          kind: "session",
        });
      });
    }

    if (selectedAppName && !seen.has(selectedAppName)) {
      if (sessionsAdded.length === 0) {
        options.push({ kind: "divider", label: "Applications" });
      }
      const label = selectedAppName.charAt(0).toUpperCase() + selectedAppName.slice(1);
      options.push({
        value: selectedAppName,
        label: `${label} (Unavailable)`,
        kind: "session",
        ghost: true,
      });
    }

    if (playbackDevices.length > 0) {
      options.push({ kind: "divider", label: "Playback Devices" });
      playbackDevices.forEach((device) => {
        options.push({
          value: `playback:${device.id}`,
          label: device.display_name,
          icon_data: device.icon_data,
          kind: "device",
        });
      });
    }

    if (recordingDevices.length > 0) {
      options.push({ kind: "divider", label: "Recording Devices" });
      recordingDevices.forEach((device) => {
        options.push({
          value: `recording:${device.id}`,
          label: device.display_name,
          icon_data: device.icon_data,
          kind: "device",
        });
      });
    }

    if (selectedDeviceId) {
      const found = options.some((opt) => opt.value === selectedDeviceId);
      if (!found) {
        if (playbackDevices.length === 0 && recordingDevices.length === 0) {
          options.push({ kind: "divider", label: "Devices" });
        }
        options.push({
          value: selectedDeviceId,
          label: "Device (Unavailable)",
          kind: "device",
          ghost: true,
        });
      }
    }

    let activeIntegrationOption = null;
    if (selectedKind === "integration-target" && selectedValue) {
      let label = "Integration Target";
      let ghost = false;
      let icon_data = null;
      if (integration) {
        const handler = pluginHost?.getIntegration?.(integration.integration_id);
        if (handler && typeof handler.describeTarget === "function") {
          try {
            const desc = handler.describeTarget({ Integration: integration });
            if (desc?.label) label = desc.label;
            if (desc?.icon_data) icon_data = desc.icon_data;
            if (typeof desc?.ghost === "boolean") ghost = desc.ghost;
          } catch { }
        }

        if (!icon_data || label === "Integration Target") {
          try {
            const fallback = resolveDisplay({ Integration: integration });
            if (fallback?.label) label = fallback.label;
            if (fallback?.icon_data) icon_data = fallback.icon_data;
          } catch { }
        }

        if (!handler) {
          ghost = true;
        }

        if (ghost && label && typeof label === "string" && !label.includes("Unavailable")) {
          label = `${label} (Unavailable)`;
        }
      }
      activeIntegrationOption = {
        kind: "integration-target",
        value: selectedValue,
        label,
        ghost,
        icon_data,
        target: integration ? { Integration: integration } : null,
      };
    }

    return { options, selectedValue, selectedKind, activeIntegrationOption };
  }

  function buildTargetSelect(currentTarget, isBindingButton = false, currentAction = "Volume") {
    const container = document.createElement("div");
    container.className = "target-dropdown";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "target-button";

    const display = document.createElement("span");
    display.className = "target-display";

    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "\u25be";

    button.appendChild(display);
    button.appendChild(caret);

    let selectedTarget = currentTarget;
    let selectedAction = isBindingButton ? (currentAction || "ToggleMute") : "Volume";

    const { options, selectedValue, selectedKind, activeIntegrationOption } = buildTargetOptions(currentTarget, isBindingButton);
    const placeholderOption = {
      value: "",
      label: "Select an application or device",
      icon_data: null,
      kind: "placeholder",
    };

    const actionLabel = (action) => {
      if (action === "ToggleMute") return "Toggle Mute";
      if (action === "MediaPlayPause") return "Media Play/Pause";
      if (action === "MediaNextTrack") return "Media Next Track";
      if (action === "MediaPrevTrack") return "Media Previous Track";
      if (action === "MediaStop") return "Media Stop";
      if (action === "Volume" && isBindingButton) return "Trigger";
      return action;
    };

    const setDisplay = (option, action = null) => {
      display.innerHTML = "";
      if (option.kind === "placeholder") {
        const label = document.createElement("span");
        label.className = "target-placeholder";
        label.textContent = option.label;
        display.appendChild(label);
        return;
      }
      const displayOption = (option.kind === "media-control" && isBindingButton)
        ? { ...option, icon_data: mediaIconForAction(action) }
        : option;
      const icon = createTargetIcon(displayOption);
      const label = document.createElement("span");
      label.className = "target-label";
      const actionTag = (action && isBindingButton) ? actionLabel(action) : null;
      appendLabelWithTags(label, option.label, actionTag ? [actionTag] : [], true);

      display.appendChild(icon);
      display.appendChild(label);
    };

    const mapOptionToTarget = (option) => {
      if (option && option.target) {
        const t = option.target;
        const integ = t?.Integration || t?.integration;
        if (integ && typeof integ === "object" && integ.integration_id) {
          const next = {
            Integration: {
              integration_id: String(integ.integration_id),
              kind: String(integ.kind || ""),
              data: { ...(integ.data || {}) },
            },
          };
          if (option.label) next.Integration.data.label = String(option.label);
          if (option.icon_data) next.Integration.data.icon_data = option.icon_data;
          return next;
        }
        return t;
      }
      if (option.kind === "master") {
        return "Master";
      }
      if (option.kind === "focus") {
        return "Focus";
      }
      if (option.kind === "media-control") {
        return "MediaControl";
      }
      if (option.kind === "device") {
        return { Device: { device_id: option.value } };
      }
      if (option.kind === "session") {
        return { Application: { name: option.value } };
      }
      if (option.kind === "placeholder") {
        return "Unset";
      }
      return selectedTarget;
    };

    const selectOption = (option, action = null, emit = true) => {
      container.value = option.value;
      container.dataset.kind = option.kind || "master";

      if (option.ghost) {
        container.classList.add("target-unavailable");
      } else {
        container.classList.remove("target-unavailable");
      }
      if (option.sceneName) container.dataset.sceneName = option.sceneName;
      container.dataset.mixType = option.mixType || "";

      if (action) {
        container.dataset.action = action;
        selectedAction = action;
      }

      setDisplay(option, selectedAction);
      selectedTarget = mapOptionToTarget(option);
      container.__selectedTarget = selectedTarget;
      if (emit) {
        container.dispatchEvent(new Event("change"));
      }
    };

    let initial = selectedKind === "placeholder"
      ? placeholderOption
      : options.find((option) => option.value === selectedValue && option.kind === selectedKind);

    if (!initial && activeIntegrationOption) {
      initial = activeIntegrationOption;
    }

    if (!initial) {
      initial = options.find((option) => option.kind !== "divider") || options[0];
    }

    container.dataset.action = selectedAction;
    selectOption(initial, selectedAction, false);

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const { options, selectedValue, selectedKind } = buildTargetOptions(selectedTarget, isBindingButton);

      const openRootTargetPanel = () => {
        openTargetPanel(
          options,
          selectedValue,
          selectedKind,
          (targetOption) => {
            if (targetOption.kind === "integration-root") {
              showIntegrationSubmenu(targetOption.value, [], null).catch(() => { });
              return false;
            }

            if (isBindingButton) {
              const actionOptions = targetOption.kind === "media-control"
                ? [
                  { label: "Media Play/Pause", value: "MediaPlayPause", kind: "action", icon_data: mediaPlayPauseIconData },
                  { label: "Media Next Track", value: "MediaNextTrack", kind: "action", icon_data: mediaNextTrackIconData },
                  { label: "Media Previous Track", value: "MediaPrevTrack", kind: "action", icon_data: mediaPrevTrackIconData },
                  { label: "Media Stop", value: "MediaStop", kind: "action", icon_data: mediaStopIconData },
                ]
                : [
                  { label: "Toggle Mute", value: "ToggleMute", kind: "action" },
                ];
              setTimeout(() => {
                openTargetPanel(actionOptions, selectedAction, "action", (actionOption) => {
                  selectOption(targetOption, actionOption.value);
                }, "Select Action");
              }, 10);
              return false;
            }

            selectOption(targetOption);
            return true;
          },
        );
      };

      const showIntegrationSubmenu = async (integrationId, navStack = [], navState = null) => {
        const pluginHost = getHost();
        const handler = pluginHost?.getIntegration(integrationId);
        let sub = [];
        try {
          const sessions = getSess();
          const playbackDevices = getPlayback();
          const recordingDevices = getRecording();
          const res = handler?.getTargetOptions?.({
            sessions,
            playbackDevices,
            recordingDevices,
            controlType: isBindingButton ? "button" : "fader",
            nav: navState,
          });
          sub = (res && typeof res.then === "function") ? (await res) : (res || []);
        } catch {
          sub = [];
        }
        if (!Array.isArray(sub) || sub.length === 0) {
          sub = [{
            label: "No targets yet. Connect in Plugins to load targets.",
            value: "",
            kind: "placeholder",
            ghost: true,
          }];
        }

        const subOptions = sub
          .filter((o) => o && typeof o === "object")
          .map((o) => {
            if (o.nav) {
              return {
                label: o.label || "Open",
                icon_data: o.icon_data || handler?.icon_data || null,
                kind: "integration-nav",
                value: JSON.stringify(o.nav),
                nav: o.nav,
              };
            }
            return {
              label: o.label || "Integration Target",
              icon_data: o.icon_data || handler?.icon_data || null,
              kind: o.kind || "integration-target",
              value: targetKey((o.target?.Integration || o.target?.integration) || {}),
              target: o.target,
            };
          });

        openTargetPanel(
          subOptions,
          null,
          null,
          (opt) => {
            if (opt.kind === "integration-nav") {
              const nextStack = navStack.concat([opt.nav]);
              showIntegrationSubmenu(integrationId, nextStack, opt.nav).catch(() => { });
              return false;
            }

            if (isBindingButton) {
              const actionOptions = [
                { label: "Trigger", value: "Volume", kind: "action" },
                { label: "Toggle Mute", value: "ToggleMute", kind: "action" },
              ];
              setTimeout(() => {
                openTargetPanel(actionOptions, selectedAction, "action", (actionOption) => {
                  selectOption(opt, actionOption.value);
                }, "Select Action");
              }, 10);
              return false;
            }

            selectOption(opt);
            return true;
          },
          handler?.name ? `Select ${handler.name} Target` : "Select Integration Target",
          {
            onBack: () => {
              if (navStack.length === 0) {
                openRootTargetPanel();
                return;
              }
              const nextStack = navStack.slice(0, -1);
              const nextNav = nextStack.length > 0 ? nextStack[nextStack.length - 1] : null;
              showIntegrationSubmenu(integrationId, nextStack, nextNav).catch(() => { });
            },
          },
        );
      };

      openRootTargetPanel();
    });

    container.appendChild(button);
    return container;
  }

  function bindUi() {
    if (d.targetPanel) {
      d.targetPanel.addEventListener("click", (event) => {
        if (event.target === d.targetPanel) {
          closeTargetPanel();
        }
      });
    }
    if (d.targetPanelClose) {
      d.targetPanelClose.addEventListener("click", closeTargetPanel);
    }
  }

  return {
    bindUi,
    closeTargetMenus,
    createTargetIcon,
    openTargetPanel,
    closeTargetPanel,
    buildTargetOptions,
    buildTargetSelect,
  };
}
