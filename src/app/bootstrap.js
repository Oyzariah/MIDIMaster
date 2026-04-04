export function createTauriBridge() {
  let coreApi = null;
  let eventApi = null;

  const invoke = async (...args) => {
    if (coreApi?.invoke) {
      return coreApi.invoke(...args);
    }
    throw new Error("Tauri API missing");
  };

  const listen = async (event, handler) => {
    if (eventApi?.listen) {
      return eventApi.listen(event, handler);
    }
    console.warn("Tauri Event API missing/delayed for listener:", event);
    return () => { };
  };

  const bind = () => {
    coreApi = window.__TAURI__?.core ?? null;
    eventApi = window.__TAURI__?.event ?? null;
    return Boolean(coreApi?.invoke && eventApi?.listen);
  };

  return {
    invoke,
    listen,
    bind,
  };
}

export function scheduleRetry(fn, delayMs = 200) {
  setTimeout(fn, delayMs);
}
