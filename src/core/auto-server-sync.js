import { loadServerSyncState, pushServerData } from "./server-sync.js";

export function createAutoServerSync(app, authController) {
  let timer = null;
  let running = false;
  let queued = false;
  let lastError = "";

  async function pushNow() {
    const syncState = loadServerSyncState();
    const canUseServerAuth = Boolean(authController.isServerAuthenticated);
    if (!syncState.autoEnabled || (!syncState.hasToken && !canUseServerAuth) || !authController.isAuthenticated) return false;

    if (running) {
      queued = true;
      return false;
    }

    running = true;
    try {
      await pushServerData(app.store.exportData());
      lastError = "";
      return true;
    } catch (error) {
      lastError = error.message || "自动同步失败";
      console.warn(lastError);
      return false;
    } finally {
      running = false;
      if (queued) {
        queued = false;
        schedule();
      }
    }
  }

  function schedule(delay = 900) {
    window.clearTimeout(timer);
    timer = window.setTimeout(pushNow, delay);
  }

  return {
    schedule,
    pushNow,
    getLastError() {
      return lastError;
    },
  };
}
