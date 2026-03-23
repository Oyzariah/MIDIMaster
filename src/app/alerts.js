export function createAlertsController({
  alertOverlay,
  alertTitle,
  alertMessage,
  alertClose,
  alertOk,
}) {
  function showAlert(message, title = "Alert") {
    if (!alertOverlay || !alertMessage) {
      return;
    }
    if (alertTitle) {
      alertTitle.textContent = title;
    }
    alertMessage.textContent = message;
    alertOverlay.classList.remove("hidden");
  }

  function closeAlert() {
    if (alertOverlay) {
      alertOverlay.classList.add("hidden");
    }
  }

  function bindUi() {
    if (alertClose) {
      alertClose.addEventListener("click", closeAlert);
    }

    if (alertOk) {
      alertOk.addEventListener("click", closeAlert);
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
    closeAlert,
    bindUi,
  };
}
