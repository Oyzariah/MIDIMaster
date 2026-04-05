export function createAlertsController({
  alertOverlay,
  alertTitle,
  alertMessage,
  alertClose,
  alertCancel,
  alertOk,
}) {
  let pendingConfirmResolve = null;

  function resolveConfirm(value) {
    if (!pendingConfirmResolve) return;
    const resolve = pendingConfirmResolve;
    pendingConfirmResolve = null;
    resolve(Boolean(value));
  }

  function setActionsMode({
    confirm = false,
    confirmLabel = "OK",
    cancelLabel = "Cancel",
  } = {}) {
    if (!alertOk) return;
    alertOk.textContent = confirmLabel;
    if (alertCancel) {
      alertCancel.textContent = cancelLabel;
      alertCancel.classList.toggle("hidden", !confirm);
    }
  }

  function showAlert(message, title = "Alert") {
    if (!alertOverlay || !alertMessage) {
      return;
    }
    resolveConfirm(false);
    if (alertTitle) {
      alertTitle.textContent = title;
    }
    setActionsMode({ confirm: false, confirmLabel: "OK" });
    alertMessage.textContent = message;
    alertOverlay.classList.remove("hidden");
  }

  function showConfirm({
    title = "Confirm",
    message = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
  } = {}) {
    if (!alertOverlay || !alertMessage) {
      return Promise.resolve(false);
    }
    resolveConfirm(false);
    if (alertTitle) {
      alertTitle.textContent = title;
    }
    setActionsMode({ confirm: true, confirmLabel, cancelLabel });
    alertMessage.textContent = message;
    alertOverlay.classList.remove("hidden");
    return new Promise((resolve) => {
      pendingConfirmResolve = resolve;
    });
  }

  function closeAlert() {
    resolveConfirm(false);
    if (alertOverlay) {
      alertOverlay.classList.add("hidden");
    }
    setActionsMode({ confirm: false, confirmLabel: "OK" });
  }

  function bindUi() {
    if (alertClose) {
      alertClose.addEventListener("click", closeAlert);
    }

    if (alertCancel) {
      alertCancel.addEventListener("click", closeAlert);
    }

    if (alertOk) {
      alertOk.addEventListener("click", () => {
        if (pendingConfirmResolve) {
          resolveConfirm(true);
          if (alertOverlay) {
            alertOverlay.classList.add("hidden");
          }
          setActionsMode({ confirm: false, confirmLabel: "OK" });
          return;
        }
        closeAlert();
      });
    }

    if (alertOverlay) {
      alertOverlay.addEventListener("click", (event) => {
        if (event.target === alertOverlay) {
          closeAlert();
        }
      });
    }
  }

  return {
    showAlert,
    showConfirm,
    closeAlert,
    bindUi,
  };
}
