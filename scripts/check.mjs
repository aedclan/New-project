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
  "src/vendor/xlsx.full.min.js",
  "src/views/renderer.js",
  "EMAIL_NOTIFICATION_SETUP.md",
];
const missing = requiredFiles.filter((file) => !existsSync(file));

if (missing.length > 0) {
  console.error(`Missing required files: ${missing.join(", ")}`);
  process.exit(1);
}

const html = readFileSync("index.html", "utf8");
const requiredSnippets = [
  '<link rel="stylesheet" href="styles.css" />',
  '<script type="module" src="src/main.js"></script>',
  '<nav class="nav-list" id="navList"></nav>',
];

const missingSnippets = requiredSnippets.filter((snippet) => !html.includes(snippet));
if (missingSnippets.length > 0) {
  console.error(`index.html is missing expected snippets:\n${missingSnippets.join("\n")}`);
  process.exit(1);
}

const renderer = readFileSync("src/views/renderer.js", "utf8");
const requiredRendererSnippets = [
  "function renderDashboard",
  "function renderBills",
  "function renderSubscriptions",
  "function renderFavors",
  "function renderNotes",
  "财务 Excel 管理",
  "downloadBillExcelTemplate",
  "exportFinanceExcel",
  "importBillExcelButton",
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
];
const missingSubscriptionEnhancements = subscriptionEnhancementSnippets.filter(
  (snippet) => !store.includes(snippet) && !events.includes(snippet) && !renderer.includes(snippet) && !styles.includes(snippet) && !readFileSync("scripts/dev-server.mjs", "utf8").includes(snippet),
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
const missingBookmarkSnippets = bookmarkSnippets.filter(
  (snippet) => !store.includes(snippet) && !events.includes(snippet) && !renderer.includes(snippet) && !html.includes(snippet),
);
if (missingBookmarkSnippets.length > 0) {
  console.error(`Bookmark runtime hooks are missing:\n${missingBookmarkSnippets.join("\n")}`);
  process.exit(1);
}

const mojibakeSamples = [
  "\uFFFD",
  "\u934F",
  "\u93C0\u60F0\u68CC",
  "\u7ED7\u65C7\uE187",
  "\u940F\u57AB\u5285",
  "\u95BE\u70AC\u5E34",
  "\u7F03\uE1C0\u300A",
  "\u5BB8\u63D2\u756C\u93B4",
  "\u5BF0\u546D\uE629\u941E",
  "\u6769\u6D9C\uE511\u6D93",
];
const suspiciousTextPatterns = mojibakeSamples.map((sample) => new RegExp(sample));
for (const file of textFiles) {
  const content = readFileSync(file, "utf8");
  if (suspiciousTextPatterns.some((pattern) => pattern.test(content))) {
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
