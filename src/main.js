import { DEFAULT_SORT_BY_PAGE, UI_STATE_KEY } from "./config/constants.js";
import { APP_VERSION } from "./config/version.js";
import { getElements } from "./core/dom.js";
import { createAutoServerSync } from "./core/auto-server-sync.js";
import { applyAuthCoverImage } from "./core/auth-cover.js";
import { createAuthController } from "./core/auth.js";
import { bindEvents, initializeTheme } from "./core/events.js";
import { createFormController } from "./core/form-controller.js";
import { createRealtimeSync } from "./core/realtime-sync.js";
import { runBrowserSubscriptionNotifications } from "./core/subscription-notifications.js";
import { pullServerData } from "./core/server-sync.js";
import { createStore } from "./core/store.js";
import { createBillExcelController } from "./core/bill-excel-controller.js";
import { createRenderer } from "./views/renderer.js";

function loadUiState() {
  try {
    return JSON.parse(localStorage.getItem(UI_STATE_KEY) || "{}");
  } catch {
    return {};
  }
}

const storedUi = loadUiState();
const activePage = storedUi.activePage || "dashboard";

const app = {
  store: createStore(),
  ui: {
    activePage,
    activeChip: "all",
    searchTerm: storedUi.searchTerm || "",
    sortBy: storedUi.sortBy || DEFAULT_SORT_BY_PAGE[activePage] || "updated-desc",
    filters: {
      type: "all",
      status: "all",
      tag: "all",
      favoriteOnly: false,
    },
  },
};

const elements = getElements();
const renderer = createRenderer(app, elements);
const formController = createFormController(elements);
const authController = createAuthController(elements);
app.authController = authController;
const billExcelController = createBillExcelController(app, renderer);
const autoServerSync = createAutoServerSync(app, authController);
const realtimeSync = createRealtimeSync(app, authController, renderer);
app.autoServerSync = autoServerSync;
app.realtimeSync = realtimeSync;
app.store.setChangeHandler(() => autoServerSync.schedule());

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function pullServerDataAfterLogin() {
  let lastError = null;
  for (const delay of [0, 250, 800]) {
    if (delay) await wait(delay);
    try {
      return await pullServerData();
    } catch (error) {
      lastError = error;
      if (error.status !== 401) throw error;
    }
  }
  throw lastError;
}

window.addEventListener("personalHub:serverLogin", async () => {
  renderer.render();
  try {
    const result = await pullServerDataAfterLogin();
    if (!result.data) {
      realtimeSync.refreshConnection();
      return;
    }
    app.store.importData(result.data);
    renderer.render();
    realtimeSync.refreshConnection();
    console.info(`Personal Hub server data restored: ${result.savedAt || "unknown time"}`);
  } catch (error) {
    if (error.status === 401) {
      console.warn("登录成功，但浏览器尚未带上服务器会话 Cookie，已跳过自动恢复。");
      return;
    }
    window.alert(error.message || "登录成功，但自动读取服务器数据失败。");
  }
});

window.addEventListener("personalHub:serverLogout", () => {
  realtimeSync.disconnect();
});

const versionBadge = document.querySelector("#appVersionBadge");
if (versionBadge) {
  versionBadge.textContent = `v${APP_VERSION}`;
}

document.body.classList.add("app-ready");
applyAuthCoverImage();
initializeTheme();
bindEvents(app, elements, renderer, formController, authController, billExcelController);
renderer.render();
runBrowserSubscriptionNotifications(app.store.getSubscriptionsOverview().items);

authController.refreshServerSession({ silent: true }).then(async (isAuthenticated) => {
  if (!isAuthenticated || !authController.isServerAuthenticated) return;
  try {
    const result = await pullServerData();
    if (!result.data) {
      return;
    }
    app.store.importData(result.data);
    renderer.render();
    realtimeSync.refreshConnection();
    console.info(`Personal Hub server data restored on startup: ${result.savedAt || "unknown time"}`);
  } catch (error) {
    console.warn(error.message || "Failed to restore server data on startup.");
  }
});
