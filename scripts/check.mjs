import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function collectJavaScriptFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const filePath = join(directory, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      return collectJavaScriptFiles(filePath);
    }
    return filePath.endsWith(".js") || filePath.endsWith(".mjs") ? [filePath] : [];
  });
}

const files = [...collectJavaScriptFiles("src"), ...collectJavaScriptFiles("scripts")];
const textFiles = [
  ...files.filter(
    (file) =>
      !file.endsWith("scripts/check.mjs") &&
      !file.endsWith("scripts\\check.mjs") &&
      !file.includes("src/vendor/") &&
      !file.includes("src\\vendor\\"),
  ),
  "index.html",
  "styles.css",
  "package.json",
  "src/config/version.js",
  ...readdirSync(".").filter((file) => file.endsWith(".md")),
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

const requiredFiles = [
  "index.html",
  "styles.css",
  "src/main.js",
  "src/core/store.js",
  "src/core/bill-excel-controller.js",
  "src/core/subscription-notifications.js",
  "src/core/server-sync.js",
  "src/core/auto-server-sync.js",
  "src/vendor/xlsx.full.min.js",
  "src/views/renderer.js",
  "scripts/persistent-data-service.mjs",
  "scripts/backup-persistent-data.mjs",
  "scripts/restore-persistent-data.mjs",
  "scripts/check-production-env.mjs",
  "scripts/scheduled-backup-service.mjs",
  "scripts/auth-service.mjs",
  "scripts/deploy-vps.sh",
  "scripts/rollback-vps.sh",
  "EMAIL_NOTIFICATION_SETUP.md",
  "SERVER_SYNC_AND_BACKUP.md",
  "DATA_SECURITY_AND_DEPLOYMENT.md",
];
const missing = requiredFiles.filter((file) => !existsSync(file));

if (missing.length > 0) {
  console.error(`Missing required files: ${missing.join(", ")}`);
  process.exit(1);
}

const html = readFileSync("index.html", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageText = readFileSync("package.json", "utf8");
const versionFile = readFileSync("src/config/version.js", "utf8");
const versionMatch = versionFile.match(/APP_VERSION\s*=\s*"([^"]+)"/);
if (!versionMatch) {
  console.error("src/config/version.js is missing APP_VERSION.");
  process.exit(1);
}
if (packageJson.version !== versionMatch[1]) {
  console.error(`Version mismatch: package.json has ${packageJson.version}, APP_VERSION has ${versionMatch[1]}.`);
  process.exit(1);
}

const requiredSnippets = [
  '<link rel="stylesheet" href="styles.css" />',
  '<script type="module" src="src/main.js"></script>',
  '<nav class="nav-list" id="navList"></nav>',
  'class="account-version-badge" id="appVersionBadge"',
  '<title>个人工作台</title>',
  'placeholder="搜索事项、账单、笔记、项目集..."',
];

const missingSnippets = requiredSnippets.filter((snippet) => !html.includes(snippet));
if (missingSnippets.length > 0) {
  console.error(`index.html is missing expected snippets:\n${missingSnippets.join("\n")}`);
  process.exit(1);
}

const removedStartupSnippets = [
  "startupNotice",
  "startup-notice",
  "页面尚未完成初始化",
  "不要直接双击",
];
const remainingStartupSnippets = removedStartupSnippets.filter((snippet) => html.includes(snippet));
if (remainingStartupSnippets.length > 0) {
  console.error(`Startup overlay residue detected in index.html:\n${remainingStartupSnippets.join("\n")}`);
  process.exit(1);
}

const renderer = readFileSync("src/views/renderer.js", "utf8");
const constants = readFileSync("src/config/constants.js", "utf8");
const serverSync = readFileSync("src/core/server-sync.js", "utf8");
const autoServerSync = readFileSync("src/core/auto-server-sync.js", "utf8");
const realtimeSync = readFileSync("src/core/realtime-sync.js", "utf8");
const devServer = readFileSync("scripts/dev-server.mjs", "utf8");
const persistentDataService = readFileSync("scripts/persistent-data-service.mjs", "utf8");
const backupDataScript = readFileSync("scripts/backup-persistent-data.mjs", "utf8");
const restoreDataScript = readFileSync("scripts/restore-persistent-data.mjs", "utf8");
const productionEnvScript = readFileSync("scripts/check-production-env.mjs", "utf8");
const authService = readFileSync("scripts/auth-service.mjs", "utf8");
const compose = readFileSync("docker-compose.yml", "utf8");
const serverSyncDoc = readFileSync("SERVER_SYNC_AND_BACKUP.md", "utf8");
const securityDeployDoc = readFileSync("DATA_SECURITY_AND_DEPLOYMENT.md", "utf8");
const requiredRendererSnippets = [
  "function renderDashboard",
  "function renderBills",
  "function billScopeOverviewPanel",
  "function billImportReviewPanel",
  "function payerBalancePanel",
  "function mortgageDetailList",
  "bill-source",
  "bill-payer",
  "bill-fixed",
  "账单明细",
  "导入后复核",
  "function renderSubscriptions",
  "function renderFavors",
  "function renderNotes",
  "财务 Excel 管理",
  "downloadBillExcelTemplate",
  "exportFinanceExcel",
  "importBillExcelButton",
  "financeImportSource",
  "financeImportPayer",
  "本次导入来源",
  "bookmarkForm",
  "外部资料收藏",
  "kanban-board",
  "subscriptions: () => renderSubscriptions",
  "favors: () => renderFavors",
  "favor-entry-section",
  "relationship-ledger-grid",
  "favor-ledger-list",
  "relationshipLedgerRow",
  "isOverdue",
  "bills: () => renderBills",
  "月度与累计对照",
  "承担结构",
  "房贷明细",
  "最大固定项",
];
const missingRendererSnippets = requiredRendererSnippets.filter((snippet) => !renderer.includes(snippet));
if (missingRendererSnippets.length > 0) {
  console.error(`renderer.js is missing expected runtime hooks:\n${missingRendererSnippets.join("\n")}`);
  process.exit(1);
}

const excelController = readFileSync("src/core/bill-excel-controller.js", "utf8");
const requiredExcelSnippets = [
  "财务数据导入模板.xlsx",
  "财务数据导出-",
  "parseBillRows",
  "importFile",
  "exportFinanceWorkbook",
  "downloadTemplate",
  "defaultSource",
  "shouldSkipBillRow",
  "buildBillTitle",
  "交易关闭",
  "支付失败",
  "summarizeImportedBills",
  "summarizeBillMonths",
  "summarizeImportOptions",
  "失败 / 跳过明细",
  "订阅项目",
  "SUBSCRIPTION_HEADERS",
];
const missingExcelSnippets = requiredExcelSnippets.filter((snippet) => !excelController.includes(snippet));
if (missingExcelSnippets.length > 0) {
  console.error(`bill-excel-controller.js is missing expected hooks:\n${missingExcelSnippets.join("\n")}`);
  process.exit(1);
}

const store = readFileSync("src/core/store.js", "utf8");
const events = readFileSync("src/core/events.js", "utf8");
const styles = readFileSync("styles.css", "utf8");
const taskRuntimeSnippets = [
  "batchUpdateTasks",
  "data-complete",
];
const missingTaskRuntimeSnippets = taskRuntimeSnippets.filter((snippet) => !store.includes(snippet) && !events.includes(snippet) && !renderer.includes(snippet));
if (missingTaskRuntimeSnippets.length > 0) {
  console.error(`Task enhancement hooks are missing:\n${missingTaskRuntimeSnippets.join("\n")}`);
  process.exit(1);
}

const templates = readFileSync("src/views/templates.js", "utf8");
const removedTaskCheckboxSnippets = ["task-select", 'name="taskIds"', 'input[name="taskIds"]', "taskBatchForm", "batchTaskStatus"];
const remainingTaskCheckboxSnippets = removedTaskCheckboxSnippets.filter((snippet) =>
  [templates, renderer, events, styles].some((fileContent) => fileContent.includes(snippet)),
);
if (remainingTaskCheckboxSnippets.length > 0) {
  console.error(`Removed task checkbox UI is still referenced:\n${remainingTaskCheckboxSnippets.join("\n")}`);
  process.exit(1);
}

const bookmarkSnippets = [
  "addBookmark",
  "exportData",
  "bookmarkForm",
];

const subscriptionEnhancementSnippets = [
  "usageFrequency",
  "necessity",
  "satisfaction",
  "lastUsedAt",
  "estimatedAnnualCost",
  "categoryTotals",
  "subscription-card",
  "createBillFromSubscription",
  "renewSubscription",
  "updateSubscriptionStatus",
  "data-subscription-bill",
  "data-subscription-renew",
  "data-subscription-status",
  "lastBillDate",
  "lastRenewedAt",
  "runBrowserSubscriptionNotifications",
  "subscriptionNotificationForm",
  "requestBrowserNotification",
  "testSubscriptionEmail",
  "scanSubscriptionEmail",
  "/api/subscription-email/test",
  "sendSubscriptionScanEmails",
  "reviewSubscription",
  "data-subscription-review",
  "reviewQueue",
  "订阅复盘队列",
  "nextReviewDate",
  "renderSubscriptionForm",
  "subscription-workbench",
  "subscription-entry-panel",
  "subscriptionCompactRow",
  "subscription-row",
  "tag-danger",
  "subscription-entry-details",
  "subscription-stats-grid",
  "subscription-due-panel",
  "subscription-due-list",
  "ownerTotals",
  "paymentTotals",
  "manualRenewing",
  "subscription-maturity-panel",
  "subscription-distribution-grid",
  "subscriptionDistributionRows",
  "paymentMethod",
  "owner",
];
const missingSubscriptionEnhancements = subscriptionEnhancementSnippets.filter(
  (snippet) => !store.includes(snippet) && !events.includes(snippet) && !renderer.includes(snippet) && !styles.includes(snippet) && !devServer.includes(snippet),
);
if (missingSubscriptionEnhancements.length > 0) {
  console.error(`Subscription enhancements are missing:\n${missingSubscriptionEnhancements.join("\n")}`);
  process.exit(1);
}

const removedSubscriptionPanelSnippets = ["subscriptionBudgetForm", "订阅预算", "可优化订阅", "未来扣费预测", "30 天扣费"];
const remainingSubscriptionPanelSnippets = removedSubscriptionPanelSnippets.filter((snippet) => renderer.includes(snippet));
if (remainingSubscriptionPanelSnippets.length > 0) {
  console.error(`Removed subscription panels are still rendered:\n${remainingSubscriptionPanelSnippets.join("\n")}`);
  process.exit(1);
}

const removedSubscriptionFilterSnippets = ["subscription:urgent", "subscription:upcoming", "subscription:auto", "subscription:high-cost", "subscription:cancellable"];
const remainingSubscriptionFilterSnippets = removedSubscriptionFilterSnippets.filter((snippet) => renderer.includes(snippet));
if (remainingSubscriptionFilterSnippets.length > 0) {
  console.error(`Removed subscription quick filters are still rendered:\n${remainingSubscriptionFilterSnippets.join("\n")}`);
  process.exit(1);
}

if (renderer.includes('renderControls(elements, data, ui, "subscriptions")')) {
  console.error("Subscriptions page should not render the toolbar controls.");
  process.exit(1);
}

const serverSyncSnippets = [
  "SERVER_SYNC_TOKEN_KEY",
  "loadServerSyncState",
  "checkServerSyncStatus",
  "pushServerData",
  "pullServerData",
  "server-sync-panel",
  "server-sync-grid--compact",
  "checkServerSyncStatus",
  "pushServerData",
  "pullServerData",
  "handlePersistentDataRequest",
  "/api/data/status",
  "/api/data/events",
  "/api/data",
  "PERSONAL_HUB_SYNC_TOKEN",
  "PERSONAL_HUB_DATA_FILE",
  "PERSONAL_HUB_BACKUP_DIR",
  "PERSONAL_HUB_BACKUP_KEEP",
  "PERSONAL_HUB_BACKUP_AUTO_ENABLED",
  "PERSONAL_HUB_BACKUP_INTERVAL_HOURS",
  "PERSONAL_HUB_BACKUP_ON_START",
  "PERSONAL_HUB_AUTH_DB_FILE",
  "personal-hub-data:/app/data",
  "personal-hub-data:",
  "importData(payload)",
  "backup:data",
  "backup:list",
  "restore:data",
  "check:production",
  "createPersistentDataBackup",
  "restore-persistent-data.mjs",
  "check-production-env.mjs",
  "deploy-vps.sh",
  "rollback-vps.sh",
  "startScheduledBackups",
  "scheduled-backup-service.mjs",
  "SERVER_SYNC_AUTO_KEY",
  "SERVER_SYNC_LAST_PUSH_KEY",
  "createAutoServerSync",
  "createRealtimeSync",
  "EventSource",
  "data-updated",
  "mergeHubData",
  "summarizeHubData",
  "formatHubDataSummary",
  "exportServerBackup",
];
const missingServerSyncSnippets = serverSyncSnippets.filter(
  (snippet) =>
    !constants.includes(snippet) &&
    !serverSync.includes(snippet) &&
    !autoServerSync.includes(snippet) &&
    !realtimeSync.includes(snippet) &&
    !events.includes(snippet) &&
    !renderer.includes(snippet) &&
    !styles.includes(snippet) &&
    !store.includes(snippet) &&
    !devServer.includes(snippet) &&
    !persistentDataService.includes(snippet) &&
    !backupDataScript.includes(snippet) &&
    !restoreDataScript.includes(snippet) &&
    !productionEnvScript.includes(snippet) &&
    !authService.includes(snippet) &&
    !compose.includes(snippet) &&
    !packageText.includes(snippet) &&
    !serverSyncDoc.includes(snippet) &&
    !securityDeployDoc.includes(snippet),
);
if (missingServerSyncSnippets.length > 0) {
  console.error(`Server sync hooks are missing:\n${missingServerSyncSnippets.join("\n")}`);
  process.exit(1);
}

const authSnippets = [
  "node:sqlite",
  "DatabaseSync",
  "/api/auth/session",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/users",
  "/api/auth/logout",
  "PERSONAL_HUB_AUTH_DB_FILE",
  "PERSONAL_HUB_ADMIN_USERNAME",
  "PERSONAL_HUB_ADMIN_PASSWORD",
  "PERSONAL_HUB_SESSION_MAX_AGE",
  "PERSONAL_HUB_REGISTRATION_ENABLED",
  "PERSONAL_HUB_REGISTRATION_CODE",
  "personal_hub_session",
  "checkServerSession",
  "loginServer",
  "registerServer",
  "listServerUsers",
  "updateServerUserStatus",
  "resetServerUserPassword",
  "migrateServerUserData",
  "data-user-migrate-legacy",
  "legacyData",
  "logoutServer",
  "serverConfigured",
  "registrationEnabled",
  "auth-mode-switch",
  "userDataFilePath",
  "openUserManagement",
  "user-management-modal",
];
const missingAuthSnippets = authSnippets.filter(
  (snippet) =>
    !authService.includes(snippet) &&
    !devServer.includes(snippet) &&
    !compose.includes(snippet) &&
    !html.includes(snippet) &&
    !persistentDataService.includes(snippet) &&
    !serverSyncDoc.includes(snippet) &&
    !readFileSync("src/core/server-auth.js", "utf8").includes(snippet) &&
    !events.includes(snippet) &&
    !readFileSync("src/core/auth.js", "utf8").includes(snippet),
);
if (missingAuthSnippets.length > 0) {
  console.error(`Server auth hooks are missing:\n${missingAuthSnippets.join("\n")}`);
  process.exit(1);
}
const missingBookmarkSnippets = bookmarkSnippets.filter(
  (snippet) => !store.includes(snippet) && !events.includes(snippet) && !renderer.includes(snippet) && !html.includes(snippet),
);
if (missingBookmarkSnippets.length > 0) {
  console.error(`Bookmark runtime hooks are missing:\n${missingBookmarkSnippets.join("\n")}`);
  process.exit(1);
}

const mojibakeSamples = [
  "\uFFFD",
  "涓",
  "涓诲",
  "鎼滅储",
  "鐧诲",
  "鏂板",
  "璐﹀",
  "绫诲",
  "鎬昏",
  "椤圭",
  "鍏抽",
  "寰呭",
  "杩涜",
  "宸插",
  "鏀",
  "鏀跺",
  "瀵煎",
  "€?",
];
for (const file of textFiles) {
  const content = readFileSync(file, "utf8");
  if (mojibakeSamples.some((sample) => content.includes(sample))) {
    console.error(`Potential mojibake detected in ${file}`);
    process.exit(1);
  }
}

const disallowedHtmlSnippets = [
  '<option value="portfolio">',
  'data-section="portfolio"',
  'placeholder="搜索作品',
  'id="musicUrl"',
  'id="musicAddUrl"',
  'id="neteasePlayer"',
  'id="neteasePlaylistId"',
  'id="neteaseFullPlaylist"',
  "打开完整歌单",
];

const unexpectedHtmlSnippets = disallowedHtmlSnippets.filter((snippet) => html.includes(snippet));
if (unexpectedHtmlSnippets.length > 0) {
  console.error(`index.html still contains removed portfolio UI:\n${unexpectedHtmlSnippets.join("\n")}`);
  process.exit(1);
}

const disallowedRendererSnippets = [
  "portfolio: { label:",
  "function renderPortfolio",
  'data-page-jump="portfolio"',
  "overview.portfolio",
  "overview.photos",
  "portfolio: () => renderPortfolio",
  "relationshipGroupCard",
  "getRelationshipGroupStats",
  "关系组",
  "exportBillExcel",
  "exportFavorExcel",
];

const unexpectedRendererSnippets = disallowedRendererSnippets.filter((snippet) => renderer.includes(snippet));
if (unexpectedRendererSnippets.length > 0) {
  console.error(`renderer.js still contains removed portfolio runtime hooks:\n${unexpectedRendererSnippets.join("\n")}`);
  process.exit(1);
}

const disallowedRelationshipSnippets = ["addRelationshipGroup", "getRelationshipGroupStats", "relationshipGroupCard", "关系组"];
const relationshipResidue = disallowedRelationshipSnippets.filter((snippet) => store.includes(snippet) || renderer.includes(snippet));
if (relationshipResidue.length > 0) {
  console.error(`Relationship group residue detected:\n${relationshipResidue.join("\n")}`);
  process.exit(1);
}

const deprecatedFavorFieldSnippets = ["newContactCloseness", "亲密度", "亲疏程度"];
const favorFieldResidue = deprecatedFavorFieldSnippets.filter((snippet) =>
  [renderer, events, templates, readFileSync("src/data/default-data.js", "utf8")].some((content) => content.includes(snippet)),
);
if (favorFieldResidue.length > 0) {
  console.error(`Deprecated favor field residue detected:\n${favorFieldResidue.join("\n")}`);
  process.exit(1);
}

const disallowedMusicAndExportSnippets = [
  "musicPlayer",
  "musicPanel",
  "musicPlaylistToggle",
  "musicProgress",
  "musicTrackSelect",
  "musicLocalTrackForm",
  "floating-music",
  "createMusicController",
  "music-controller",
  "new Audio",
  "musicUrl",
  "musicAddUrl",
  "addExternalTrack",
  "MUSIC_PLAYLIST_KEY",
  "NETEASE_PLAYLIST_KEY",
  "neteasePlayer",
  "buildPlaylistUrl",
  "exportBills",
  "exportFavors",
];
const main = readFileSync("src/main.js", "utf8");
const musicAndExportResidue = disallowedMusicAndExportSnippets.filter(
  (snippet) => html.includes(snippet) || main.includes(snippet) || renderer.includes(snippet) || events.includes(snippet) || excelController.includes(snippet) || styles.includes(snippet),
);
if (musicAndExportResidue.length > 0) {
  console.error(`Old music or separated export residue detected:\n${musicAndExportResidue.join("\n")}`);
  process.exit(1);
}

const disallowedSortSnippets = ['id="sortSelect"', "sortSelect", "排序"];
const sortResidue = disallowedSortSnippets.filter((snippet) => renderer.includes(snippet) || events.includes(snippet));
if (sortResidue.length > 0) {
  console.error(`Sort controls should be removed:\n${sortResidue.join("\n")}`);
  process.exit(1);
}

console.log("Project check passed.");
