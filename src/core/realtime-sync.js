import { pullServerData } from "./server-sync.js";

export function createRealtimeSync(app, authController, renderer) {
  let source = null;
  let pulling = false;
  let lastAppliedAt = "";

  async function applyServerData(reason = "event") {
    if (!authController.isServerAuthenticated || pulling) return false;
    pulling = true;
    try {
      const result = await pullServerData();
      if (!result.data) return false;
      if (result.savedAt && result.savedAt === lastAppliedAt) return false;
      app.store.importData(result.data);
      lastAppliedAt = result.savedAt || new Date().toISOString();
      renderer.render();
      console.info(`Personal Hub realtime sync applied: ${reason} ${lastAppliedAt}`);
      return true;
    } catch (error) {
      console.warn(error.message || "实时同步读取服务器数据失败");
      return false;
    } finally {
      pulling = false;
    }
  }

  function disconnect() {
    if (source) {
      source.close();
      source = null;
    }
  }

  function connect() {
    if (!authController.isServerAuthenticated || source) return;
    source = new EventSource("/api/data/events");
    source.addEventListener("data-updated", (event) => {
      let payload = {};
      try {
        payload = JSON.parse(event.data || "{}");
      } catch {
        payload = {};
      }
      if (payload.savedAt && payload.savedAt === lastAppliedAt) return;
      applyServerData("data-updated");
    });
    source.onerror = () => {
      disconnect();
      window.setTimeout(connect, 3000);
    };
  }

  function refreshConnection() {
    if (!authController.isServerAuthenticated) {
      disconnect();
      return;
    }
    connect();
  }

  return {
    applyServerData,
    connect,
    disconnect,
    refreshConnection,
  };
}
