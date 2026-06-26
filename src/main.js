import { DEFAULT_SORT_BY_PAGE, UI_STATE_KEY } from "./config/constants.js";
import { APP_VERSION } from "./config/version.js";
import { getElements } from "./core/dom.js";
import { createAutoServerSync } from "./core/auto-server-sync.js";
import { createAuthController } from "./core/auth.js";
import { bindEvents, initializeTheme } from "./core/events.js";
import { createFormController } from "./core/form-controller.js";
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
const billExcelController = createBillExcelController(app, renderer);
const autoServerSync = createAutoServerSync(app, authController);
app.autoServerSync = autoServerSync;
app.store.setChangeHandler(() => autoServerSync.schedule());

window.addEventListener("personalHub:serverLogin", async () => {
  try {
    const result = await pullServerData();
    if (!result.data) return;
    app.store.importData(result.data);
    renderer.render();
    console.info(`Personal Hub server data restored: ${result.savedAt || "unknown time"}`);
  } catch (error) {
    window.alert(error.message || "登录成功，但自动读取服务器数据失败。");
  }
});

const versionBadge = document.querySelector("#appVersionBadge");
if (versionBadge) {
  versionBadge.textContent = `v${APP_VERSION}`;
}

document.body.classList.add("app-ready");
initializeTheme();
bindEvents(app, elements, renderer, formController, authController, billExcelController);
renderer.render();
runBrowserSubscriptionNotifications(app.store.getSubscriptionsOverview().items);

authController.refreshServerSession({ silent: true }).then(async (isAuthenticated) => {
  if (!isAuthenticated || !authController.isServerAuthenticated) return;
  try {
    const result = await pullServerData();
    if (!result.data) return;
    app.store.importData(result.data);
    renderer.render();
    console.info(`Personal Hub server data restored on startup: ${result.savedAt || "unknown time"}`);
  } catch (error) {
    console.warn(error.message || "Failed to restore server data on startup.");
  }
});
