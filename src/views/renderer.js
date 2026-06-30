import { escapeHtml, excerptText, formatCurrency, renderMarkdown } from "../core/utils.js";
import {
  getSubscriptionReminderSummary,
  groupSubscriptionReminders,
  loadSubscriptionNotificationSettings,
} from "../core/subscription-notifications.js";
import { loadAuthCoverImage, loadAuthCoverImages } from "../core/auth-cover.js";
import { loadServerSyncState } from "../core/server-sync.js";
import { getPinyinSearchText } from "../core/utils.js";
import { navItems } from "../data/nav-items.js";
import {
  billRow,
  budgetProgressCard,
  emptyState,
  recentViewRow,
  searchResultCard,
  statCard,
  subscriptionCard,
  taskRow,
} from "./templates.js";

const mobileIds = ["dashboard", "tasks", "bills", "subscriptions", "favors"];

const favorRelationTypes = ["亲戚", "朋友", "同事", "同学", "邻里", "合作", "其他"];
const favorEventTypes = ["婚礼", "满月", "生日", "乔迁", "节日", "升学", "探病", "其他"];

const typeMeta = {
  tasks: { label: "事项", eyebrow: "Tasks" },
  bills: { label: "生活收支", eyebrow: "Daily Bills" },
};

const pageSortOptions = {
  dashboard: [
    { value: "updated-desc", label: "最近更新" },
    { value: "title-asc", label: "按标题" },
  ],
  tasks: [
    { value: "updated-desc", label: "最近更新" },
    { value: "due-asc", label: "截止日期" },
    { value: "priority-desc", label: "优先级" },
    { value: "title-asc", label: "按标题" },
  ],
  bills: [
    { value: "date-desc", label: "最新账单" },
    { value: "amount-desc", label: "金额从高到低" },
    { value: "amount-asc", label: "金额从低到高" },
    { value: "title-asc", label: "按标题" },
  ],
  subscriptions: [
    { value: "date-asc", label: "到期从近到远" },
    { value: "amount-desc", label: "金额从高到低" },
    { value: "amount-asc", label: "金额从低到高" },
    { value: "title-asc", label: "按名称" },
  ],
  favors: [
    { value: "date-desc", label: "最新往来" },
    { value: "amount-desc", label: "金额从高到低" },
    { value: "amount-asc", label: "金额从低到高" },
    { value: "title-asc", label: "按标题" },
  ],
  favorites: [
    { value: "updated-desc", label: "最近更新" },
    { value: "title-asc", label: "按标题" },
  ],
  settings: [{ value: "updated-desc", label: "最近更新" }],
  search: [
    { value: "updated-desc", label: "最近更新" },
    { value: "title-asc", label: "按标题" },
    { value: "type-asc", label: "按模块" },
  ],
};

const priorityWeight = {
  高: 3,
  中: 2,
  低: 1,
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAllItems(data) {
  return Object.entries(data)
    .filter(([entryType, items]) => Array.isArray(items) && typeMeta[entryType])
    .flatMap(([entryType, items]) => items.map((item) => ({ ...item, entryType })));
}

function getSearchText(item) {
  return [
    item.title,
    item.name,
    item.description,
    item.note,
    item.content,
    item.category,
    item.status,
    item.type,
    item.priority,
    item.projectId,
    item.role,
    item.result,
    item.visibility,
    item.date,
    item.dueDate,
    item.nextRenewalDate,
    item.usageFrequency,
    item.necessity,
    item.satisfaction,
    item.lastUsedAt,
    item.advice?.label,
    item.advice?.reason,
    item.url,
    item.sourceUrl,
    ...(item.tags || []),
    ...(item.techStack || []),
    ...(item.process || []),
  ]
    .filter(Boolean)
    .join(" ");
}

function matchesSearchTerm(item, searchTerm) {
  if (!searchTerm) return true;
  return normalize(getSearchText(item)).includes(normalize(searchTerm));
}

function matchesFilterToken(item, entryType, token) {
  if (!token || token === "all") return true;
  if (token === "favorite") return Boolean(item.isFavorite);
  if (token === "pinned") return Boolean(item.pinned);

  const [kind, ...rest] = token.split(":");
  const value = rest.join(":");

  switch (kind) {
    case "status":
      return item.status === value;
    case "task":
      if (value === "today") return isDueToday(item);
      if (value === "overdue") return isOverdue(item);
      return true;
    case "category":
      return item.category === value;
    case "tag":
      return (item.tags || []).includes(value);
    case "note-type":
      return item.noteType === value;
    case "entry-type":
      return entryType === value;
    case "bill-type":
      return item.type === value;
    case "bill-source":
      return (item.source || "未指定") === value;
    case "bill-payer":
      return (item.payer || "未指定") === value;
    case "bill-fixed":
      if (value === "any") return Boolean(getBillFixedType(item));
      return getBillFixedType(item) === value;
    case "bill-family":
      if (value === "children") return ["大宝", "二宝"].includes(item.familyMember) || item.payer === "孩子相关";
      return (item.familyMember || "未指定") === value;
    case "subscription":
      if (value === "urgent") return item.level === "urgent" || item.level === "expired";
      if (value === "upcoming") return item.daysUntilRenewal !== null && item.daysUntilRenewal >= 0 && item.daysUntilRenewal <= 30;
      if (value === "auto") return Boolean(item.autoRenew);
      if (value === "high-cost") return Number(item.monthlyCost || 0) >= 100;
      if (value === "cancellable") return item.advice?.level === "danger" || item.advice?.label?.includes("取消");
      return true;
    default:
      return true;
  }
}

function compareBySort(a, b, sortBy) {
  switch (sortBy) {
    case "title-asc":
      return String(a.title || a.name || "").localeCompare(String(b.title || b.name || ""), "zh-CN");
    case "date-asc":
      return String(a.date || a.nextRenewalDate || "9999-12-31").localeCompare(String(b.date || b.nextRenewalDate || "9999-12-31"));
    case "due-asc":
      return String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31"));
    case "priority-desc":
      return (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
    case "amount-desc":
      return Number(b.amount || 0) - Number(a.amount || 0);
    case "amount-asc":
      return Number(a.amount || 0) - Number(b.amount || 0);
    case "date-desc":
      return String(b.date || "").localeCompare(String(a.date || ""));
    case "progress-desc":
      return Number(b.progress || 0) - Number(a.progress || 0);
    case "pinned-desc":
      return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    case "status-asc":
      return String(a.status || "").localeCompare(String(b.status || ""), "zh-CN");
    case "type-asc":
      return String(typeMeta[a.entryType]?.label || "").localeCompare(String(typeMeta[b.entryType]?.label || ""), "zh-CN");
    case "updated-desc":
    default:
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  }
}

function filterCollection(items, ui, options = {}) {
  const fixedType = options.fixedType || null;

  return items
    .filter((item) => {
      const entryType = item.entryType || fixedType;

      if (fixedType && entryType !== fixedType) return false;
      if (!matchesSearchTerm(item, ui.searchTerm)) return false;
      if (!matchesFilterToken(item, entryType, ui.activeChip)) return false;
      if (ui.filters.type !== "all" && entryType !== ui.filters.type) return false;
      if (ui.filters.status !== "all" && !matchesFilterToken(item, entryType, ui.filters.status)) return false;
      if (ui.filters.tag !== "all" && !matchesFilterToken(item, entryType, `tag:${ui.filters.tag}`)) return false;
      if (ui.filters.favoriteOnly && !item.isFavorite) return false;

      return true;
    })
    .sort((left, right) => compareBySort(left, right, ui.sortBy));
}

function filteredItems(data, ui, type) {
  const items = (data[type] || []).map((item) => ({ ...item, entryType: type }));
  return filterCollection(items, ui, { fixedType: type });
}

function uniqueValues(items, getter) {
  return [...new Set(items.map(getter).filter(Boolean))];
}

function getTodayText() {
  return new Date().toISOString().slice(0, 10);
}

function isTaskDone(task) {
  return task.status === "已完成";
}

function isDueToday(task) {
  return !isTaskDone(task) && task.dueDate === getTodayText();
}

function isOverdue(task) {
  return !isTaskDone(task) && task.dueDate && task.dueDate < getTodayText();
}

function getQuickFilters(page, data) {
  if (page === "tasks") {
    return [
      { value: "all", label: "全部" },
      { value: "task:today", label: "今日" },
      { value: "task:overdue", label: "逾期" },
      ...uniqueValues(data.tasks, (item) => item.status).map((status) => ({ value: `status:${status}`, label: status })),
    ];
  }

  if (page === "bills") {
    const billSources = uniqueValues(data.bills, (item) => item.source).slice(0, 3);
    const billPayers = ["男方", "女方", "共同", "家庭账户", "孩子相关"].filter((payer) => data.bills.some((item) => item.payer === payer));
    return [
      { value: "all", label: "全部" },
      ...uniqueValues(data.bills, (item) => item.type).map((billType) => ({ value: `bill-type:${billType}`, label: billType })),
      ...billSources.map((source) => ({ value: `bill-source:${source}`, label: source })),
      ...billPayers.map((payer) => ({ value: `bill-payer:${payer}`, label: payer })),
      { value: "bill-fixed:any", label: "固定支出" },
      { value: "bill-fixed:房贷", label: "房贷" },
      { value: "bill-family:children", label: "孩子相关" },
    ];
  }

  if (page === "subscriptions") {
    return [];
  }

  if (page === "favorites") {
    return [
      { value: "all", label: "全部收藏" },
      ...uniqueValues(data.bookmarks || [], (item) => item.category).map((category) => ({ value: `category:${category}`, label: category })),
    ];
  }

  return [];
}

function getStatusOptions(page, data) {
  if (page === "tasks") {
    return uniqueValues(data.tasks, (item) => item.status).map((status) => ({
      value: `status:${status}`,
      label: status,
    }));
  }

  if (page === "bills") {
    return [
      ...uniqueValues(data.bills, (item) => item.type).map((billType) => ({
        value: `bill-type:${billType}`,
        label: billType,
      })),
      ...uniqueValues(data.bills, (item) => item.source).map((source) => ({
        value: `bill-source:${source}`,
        label: `来源：${source}`,
      })),
      ...uniqueValues(data.bills, (item) => item.payer).map((payer) => ({
        value: `bill-payer:${payer}`,
        label: `承担：${payer}`,
      })),
      ...uniqueValues(data.bills, (item) => getBillFixedType(item)).map((fixedType) => ({
        value: `bill-fixed:${fixedType}`,
        label: `固定：${fixedType}`,
      })),
      { value: "bill-family:children", label: "孩子相关" },
    ];
  }

  if (page === "search") {
    const allItems = getAllItems(data);
    const statusOptions = uniqueValues(allItems, (item) => item.status).map((status) => ({
      value: `status:${status}`,
      label: status,
    }));
    const billOptions = uniqueValues(data.bills, (item) => item.type).map((billType) => ({
      value: `bill-type:${billType}`,
      label: billType,
    }));

    return [...statusOptions, ...billOptions, { value: "pinned", label: "置顶" }];
  }

  return [];
}

function getTagOptions(page, data, ui) {
  const source =
    page === "search"
      ? filterCollection(getAllItems(data), ui)
      : page === "favorites"
        ? data.bookmarks || []
      : filteredItems(data, ui, page);

  return uniqueValues(source, (item) => (item.tags || []).join("|"))
    .flatMap((value) => value.split("|").filter(Boolean))
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function renderControls(elements, data, ui, page) {
  const hiddenTopControls = new Set(["tasks", "bills"]);
  if (hiddenTopControls.has(page)) {
    elements.filterRow.innerHTML = "";
    return;
  }

  const quickFilters = getQuickFilters(page, data);
  const compactControls = page === "subscriptions";
  const statusOptions = compactControls ? [] : getStatusOptions(page, data);
  const tagOptions = compactControls ? [] : getTagOptions(page, data, ui);
  const showTypeFilter = page === "search";
  const statusLabel = page === "bills" ? "筛选" : "状态";

  elements.filterRow.innerHTML = `
    <div class="toolbar-shell ${compactControls ? "toolbar-shell--compact" : ""}">
      ${
        quickFilters.length
          ? `<div class="filter-chip-row">
        ${quickFilters
          .map(
            (filter) => `
              <button class="chip ${ui.activeChip === filter.value ? "active" : ""}" data-filter="${filter.value}" type="button">
                ${escapeHtml(filter.label)}
              </button>
            `,
          )
          .join("")}
      </div>`
          : ""
      }
      <div class="toolbar-controls">
        ${
          showTypeFilter
            ? renderSelect(
                "typeFilter",
                "模块",
                [{ value: "all", label: "全部模块" }, ...Object.entries(typeMeta).map(([value, meta]) => ({ value, label: meta.label }))],
                ui.filters.type,
              )
            : ""
        }
        ${
          statusOptions.length
            ? renderSelect("statusFilter", statusLabel, [{ value: "all", label: page === "bills" ? "全部账单" : "全部状态" }, ...statusOptions], ui.filters.status)
            : ""
        }
        ${
          tagOptions.length
            ? renderSelect(
                "tagFilter",
                "标签",
                [{ value: "all", label: "全部标签" }, ...tagOptions.map((tag) => ({ value: tag, label: tag }))],
                ui.filters.tag,
              )
            : ""
        }
        ${ui.searchTerm ? '<button class="ghost-button" id="openSearchPage" type="button">查看全部结果</button>' : ""}
        ${ui.searchTerm && page === "search" ? '<button class="ghost-button" id="clearSearchTerm" type="button">清除搜索</button>' : ""}
      </div>
      ${ui.searchTerm ? `<p class="toolbar-summary">正在搜索 “${escapeHtml(ui.searchTerm)}”</p>` : ""}
    </div>
  `;
}

function renderSelect(id, label, options, activeValue) {
  const activeOption = options.find((option) => option.value === activeValue) || options[0];
  return `
    <details class="toolbar-select ui-menu-select">
      <summary>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(activeOption?.label || "")}</strong>
      </summary>
      <div class="ui-menu-select__panel">
        ${options
          .map(
            (option) => `
              <button class="${option.value === activeValue ? "is-active" : ""}" data-filter-select="${escapeHtml(id)}:${escapeHtml(option.value)}" type="button">
                ${escapeHtml(option.label)}
              </button>
            `,
          )
          .join("")}
      </div>
    </details>
  `;
}

function renderNav(elements, ui) {
  const visibleItems = navItems.filter((item) => !item.hidden);

  elements.navList.innerHTML = visibleItems
    .map(
      (item) => `
        <button class="nav-item ${ui.activePage === item.id ? "active" : ""}" data-page="${item.id}" type="button">
          <span class="nav-icon">${item.icon}</span>
          <span>${item.label}</span>
        </button>
      `,
    )
    .join("");

  elements.mobileTabs.innerHTML = visibleItems
    .filter((item) => mobileIds.includes(item.id))
    .map(
      (item) => `
        <button class="${ui.activePage === item.id ? "active" : ""}" data-page="${item.id}" type="button">
          <span>${item.icon}</span><br />${item.label}
        </button>
      `,
    )
    .join("");
}

function updateProgress(elements, data) {
  if (!elements.sidebarProgress || !elements.sidebarProgressBar) return;
  const done = data.tasks.filter((task) => task.status === "已完成").length;
  const progress = Math.round((done / Math.max(data.tasks.length, 1)) * 100);
  elements.sidebarProgress.textContent = `${progress}%`;
  elements.sidebarProgressBar.style.width = `${progress}%`;
}

function dashboardActionAttributes(action = {}) {
  if (action.ledgerMonth) return `data-dashboard-open-ledger="${escapeHtml(action.ledgerMonth)}"`;
  return `data-page-jump="${escapeHtml(action.page || "dashboard")}"`;
}

function dashboardMetricCard(label, value, hint, action, tone = "") {
  return `
    <button class="dashboard-metric-card ${tone ? `dashboard-metric-card--${tone}` : ""}" ${dashboardActionAttributes(action)} type="button">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </button>
  `;
}

function dashboardQueueItem(title, text, actionLabel, action, tone = "normal") {
  return `
    <article class="dashboard-queue-item dashboard-queue-item--${escapeHtml(tone)}">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(text)}</span>
      </div>
      <button class="ghost-button" ${dashboardActionAttributes(action)} type="button">${escapeHtml(actionLabel)}</button>
    </article>
  `;
}

function dashboardTrendBars(rows) {
  const maxValue = Math.max(...rows.flatMap((row) => [row.income, row.expense]), 1);
  return `
    <div class="dashboard-trend-bars">
      ${rows
        .map((row) => {
          const incomeHeight = Math.max(6, Math.round((row.income / maxValue) * 72));
          const expenseHeight = Math.max(6, Math.round((row.expense / maxValue) * 72));
          return `
            <article>
              <div>
                <i class="dashboard-trend-bar dashboard-trend-bar--income" style="height:${incomeHeight}px"></i>
                <i class="dashboard-trend-bar dashboard-trend-bar--expense" style="height:${expenseHeight}px"></i>
              </div>
              <span>${escapeHtml(row.month.slice(5))}</span>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderDashboard(elements, data, ui, recentViews, store) {
  renderControls(elements, data, ui, "dashboard");

  const tasks = data.tasks || [];
  const bills = data.bills || [];
  const fallbackMonth = getBillHistoryRows(bills)[0]?.month || data.budgets?.month || new Date().toISOString().slice(0, 7);
  const month = ui.filters.billMonth || data.budgets?.viewMonth || fallbackMonth;
  const financeSummary = getMonthlyFinanceSummary(data, month);
  const commitments = getFutureCommitments(data, month);
  const financeRisks = buildFinanceRisks(financeSummary, commitments);
  const futureExpense = commitments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const healthStatus =
    financeSummary.income <= 0 ? "待补录" : financeSummary.balance < 0 || financeRisks.some((risk) => risk.level === "risk") ? "风险" : financeRisks.some((risk) => risk.level === "watch") ? "关注" : "健康";
  const doneTasks = data.tasks.filter((task) => task.status === "已完成").length;
  const progress = Math.round((doneTasks / Math.max(data.tasks.length, 1)) * 100);
  const notificationSettings = loadSubscriptionNotificationSettings();
  const subscriptionSummary = getSubscriptionReminderSummary(data.subscriptions || []);
  const subscriptionsOverview = store?.getSubscriptionsOverview?.() || { estimatedMonthlyCost: 0, upcoming: [], urgent: [] };
  const favorStats = store?.getFavorStats?.() || { received: 0, given: 0, balance: 0, totalContacts: 0 };
  const pendingTasks = tasks.filter((task) => task.status !== "已完成");
  const todayTasks = pendingTasks.filter((task) => isDueToday(task)).slice(0, 4);
  const overdueTasks = pendingTasks.filter(isOverdue);
  const unclassifiedBills = bills.filter((bill) => String(bill.date || "").startsWith(month) && !bill.excludeFromAnalysis && (!bill.category || bill.category === "未分类" || bill.classification?.needsReview));
  const excludedBills = bills.filter((bill) => String(bill.date || "").startsWith(month) && bill.excludeFromAnalysis);
  const latestImport = (data.billImportReports || [])[0];
  const trendRows = getBillHistoryRows(bills.filter((bill) => !bill.excludeFromAnalysis)).slice(0, 6).reverse();
  const visibleRecentViews = recentViews.filter((item) => !["notes", "collections", "analytics"].includes(item.type));
  const balanceCopy =
    favorStats.balance > 0
      ? `别人差我 ${formatCurrency(favorStats.balance)}`
      : favorStats.balance < 0
        ? `我差别人 ${formatCurrency(Math.abs(favorStats.balance))}`
        : "往来差额持平";
  const decisionText =
    financeSummary.income <= 0
      ? "先补录本月收入，才能判断支出率。"
      : financeSummary.balance < 0
        ? "本月现金流为负，优先复核大额支出。"
        : `本月结余 ${formatCurrency(financeSummary.balance)}，未来计划 ${formatCurrency(futureExpense)}。`;
  const queueItems = [
    unclassifiedBills.length ? dashboardQueueItem("未分类流水", `${month} 有 ${unclassifiedBills.length} 条需要复核`, "复核流水", { ledgerMonth: month }, "risk") : "",
    subscriptionsOverview.upcoming?.length ? dashboardQueueItem("订阅临期", `30 天内 ${subscriptionsOverview.upcoming.length} 项到期`, "看订阅", { page: "subscriptions" }, subscriptionsOverview.urgent?.length ? "risk" : "watch") : "",
    overdueTasks.length ? dashboardQueueItem("逾期事项", `${overdueTasks.length} 项已经逾期`, "处理事项", { page: "tasks" }, "risk") : "",
    latestImport?.needsReview || latestImport?.uncategorized ? dashboardQueueItem("导入待复核", `${latestImport.uncategorized || 0} 条未分类，${latestImport.needsReview || 0} 条需确认`, "打开流水", { ledgerMonth: latestImport.months?.[0] || month }, "watch") : "",
    !unclassifiedBills.length && !subscriptionsOverview.upcoming?.length && !overdueTasks.length ? dashboardQueueItem("暂无紧急处理", "关键事项处于可控状态", "查看总账", { page: "bills" }, "good") : "",
  ].filter(Boolean);

  elements.contentArea.innerHTML = `
    <section class="dashboard-command">
      <div class="dashboard-command__main">
        <span class="eyebrow">COMMAND CENTER</span>
        <h2>家庭财务状态：${escapeHtml(healthStatus)}</h2>
        <p>${escapeHtml(decisionText)}</p>
        <div class="dashboard-command__actions">
          <button class="primary-button" data-dashboard-open-ledger="${escapeHtml(month)}" type="button">复核完整流水</button>
          <button class="ghost-button" data-page-jump="bills" type="button">进入生活收支</button>
          <button class="ghost-button" id="dashboardQuickAdd" type="button">新增记录</button>
        </div>
      </div>
      <aside class="dashboard-command__status dashboard-command__status--${healthStatus === "风险" ? "risk" : healthStatus === "关注" ? "watch" : "good"}">
        <span>${escapeHtml(month)} 月度判断</span>
        <strong>${escapeHtml(healthStatus)}</strong>
        <small>支出率 ${financeSummary.income > 0 ? `${Math.round(financeSummary.expenseRate * 100)}%` : "缺少收入"} · ${excludedBills.length} 条不计入</small>
      </aside>
    </section>
    <div class="dashboard-metric-grid">
      ${dashboardMetricCard("本月结余", formatCurrency(financeSummary.balance), `收入 ${formatCurrency(financeSummary.income)} / 支出 ${formatCurrency(financeSummary.expense)}`, { page: "bills" }, financeSummary.balance < 0 ? "risk" : "good")}
      ${dashboardMetricCard("预算使用", financeSummary.totalBudget ? `${Math.round((financeSummary.expense / Math.max(financeSummary.totalBudget, 1)) * 100)}%` : "未设置", `${formatCurrency(financeSummary.expense)} / ${formatCurrency(financeSummary.totalBudget)}`, { page: "bills" }, financeSummary.totalBudget && financeSummary.expense > financeSummary.totalBudget ? "risk" : "")}
      ${dashboardMetricCard("未来压力", formatCurrency(futureExpense), `未来 3 个月 ${commitments.length} 项`, { page: "bills" }, futureExpense > Math.max(financeSummary.balance, 0) + Math.max(financeSummary.income, 0) ? "watch" : "")}
      ${dashboardMetricCard("待处理", String(queueItems.length), `${overdueTasks.length ? `${overdueTasks.length} 逾期 · ` : ""}${unclassifiedBills.length} 未分类`, unclassifiedBills.length ? { ledgerMonth: month } : { page: "tasks" }, queueItems.length > 2 ? "watch" : "")}
    </div>
    ${
      notificationSettings.siteEnabled && subscriptionSummary.total
        ? `<section class="panel notification-panel">
            <div class="panel-head">
              <h2>订阅到期提醒</h2>
              <button class="ghost-button" data-page-jump="subscriptions" type="button">查看订阅</button>
            </div>
            <div class="tag-row">
              <span class="tag">已过期 ${subscriptionSummary.groups.expired.length}</span>
              <span class="tag">今天 ${subscriptionSummary.groups.today.length}</span>
              <span class="tag">7 天内 ${subscriptionSummary.groups.week.length}</span>
              <span class="tag">30 天内 ${subscriptionSummary.groups.month.length}</span>
            </div>
          </section>`
        : ""
    }
    <div class="dashboard-main-grid">
      <section class="panel dashboard-panel">
        <div class="panel-head">
          <div>
            <span class="eyebrow">RISK</span>
            <h2>风险提醒</h2>
          </div>
          <button class="ghost-button" data-dashboard-open-ledger="${escapeHtml(month)}" type="button">完整流水</button>
        </div>
        <div class="dashboard-risk-list">
          ${financeRisks.map((risk) => `<article class="dashboard-risk-item dashboard-risk-item--${escapeHtml(risk.level)}"><strong>${escapeHtml(risk.title)}</strong><span>${escapeHtml(risk.text)}</span></article>`).join("")}
        </div>
      </section>
      <section class="panel dashboard-panel">
        <div class="panel-head">
          <div>
            <span class="eyebrow">ACTION</span>
            <h2>待处理队列</h2>
          </div>
          <span class="results-count">${queueItems.length} 项</span>
        </div>
        <div class="dashboard-queue-list">${queueItems.join("")}</div>
      </section>
      <section class="panel dashboard-panel">
        <div class="panel-head">
          <div>
            <span class="eyebrow">TREND</span>
            <h2>近 6 月收支趋势</h2>
          </div>
          <span class="results-count">红收入 / 绿支出</span>
        </div>
        ${trendRows.length ? dashboardTrendBars(trendRows) : emptyState("暂无趋势数据")}
      </section>
      <section class="panel dashboard-panel">
        <div class="panel-head">
          <div>
            <span class="eyebrow">REVIEW</span>
            <h2>复盘摘要</h2>
          </div>
          <button class="ghost-button" data-page-jump="favors" type="button">人情台账</button>
        </div>
        <div class="dashboard-review-grid">
          <article><span>人情差额</span><strong>${formatCurrency(Math.abs(favorStats.balance || 0))}</strong><small>${escapeHtml(balanceCopy)}</small></article>
          <article><span>订阅月均</span><strong>${formatCurrency(subscriptionsOverview.estimatedMonthlyCost)}</strong><small>${subscriptionsOverview.upcoming.length} 项 30 天内到期</small></article>
          <article><span>事项完成</span><strong>${progress}%</strong><small>${pendingTasks.length} 项未完成</small></article>
          <article><span>最近导入</span><strong>${latestImport ? `${latestImport.imported || 0} 条` : "暂无"}</strong><small>${latestImport?.mode || "未导入"}</small></article>
        </div>
      </section>
    </div>
    <section class="panel dashboard-panel dashboard-recent-panel">
      <div class="panel-head">
        <div>
          <span class="eyebrow">RECENT</span>
          <h2>最近访问</h2>
        </div>
        ${ui.searchTerm ? '<button class="ghost-button" id="openSearchPage" type="button">查看搜索结果</button>' : ""}
      </div>
      <div class="recent-list">${visibleRecentViews.slice(0, 6).map(recentViewRow).join("") || emptyState("还没有浏览记录")}</div>
    </section>
    <section class="panel dashboard-panel dashboard-task-panel">
      <div class="panel-head">
        <div>
          <span class="eyebrow">TODAY</span>
          <h2>今日事项</h2>
        </div>
        <button class="ghost-button" data-page-jump="tasks" type="button">查看全部</button>
      </div>
      <div class="list-stack">${(todayTasks.length ? todayTasks : pendingTasks.slice(0, 4)).map(taskRow).join("") || emptyState("暂无事项")}</div>
    </section>
  `;
}

function timelineRows(items) {
  return `
    <div class="timeline-list">
      ${
        items
          .map(
            (item) => `
              <article class="timeline-row" ${item.ref ? `data-open="${escapeHtml(item.ref)}"` : ""}>
                <span class="tag">${escapeHtml(item.type)}</span>
                <div>
                  <strong>${escapeHtml(item.title)}</strong>
                  <small>${escapeHtml(item.date || "未设置日期")}</small>
                </div>
              </article>
            `,
          )
          .join("") || emptyState("暂无项目动态")
      }
    </div>
  `;
}

function renderTasks(elements, data, ui) {
  renderControls(elements, data, ui, "tasks");
  const items = filteredItems(data, ui, "tasks");
  const allTasks = data.tasks || [];
  const todayTasks = allTasks.filter(isDueToday);
  const overdueTasks = allTasks.filter(isOverdue);
  const activeTasks = allTasks.filter((task) => !isTaskDone(task));
  const doneTasks = allTasks.filter(isTaskDone);
  const statusColumns = ["待处理", "进行中", "已完成"];

  const boardHtml = statusColumns
    .map((status) => {
      const columnTasks = items.filter((task) => task.status === status);
      return `
        <section class="kanban-column">
          <div class="panel-head">
            <h2>${escapeHtml(status)}</h2>
            <span class="results-count">${columnTasks.length} 条</span>
          </div>
          <div class="list-stack">
            ${columnTasks.map(taskRow).join("") || emptyState(`暂无${status}事项`)}
          </div>
        </section>
      `;
    })
    .join("");

  elements.contentArea.innerHTML = `
    <div class="stats-grid">
      ${statCard("今日事项", todayTasks.length, "截止日期为今天")}
      ${statCard("逾期事项", overdueTasks.length, "需要优先处理")}
      ${statCard("未完成", activeTasks.length, "待处理与进行中")}
      ${statCard("已完成", doneTasks.length, "累计完成")}
    </div>
    <section class="panel">
      <div class="panel-head">
        <h2>看板视图</h2>
        <span class="results-count">按状态推进事项</span>
      </div>
      <div class="kanban-board">${boardHtml}</div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>全部事项</h2>
        <span class="results-count">当前筛选共 ${items.length} 条</span>
      </div>
      <div class="list-stack">
        ${items.map(taskRow).join("") || emptyState("暂无符合条件的事项")}
      </div>
    </section>
  `;
}

const incomeTypes = new Set(["收入"]);
const expenseTypes = new Set(["支出"]);
const fixedExpenseKeywords = ["房贷", "车贷", "保险", "学费", "订阅", "水电燃气"];

function isIncomeBill(item) {
  return incomeTypes.has(item.type);
}

function isExpenseBill(item) {
  return expenseTypes.has(item.type) || !isIncomeBill(item);
}

function getBillFixedType(item) {
  const text = `${item.fixedExpenseType || ""} ${item.category || ""} ${item.title || ""}`;
  return fixedExpenseKeywords.find((keyword) => text.includes(keyword)) || item.fixedExpenseType || "";
}

function sumBills(items) {
  return items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function getBillHistoryRows(bills) {
  return Object.entries(
    (bills || []).reduce((map, bill) => {
      const month = String(bill.date || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return map;
      if (!map[month]) map[month] = [];
      map[month].push(bill);
      return map;
    }, {}),
  )
    .map(([month, items]) => {
      const income = sumBills(items.filter(isIncomeBill));
      const expense = sumBills(items.filter(isExpenseBill));
      return { month, items, income, expense, balance: income - expense };
    })
    .sort((left, right) => right.month.localeCompare(left.month));
}

function getMonthDateParts(month) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  const fallback = new Date();
  const year = match ? Number(match[1]) : fallback.getFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : fallback.getMonth();
  return { year, monthIndex };
}

function getDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getMonthDays(month) {
  const { year, monthIndex } = getMonthDateParts(month);
  const total = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: total }, (_, index) => {
    const date = new Date(year, monthIndex, index + 1);
    return {
      date,
      key: getDateKey(date),
      day: index + 1,
      weekday: "日一二三四五六"[date.getDay()],
    };
  });
}

function summarizeBillsByDate(items = []) {
  return items.reduce((map, item) => {
    const key = String(item.date || "").slice(0, 10);
    if (!key) return map;
    if (!map[key]) map[key] = { income: 0, expense: 0 };
    if (isIncomeBill(item)) {
      map[key].income += Number(item.amount || 0);
    } else if (isExpenseBill(item)) {
      map[key].expense += Number(item.amount || 0);
    }
    return map;
  }, {});
}

function getMonthBills(allBills, month) {
  return (allBills || []).filter((item) => String(item.date || "").startsWith(month) && !item.excludeFromAnalysis);
}

function getMonthlyFinanceSummary(data, month) {
  const bills = getMonthBills(data.bills || [], month);
  const incomeItems = bills.filter(isIncomeBill);
  const expenseItems = bills.filter(isExpenseBill);
  const income = sumBills(incomeItems);
  const expense = sumBills(expenseItems);
  const balance = income - expense;
  const fixedExpense = sumBills(expenseItems.filter((item) => getBillFixedType(item)));
  const repayment = sumBills(expenseItems.filter((item) => ["房贷", "车贷", "信用卡", "银行卡", "花呗", "白条", "购物平台", "其他还款"].some((keyword) => `${item.fixedExpenseType || ""}${item.category || ""}${item.title || ""}`.includes(keyword))));
  const categoryTotals = Object.entries(
    expenseItems.reduce((map, item) => {
      const category = item.category || "未分类";
      map[category] = (map[category] || 0) + Number(item.amount || 0);
      return map;
    }, {}),
  )
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount);
  const budgets = data.budgets || {};
  const categoryBudgets = budgets.categoryBudgets || [];
  return {
    month,
    bills,
    incomeItems,
    expenseItems,
    income,
    expense,
    balance,
    fixedExpense,
    repayment,
    expenseRate: income > 0 ? expense / income : 0,
    fixedRate: income > 0 ? fixedExpense / income : 0,
    repaymentRate: income > 0 ? repayment / income : 0,
    categoryTotals,
    totalBudget: Number(budgets.totalBudget || 0),
    categoryBudgets,
    futurePlans: budgets.futurePlans || [],
  };
}

function getFutureWindow(month, months = 3) {
  const { year, monthIndex } = getMonthDateParts(month);
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + months, 0);
  return { startKey: getDateKey(start), endKey: getDateKey(end) };
}

function getFutureCommitments(data, month) {
  const { startKey, endKey } = getFutureWindow(month, 3);
  const planItems = ((data.budgets || {}).futurePlans || [])
    .filter((item) => item.status !== "取消")
    .filter((item) => {
      const key = String(item.date || "").slice(0, 10);
      return key >= startKey && key <= endKey;
    })
    .map((item) => ({ ...item, source: "plan" }));
  const subscriptionItems = (data.subscriptions || [])
    .filter((item) => {
      const key = String(item.nextRenewalDate || "").slice(0, 10);
      return key >= startKey && key <= endKey;
    })
    .map((item) => ({
      id: `sub-${item.id}`,
      title: item.name,
      amount: Number(item.monthlyCost || item.amount || 0),
      date: item.nextRenewalDate,
      planType: "订阅续费",
      priority: item.autoRenew ? "高" : "中",
      fundingSource: item.paymentMethod || "家庭账户",
      status: item.autoRenew ? "自动续费" : "待确认",
      source: "subscription",
    }));
  return [...planItems, ...subscriptionItems].sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));
}

function buildFinanceRisks(summary, commitments) {
  const risks = [];
  if (summary.income <= 0 && summary.expense > 0) risks.push({ level: "risk", title: "缺少收入参照", text: "当前月份已有支出，但未录入工资或其他收入，无法判断支出是否健康。" });
  if (summary.income > 0 && summary.expenseRate >= 0.9) risks.push({ level: "risk", title: "支出率过高", text: `本月支出已达收入 ${Math.round(summary.expenseRate * 100)}%，建议暂停非必要消费。` });
  if (summary.income > 0 && summary.repaymentRate >= 0.35) risks.push({ level: "risk", title: "还款压力偏高", text: `还款占收入 ${Math.round(summary.repaymentRate * 100)}%，需要关注信用卡、房贷或分期。` });
  if (summary.income > 0 && summary.fixedRate >= 0.4) risks.push({ level: "watch", title: "固定支出偏高", text: `固定支出占收入 ${Math.round(summary.fixedRate * 100)}%，下月可支配空间会被压缩。` });
  if (summary.totalBudget > 0 && summary.expense / summary.totalBudget >= 0.8) risks.push({ level: summary.expense > summary.totalBudget ? "risk" : "watch", title: "预算接近上限", text: `总预算已使用 ${Math.round((summary.expense / summary.totalBudget) * 100)}%。` });
  const futureExpense = commitments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (futureExpense > Math.max(summary.balance, 0) + Math.max(summary.income, 0)) risks.push({ level: "watch", title: "未来计划压力", text: `未来 3 个月计划/续费约 ${formatCurrency(futureExpense)}，建议提前安排储备。` });
  if (!risks.length) risks.push({ level: "good", title: "暂无明显风险", text: "当前数据未触发高风险规则，继续保持收入、支出和预算录入。" });
  return risks.slice(0, 4);
}

function billDecisionStrip(summary, commitments) {
  const futureExpense = commitments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const status = summary.income <= 0 ? "待补录" : summary.balance >= futureExpense * 0.5 ? "可控" : summary.balance >= 0 ? "关注" : "风险";
  const text =
    summary.income <= 0
      ? "请先录入当月工资，分析才有收入参照。"
      : summary.balance < 0
        ? "本月现金流为负，优先复核大额支出和还款。"
        : `本月结余 ${formatCurrency(summary.balance)}，未来 3 个月已知计划 ${formatCurrency(futureExpense)}。`;
  return `
    <section class="bill-decision-strip bill-decision-strip--${status === "风险" ? "risk" : status === "关注" ? "watch" : "stable"}">
      <span>${escapeHtml(summary.month)} 月度结论</span>
      <strong>${escapeHtml(status)}</strong>
      <p>${escapeHtml(text)}</p>
    </section>
  `;
}

function billAnalysisPanel(summary) {
  const metrics = [
    ["收入", formatCurrency(summary.income), `${summary.incomeItems.length} 笔`],
    ["支出", formatCurrency(summary.expense), `${summary.expenseItems.length} 笔`],
    ["结余", formatCurrency(summary.balance), summary.balance >= 0 ? "现金流为正" : "现金流为负"],
    ["支出率", summary.income > 0 ? `${Math.round(summary.expenseRate * 100)}%` : "缺少收入", "支出 / 收入"],
  ];
  return `
    <section class="panel bill-decision-panel">
      <div class="panel-head">
        <h2>收支分析</h2>
        <span class="results-count">${escapeHtml(summary.month)}</span>
      </div>
      <div class="bill-metric-grid">
        ${metrics.map(([label, value, hint]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`).join("")}
      </div>
      <div class="bill-category-list">
        ${(summary.categoryTotals.slice(0, 4).map((row) => {
          const percent = summary.expense > 0 ? Math.round((row.amount / summary.expense) * 100) : 0;
          return `<div><span>${escapeHtml(row.category)}</span><i><b style="width:${percent}%"></b></i><strong>${percent}%</strong></div>`;
        }).join("") || emptyState("暂无支出分类"))}
      </div>
    </section>
  `;
}

function billRiskPanel(risks) {
  return `
    <section class="panel bill-decision-panel">
      <div class="panel-head">
        <h2>风险提醒</h2>
        <span class="results-count">规则判断</span>
      </div>
      <div class="bill-risk-list">
        ${risks.map((risk) => `<article class="bill-risk-item bill-risk-item--${escapeHtml(risk.level)}"><strong>${escapeHtml(risk.title)}</strong><p>${escapeHtml(risk.text)}</p></article>`).join("")}
      </div>
    </section>
  `;
}

function summarizeBillTrendRow(data, rawBills, meta = {}) {
  const analysisBills = rawBills.filter((item) => !item.excludeFromAnalysis);
  const income = sumBills(analysisBills.filter(isIncomeBill));
  const expense = sumBills(analysisBills.filter(isExpenseBill));
  const rawExpense = sumBills(rawBills.filter(isExpenseBill));
  const fixedExpense = sumBills(analysisBills.filter((item) => getBillFixedType(item)));
  const nonFixedExpense = Math.max(expense - fixedExpense, 0);
  const categories = analysisBills.filter(isExpenseBill).reduce((map, item) => {
    const category = item.category || "未分类";
    map[category] = (map[category] || 0) + Number(item.amount || 0);
    return map;
  }, {});
  return {
    ...meta,
    income,
    expense,
    balance: income - expense,
    budget: Number(meta.budget || 0),
    fixedExpense,
    nonFixedExpense,
    rawExpense,
    categories,
  };
}

function getBillDayTrendRows(data, activeMonth) {
  const days = getMonthDays(activeMonth);
  const monthlyBudget = Number((data.budgets || {}).totalBudget || 0);
  return days.map((day) => {
    const rawBills = (data.bills || []).filter((item) => String(item.date || "").slice(0, 10) === day.key);
    return summarizeBillTrendRow(data, rawBills, {
      key: day.key,
      label: String(day.day).padStart(2, "0"),
      detail: `周${day.weekday}`,
      month: activeMonth,
      scope: "day",
      budget: monthlyBudget ? monthlyBudget / days.length : 0,
    });
  });
}

function getBillWeekTrendRows(data, activeMonth) {
  const { year, monthIndex } = getMonthDateParts(activeMonth);
  const days = getMonthDays(activeMonth);
  const weekCount = Math.ceil(days.length / 7);
  const monthlyBudget = Number((data.budgets || {}).totalBudget || 0);
  return Array.from({ length: weekCount }, (_, index) => {
    const startDay = index * 7 + 1;
    const endDay = Math.min(startDay + 6, days.length);
    const startDate = new Date(year, monthIndex, startDay);
    const endDate = new Date(year, monthIndex, endDay);
    const startKey = getDateKey(startDate);
    const endKey = getDateKey(endDate);
    const rawBills = (data.bills || []).filter((item) => {
      const key = String(item.date || "").slice(0, 10);
      return key >= startKey && key <= endKey;
    });
    return summarizeBillTrendRow(data, rawBills, {
      key: `${activeMonth}-w${index + 1}`,
      label: `W${index + 1}`,
      detail: `${String(startDay).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
      month: activeMonth,
      scope: "week",
      budget: monthlyBudget ? monthlyBudget / weekCount : 0,
    });
  });
}

function getBillMonthTrendRows(data, activeMonth, months = 6) {
  const { year, monthIndex } = getMonthDateParts(activeMonth);
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(year, monthIndex - (months - index - 1), 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const rawBills = (data.bills || []).filter((item) => String(item.date || "").startsWith(month));
    return summarizeBillTrendRow(data, rawBills, {
      key: month,
      label: month.slice(5),
      detail: month,
      month,
      scope: "month",
      budget: Number((data.budgets || {}).totalBudget || 0),
    });
  });
}

function getBillYearTrendRows(data, activeMonth, years = 5) {
  const { year } = getMonthDateParts(activeMonth);
  const yearlyBudget = Number((data.budgets || {}).totalBudget || 0) * 12;
  return Array.from({ length: years }, (_, index) => {
    const targetYear = String(year - (years - index - 1));
    const rawBills = (data.bills || []).filter((item) => String(item.date || "").startsWith(targetYear));
    return summarizeBillTrendRow(data, rawBills, {
      key: targetYear,
      label: targetYear,
      detail: `${targetYear} 年`,
      month: `${targetYear}-${String(monthIndexFromActiveYear(activeMonth, targetYear)).padStart(2, "0")}`,
      scope: "year",
      budget: yearlyBudget,
    });
  });
}

function monthIndexFromActiveYear(activeMonth, targetYear) {
  const { year, monthIndex } = getMonthDateParts(activeMonth);
  return Number(targetYear) === year ? monthIndex + 1 : 12;
}

function normalizeTrendScope(value) {
  return ["day", "week", "month", "year"].includes(value) ? value : "month";
}

function getBillTrendRows(data, activeMonth, scope = "month", range = 6) {
  const normalizedScope = normalizeTrendScope(scope);
  if (normalizedScope === "day") return getBillDayTrendRows(data, activeMonth);
  if (normalizedScope === "week") return getBillWeekTrendRows(data, activeMonth);
  if (normalizedScope === "year") return getBillYearTrendRows(data, activeMonth, range);
  return getBillMonthTrendRows(data, activeMonth, range);
}

function getActiveTrendKey(activeMonth, scope) {
  const normalizedScope = normalizeTrendScope(scope);
  if (normalizedScope === "day") {
    const now = new Date();
    const todayKey = getDateKey(now);
    return todayKey.startsWith(activeMonth) ? todayKey : `${activeMonth}-01`;
  }
  if (normalizedScope === "week") {
    const now = new Date();
    const todayMonth = getDateKey(now).slice(0, 7);
    const day = todayMonth === activeMonth ? now.getDate() : 1;
    return `${activeMonth}-w${Math.ceil(day / 7)}`;
  }
  if (normalizedScope === "year") return String(getMonthDateParts(activeMonth).year);
  return activeMonth;
}


function trendValue(row, series) {
  if (series.category) return Number(row.categories?.[series.category] || 0);
  return Number(row[series.key] || 0);
}

function trendPoint(value, index, count, maxValue, minValue, width, height, padding) {
  const span = Math.max(maxValue - minValue, 1);
  const divisor = Math.max(count - 1, 1);
  const x = padding + (index * (width - padding * 2)) / divisor;
  const y = height - padding - ((value - minValue) / span) * (height - padding * 2);
  return { x: Math.round(x), y: Math.round(y) };
}

function buildSmoothTrendPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return points
    .map((point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const previous = points[index - 1];
      const controlOffset = Math.max((point.x - previous.x) * 0.42, 8);
      const c1x = previous.x + controlOffset;
      const c1y = previous.y;
      const c2x = point.x - controlOffset;
      const c2y = point.y;
      return `C ${Math.round(c1x)} ${Math.round(c1y)}, ${Math.round(c2x)} ${Math.round(c2y)}, ${point.x} ${point.y}`;
    })
    .join(" ");
}

function trendSeriesPoints(rows, series, scale) {
  return rows.map((row, index) => {
    const value = trendValue(row, series);
    return {
      ...trendPoint(value, index, rows.length, scale.max, scale.min, scale.width, scale.height, scale.padding),
      value,
      row,
      index,
    };
  });
}

function trendCurvePath(rows, series, scale) {
  const points = trendSeriesPoints(rows, series, scale);
  const title = `${series.label}：${rows.map((row) => `${row.month} ${formatCurrency(trendValue(row, series))}`).join(" / ")}`;
  return `<path class="bill-trend-line ${series.className}" d="${buildSmoothTrendPath(points)}"><title>${escapeHtml(title)}</title></path>`;
}

function trendLabelWidth(text) {
  return Math.min(112, Math.max(58, String(text).length * 7 + 18));
}

function trendValueLabel(point, text, className = "", priority = "") {
  const width = trendLabelWidth(text);
  const x = Math.max(4, Math.min(point.x - width / 2, 620 - width - 4));
  const y = Math.max(6, point.y - 30);
  return `
    <g class="bill-trend-value-label ${escapeHtml(className)} ${escapeHtml(priority)}" transform="translate(${Math.round(x)} ${Math.round(y)})">
      <rect width="${width}" height="22" rx="11"></rect>
      <text x="${Math.round(width / 2)}" y="15">${escapeHtml(text)}</text>
      <circle cx="${Math.round(point.x - x)}" cy="${Math.round(point.y - y)}" r="3"></circle>
    </g>
  `;
}

function trendSeriesLabels(rows, series, scale, range) {
  const points = trendSeriesPoints(rows, series, scale);
  if (!points.length) return "";
  const candidates = [points[points.length - 1]];
  const sorted = [...points].sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  const peak = sorted[0];
  if (peak && peak.index !== candidates[0].index && range <= 6 && Math.abs(peak.value) > 0) {
    candidates.unshift(peak);
  }
  const seen = new Set();
  return candidates
    .filter((point) => {
      const key = `${series.label}-${point.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((point) => trendValueLabel(point, `${excerptText(series.label, 6)} ${formatCurrency(point.value)}`, series.className, point.index === rows.length - 1 ? "is-final" : "is-peak"))
    .join("");
}

function trendProblemMarkers(rows, mode, scale) {
  const problems = rows
    .map((row, index) => {
      if (mode === "budget" && row.budget > 0 && row.expense > row.budget) {
        return { row, index, value: row.expense, label: `超预算 ${formatCurrency(row.expense - row.budget)}` };
      }
      if (mode === "raw" && row.rawExpense > row.expense) {
        return { row, index, value: row.rawExpense, label: `已剔除 ${formatCurrency(row.rawExpense - row.expense)}` };
      }
      if (mode === "cashflow" && row.balance < 0) {
        return { row, index, value: row.balance, label: `负结余 ${formatCurrency(Math.abs(row.balance))}` };
      }
      if (mode === "fixed" && row.expense > 0 && row.fixedExpense / row.expense >= 0.7) {
        return { row, index, value: row.fixedExpense, label: `固定占比 ${Math.round((row.fixedExpense / row.expense) * 100)}%` };
      }
      return null;
    })
    .filter(Boolean)
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, 3);

  return problems
    .map((problem) => {
      const point = trendPoint(problem.value, problem.index, rows.length, scale.max, scale.min, scale.width, scale.height, scale.padding);
      return trendValueLabel(point, problem.label, "bill-trend-marker--risk", "is-problem");
    })
    .join("");
}

function trendAxisLabel(row, scope) {
  if (scope === "day") return row.label;
  if (scope === "week") return row.detail;
  if (scope === "year") return row.label;
  return `${row.label}月`;
}

function trendAxisLabels(rows, scale, scope, activeTrendKey) {
  const divisor = Math.max(rows.length - 1, 1);
  return `
    <g class="bill-trend-axis-labels">
      ${rows
        .map((row, index) => {
          const x = Math.round(scale.padding + (index * (scale.width - scale.padding * 2)) / divisor);
          const activeClass = row.key === activeTrendKey ? "is-active" : "";
          const shouldShowLabel = scope !== "day" || index === 0 || index === rows.length - 1 || row.key === activeTrendKey || Number(row.label) % 5 === 0;
          return `
            <g class="${activeClass}" transform="translate(${x} 0)">
              <line x1="0" y1="183" x2="0" y2="188"></line>
              ${shouldShowLabel ? `<text x="0" y="202">${escapeHtml(trendAxisLabel(row, scope))}</text>` : ""}
            </g>
          `;
        })
        .join("")}
    </g>
  `;
}

function trendRangeOptions(scope) {
  if (scope === "day") return [];
  if (scope === "week") return [];
  if (scope === "year") return [3, 5, 10];
  return [3, 6, 12];
}

function getTopTrendCategories(rows) {
  return Object.entries(
    rows.reduce((map, row) => {
      Object.entries(row.categories || {}).forEach(([category, amount]) => {
        map[category] = (map[category] || 0) + Number(amount || 0);
      });
      return map;
    }, {}),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([category], index) => ({
      category,
      label: category,
      className: ["bill-trend-line--category-a", "bill-trend-line--category-b", "bill-trend-line--category-c"][index],
    }));
}

function normalizeTrendRange(value, scope = "month") {
  const options = trendRangeOptions(scope);
  if (!options.length) return 0;
  const range = Number(value || options[1] || options[0]);
  return options.includes(range) ? range : options[1] || options[0];
}

function billTrendPanel(data, activeMonth, mode = "cashflow", range = 6, scope = "month") {
  const normalizedMode = ["cashflow", "budget", "fixed", "raw", "category"].includes(mode) ? mode : "cashflow";
  const normalizedScope = normalizeTrendScope(scope);
  const normalizedRange = normalizeTrendRange(range, normalizedScope);
  const rows = getBillTrendRows(data, activeMonth, normalizedScope, normalizedRange);
  const categorySeries = getTopTrendCategories(rows);
  const categoryFallback = [{ key: "expense", label: "暂无分类，显示总支出", className: "bill-trend-line--expense" }];
  const seriesByMode = {
    cashflow: [
      { key: "income", label: "收入", className: "bill-trend-line--income" },
      { key: "expense", label: "支出", className: "bill-trend-line--expense" },
      { key: "balance", label: "结余", className: "bill-trend-line--balance" },
    ],
    budget: [
      { key: "expense", label: "实际支出", className: "bill-trend-line--expense" },
      { key: "budget", label: "预算", className: "bill-trend-line--budget" },
    ],
    fixed: [
      { key: "fixedExpense", label: "固定支出", className: "bill-trend-line--fixed" },
      { key: "nonFixedExpense", label: "非固定支出", className: "bill-trend-line--expense" },
    ],
    raw: [
      { key: "rawExpense", label: "原始支出", className: "bill-trend-line--raw" },
      { key: "expense", label: "过滤后支出", className: "bill-trend-line--expense" },
    ],
    category: categorySeries.length ? categorySeries : categoryFallback,
  };
  const series = seriesByMode[normalizedMode];
  const values = rows.flatMap((row) => series.map((item) => trendValue(row, item)));
  const minValue = normalizedMode === "cashflow" ? Math.min(0, ...values) : 0;
  const maxValue = Math.max(1, ...values);
  const scale = { min: minValue, max: maxValue, width: 620, height: 210, padding: 24 };
  const scopeLabel = { day: `${activeMonth} · 按日`, week: `${activeMonth} · 按周`, month: `近 ${normalizedRange} 月`, year: `近 ${normalizedRange} 年` }[normalizedScope];
  const rangeOptions = trendRangeOptions(normalizedScope);
  const activeTrendKey = getActiveTrendKey(activeMonth, normalizedScope);
  return `
    <section class="panel bill-trend-panel">
      <div class="panel-head">
        <div>
          <h2>收支趋势</h2>
          <span class="results-count">${escapeHtml(scopeLabel)} · 图内显示时间坐标</span>
        </div>
        <div class="bill-trend-control-group">
          <div class="bill-trend-tabs bill-trend-tabs--scope">
            ${[
              ["day", "日"],
              ["week", "周"],
              ["month", "月"],
              ["year", "年"],
            ]
              .map((item) => `<button class="${normalizedScope === item[0] ? "is-active" : ""}" data-bill-trend-scope="${item[0]}" type="button">${item[1]}</button>`)
              .join("")}
          </div>
          <div class="bill-trend-tabs">
            ${[
              ["cashflow", "收入支出"],
              ["budget", "预算对比"],
              ["fixed", "固定支出"],
              ["raw", "原始对比"],
              ["category", "分类对比"],
            ]
              .map((item) => `<button class="${normalizedMode === item[0] ? "is-active" : ""}" data-bill-trend-mode="${item[0]}" type="button">${item[1]}</button>`)
              .join("")}
          </div>
          ${
            rangeOptions.length
              ? `<div class="bill-trend-tabs bill-trend-tabs--range">
                  ${rangeOptions.map((item) => `<button class="${normalizedRange === item ? "is-active" : ""}" data-bill-trend-range="${item}" type="button">${item}${normalizedScope === "year" ? "年" : "月"}</button>`).join("")}
                </div>`
              : ""
          }
        </div>
      </div>
      <div class="bill-trend-chart">
        <svg viewBox="0 0 ${scale.width} ${scale.height}" role="img" aria-label="收支趋势折线图">
          <g class="bill-trend-grid">
            <line x1="24" y1="24" x2="24" y2="186"></line>
            <line x1="24" y1="186" x2="596" y2="186"></line>
            <line x1="24" y1="105" x2="596" y2="105"></line>
          </g>
          ${series.map((item) => trendCurvePath(rows, item, scale)).join("")}
          <g class="bill-trend-label-layer">
            ${series.map((item) => trendSeriesLabels(rows, item, scale, normalizedRange)).join("")}
            ${trendProblemMarkers(rows, normalizedMode, scale)}
          </g>
          ${trendAxisLabels(rows, scale, normalizedScope, activeTrendKey)}
        </svg>
      </div>
      <div class="bill-trend-legend">
        ${series.map((item) => `<span class="${escapeHtml(item.className)}"><i></i>${escapeHtml(item.label)}</span>`).join("")}
      </div>
    </section>
  `;
}

function billBudgetPanel(summary) {
  const totalUsed = summary.totalBudget > 0 ? Math.round((summary.expense / summary.totalBudget) * 100) : 0;
  const categoryRows = (summary.categoryBudgets || []).slice(0, 5).map((budget) => {
    const used = summary.categoryTotals.find((item) => item.category === budget.category)?.amount || 0;
    const percent = Number(budget.amount || 0) > 0 ? Math.round((used / Number(budget.amount || 0)) * 100) : 0;
    return { category: budget.category, used, budget: Number(budget.amount || 0), percent };
  });
  return `
    <section class="panel bill-decision-panel">
      <div class="panel-head">
        <h2>预算目标</h2>
        <span class="results-count">${summary.totalBudget ? `${totalUsed}% 已用` : "未设置总预算"}</span>
      </div>
      <div class="bill-budget-total">
        <span>本月总预算</span>
        <strong>${formatCurrency(summary.expense)} / ${formatCurrency(summary.totalBudget)}</strong>
        <i><b style="width:${Math.min(totalUsed, 100)}%"></b></i>
      </div>
      <div class="bill-budget-list">
        ${categoryRows.map((row) => `<article><span>${escapeHtml(row.category)}</span><strong>${formatCurrency(row.used)} / ${formatCurrency(row.budget)}</strong><em>${row.percent}%</em></article>`).join("") || emptyState("可在设置预算后查看分类目标")}
      </div>
    </section>
  `;
}

function billFuturePlanPanel(summary, commitments) {
  const futureExpense = commitments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const reserve = Math.max(summary.balance, 0);
  const today = new Date();
  const controlRows = commitments
    .map((item) => {
      const amount = Number(item.amount || 0);
      const dueDate = String(item.date || "").slice(0, 10);
      const dueTime = dueDate ? new Date(`${dueDate}T00:00:00`) : null;
      const dueDays = dueTime ? Math.ceil((dueTime - today) / 86400000) : 999;
      const gap = Math.max(amount - reserve, 0);
      const pressure = reserve > 0 ? amount / reserve : amount > 0 ? 99 : 0;
      const isRisk = gap > 0 || item.priority === "高" || (dueDays <= 30 && pressure >= 0.35);
      const isWatch = !isRisk && (dueDays <= 60 || pressure >= 0.2 || item.priority === "中");
      const level = isRisk ? "risk" : isWatch ? "watch" : "good";
      const action = gap > 0
        ? `缺口 ${formatCurrency(gap)}，建议拆分准备或推迟。`
        : dueDays <= 30
          ? "临近发生，建议锁定资金来源。"
          : "可控，按计划跟踪即可。";
      return { ...item, amount, dueDate, dueDays, gap, level, action };
    })
    .sort((left, right) => {
      const levelWeight = { risk: 0, watch: 1, good: 2 };
      return levelWeight[left.level] - levelWeight[right.level] || left.dueDays - right.dueDays || right.amount - left.amount;
    })
    .slice(0, 5);
  const riskCount = controlRows.filter((item) => item.level === "risk").length;
  return `
    <section class="panel bill-decision-panel">
      <div class="panel-head">
        <h2>未来计划</h2>
        <span class="results-count">${riskCount ? `${riskCount} 项高风险` : "风险可控"} · 未来 3 个月 ${formatCurrency(futureExpense)}</span>
      </div>
      <div class="bill-future-control-summary">
        <article><span>可用结余</span><strong>${formatCurrency(reserve)}</strong></article>
        <article><span>计划压力</span><strong>${formatCurrency(futureExpense)}</strong></article>
        <article><span>控制目标</span><strong>${futureExpense > reserve ? "先补缺口" : "按期准备"}</strong></article>
      </div>
      <div class="bill-future-list">
        ${controlRows.map((item) => `
          <article class="bill-future-item bill-future-item--${escapeHtml(item.level)}">
            <div>
              <strong>${escapeHtml(item.title || "未命名计划")}</strong>
              <span>${escapeHtml(item.dueDate || "未设置日期")} · ${escapeHtml(item.planType || "计划")} · ${item.dueDays < 999 ? `${Math.max(item.dueDays, 0)} 天内` : "未排期"}</span>
            </div>
            <em>${formatCurrency(item.amount)}</em>
            <p>${escapeHtml(item.action)}</p>
            ${item.source === "plan" ? `<button class="ghost-button" data-future-plan-status="${escapeHtml(item.id)}" data-next-status="${item.status === "已准备" ? "计划中" : "已准备"}" type="button">${item.status === "已准备" ? "转计划" : "已准备"}</button><button class="ghost-button danger-button" data-delete-future-plan="${escapeHtml(item.id)}" type="button">删除</button>` : `<span class="tag">订阅</span>`}
          </article>
        `).join("") || emptyState("暂无未来计划，建议录入保险、学费、旅行、大件消费等")}
      </div>
    </section>
  `;
}

function billMonthlyReviewPanel(summary, risks) {
  const topCategory = summary.categoryTotals[0];
  const reviewText = summary.balance < 0 ? "现金流为负，优先处理风险提醒。" : summary.income <= 0 ? "缺少收入数据，先补录工资。" : "现金流为正，继续观察预算和未来计划。";
  return `
    <section class="panel bill-decision-panel">
      <div class="panel-head">
        <h2>月度复盘</h2>
        <span class="results-count">${escapeHtml(summary.month)}</span>
      </div>
      <div class="bill-review-grid">
        <article><span>复盘判断</span><strong>${escapeHtml(reviewText)}</strong></article>
        <article><span>最大支出</span><strong>${topCategory ? `${topCategory.category} ${formatCurrency(topCategory.amount)}` : "暂无支出"}</strong></article>
        <article><span>待处理风险</span><strong>${risks.filter((item) => item.level !== "good").length} 项</strong></article>
      </div>
      <button class="ghost-button" data-create-bill-review="${escapeHtml(summary.month)}" type="button">保存为复盘笔记</button>
    </section>
  `;
}

function billLedgerRow(bill, activeMonth) {
  const isIncome = isIncomeBill(bill);
  const monthKey = String(bill.date || "").slice(0, 7);
  const excluded = Boolean(bill.excludeFromAnalysis || bill.analysisExcluded);
  return `
    <tr data-bill-ledger-row data-bill-month-key="${escapeHtml(monthKey)}" ${monthKey === activeMonth ? "" : "hidden"}>
      <td><strong>${escapeHtml(bill.date || "未设置")}</strong></td>
      <td>
        <div class="bill-ledger-title">
          <strong>${escapeHtml(bill.title || "未命名流水")}</strong>
          <span>${escapeHtml(bill.note || bill.goods || bill.remark || "")}</span>
          ${excluded ? '<em>不计入分析</em>' : ""}
        </div>
      </td>
      <td>
        <div class="bill-ledger-category-editor">
          <input data-bill-category-input="${escapeHtml(bill.id)}" value="${escapeHtml(bill.category || "未分类")}" list="billCategoryOptions" aria-label="分类" />
          <button class="ghost-button" data-bill-category-save="${escapeHtml(bill.id)}" type="button">保存</button>
        </div>
      </td>
      <td>${escapeHtml(bill.payer || bill.familyMember || "未指定")}</td>
      <td>${escapeHtml(bill.source || "手动")}</td>
      <td class="money ${isIncome ? "income" : "expense"}">${isIncome ? "+" : "-"}${formatCurrency(bill.amount)}</td>
      <td>
        <div class="bill-ledger-actions">
          <button class="ghost-button" data-bill-rule-confirm="${escapeHtml(bill.id)}" type="button">记规则</button>
          <button class="ghost-button" data-bill-analysis-exclude="${escapeHtml(bill.id)}" data-next-excluded="${excluded ? "false" : "true"}" type="button">${excluded ? "计入" : "不计入"}</button>
          <button class="ghost-button" data-edit="bills:${escapeHtml(bill.id)}" type="button">编辑</button>
          <button class="ghost-button" data-bill-ledger-detail="${escapeHtml(bill.id)}" type="button">详情</button>
        </div>
      </td>
    </tr>
  `;
}

function billLedgerRuleBoard(classificationRules = [], nonConsumptionRules = []) {
  const classificationRows = (classificationRules || []).slice(0, 6);
  const nonConsumptionRows = (nonConsumptionRules || []).slice(0, 6);
  return `
    <section class="bill-ledger-rules">
      <details>
        <summary>
          <span>分类规则</span>
          <em>${classificationRules.length} 条</em>
        </summary>
        <form class="bill-ledger-rule-form" id="billClassificationRuleForm">
          <input name="keyword" placeholder="关键词" autocomplete="off" />
          <input name="category" placeholder="分类" list="billCategoryOptions" autocomplete="off" />
          <input name="fixedExpenseType" placeholder="固定类型，可选" autocomplete="off" />
          <button class="ghost-button" type="submit">新增</button>
        </form>
        <div class="bill-ledger-rule-list">
          ${
            classificationRows
              .map(
                (rule) => `
                  <article>
                    <div>
                      <strong>${escapeHtml(rule.keyword || "未命名规则")}</strong>
                      <span>${escapeHtml(rule.category || "未分类")} · ${escapeHtml(rule.updatedAt || "")}</span>
                    </div>
                    <button class="ghost-button" data-bill-rule-apply="${escapeHtml(rule.id)}" type="button">应用</button>
                    <button class="ghost-button danger-button" data-bill-rule-delete="${escapeHtml(rule.id)}" type="button">删除</button>
                  </article>
                `,
              )
              .join("") || emptyState("暂无分类规则")
          }
        </div>
      </details>
      <details>
        <summary>
          <span>不计入规则</span>
          <em>${nonConsumptionRules.length} 条</em>
        </summary>
        <form class="bill-ledger-rule-form bill-ledger-rule-form--compact" id="billNonConsumptionRuleForm">
          <input name="keyword" placeholder="关键词，例如：亲属卡 / 转账" autocomplete="off" />
          <input name="note" placeholder="备注，可选" autocomplete="off" />
          <button class="ghost-button" type="submit">新增</button>
        </form>
        <div class="bill-ledger-rule-list">
          ${
            nonConsumptionRows
              .map(
                (rule) => `
                  <article>
                    <div>
                      <strong>${escapeHtml(rule.keyword || "未命名规则")}</strong>
                      <span>${escapeHtml(rule.note || "命中后不计入分析")} · ${escapeHtml(rule.updatedAt || "")}</span>
                    </div>
                    <button class="ghost-button danger-button" data-bill-non-consumption-rule-delete="${escapeHtml(rule.id)}" type="button">删除</button>
                  </article>
                `,
              )
              .join("") || emptyState("暂无不计入规则")
          }
        </div>
      </details>
    </section>
  `;
}

function billLedgerModal(allBills, activeMonth, data = {}) {
  const months = getBillHistoryRows(allBills || []).map((row) => row.month);
  const normalizedMonths = months.includes(activeMonth) ? months : [activeMonth, ...months].filter(Boolean);
  const rows = [...(allBills || [])].sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  const monthCount = rows.filter((bill) => String(bill.date || "").startsWith(activeMonth)).length;
  const categoryOptions = [...new Set((allBills || []).map((bill) => bill.category).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"));
  return `
    <dialog class="modal bill-ledger-modal" id="billLedgerModal">
      <section class="modal-panel bill-ledger-modal__panel">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">ORIGINAL LEDGER</p>
            <h2>完整流水</h2>
          </div>
          <button class="icon-button" id="closeBillLedgerModal" type="button" aria-label="关闭">×</button>
        </div>
        <div class="bill-ledger-tools">
          <div class="bill-ledger-months" aria-label="月份筛选">
            ${normalizedMonths
              .map(
                (month) => `
                  <button class="${month === activeMonth ? "is-active" : ""}" data-bill-ledger-month="${escapeHtml(month)}" type="button">
                    ${escapeHtml(month)}
                  </button>
                `,
              )
              .join("")}
          </div>
          <span class="results-count" data-bill-ledger-count>${escapeHtml(activeMonth)} · ${monthCount} 条</span>
        </div>
        ${billLedgerRuleBoard(data.billClassificationRules || [], data.billNonConsumptionRules || [])}
        <div class="bill-ledger-table-wrap">
          <datalist id="billCategoryOptions">
            ${categoryOptions.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}
          </datalist>
          <table class="bill-ledger-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>流水</th>
                <th>分类</th>
                <th>归属</th>
                <th>来源</th>
                <th>金额</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((bill) => billLedgerRow(bill, activeMonth)).join("") || `<tr><td colspan="7">${emptyState("暂无流水")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </dialog>
  `;
}

function futurePlanEntryPanel(month) {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <section class="panel finance-entry-panel future-plan-entry-panel">
      <div class="panel-head">
        <h2>未来计划录入</h2>
        <span class="results-count">收入 / 支出 / 还款</span>
      </div>
      <form class="quick-note-form finance-entry-form" id="futurePlanForm">
        <div class="form-grid">
          <label>
            计划类型
            <select name="planType">
              <option value="计划支出">计划支出</option>
              <option value="计划收入">计划收入</option>
              <option value="固定支出">固定支出</option>
              <option value="还款">还款</option>
              <option value="保险">保险</option>
              <option value="学费">学费</option>
              <option value="旅行">旅行</option>
              <option value="大件消费">大件消费</option>
            </select>
          </label>
          <label>
            金额
            <input name="amount" type="number" step="0.01" placeholder="0.00" />
          </label>
        </div>
        <label>
          计划名称
          <input name="title" placeholder="例如：9 月保险续费" />
        </label>
        <div class="form-grid">
          <label>
            预计日期
            <input name="date" type="text" data-date-input value="${escapeHtml(today)}" autocomplete="off" />
          </label>
          <label>
            优先级
            <select name="priority">
              <option value="高">高</option>
              <option value="中">中</option>
              <option value="低">低</option>
            </select>
          </label>
        </div>
        <label>
          资金来源
          <input name="fundingSource" placeholder="工资 / 储蓄 / 奖金 / 报销" />
        </label>
        <label>
          备注
          <input name="note" placeholder="记录准备方式或注意事项" />
        </label>
        <button class="primary-button" type="submit">保存计划</button>
      </form>
    </section>
  `;
}

function billTimelineNode(day, summary, active) {
  const hasFlow = summary.income > 0 || summary.expense > 0;
  return `
    <button class="bill-time-node ${active ? "is-active" : ""} ${hasFlow ? "has-flow" : ""}" data-bill-timeline-day="${escapeHtml(day.key)}" type="button">
      <span><strong>${escapeHtml(String(day.day).padStart(2, "0"))}</strong><b>周${escapeHtml(day.weekday)}</b></span>
      <small>
        <em class="bill-time-income">+${formatCurrency(summary.income)}</em>
        <em class="bill-time-expense">-${formatCurrency(summary.expense)}</em>
      </small>
    </button>
  `;
}

function billTimelinePanel(allBills, activeMonth, scope = "week") {
  const normalizedScope = ["week", "month", "year"].includes(scope) ? scope : "week";
  const analysisBills = (allBills || []).filter((item) => !item.excludeFromAnalysis);
  const monthItems = analysisBills.filter((item) => String(item.date || "").startsWith(activeMonth));
  const dayMap = summarizeBillsByDate(monthItems);
  const days = getMonthDays(activeMonth);
  const todayKey = getDateKey(new Date());
  const { year } = getMonthDateParts(activeMonth);
  const monthRows = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    const bills = analysisBills.filter((item) => String(item.date || "").startsWith(key));
    const income = sumBills(bills.filter(isIncomeBill));
    const expense = sumBills(bills.filter(isExpenseBill));
    return { key, income, expense, balance: income - expense };
  });

  const body =
    normalizedScope === "year"
      ? `<div class="bill-year-timeline">
          ${monthRows
            .map(
              (row) => `
                <button class="bill-month-node ${row.key === activeMonth ? "is-active" : ""}" data-bill-timeline-month="${escapeHtml(row.key)}" type="button">
                  <span><strong>${escapeHtml(row.key.slice(5))}月</strong><b>${escapeHtml(String(year))}</b></span>
                  <strong>${formatCurrency(row.balance)}</strong>
                  <small><em class="bill-time-income">+${formatCurrency(row.income)}</em><em class="bill-time-expense">-${formatCurrency(row.expense)}</em></small>
                </button>
              `,
            )
            .join("")}
        </div>`
      : `<div class="bill-week-timeline bill-week-timeline--${escapeHtml(normalizedScope)}">
          <div class="bill-week-timeline__days" data-draggable="${normalizedScope === "week" ? "true" : "false"}">
            ${days
              .map((day) => billTimelineNode(day, dayMap[day.key] || { income: 0, expense: 0 }, day.key === todayKey))
              .join("")}
          </div>
        </div>`;

  return `
    <section class="panel bill-timeline-panel">
      <div class="bill-timeline-panel__head">
        <div class="bill-timeline-tabs" aria-label="时间口径">
          ${[
            ["week", "周"],
            ["month", "月"],
            ["year", "年"],
          ]
            .map(
              ([value, label]) => `
                <button class="${normalizedScope === value ? "is-active" : ""}" data-bill-timeline-scope="${value}" type="button">${label}</button>
              `,
            )
            .join("")}
        </div>
        <div class="bill-timeline-actions">
          <button class="ghost-button" data-open-bill-ledger type="button">完整流水</button>
          <button class="ghost-button" data-bill-timeline-today type="button">今天</button>
        </div>
      </div>
      <div class="bill-timeline-panel__body">
        ${body}
      </div>
    </section>
  `;
}

function financeEntryPanel(month) {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <section class="panel finance-entry-panel">
      <div class="panel-head">
        <h2>财务录入</h2>
        <span class="results-count">收入 / 还款</span>
      </div>
      <div class="finance-entry-grid">
        <form class="quick-note-form finance-entry-form" id="incomeEntryForm">
          <div class="form-grid">
            <label>
              收入类型
              <select name="incomeType">
                <option value="工资">工资</option>
                <option value="奖金">奖金</option>
                <option value="副业">副业</option>
                <option value="理财">理财</option>
                <option value="报销">报销</option>
                <option value="其他收入">其他收入</option>
              </select>
            </label>
            <label>
              金额
              <input name="amount" type="number" step="0.01" placeholder="0.00" />
            </label>
          </div>
          <div class="form-grid">
            <label>
              日期
              <input name="date" type="text" data-date-input value="${escapeHtml(today)}" autocomplete="off" />
            </label>
            <label>
              归属
              <select name="payer">
                <option value="家庭账户">家庭账户</option>
                <option value="男方">男方</option>
                <option value="女方">女方</option>
                <option value="共同">共同</option>
              </select>
            </label>
          </div>
          <label>
            收入名称
            <input name="title" placeholder="例如：6 月工资" />
          </label>
          <button class="primary-button" type="submit">保存收入</button>
        </form>
        <form class="quick-note-form finance-entry-form" id="repaymentEntryForm">
          <div class="form-grid">
            <label>
              还款类型
              <select name="repaymentType">
                <option value="信用卡">信用卡</option>
                <option value="房贷">房贷</option>
                <option value="车贷">车贷</option>
                <option value="购物平台">购物平台</option>
                <option value="亲属卡">亲属卡</option>
                <option value="其他还款">其他还款</option>
              </select>
            </label>
            <label>
              金额
              <input name="amount" type="number" step="0.01" placeholder="0.00" />
            </label>
          </div>
          <div class="form-grid">
            <label>
              日期
              <input name="date" type="text" data-date-input value="${escapeHtml(today)}" autocomplete="off" />
            </label>
            <label>
              承担人
              <select name="payer">
                <option value="家庭账户">家庭账户</option>
                <option value="男方">男方</option>
                <option value="女方">女方</option>
                <option value="共同">共同</option>
              </select>
            </label>
          </div>
          <label>
            还款名称
            <input name="title" placeholder="例如：招商信用卡还款" />
          </label>
          <button class="primary-button" type="submit">保存还款</button>
        </form>
      </div>
    </section>
  `;
}

function renderBills(elements, data, ui, store) {
  renderControls(elements, data, ui, "bills");
  const fallbackMonth = getBillHistoryRows(data.bills || [])[0]?.month || data.budgets?.month || new Date().toISOString().slice(0, 7);
  const month = ui.filters.billMonth || data.budgets?.viewMonth || fallbackMonth;
  const timelineScope = ui.filters.billTimelineScope || "week";
  const trendMode = ui.filters.billTrendMode || "cashflow";
  const trendScope = ui.filters.billTrendScope || "month";
  const trendRange = ui.filters.billTrendRange || 6;
  const summary = getMonthlyFinanceSummary(data, month);
  const commitments = getFutureCommitments(data, month);
  const risks = buildFinanceRisks(summary, commitments);

  elements.contentArea.innerHTML = `
    <div class="bill-dashboard-layout">
      <main class="bill-dashboard-layout__main">
        ${billTimelinePanel(data.bills || [], month, timelineScope)}
        ${billTrendPanel(data, month, trendMode, trendRange, trendScope)}
        ${billDecisionStrip(summary, commitments)}
        <div class="bill-decision-grid">
          ${billAnalysisPanel(summary)}
          ${billRiskPanel(risks)}
        </div>
        <div class="bill-decision-grid">
          ${billBudgetPanel(summary)}
          ${billFuturePlanPanel(summary, commitments)}
        </div>
        ${billMonthlyReviewPanel(summary, risks)}
      </main>
      <aside class="bill-dashboard-layout__side">
        ${financeEntryPanel(month)}
        ${futurePlanEntryPanel(month)}
      </aside>
    </div>
    ${billLedgerModal(data.bills || [], month, data)}
  `;
}

function subscriptionDistributionRows(rows, totalAmount) {
  return rows
    .slice(0, 4)
    .map((row) => {
      const percent = Math.round((Number(row.amount || 0) / Math.max(totalAmount, 1)) * 100);
      return `
        <article class="subscription-distribution-row">
          <div>
            <strong>${escapeHtml(row.label)}</strong>
            <span>${row.count} 项</span>
          </div>
          <div class="subscription-distribution-meter"><i style="width:${percent}%"></i></div>
          <em>${formatCurrency(row.amount)} / 月</em>
        </article>
      `;
    })
    .join("");
}

function renderSubscriptionMaturityPanel(overview) {
  const nextItem = overview.upcoming[0] || overview.items[0];
  const riskLabel = overview.expired.length
    ? `已过期 ${overview.expired.length} 项`
    : overview.urgent.length
      ? `临期 ${overview.urgent.length} 项`
      : "状态稳定";
  return `
    <section class="panel subscription-maturity-panel">
      <div class="subscription-maturity-lead">
        <span class="eyebrow">Subscription Control</span>
        <h2>订阅管理总览</h2>
        <p>优先看临期风险、月均成本、扣费归属和付款渠道，保证订阅不会漏扣、重复扣或忘记复盘。</p>
      </div>
      <div class="subscription-maturity-grid">
        <article class="subscription-maturity-card ${overview.urgent.length ? "is-alert" : ""}">
          <span>到期风险</span>
          <strong>${escapeHtml(riskLabel)}</strong>
          <em>${nextItem ? `${escapeHtml(nextItem.name)} · ${escapeHtml(nextItem.reminderLabel || "")}` : "暂无订阅"}</em>
        </article>
        <article class="subscription-maturity-card">
          <span>月均成本</span>
          <strong>${formatCurrency(overview.estimatedMonthlyCost)}</strong>
          <em>年化 ${formatCurrency(overview.estimatedAnnualCost)}</em>
        </article>
        <article class="subscription-maturity-card">
          <span>续费方式</span>
          <strong>${overview.autoRenewing.length} 自动 / ${overview.manualRenewing.length} 手动</strong>
          <em>手动项目需在到期前确认</em>
        </article>
        <article class="subscription-maturity-card">
          <span>复盘队列</span>
          <strong>${overview.reviewQueue.length} 项</strong>
          <em>按使用频率、必要性和满意度判断</em>
        </article>
      </div>
    </section>
  `;
}

function renderSubscriptionDistributionPanel(overview) {
  return `
    <div class="subscription-distribution-grid">
      <section class="panel subscription-distribution-panel">
        <div class="panel-head">
          <h2>归属分布</h2>
          <span class="results-count">谁在使用 / 谁承担</span>
        </div>
        <div class="subscription-distribution-list">
          ${subscriptionDistributionRows(overview.ownerTotals, overview.estimatedMonthlyCost) || emptyState("暂无归属数据")}
        </div>
      </section>
      <section class="panel subscription-distribution-panel">
        <div class="panel-head">
          <h2>付款渠道</h2>
          <span class="results-count">扣费从哪里走</span>
        </div>
        <div class="subscription-distribution-list">
          ${subscriptionDistributionRows(overview.paymentTotals, overview.estimatedMonthlyCost) || emptyState("暂无付款渠道")}
        </div>
      </section>
    </div>
  `;
}

function renderSubscriptionForm() {
  return `
    <section class="panel subscription-entry-panel">
      <form class="quick-note-form" id="subscriptionForm">
        <div class="panel-head">
          <h2>新增订阅</h2>
          <span class="results-count">录入后自动进入提醒、预测和复盘</span>
        </div>
        <div class="form-grid">
          <label>
            项目名称
            <input name="name" placeholder="例如：iCloud+ / Figma / Notion" />
          </label>
          <label>
            订阅金额
            <input name="amount" type="number" step="0.01" placeholder="输入期内扣费金额" />
          </label>
        </div>
        <div class="form-grid">
          <label>
            续费周期
            <select name="cycle">
              <option value="monthly">月付</option>
              <option value="quarterly">季付</option>
              <option value="yearly">年付</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label>
            下次到期
            <input name="nextRenewalDate" type="text" data-date-input placeholder="YYYY-MM-DD" autocomplete="off" />
          </label>
        </div>
        <div class="form-grid">
          <label>
            分类
            <input name="category" placeholder="例如：工具 / 影音 / 存储" />
          </label>
          <label>
            归属人
            <select name="owner">
              <option value="家庭账户">家庭账户</option>
              <option value="男方">男方</option>
              <option value="女方">女方</option>
              <option value="共同">共同</option>
              <option value="孩子相关">孩子相关</option>
            </select>
          </label>
        </div>
        <div class="form-grid">
          <label>
            付款渠道
            <input name="paymentMethod" placeholder="例如：支付宝 / 微信 / 信用卡 / App Store" />
          </label>
          <label>
            关联项目
            <input name="projectId" placeholder="例如：个人网站工作" />
          </label>
        </div>
        <div class="form-grid">
          <label>
            网址
            <input name="websiteUrl" placeholder="https://example.com" />
          </label>
          <label>
            登录账号
            <input name="accountName" placeholder="邮箱 / 手机号 / 用户名" autocomplete="off" />
          </label>
        </div>
        <label>
          登录密码
          <input name="accountPassword" type="password" placeholder="可选，仅本地保存时填写" autocomplete="new-password" />
        </label>
        <label>
          备注
          <input name="note" placeholder="记录费用说明、容量档位或取消注意点" />
        </label>
        <div class="form-grid">
          <label>
            使用频率
            <select name="usageFrequency">
              <option value="unknown">暂未记录</option>
              <option value="high">高频</option>
              <option value="occasional">偶尔</option>
              <option value="rare">几乎不用</option>
            </select>
          </label>
          <label>
            必要性
            <select name="necessity">
              <option value="optional">可取消</option>
              <option value="essential">必需</option>
              <option value="replaceable">可替代</option>
            </select>
          </label>
        </div>
        <div class="form-grid">
          <label>
            满意度
            <input name="satisfaction" type="number" min="1" max="5" step="1" placeholder="1-5" />
          </label>
          <label>
            最近使用
            <input name="lastUsedAt" type="text" data-date-input placeholder="YYYY-MM-DD" autocomplete="off" />
          </label>
        </div>
        <div class="form-grid">
          <label>
            上次复盘
            <input name="lastReviewedAt" type="text" data-date-input placeholder="YYYY-MM-DD" autocomplete="off" />
          </label>
          <label>
            下次复盘
            <input name="nextReviewDate" type="text" data-date-input placeholder="YYYY-MM-DD" autocomplete="off" />
          </label>
        </div>
        <div class="form-grid">
          <label class="setting-toggle">
            <input name="autoRenew" type="checkbox" checked />
            <span>自动续费</span>
          </label>
          <label>
            状态
            <select name="status">
              <option value="active">使用中</option>
              <option value="paused">已暂停</option>
              <option value="cancelled">已取消</option>
            </select>
          </label>
        </div>
        <div class="topbar-actions">
          <button class="primary-button" type="submit">保存订阅</button>
        </div>
      </form>
    </section>
  `;
}

function subscriptionCompactRow(item) {
  const isCritical = item.level === "urgent" || item.level === "expired";
  const cycleLabel =
    item.cycle === "yearly" ? "年付" : item.cycle === "quarterly" ? "季付" : item.cycle === "monthly" ? "月付" : "自定义";
  return `
    <article class="subscription-row subscription-row--${escapeHtml(item.level || "normal")}">
      <div class="subscription-row__main">
        <div class="meta-row">
          <span class="tag ${isCritical ? "tag-danger" : ""}">${escapeHtml(item.reminderLabel || "正常跟进")}</span>
          <span>${escapeHtml(item.nextRenewalDate || "未设置")}</span>
          ${item.autoRenew ? '<span class="tag">自动续费</span>' : '<span class="tag">手动续费</span>'}
        </div>
        <strong>${escapeHtml(item.name)}</strong>
        <span class="muted-text">${escapeHtml(item.category || "订阅")} · ${escapeHtml(cycleLabel)} · ${escapeHtml(item.owner || "家庭账户")} · ${escapeHtml(item.paymentMethod || "未指定渠道")}</span>
      </div>
      <div class="subscription-row__money">
        <strong>${formatCurrency(item.amount)}</strong>
        <span>月均 ${formatCurrency(item.monthlyCost || item.amount)}</span>
      </div>
      <div class="subscription-row__actions">
        <button class="ghost-button" data-subscription-bill="${escapeHtml(item.id)}" type="button">记账</button>
        <button class="primary-button" data-subscription-renew="${escapeHtml(item.id)}" type="button">续费</button>
        <button class="ghost-button" data-subscription-review="${escapeHtml(item.id)}" type="button">复盘</button>
      </div>
    </article>
  `;
}

function renderSubscriptions(elements, data, ui, store) {
  elements.filterRow.innerHTML = "";
  const overview = store.getSubscriptionsOverview();
  const notificationSettings = loadSubscriptionNotificationSettings();
  const reminderGroups = groupSubscriptionReminders(overview.items);
  const items = filterCollection(
    overview.items.map((item) => ({
      ...item,
      title: item.name,
      date: item.nextRenewalDate,
      entryType: "subscriptions",
    })),
    { ...ui, activeChip: "all", filters: { ...ui.filters, status: "all", tag: "all" } },
    { fixedType: "subscriptions" },
  );

  elements.contentArea.innerHTML = `
    <div class="stats-grid">
      ${statCard("订阅数量", overview.total, "当前在跟进的订阅")}
      ${statCard("月均成本", formatCurrency(overview.estimatedMonthlyCost), "折算后的月度压力")}
      ${statCard("待复盘", overview.reviewQueue.length, "续费前需要判断的订阅")}
    </div>
    ${renderSubscriptionMaturityPanel(overview)}
    ${renderSubscriptionForm()}
    <section class="panel subscription-list-panel subscription-detail-card-panel">
      <div class="panel-head">
        <h2>订阅详情卡片</h2>
        <span class="results-count">共 ${items.length} 项</span>
      </div>
      <div class="card-grid compact-card-grid subscription-detail-card-grid">
        ${items.map(subscriptionCard).join("") || emptyState("还没有记录订阅项目")}
      </div>
    </section>
    <section class="panel subscription-due-panel">
      <div class="panel-head">
        <h2>到期提醒</h2>
        <span class="results-count">30 天内 ${overview.upcoming.length} 项</span>
      </div>
      <div class="subscription-due-list">
        ${
          overview.upcoming
            .map(
              (item) => `
                <article class="search-result-card subscription-alert subscription-alert--${escapeHtml(item.level || "normal")}">
                  <div class="meta-row">
                    <span class="tag ${item.level === "urgent" || item.level === "expired" ? "tag-danger" : ""}">${escapeHtml(item.reminderLabel)}</span>
                    <span>${escapeHtml(item.nextRenewalDate || "未设置")}</span>
                    ${item.autoRenew ? '<span class="tag">自动续费</span>' : '<span class="tag">手动续费</span>'}
                  </div>
                  <strong>${escapeHtml(item.name)}</strong>
                  <p>${formatCurrency(item.amount)} / 月均 ${formatCurrency(item.monthlyCost)}</p>
                </article>
              `,
            )
            .join("") || emptyState("30 天内没有到期订阅")
        }
      </div>
    </section>
  `;
}

function getFavorBalanceLabel(balance) {
  const value = Number(balance || 0);
  if (value > 0) return "需回礼";
  if (value < 0) return "我方多给";
  return "平衡";
}

function formatRelationType(relationType) {
  const value = String(relationType || "其他").trim() || "其他";
  const legacyRelation = ["亲", "友"].join("");
  return value === legacyRelation ? "亲戚" : value;
}

function relationshipLedgerRow(item) {
  const { contact, received, given, balance, count, lastDate } = item;
  const balanceValue = Number(balance || 0);
  const balanceLevel = balanceValue > 0 ? "attention" : balanceValue < 0 ? "given" : "balanced";
  const balanceLabel = getFavorBalanceLabel(balanceValue);
  const balanceOwner = balanceValue > 0 ? "我欠TA" : balanceValue < 0 ? "TA欠我" : "不相欠";
  const noteHtml = contact.note ? `<span class="relationship-row__note">${escapeHtml(contact.note)}</span>` : "";
  return `
    <article
      class="relationship-row relationship-row--${escapeHtml(balanceLevel)}"
      data-open="contacts:${escapeHtml(contact.id)}"
      data-contact-search="${escapeHtml([getPinyinSearchText(contact.name), contact.relationType, contact.phone, contact.note].filter(Boolean).join(" "))}"
      data-contact-relation="${escapeHtml(formatRelationType(contact.relationType))}"
      data-contact-balance="${escapeHtml(balanceValue > 0 ? "iOwe" : balanceValue < 0 ? "theyOwe" : "balanced")}"
      tabindex="0"
    >
      <div class="relationship-row__head">
        <div class="relationship-row__identity">
          <strong>${escapeHtml(contact.name)}</strong>
          ${noteHtml}
        </div>
        <div class="relationship-row__tags">
          <span>${escapeHtml(formatRelationType(contact.relationType))}</span>
          <span class="relationship-row__status">${escapeHtml(balanceLabel)}</span>
        </div>
      </div>
      <div class="relationship-row__balance">
        <strong><em>${escapeHtml(balanceOwner)}</em>${formatCurrency(Math.abs(balanceValue))}</strong>
      </div>
      <div class="relationship-row__metrics">
        <span><b>收</b>${formatCurrency(received)}</span>
        <span><b>给</b>${formatCurrency(given)}</span>
      </div>
      <div class="relationship-row__meta">
        <span>${count} 次往来</span>
        <span>${escapeHtml(lastDate || "暂无日期")}</span>
      </div>
    </article>
  `;
}

function contactFilterControls(ui, contacts) {
  const selectedRelation = ui.filters.favorRelation || "all";
  const selectedBalance = ui.filters.favorBalance || "all";
  const relationChoices = ["all", ...favorRelationTypes]
    .map((relation) => {
      const label = relation === "all" ? "全部关系" : relation;
      return `
        <label class="choice-pill favor-filter-pill">
          <input name="favorRelation" type="radio" value="${escapeHtml(relation)}" ${selectedRelation === relation ? "checked" : ""} />
          <span>${escapeHtml(label)}</span>
        </label>
      `;
    })
    .join("");
  const balanceChoices = [
    ["all", "全部差额"],
    ["iOwe", "我欠TA"],
    ["theyOwe", "TA欠我"],
    ["balanced", "不相欠"],
  ]
    .map(
      ([value, label]) => `
        <label class="choice-pill favor-filter-pill">
          <input name="favorBalance" type="radio" value="${escapeHtml(value)}" ${selectedBalance === value ? "checked" : ""} />
          <span>${escapeHtml(label)}</span>
        </label>
      `,
    )
    .join("");
  return `
    <div class="favor-ledger-tools">
      <label class="favor-search-panel">
        <span>搜索人物</span>
        <input id="favorContactSearch" value="${escapeHtml(ui.filters.favorContactSearch || "")}" placeholder="输入姓名、电话或备注" />
      </label>
      <fieldset class="favor-filter-group favor-filter-group--relation">
        <legend>关系</legend>
        <div class="choice-grid">${relationChoices}</div>
      </fieldset>
      <fieldset class="favor-filter-group favor-filter-group--balance">
        <legend>差额</legend>
        <div class="choice-grid choice-grid--compact">${balanceChoices}</div>
      </fieldset>
      <span id="favorLedgerFilterCount">${contacts.length} / ${contacts.length} 人</span>
    </div>
  `;
}

function summarizeFavorEvents(events) {
  const received = events.filter((event) => event.direction === "received").reduce((sum, event) => sum + Number(event.amount || 0), 0);
  const given = events.filter((event) => event.direction === "given").reduce((sum, event) => sum + Number(event.amount || 0), 0);
  return { count: events.length, received, given, balance: received - given };
}

function buildFavorMonthTrend(events, year = "") {
  const months = Array.from({ length: 12 }, (_, index) => `${year || new Date().getFullYear()}-${String(index + 1).padStart(2, "0")}`);
  return months.map((month) => {
    const items = events.filter((event) => String(event.date || "").startsWith(month));
    return { month, ...summarizeFavorEvents(items) };
  });
}

function buildFavorPeriodOverview(events) {
  const today = new Date();
  const currentMonth = today.toISOString().slice(0, 7);
  const currentYear = today.toISOString().slice(0, 4);
  const monthEvents = events.filter((event) => String(event.date || "").startsWith(currentMonth));
  const yearEvents = events.filter((event) => String(event.date || "").startsWith(currentYear));
  const monthlyRows = Object.entries(
    events.reduce((map, event) => {
      const month = String(event.date || "").slice(0, 7);
      if (!month) return map;
      if (!map[month]) map[month] = [];
      map[month].push(event);
      return map;
    }, {}),
  )
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, 12)
    .map(([month, items]) => ({ month, ...summarizeFavorEvents(items) }));

  return {
    currentMonth,
    currentYear,
    month: summarizeFavorEvents(monthEvents),
    year: summarizeFavorEvents(yearEvents),
    monthlyRows,
  };
}

function getYearFromDate(dateText) {
  return String(dateText || "").slice(0, 4) || "未记录";
}

function getLastFavorDate(events) {
  return events.map((event) => event.date || event.updatedAt || event.createdAt || "").sort((left, right) => String(right).localeCompare(String(left)))[0] || "";
}

function daysSince(dateText) {
  if (!dateText) return null;
  const target = new Date(dateText);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000));
}

function buildFavorInsightOverview(events, contacts) {
  const annualRows = Object.entries(
    events.reduce((map, event) => {
      const year = getYearFromDate(event.date);
      if (!map[year]) map[year] = [];
      map[year].push(event);
      return map;
    }, {}),
  )
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([year, items]) => ({ year, ...summarizeFavorEvents(items) }));

  const eventTypeRows = Object.entries(
    events.reduce((map, event) => {
      const type = event.eventType || "其他";
      if (!map[type]) map[type] = [];
      map[type].push(event);
      return map;
    }, {}),
  )
    .map(([eventType, items]) => ({ eventType, ...summarizeFavorEvents(items) }))
    .sort((left, right) => right.count - left.count || Math.abs(right.balance) - Math.abs(left.balance));

  const reminders = contacts
    .map((contact) => {
      const related = events.filter((event) => event.contactId === contact.id);
      const summary = summarizeFavorEvents(related);
      const lastDate = getLastFavorDate(related);
      const idleDays = daysSince(lastDate);
      const reasons = [];
      if (summary.balance >= 500) reasons.push(`收到多 ${formatCurrency(summary.balance)}`);
      if (summary.balance <= -500) reasons.push(`给出多 ${formatCurrency(Math.abs(summary.balance))}`);
      if (idleDays !== null && idleDays >= 365) reasons.push(`已 ${idleDays} 天无新往来`);
      return { contact, ...summary, lastDate, idleDays, reasons };
    })
    .filter((item) => item.reasons.length > 0)
    .sort((left, right) => Math.abs(right.balance) - Math.abs(left.balance) || (right.idleDays || 0) - (left.idleDays || 0))
    .slice(0, 8);

  return { annualRows, eventTypeRows, reminders };
}

function favorInsightPanels(overview) {
  return `
    <div class="favor-insight-grid">
      <section class="panel favor-insight-panel">
        <div class="panel-head">
          <h2>年度详情</h2>
          <span class="results-count">按年份汇总收给差额</span>
        </div>
        <div class="favor-table-list">
          ${
            overview.annualRows
              .map(
                (row) => `
                  <article class="favor-table-row favor-table-row--${row.balance >= 0 ? "received" : "given"}" data-open="favor-year:${escapeHtml(row.year)}" tabindex="0">
                    <div class="favor-table-row__main">
                      <strong>${escapeHtml(row.year)}</strong>
                      <span>${row.count} 次往来</span>
                    </div>
                    <div class="favor-table-row__flow">
                      <span>收 ${formatCurrency(row.received)}</span>
                      <span>给 ${formatCurrency(row.given)}</span>
                    </div>
                    <b>${formatCurrency(row.balance)}</b>
                  </article>
                `,
              )
              .join("") || emptyState("暂无年度数据")
          }
        </div>
      </section>
      <section class="panel favor-insight-panel">
        <div class="panel-head">
          <h2>事件类型统计</h2>
          <span class="results-count">婚礼、满月、乔迁等场景</span>
        </div>
        <div class="favor-table-list">
          ${
            overview.eventTypeRows
              .map(
                (row) => `
                  <article class="favor-table-row favor-table-row--${row.balance >= 0 ? "received" : "given"}" data-open="favor-type:${escapeHtml(row.eventType)}" tabindex="0">
                    <div class="favor-table-row__main">
                      <strong>${escapeHtml(row.eventType)}</strong>
                      <span>${row.count} 次往来</span>
                    </div>
                    <div class="favor-table-row__flow">
                      <span>收 ${formatCurrency(row.received)}</span>
                      <span>给 ${formatCurrency(row.given)}</span>
                    </div>
                    <b>${formatCurrency(row.balance)}</b>
                  </article>
                `,
              )
              .join("") || emptyState("暂无事件类型数据")
          }
        </div>
      </section>
      <section class="panel favor-insight-panel favor-insight-panel--reminders">
        <div class="panel-head">
          <h2>提醒机制</h2>
          <span class="results-count">差额、未回访、长期无往来</span>
        </div>
        <div class="favor-reminder-list">
          ${
            overview.reminders
              .map(
                (item) => `
                  <article class="favor-reminder-row" data-open="contacts:${escapeHtml(item.contact.id)}" tabindex="0">
                    <div class="favor-reminder-row__main">
                      <strong>${escapeHtml(item.contact.name)}</strong>
                      <span>${escapeHtml(formatRelationType(item.contact.relationType))} · ${escapeHtml(item.lastDate || "暂无日期")}</span>
                    </div>
                    <p class="favor-reminder-row__reason">${item.reasons.map(escapeHtml).join("；")}</p>
                  </article>
                `,
              )
              .join("") || emptyState("暂无需要提醒的关系")
          }
        </div>
      </section>
    </div>
  `;
}

function favorMonthTrendChart(rows) {
  const maxValue = Math.max(...rows.map((row) => Math.max(row.received, row.given, Math.abs(row.balance))), 1);
  return `
    <div class="favor-trend-chart">
      ${rows
        .map((row) => {
          const receivedHeight = Math.max(4, Math.round((row.received / maxValue) * 78));
          const givenHeight = Math.max(4, Math.round((row.given / maxValue) * 78));
          return `
            <button class="favor-trend-month" data-open="favor-month:${escapeHtml(row.month)}" type="button" title="${escapeHtml(row.month)}：收 ${formatCurrency(row.received)} / 给 ${formatCurrency(row.given)}">
              <span class="favor-trend-bars">
                <i class="favor-trend-bar favor-trend-bar--received" style="height:${receivedHeight}px"></i>
                <i class="favor-trend-bar favor-trend-bar--given" style="height:${givenHeight}px"></i>
              </span>
              <b>${escapeHtml(row.month.slice(5))}</b>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function personAnnualLedger(events) {
  const rows = Object.entries(
    events.reduce((map, event) => {
      const year = getYearFromDate(event.date);
      if (!map[year]) map[year] = [];
      map[year].push(event);
      return map;
    }, {}),
  )
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([year, items]) => ({ year, ...summarizeFavorEvents(items) }));

  return `
    <div class="person-annual-list">
      ${
        rows
          .map(
            (row) => `
              <article class="person-annual-row person-annual-row--${row.balance >= 0 ? "received" : "given"}">
                <strong>${escapeHtml(row.year)}</strong>
                <span>${row.count} 次</span>
                <span>收 ${formatCurrency(row.received)}</span>
                <span>给 ${formatCurrency(row.given)}</span>
                <b>${formatCurrency(row.balance)}</b>
              </article>
            `,
          )
          .join("") || emptyState("暂无年度往来")
      }
    </div>
  `;
}

function getBalanceInsight(balance) {
  if (balance >= 500) return { label: "收到较多", tone: "received" };
  if (balance <= -500) return { label: "给出较多", tone: "given" };
  if (balance > 0) return { label: "略偏收到", tone: "received" };
  if (balance < 0) return { label: "略偏给出", tone: "given" };
  return { label: "收给平衡", tone: "balanced" };
}

function contactProfilePanel(contact, events, summary) {
  const insight = getBalanceInsight(summary.balance);
  const lastDate = getLastFavorDate(events);
  const lastEvent = events[0];
  const totalFlow = Math.max(summary.received + summary.given, 1);
  const receivedPercent = Math.round((summary.received / totalFlow) * 100);
  const givenPercent = Math.round((summary.given / totalFlow) * 100);

  return `
    <section class="contact-profile-panel contact-profile-panel--${escapeHtml(insight.tone)}">
      <div class="contact-profile-main">
        <div>
          <div class="meta-row">
            <span class="tag">${escapeHtml(formatRelationType(contact.relationType))}</span>
            ${contact.phone ? `<span class="tag">电话 ${escapeHtml(contact.phone)}</span>` : ""}
          </div>
          <h3>${escapeHtml(contact.name || "未命名")}</h3>
          ${contact.note ? `<p>${escapeHtml(contact.note)}</p>` : ""}
          <div class="contact-profile-meta">
            <span>最近：${escapeHtml(lastDate || "暂无往来")}</span>
            <span>记录：${summary.count} 次</span>
            <span>创建：${escapeHtml(contact.createdAt || "未记录")}</span>
          </div>
        </div>
      </div>
      <div class="contact-balance-card">
        <div class="contact-balance-head">
          <span>${escapeHtml(insight.label)}</span>
          <strong>${formatCurrency(summary.balance)}</strong>
        </div>
        <div class="favor-compare-bars" aria-label="收礼送礼对比">
          <div class="favor-compare-row">
            <span>收礼</span>
            <div class="favor-compare-track"><i class="favor-compare-fill favor-compare-fill--received" style="width:${receivedPercent}%"></i></div>
            <b>${formatCurrency(summary.received)}</b>
          </div>
          <div class="favor-compare-row">
            <span>送礼</span>
            <div class="favor-compare-track"><i class="favor-compare-fill favor-compare-fill--given" style="width:${givenPercent}%"></i></div>
            <b>${formatCurrency(summary.given)}</b>
          </div>
        </div>
        ${lastEvent ? `<small>最近事件：${escapeHtml(lastEvent.eventType || "往来")} · ${lastEvent.direction === "received" ? "收礼" : "送礼"} ${formatCurrency(lastEvent.amount)}</small>` : ""}
      </div>
    </section>
  `;
}

function averageFavorAmount(events) {
  if (!events.length) return 0;
  return Math.round(events.reduce((sum, event) => sum + Number(event.amount || 0), 0) / events.length);
}

function buildFavorAmountReference(events) {
  const givenEvents = events.filter((event) => event.direction === "given");
  const receivedEvents = events.filter((event) => event.direction === "received");
  const rows = Object.entries(
    events.reduce((map, event) => {
      const type = event.eventType || "其他";
      if (!map[type]) map[type] = [];
      map[type].push(event);
      return map;
    }, {}),
  )
    .map(([eventType, items]) => {
      const sorted = [...items].sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
      const latest = sorted[0];
      return {
        eventType,
        count: items.length,
        average: averageFavorAmount(items),
        latestAmount: Number(latest?.amount || 0),
        latestDate: latest?.date || "",
      };
    })
    .sort((left, right) => right.count - left.count || right.average - left.average)
    .slice(0, 4);

  return {
    givenAverage: averageFavorAmount(givenEvents),
    receivedAverage: averageFavorAmount(receivedEvents),
    maxGiven: Math.max(0, ...givenEvents.map((event) => Number(event.amount || 0))),
    maxReceived: Math.max(0, ...receivedEvents.map((event) => Number(event.amount || 0))),
    rows,
  };
}

function amountReferencePanel(events) {
  const reference = buildFavorAmountReference(events);
  const topEvent = reference.rows[0];
  const cards = [
    { label: "送礼均值", value: formatCurrency(reference.givenAverage), meta: `最高 ${formatCurrency(reference.maxGiven)}` },
    { label: "收礼均值", value: formatCurrency(reference.receivedAverage), meta: `最高 ${formatCurrency(reference.maxReceived)}` },
    { label: "最高送礼", value: formatCurrency(reference.maxGiven), meta: "历史送礼上限" },
    { label: "主要事件", value: topEvent?.eventType || "暂无", meta: topEvent ? `${topEvent.count} 次 / 均值 ${formatCurrency(topEvent.average)}` : "暂无可参考记录" },
  ];
  return `
    <section class="detail-section favor-reference-panel">
      <div class="section-title-row">
        <h3>金额参考</h3>
        <span>按历史金额自动估算</span>
      </div>
      <div class="favor-reference-grid">
        ${
          cards
            .map(
              (card) => `
                <article class="favor-summary-card">
                  <span>${escapeHtml(card.label)}</span>
                  <strong>${escapeHtml(card.value)}</strong>
                  <small>${escapeHtml(card.meta)}</small>
                </article>
              `,
            )
            .join("")
        }
      </div>
    </section>
  `;
}

function getMainFavorEventType(events) {
  const rows = Object.entries(
    events.reduce((map, event) => {
      const type = event.eventType || "其他";
      map[type] = (map[type] || 0) + 1;
      return map;
    }, {}),
  ).sort((left, right) => right[1] - left[1]);
  return rows[0] ? `${rows[0][0]} / ${rows[0][1]} 次` : "暂无";
}

function favorKeyNodesPanel(events) {
  const sortedAsc = [...events].sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));
  const sortedDesc = [...events].sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  const firstEvent = sortedAsc[0];
  const latestEvent = sortedDesc[0];
  const maxEvent = [...events].sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0))[0];
  const firstYear = firstEvent?.date ? String(firstEvent.date).slice(0, 4) : "";
  const latestYear = latestEvent?.date ? String(latestEvent.date).slice(0, 4) : "";
  const spanText = firstYear && latestYear ? (firstYear === latestYear ? `${latestYear} 年` : `${firstYear} - ${latestYear}`) : "暂无";
  const nodes = [
    { label: "首次往来", value: firstEvent?.date || "暂无", meta: firstEvent ? `${firstEvent.eventType || "往来"} · ${formatCurrency(firstEvent.amount)}` : "无记录" },
    { label: "最近往来", value: latestEvent?.date || "暂无", meta: latestEvent ? `${latestEvent.eventType || "往来"} · ${formatCurrency(latestEvent.amount)}` : "无记录" },
    { label: "最大单笔", value: maxEvent ? formatCurrency(maxEvent.amount) : "暂无", meta: maxEvent ? `${maxEvent.date || "未记录"} · ${maxEvent.direction === "received" ? "收礼" : "送礼"}` : "无记录" },
    { label: "关系跨度", value: spanText, meta: `主要类型：${getMainFavorEventType(events)}` },
  ];
  return `
    <section class="detail-section favor-keynodes-panel">
      <div class="section-title-row">
        <h3>关键节点摘要</h3>
        <span>不重复明细，仅看关系脉络</span>
      </div>
      <div class="favor-keynodes-grid">
        ${
          nodes
            .map(
              (node) => `
                <article class="favor-summary-card">
                  <span>${escapeHtml(node.label)}</span>
                  <strong>${escapeHtml(node.value)}</strong>
                  <small>${escapeHtml(node.meta)}</small>
                </article>
              `,
            )
            .join("")
        }
      </div>
    </section>
  `;
}

function favorPeriodPanel(overview) {
  return `
    <section class="panel favor-period-panel">
      <div class="panel-head">
        <h2>年度 / 月度</h2>
        <span class="results-count">按发生日期自动汇总</span>
      </div>
      <div class="favor-period-summary">
        <article class="favor-period-card favor-period-card--${overview.month.balance >= 0 ? "received" : "given"}">
          <div class="favor-period-card__main">
            <span>本月</span>
            <strong>${escapeHtml(overview.currentMonth)}</strong>
          </div>
          <div class="favor-period-card__flow">
            <span>收 ${formatCurrency(overview.month.received)}</span>
            <span>给 ${formatCurrency(overview.month.given)}</span>
          </div>
          <b>${formatCurrency(overview.month.balance)}</b>
          <small>${overview.month.count} 次往来</small>
        </article>
        <article class="favor-period-card favor-period-card--${overview.year.balance >= 0 ? "received" : "given"}">
          <div class="favor-period-card__main">
            <span>今年</span>
            <strong>${escapeHtml(overview.currentYear)}</strong>
          </div>
          <div class="favor-period-card__flow">
            <span>收 ${formatCurrency(overview.year.received)}</span>
            <span>给 ${formatCurrency(overview.year.given)}</span>
          </div>
          <b>${formatCurrency(overview.year.balance)}</b>
          <small>${overview.year.count} 次往来</small>
        </article>
      </div>
      <div class="section-title-row favor-month-title">
        <h3>月度明细</h3>
        <span>近 12 个有记录月份</span>
      </div>
      <div class="favor-month-grid">
        ${
          overview.monthlyRows
            .map(
              (row) => `
                <article class="favor-month-row favor-month-row--${row.balance >= 0 ? "received" : "given"}">
                  <div class="favor-month-row__main">
                    <strong>${escapeHtml(row.month)}</strong>
                    <span>${row.count} 次往来</span>
                  </div>
                  <div class="favor-month-row__flow">
                    <span>收 ${formatCurrency(row.received)}</span>
                    <span>给 ${formatCurrency(row.given)}</span>
                  </div>
                  <b>${formatCurrency(row.balance)}</b>
                </article>
              `,
            )
            .join("") || emptyState("暂无月度数据")
        }
      </div>
    </section>
  `;
}

function relationOptions(selected) {
  return favorRelationTypes
    .map((relation) => `<option value="${escapeHtml(relation)}" ${relation === selected ? "selected" : ""}>${escapeHtml(relation)}</option>`)
    .join("");
}

function eventTypeOptions(selected) {
  return favorEventTypes
    .map((eventType) => `<option value="${escapeHtml(eventType)}" ${eventType === selected ? "selected" : ""}>${escapeHtml(eventType)}</option>`)
    .join("");
}

function getFavorDisplayTitle(event, contactName = "") {
  const rawTitle = String(event.title || "").trim();
  const fallbackTitle = event.eventType || "往来";
  if (!rawTitle) return fallbackTitle;
  if (!contactName || contactName === "未关联") return rawTitle;
  return rawTitle.replace(new RegExp(`^${escapeRegExp(contactName)}\\s*`), "").trim() || fallbackTitle;
}

function favorEventEditForm(event, contactName = "") {
  const isReceived = event.direction === "received";
  const selectedEventType = event.eventType || "其他";
  return `
    <div class="inline-edit favor-event-edit" data-favor-edit-panel="${escapeHtml(event.id)}" hidden>
      <form class="inline-edit-form favor-event-edit-form" data-favor-event-id="${escapeHtml(event.id)}">
        <div class="favor-edit-head">
          <div>
            <strong>修改这条往来</strong>
            <span>调整后会同步刷新当前明细</span>
          </div>
          <button class="primary-button" type="submit">保存修改</button>
        </div>
        <div class="favor-edit-grid">
          <section class="favor-edit-section favor-edit-section--main">
            <div class="favor-edit-section__head">
              <strong>基础信息</strong>
              <span>金额与日期</span>
            </div>
            <div class="form-grid">
              <label>
                金额
                <input name="amount" type="number" step="0.01" value="${escapeHtml(event.amount || 0)}" />
              </label>
              <label>
                日期
                <input name="date" type="text" data-date-input value="${escapeHtml(event.date || "")}" placeholder="YYYY-MM-DD" autocomplete="off" />
              </label>
            </div>
          </section>
          <section class="favor-edit-section favor-edit-section--choice">
            <div class="favor-edit-section__head">
              <strong>类型方向</strong>
              <span>收礼、送礼与场景</span>
            </div>
            <fieldset class="choice-field">
              <legend>方向</legend>
              <div class="choice-grid choice-grid--compact">
                <label class="choice-pill">
                  <input name="direction" type="radio" value="given" ${!isReceived ? "checked" : ""} />
                  <span>送礼</span>
                </label>
                <label class="choice-pill">
                  <input name="direction" type="radio" value="received" ${isReceived ? "checked" : ""} />
                  <span>收礼</span>
                </label>
              </div>
            </fieldset>
            <fieldset class="choice-field">
              <legend>事件类型</legend>
              <div class="choice-grid">
                ${favorEventTypes
                  .map(
                    (eventType) => `
                      <label class="choice-pill">
                        <input name="eventType" type="radio" value="${escapeHtml(eventType)}" ${eventType === selectedEventType ? "checked" : ""} />
                        <span>${escapeHtml(eventType)}</span>
                      </label>
                    `,
                  )
                  .join("")}
              </div>
            </fieldset>
          </section>
          <section class="favor-edit-section favor-edit-section--meta">
            <div class="favor-edit-section__head">
              <strong>补充信息</strong>
              <span>礼品、项目与备注</span>
            </div>
            <label>
              礼品
              <input name="giftName" value="${escapeHtml(event.giftName || "")}" />
            </label>
            <label>
              关联项目
              <input name="projectId" value="${escapeHtml(event.projectId || "")}" />
            </label>
            <label>
              备注
              <input name="note" value="${escapeHtml(event.note || "")}" />
            </label>
          </section>
          </div>
      </form>
    </div>
  `;
}

function favorLedgerRow(event, contactName, options = {}) {
  const isReceived = event.direction === "received";
  const fallbackTitle = event.eventType || "往来";
  const cleanedTitle = getFavorDisplayTitle(event, contactName);
  const title = cleanedTitle === fallbackTitle ? `${fallbackTitle}${isReceived ? "收礼" : "送礼"}` : cleanedTitle;
  const noteParts = [event.giftName, event.note].filter(Boolean);
  const syncState = event.linkedBillId ? "已同步账单" : "未同步账单";
  return `
    <article class="favor-ledger-row favor-ledger-row--${isReceived ? "received" : "given"}">
      <div class="favor-ledger-row__date">
        <strong>${escapeHtml(String(event.date || "未记录").slice(5) || "未记录")}</strong>
        <span>${escapeHtml(String(event.date || "").slice(0, 4) || "日期")}</span>
      </div>
      <div class="favor-ledger-row__main">
        <div class="favor-ledger-row__head">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(event.eventType || "往来")}</span>
        </div>
        <div class="favor-ledger-row__context">
          <span>${escapeHtml(contactName || "未关联")}</span>
          ${noteParts.length ? `<span>${noteParts.map(escapeHtml).join(" · ")}</span>` : ""}
        </div>
      </div>
      <div class="favor-ledger-row__amount">
        <span>${isReceived ? "收礼" : "送礼"}</span>
        <strong>${isReceived ? "+" : "-"}${formatCurrency(event.amount)}</strong>
        <small>${escapeHtml(syncState)}${event.isReturned ? " · 已回礼" : ""}</small>
        ${options.editable ? `<button class="favor-edit-trigger" data-toggle-favor-edit="${escapeHtml(event.id)}" type="button">修改</button>` : ""}
      </div>
    </article>
  `;
}

function renderFavors(elements, data, ui, store) {
  renderControls(elements, data, ui, "favors");
  const favorStats = store.getFavorStats();
  const contacts = data.contacts || [];
  const favorPeriodOverview = buildFavorPeriodOverview(data.favorEvents || []);
  const favorInsightOverview = buildFavorInsightOverview(data.favorEvents || [], contacts);
  const searchTerm = normalize(ui.searchTerm);
  const contactStats = contacts.map((contact) => {
    const related = (data.favorEvents || []).filter((event) => event.contactId === contact.id);
    const received = related.filter((event) => event.direction === "received").reduce((sum, event) => sum + Number(event.amount || 0), 0);
    const given = related.filter((event) => event.direction === "given").reduce((sum, event) => sum + Number(event.amount || 0), 0);
    const lastDate = related.map((event) => event.date || event.updatedAt || event.createdAt || "").sort((left, right) => String(right).localeCompare(String(left)))[0] || "";
    return {
      contact,
      received,
      given,
      balance: received - given,
      count: related.length,
      lastDate,
    };
  })
    .sort((left, right) => Math.abs(right.balance) - Math.abs(left.balance));
  const favorEvents = (data.favorEvents || [])
    .filter((event) => {
      if (!searchTerm) return true;
      const contact = contacts.find((item) => item.id === event.contactId);
      return normalize([event.title, event.eventType, event.giftName, event.note, contact?.name, contact?.relationType].filter(Boolean).join(" ")).includes(
        searchTerm,
      );
    })
    .sort((left, right) => compareBySort(left, right, ui.sortBy));

  elements.contentArea.innerHTML = `
    <div class="favor-dashboard-layout">
      <main class="favor-dashboard-layout__main">
        <div class="stats-grid favor-stats-grid">
          ${statCard("关系人", favorStats.totalContacts, "已建立关系")}
          ${statCard("往来事件", favorStats.totalEvents, "礼金与礼品记录")}
          ${statCard("收 / 给", `${formatCurrency(favorStats.received)} / ${formatCurrency(favorStats.given)}`, "人情收支")}
          ${statCard("净差额", formatCurrency(favorStats.balance), "收到减去给出")}
        </div>
        ${favorPeriodPanel(favorPeriodOverview)}
        ${favorInsightPanels(favorInsightOverview)}
        <details class="panel favor-collapsible-panel" open>
          <summary class="favor-collapsible-summary">
            <span class="favor-collapsible-title">
              <b>人物关系台账</b>
              <small>按人物统计收、给、差额</small>
            </span>
            <span class="results-count">${contactStats.length} 人</span>
          </summary>
          ${contactFilterControls(ui, contacts)}
          <div class="relationship-ledger-grid">
            ${contactStats.map(relationshipLedgerRow).join("") || emptyState("还没有关系人")}
          </div>
          <div class="favor-ledger-empty" id="favorLedgerEmpty" hidden>没有符合筛选条件的人物</div>
        </details>
        <details class="panel favor-collapsible-panel" open>
          <summary class="favor-collapsible-summary">
            <span class="favor-collapsible-title">
              <b>往来记录</b>
              <small>按时间记录每一次收礼、送礼和同步状态</small>
            </span>
            <span class="results-count">当前筛选共 ${favorEvents.length} 条</span>
          </summary>
          <div class="favor-ledger-list">
            ${
              favorEvents
                .map((event) => {
                  const contact = contacts.find((item) => item.id === event.contactId);
                  return favorLedgerRow(event, contact?.name || "未关联");
                })
                .join("") || emptyState("还没有往来记录")
            }
          </div>
        </details>
      </main>
      <aside class="favor-dashboard-layout__side">
        <section class="panel favor-entry-section">
          <form class="quick-note-form favor-entry-panel" id="favorEventForm">
        <div class="favor-entry-head">
          <div>
            <h2>新增往来与人物</h2>
            <p>先确认人物，再记录本次收送、金额和背景。</p>
          </div>
          <button class="primary-button" type="submit">保存往来</button>
        </div>
        <div class="favor-entry-grid">
          <div class="favor-entry-card favor-entry-card--person">
            <div class="favor-entry-card__head">
              <strong>人物</strong>
              <span>关系归档</span>
            </div>
            <label>
              姓名
              <input name="newContactName" placeholder="输入人物姓名" required />
            </label>
            <fieldset class="choice-field">
              <legend>关系</legend>
              <div class="choice-grid">
                ${favorRelationTypes
                  .map(
                    (relation, index) => `
                      <label class="choice-pill">
                        <input name="newContactRelationType" type="radio" value="${escapeHtml(relation)}" ${index === 0 ? "checked" : ""} />
                        <span>${escapeHtml(relation)}</span>
                      </label>
                    `,
                  )
                  .join("")}
              </div>
            </fieldset>
            <label>
              电话
              <input name="newContactPhone" placeholder="可选填写" />
            </label>
            <label>
              人物备注
              <input name="newContactNote" placeholder="记录关系背景、共同经历或提醒" />
            </label>
          </div>
          <div class="favor-entry-card favor-entry-card--event">
            <div class="favor-entry-card__head">
              <strong>事件</strong>
              <span>本次往来</span>
            </div>
            <fieldset class="choice-field">
              <legend>方向</legend>
              <div class="choice-grid choice-grid--compact">
                <label class="choice-pill">
                  <input name="direction" type="radio" value="given" checked />
                  <span>送礼</span>
                </label>
                <label class="choice-pill">
                  <input name="direction" type="radio" value="received" />
                  <span>收礼</span>
                </label>
              </div>
            </fieldset>
            <fieldset class="choice-field">
              <legend>事件类型</legend>
              <div class="choice-grid">
                ${favorEventTypes
                  .map(
                    (eventType, index) => `
                      <label class="choice-pill">
                        <input name="eventType" type="radio" value="${escapeHtml(eventType)}" ${index === 0 ? "checked" : ""} />
                        <span>${escapeHtml(eventType)}</span>
                      </label>
                    `,
                  )
                  .join("")}
              </div>
            </fieldset>
            <div class="form-grid">
              <label>
                金额
                <input name="amount" type="number" step="0.01" placeholder="输入金额" />
              </label>
              <label>
                日期
                <input name="date" type="text" data-date-input value="${escapeHtml(new Date().toISOString().slice(0, 10))}" placeholder="YYYY-MM-DD" autocomplete="off" />
              </label>
            </div>
            <label>
              礼品名称
              <input name="giftName" placeholder="可留空，例如 红包 / 水果礼盒" />
            </label>
          </div>
          <div class="favor-entry-card favor-entry-card--notes">
            <div class="favor-entry-card__head">
              <strong>补充</strong>
              <span>同步与背景</span>
            </div>
            <label>
              关联项目
              <input name="projectId" placeholder="例如：个人网站改版" />
            </label>
            <label>
              往来备注
              <input name="note" placeholder="记录这次往来的背景" />
            </label>
            <label class="setting-toggle">
              <input name="syncBill" type="checkbox" checked />
              <span>同步到生活收支</span>
            </label>
          </div>
        </div>
          </form>
        </section>
        <section class="panel favor-archive-panel">
          <div class="panel-head">
            <h2>人情数据归档</h2>
            <span class="results-count">Excel</span>
          </div>
          <p class="panel-copy">设置页的财务 Excel 管理会同步导入或导出生活收支、人情往来、关系人与订阅项目。</p>
        </section>
      </aside>
    </div>
  `;
}

function bookmarkCard(item) {
  return `
    <article class="content-card bookmark-card">
      <div class="meta-row">
        <span class="tag">${escapeHtml(item.category || "外部资料")}</span>
        <span>${escapeHtml(item.updatedAt || item.createdAt || "")}</span>
      </div>
      <div>
        <h3>${escapeHtml(item.title || "未命名收藏")}</h3>
        <p>${escapeHtml(item.description || item.url || "暂无说明")}</p>
      </div>
      <div class="tag-row">
        ${(item.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="topbar-actions">
        <a class="ghost-link" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noreferrer">打开外部链接</a>
      </div>
    </article>
  `;
}

function renderFavorites(elements, data, ui) {
  renderControls(elements, data, ui, "favorites");
  const items = (data.bookmarks || [])
    .filter((item) => matchesSearchTerm(item, ui.searchTerm))
    .filter((item) => matchesFilterToken(item, "bookmarks", ui.activeChip))
    .filter((item) => ui.filters.tag === "all" || (item.tags || []).includes(ui.filters.tag))
    .sort((left, right) => compareBySort(left, right, ui.sortBy));

  elements.contentArea.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>外部资料收藏</h2>
        <span class="results-count">网站、文章、工具、音乐链接都放在这里</span>
      </div>
      <form class="quick-note-form" id="bookmarkForm">
        <div class="form-grid">
          <label>
            标题
            <input name="title" placeholder="例如：优秀记账图表参考" />
          </label>
          <label>
            外部链接
            <input name="url" type="url" required placeholder="https://example.com" />
          </label>
        </div>
        <label>
          说明
          <input name="description" placeholder="记录这个链接为什么值得收藏" />
        </label>
        <div class="form-grid">
          <label>
            分类
            <input name="category" placeholder="例如：设计参考 / 音乐 / 工具 / 文章" />
          </label>
          <label>
            标签
            <input name="tags" placeholder="用逗号分隔，例如：UI,账单,灵感" />
          </label>
        </div>
        <div class="topbar-actions">
          <button class="primary-button" type="submit">保存外部收藏</button>
        </div>
      </form>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>收藏列表</h2>
        <span class="results-count">当前筛选共 ${items.length} 条</span>
      </div>
      <div class="card-grid">
        ${items.map(bookmarkCard).join("") || emptyState("还没有外部收藏")}
      </div>
    </section>
  `;
}

function renderSettings(elements, data, ui, authController) {
  renderControls(elements, data, ui, "settings");
  const notificationSettings = loadSubscriptionNotificationSettings();
  const serverSyncState = loadServerSyncState();
  const currentUser = authController?.user || null;
  const isServerAccount = Boolean(authController?.isServerAuthenticated);
  const isAdmin = Boolean(authController?.isAdmin);
  const authCoverImage = loadAuthCoverImage();
  const authCoverImages = loadAuthCoverImages();
  const accountName = isServerAccount ? currentUser?.email || currentUser?.username || "已登录账号" : authController?.isAuthenticated ? "本地演示账号" : "未登录";
  const accountRole = isServerAccount ? currentUser?.role || "user" : authController?.isAuthenticated ? "local" : "readonly";
  const syncScope = isServerAccount ? `账号独立数据：user-${currentUser?.id || ""}.json` : "仅本地浏览器数据";
  const moduleStats = [
    ["生活收支", (data.bills || []).length, "可单独清空"],
    ["订阅", (data.subscriptions || []).length, "到期提醒"],
    ["人情往来", (data.favorEvents || []).length, `${(data.contacts || []).length} 位人物`],
    ["笔记 / 收藏", (data.notes || []).length + (data.bookmarks || []).length, "知识资料"],
  ];
  elements.contentArea.innerHTML = `
    <section class="panel settings-console">
      <div class="settings-console__status">
        <span>当前账号</span>
        <strong>${escapeHtml(accountName)}</strong>
        <em>${escapeHtml(accountRole)} · ${escapeHtml(syncScope)}</em>
      </div>
      <div class="settings-console__metrics">
        ${moduleStats
          .map(
            ([label, value, hint]) => `
              <article>
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(String(value))}</strong>
                <em>${escapeHtml(hint)}</em>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>

    <section class="panel settings-section">
      <div class="panel-head">
        <h2>备份与清理</h2>
        <span class="results-count">JSON / 示例 / 危险操作</span>
      </div>
      <div class="settings-action-grid">
        <article class="settings-action-card">
          <div>
            <strong>完整备份</strong>
            <span>导出、导入当前账号的完整 JSON 数据。</span>
          </div>
          <div class="settings-inline-actions">
            <button class="ghost-button" id="exportData" type="button">导出 JSON</button>
            <button class="ghost-button" id="importJsonButton" type="button">导入 JSON</button>
            <input id="importJsonFile" type="file" accept="application/json,.json" hidden />
          </div>
        </article>
        <article class="settings-action-card">
          <div>
            <strong>恢复演示数据</strong>
            <span>回到默认样例，会覆盖当前本地数据。</span>
          </div>
          <button class="ghost-button" id="resetDemo" type="button">恢复示例数据</button>
        </article>
        <article class="settings-action-card settings-action-card--danger">
          <div>
            <strong>清空生活收支</strong>
            <span>只删除生活收支，不影响其他模块。</span>
          </div>
          <button class="ghost-button danger-button" id="clearBillsData" type="button">清空生活收支</button>
        </article>
        <article class="settings-action-card settings-action-card--danger">
          <div>
            <strong>清空全部数据</strong>
            <span>删除所有模块数据，执行前先导出备份。</span>
          </div>
          <button class="ghost-button danger-button" id="clearData" type="button">清空全部数据</button>
        </article>
      </div>
    </section>

    <section class="panel settings-section server-sync-panel">
      <div class="panel-head">
        <h2>服务器数据</h2>
        <span class="results-count">实时推送 / 恢复 / 备份</span>
      </div>
      <p class="panel-copy">登录服务器账号后，数据按账号保存到 VPS。一个浏览器保存后，服务器会实时通知同账号的其他浏览器自动拉取最新数据。</p>
      <div class="server-sync-grid server-sync-grid--compact">
        <article class="server-sync-status-card">
          <span>当前账号</span>
          <strong>${escapeHtml(accountName)}</strong>
          <em>${escapeHtml(accountRole)} · ${escapeHtml(syncScope)}</em>
        </article>
        <article class="server-sync-status-card">
          <span>实时同步</span>
          <strong>${isServerAccount ? "已开启实时推送" : "未使用服务器账号"}</strong>
          <em>${
            isServerAccount
              ? serverSyncState.lastPushedAt
                ? `最近同步：${escapeHtml(serverSyncState.lastPushedAt)}`
                : "登录后会自动拉取该账号数据，编辑后自动保存，并推送给同账号其他浏览器。"
              : "请登录服务器账号后再使用跨设备同步。"
          }</em>
        </article>
        <article class="server-sync-status-card">
          <span>数据归属</span>
          <strong>${isServerAccount ? "按账号隔离同步" : "未连接账号数据"}</strong>
          <em>${isServerAccount ? "当前操作只读写当前登录账号的数据文件。" : "本地演示数据不会同步到其他设备。"}</em>
        </article>
      </div>
      <div class="settings-action-row">
        <button class="primary-button" id="pushServerData" type="button">立即同步</button>
        <button class="ghost-button" id="checkServerSyncStatus" type="button">检查状态</button>
        <button class="ghost-button" id="pullServerData" type="button">从服务器恢复</button>
        <button class="ghost-button" id="exportServerBackup" type="button">导出备份 JSON</button>
      </div>
    </section>

    ${
      isServerAccount
        ? `
          <section class="panel settings-section">
            <div class="panel-head">
              <h2>账号安全</h2>
              <span class="results-count">邮箱 / 密码</span>
            </div>
            <p class="panel-copy">当前账号：${escapeHtml(accountName)}。建议定期更新密码，修改后需要重新登录。</p>
            <div class="settings-action-row">
              <button class="ghost-button" id="changeOwnPassword" type="button">修改我的密码</button>
            </div>
          </section>
        `
        : ""
    }

    ${
      isAdmin
        ? `
          <section class="panel settings-section settings-auth-cover-panel">
            <div class="panel-head">
              <h2>登录封面资源库</h2>
              <span class="results-count">上传 / 轮播 / 重命名 / 删除</span>
            </div>
            <p class="panel-copy">管理员可以上传本地图片、动图和视频到 assets/login-covers，并在资源管理窗口中删除、重命名或加入登录轮播。</p>
            <div class="auth-cover-manager">
              <div class="auth-cover-preview-card">
                <div class="auth-cover-preview" style="--auth-cover-preview:url('${escapeHtml(authCoverImage).replace(/'/g, "%27")}')"></div>
                <div class="auth-cover-upload-row">
                  <label class="ghost-button auth-cover-upload-trigger" for="authCoverUploadFile">本地上传</label>
                  <button class="ghost-button" id="openAuthCoverManager" type="button">管理资源</button>
                  <input class="auth-cover-file-input" id="authCoverUploadFile" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov" />
                </div>
              </div>
              <label class="auth-cover-list-editor">
                当前登录轮播（一行一张）
                <textarea id="authCoverImageInput" rows="5" placeholder="/assets/login-covers/cover-1.jpg&#10;/assets/login-covers/cover-2.gif&#10;/assets/login-covers/cover-3.webp">${escapeHtml(authCoverImages.join("\n"))}</textarea>
                <small>上传后会自动写入第一行；登录背景建议优先使用图片、gif 或 webp。</small>
              </label>
            </div>
            <div class="settings-action-row">
              <button class="primary-button" id="saveAuthCoverImage" type="button">保存轮播</button>
              <button class="ghost-button" id="previewAuthCoverImage" type="button">预览</button>
              <button class="ghost-button" id="resetAuthCoverImage" type="button">恢复默认</button>
            </div>
            <dialog class="modal auth-cover-modal" id="authCoverManagerModal">
              <section class="modal-panel auth-cover-modal__panel">
                <div class="drawer-head">
                  <div>
                    <p class="eyebrow">LOCAL ASSETS</p>
                    <h2>本地上传资源管理</h2>
                  </div>
                  <button class="icon-button" id="closeAuthCoverManager" type="button" aria-label="关闭">&times;</button>
                </div>
                <div class="auth-cover-modal__tools">
                  <label class="ghost-button auth-cover-upload-trigger" for="authCoverUploadFile">上传图片 / 视频</label>
                  <button class="ghost-button" id="refreshAuthCoverLibrary" type="button">刷新资源库</button>
                </div>
                <div class="auth-cover-library" id="authCoverLibrary">
                  <div class="auth-cover-library__empty">点击“刷新资源库”查看已上传资源。</div>
                </div>
              </section>
            </dialog>
          </section>

          <section class="panel settings-section">
            <div class="panel-head">
              <h2>账号与多用户</h2>
              <span class="results-count">注册 / 用户 / 数据隔离</span>
            </div>
            <p class="panel-copy">用于管理员查看服务器用户、禁用账号、重置密码，并确认每个用户是否已有独立数据文件。</p>
            <div class="settings-action-row">
              <button class="ghost-button" id="openUserManagement" type="button">打开用户管理</button>
            </div>
          </section>
        `
        : ""
    }

    <section class="panel settings-section">
      <div class="panel-head">
        <h2>财务数据管理</h2>
        <span class="results-count">微信 / 支付宝 / Excel / CSV</span>
      </div>
      <p class="panel-copy">用于整站财务数据迁移。导入时会自动识别微信、支付宝、生活收支、人情往来、关系人和订阅项目，CSV 会自动处理常见中文编码，并在写入前提示重复账单。</p>
      <div class="finance-import-options">
        <input id="financeImportSource" type="hidden" value="自动识别" />
        <input id="financeImportPayer" type="hidden" value="家庭账户" />
        <input id="financeImportMode" type="hidden" value="raw" />
        <div class="ui-menu-select finance-payer-menu" data-menu-root="finance-source">
          <button class="ui-menu-select__trigger" data-menu-toggle="finance-source" type="button" aria-expanded="false">
            <span>本次导入来源</span>
            <strong id="financeImportSourceLabel">自动识别</strong>
          </button>
          <div class="ui-menu-select__panel">
            ${["自动识别", "支付宝", "微信", "Excel 导入"]
              .map(
                (source) => `
                  <button class="${source === "自动识别" ? "is-active" : ""}" data-finance-source="${escapeHtml(source)}" type="button">${escapeHtml(source)}</button>
                `,
              )
              .join("")}
          </div>
        </div>
        <div class="ui-menu-select finance-payer-menu" data-menu-root="finance-payer">
          <button class="ui-menu-select__trigger" data-menu-toggle="finance-payer" type="button" aria-expanded="false">
            <span>本次导入归属</span>
            <strong id="financeImportPayerLabel">家庭账户</strong>
          </button>
          <div class="ui-menu-select__panel">
            ${["家庭账户", "男方", "女方", "共同", "孩子相关"]
              .map(
                (payer) => `
                  <button class="${payer === "家庭账户" ? "is-active" : ""}" data-finance-payer="${escapeHtml(payer)}" type="button">${escapeHtml(payer)}</button>
                `,
              )
              .join("")}
          </div>
        </div>
        <div class="ui-menu-select finance-payer-menu" data-menu-root="finance-import-mode">
          <button class="ui-menu-select__trigger" data-menu-toggle="finance-import-mode" type="button" aria-expanded="false">
            <span>导入模式</span>
            <strong id="financeImportModeLabel">原始账单</strong>
          </button>
          <div class="ui-menu-select__panel">
            <button class="is-active" data-finance-import-mode="raw" type="button">原始账单</button>
            <button data-finance-import-mode="rules" type="button">规则导入</button>
          </div>
        </div>
        <span>适用于支付宝、微信原始账单；文件内已有“来源”或“承担人”列时优先使用文件值。</span>
      </div>
      <div class="settings-action-row">
        <button class="ghost-button" id="downloadBillExcelTemplate" type="button">下载模板</button>
        <button class="ghost-button" id="exportFinanceExcel" type="button">导出财务 Excel</button>
        <button class="primary-button" id="importBillExcelButton" type="button">导入 Excel</button>
        <input id="billExcelFile" type="file" hidden />
      </div>
    </section>

    <section class="panel settings-section">
      <div class="panel-head">
        <h2>订阅通知</h2>
        <span class="results-count">站内 / 浏览器 / 邮件</span>
      </div>
      <form class="quick-note-form" id="subscriptionNotificationForm">
        <div class="settings-form-section">
          <span class="settings-form-title">提醒渠道</span>
          <div class="form-grid">
            <label class="setting-toggle">
              <input name="siteEnabled" type="checkbox" ${notificationSettings.siteEnabled ? "checked" : ""} />
              <span>站内提醒</span>
            </label>
            <label class="setting-toggle">
              <input name="browserEnabled" type="checkbox" ${notificationSettings.browserEnabled ? "checked" : ""} />
              <span>浏览器通知</span>
            </label>
          </div>
        </div>
        <div class="settings-form-section">
          <span class="settings-form-title">提醒规则</span>
          <div class="form-grid">
            <label>
              提前提醒天数
              <input name="leadDays" value="${escapeHtml(notificationSettings.leadDays.join(","))}" placeholder="0,1,3,7" />
            </label>
            <label>
              每日提醒时间
              <input name="dailyTime" type="time" value="${escapeHtml(notificationSettings.dailyTime)}" />
            </label>
          </div>
        </div>
        <div class="settings-form-section">
          <span class="settings-form-title">提醒范围</span>
          <div class="form-grid">
            <label class="setting-toggle">
              <input name="remindAutoRenew" type="checkbox" ${notificationSettings.remindAutoRenew ? "checked" : ""} />
              <span>提醒自动续费</span>
            </label>
            <label class="setting-toggle">
              <input name="remindManualRenew" type="checkbox" ${notificationSettings.remindManualRenew ? "checked" : ""} />
              <span>提醒手动续费</span>
            </label>
          </div>
          <div class="form-grid">
            <label class="setting-toggle">
              <input name="remindHighCost" type="checkbox" ${notificationSettings.remindHighCost ? "checked" : ""} />
              <span>提醒高成本订阅</span>
            </label>
            <label class="setting-toggle">
              <input name="remindLowValue" type="checkbox" ${notificationSettings.remindLowValue ? "checked" : ""} />
              <span>提醒低价值订阅</span>
            </label>
          </div>
        </div>
        <div class="settings-form-section">
          <span class="settings-form-title">邮件通知</span>
          <div class="form-grid">
            <label class="setting-toggle">
              <input name="emailEnabled" type="checkbox" ${notificationSettings.emailEnabled ? "checked" : ""} />
              <span>邮件通知</span>
            </label>
            <label>
              接收邮箱
              <input name="email" type="email" value="${escapeHtml(notificationSettings.email)}" placeholder="you@example.com" />
            </label>
          </div>
        </div>
        <div class="settings-action-row">
          <button class="ghost-button" id="requestBrowserNotification" type="button">开启浏览器通知</button>
          <button class="ghost-button" id="testSubscriptionEmail" type="button">发送测试邮件</button>
          <button class="ghost-button" id="scanSubscriptionEmail" type="button">扫描并发送邮件</button>
          <button class="primary-button" type="submit">保存通知设置</button>
        </div>
      </form>
    </section>
  `;
}

function renderSearchResults(elements, data, ui) {
  renderControls(elements, data, ui, "search");
  const results = filterCollection(getAllItems(data), ui);
  const counts = Object.keys(typeMeta).map((entryType) => ({
    entryType,
    total: results.filter((item) => item.entryType === entryType).length,
  }));

  elements.contentArea.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>搜索结果</h2>
        <span class="results-count">共 ${results.length} 条</span>
      </div>
      <div class="stats-grid">
        ${counts.map((item) => statCard(typeMeta[item.entryType].label, item.total, "匹配结果")).join("")}
      </div>
    </section>
    <section class="panel">
      <div class="list-stack">
        ${results.map((item) => searchResultCard(item)).join("") || emptyState("没有找到符合条件的内容")}
      </div>
    </section>
  `;
}

function linkedSummaryList(items, type, emptyText) {
  return `
    <div class="list-stack">
      ${
        items
          .slice(0, 5)
          .map(
            (item) => `
              <article class="search-result-card" data-open="${type}:${item.id}">
                <div class="meta-row">
                  <span class="tag">${escapeHtml(item.category || item.status || typeMeta[type]?.label || type)}</span>
                  <span>${escapeHtml(item.updatedAt || item.date || item.dueDate || "")}</span>
                </div>
                <strong>${escapeHtml(item.title || item.name)}</strong>
                <p>${escapeHtml(item.description || item.note || "暂无说明")}</p>
              </article>
            `,
          )
          .join("") || emptyState(emptyText)
      }
    </div>
  `;
}

function renderContactDrawer(elements, contact, data) {
  elements.contactDetailModal.dataset.detailType = "contact";
  elements.contactDetailModal.dataset.detailId = contact.id;
  delete elements.contactDetailModal.dataset.filterType;
  delete elements.contactDetailModal.dataset.filterValue;
  const relatedEvents = (data.favorEvents || [])
    .filter((event) => event.contactId === contact.id)
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  const received = relatedEvents.filter((event) => event.direction === "received").reduce((sum, event) => sum + Number(event.amount || 0), 0);
  const given = relatedEvents.filter((event) => event.direction === "given").reduce((sum, event) => sum + Number(event.amount || 0), 0);
  const balance = received - given;
  const summary = { received, given, balance, count: relatedEvents.length };

  elements.contactDetailTitle.textContent = contact.name;
  elements.contactDetailBody.innerHTML = `
    ${contactProfilePanel(contact, relatedEvents, summary)}
    <section class="detail-section contact-manage-panel">
      <div class="section-title-row">
        <h3>人物数据管理</h3>
        <span>修改人物资料，删除无记录人物</span>
      </div>
      <form class="contact-manage-form" id="contactEditForm" data-contact-id="${escapeHtml(contact.id)}">
        <label>
          姓名
          <input name="name" value="${escapeHtml(contact.name || "")}" required />
        </label>
        <label>
          关系
          <select name="relationType">${relationOptions(formatRelationType(contact.relationType))}</select>
        </label>
        <label>
          电话
          <input name="phone" value="${escapeHtml(contact.phone || "")}" />
        </label>
        <label>
          备注
          <input name="note" value="${escapeHtml(contact.note || "")}" />
        </label>
        <div class="contact-manage-actions">
          <button class="ghost-button" type="submit">保存人物</button>
          <button class="ghost-button danger-button" data-delete-contact="${escapeHtml(contact.id)}" type="button">删除人物</button>
        </div>
      </form>
    </section>
    <div class="contact-detail-grid">
      <section class="detail-section">
        <div class="section-title-row">
          <h3>人物年度账</h3>
          <span>${relatedEvents.length} 条记录</span>
        </div>
        ${personAnnualLedger(relatedEvents)}
      </section>
      <section class="detail-section contact-context-panel">
        <div class="section-title-row">
          <h3>关系对比</h3>
          <span>${getFavorBalanceLabel(balance)}</span>
        </div>
        <div class="contact-context-list">
          <span><small>${balance >= 0 ? "需回礼" : "我方多给"}</small><b>${formatCurrency(Math.abs(balance))}</b></span>
          <span><small>收礼次数</small><b>${relatedEvents.filter((event) => event.direction === "received").length}</b></span>
          <span><small>送礼次数</small><b>${relatedEvents.filter((event) => event.direction === "given").length}</b></span>
        </div>
      </section>
    </div>
    <div class="contact-detail-grid contact-detail-grid--insights">
      ${amountReferencePanel(relatedEvents)}
      ${favorKeyNodesPanel(relatedEvents)}
    </div>
    <div class="detail-section">
      <div class="section-title-row">
        <h3>来往明细</h3>
        <span>按时间倒序</span>
      </div>
      <div class="favor-ledger-list">
        ${
          relatedEvents
            .map(
              (event) => `
                <div class="favor-edit-card">
                  ${favorLedgerRow(event, contact.name, { editable: true })}
                  ${favorEventEditForm(event, contact.name)}
                </div>
              `,
            )
            .join("") || emptyState("暂无往来记录")
        }
      </div>
    </div>
  `;
  elements.contactDetailModal.showModal();
}

function renderFavorInsightDetail(elements, data, filterType, filterValue) {
  elements.contactDetailModal.dataset.detailType = "favorInsight";
  elements.contactDetailModal.dataset.filterType = filterType;
  elements.contactDetailModal.dataset.filterValue = filterValue;
  delete elements.contactDetailModal.dataset.detailId;
  const contacts = data.contacts || [];
  const events = (data.favorEvents || [])
    .filter((event) => {
      if (filterType === "year") return getYearFromDate(event.date) === filterValue;
      if (filterType === "month") return String(event.date || "").startsWith(filterValue);
      if (filterType === "eventType") return (event.eventType || "其他") === filterValue;
      return false;
    })
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  const summary = summarizeFavorEvents(events);
  const title = filterType === "year" ? `${filterValue} 年度往来` : filterType === "month" ? `${filterValue} 月度往来` : `${filterValue} 往来`;
  const monthTrend = filterType === "year" ? favorMonthTrendChart(buildFavorMonthTrend(events, filterValue)) : "";

  elements.contactDetailTitle.textContent = title;
  elements.contactDetailBody.innerHTML = `
    <section class="contact-profile-panel contact-profile-panel--${summary.balance >= 0 ? "received" : "given"}">
      <div class="contact-profile-main">
        <div>
          <div class="meta-row">
            <span class="tag">${filterType === "year" ? "年度详情" : "事件类型"}</span>
            <span class="tag">${events.length} 条记录</span>
          </div>
          <h3>${escapeHtml(title)}</h3>
          <div class="contact-profile-meta">
            <span>收 ${formatCurrency(summary.received)}</span>
            <span>给 ${formatCurrency(summary.given)}</span>
            <span>差额 ${formatCurrency(summary.balance)}</span>
          </div>
        </div>
      </div>
      <div class="contact-balance-card">
        <div class="contact-balance-head">
          <span>${summary.balance > 0 ? "我欠较多" : summary.balance < 0 ? "对方欠我" : "收给持平"}</span>
          <strong>${formatCurrency(summary.balance)}</strong>
        </div>
        <p>${filterType === "year" ? "按年份筛选出的全部人情往来。" : "按事件类型筛选出的全部人情往来。"}</p>
      </div>
    </section>
    ${
      monthTrend
        ? `<section class="detail-section">
            <div class="section-title-row">
              <h3>月份趋势图</h3>
              <span>点击月份查看明细</span>
            </div>
            ${monthTrend}
          </section>`
        : ""
    }
    <section class="detail-section">
      <div class="section-title-row">
        <h3>对应往来记录</h3>
        <span>${events.length} 条</span>
      </div>
      <div class="favor-ledger-list">
        ${
          events
            .map((event) => {
              const contact = contacts.find((item) => item.id === event.contactId);
              return `
                <div class="favor-edit-card">
                  ${favorLedgerRow(event, contact?.name || "未关联", { editable: true })}
                  ${favorEventEditForm(event, contact?.name || "未关联")}
                </div>
              `;
            })
            .join("") || emptyState("暂无对应往来")
        }
      </div>
    </section>
  `;
  elements.contactDetailModal.showModal();
}

const drawerFieldLabels = {
  status: "状态",
  priority: "优先级",
  dueDate: "截止日期",
  category: "分类",
  type: "类型",
  amount: "金额",
  date: "日期",
  source: "来源",
  payer: "承担人",
  familyMember: "家庭成员",
  fixedExpenseType: "固定支出",
  mortgageDueDay: "房贷扣款日",
  mortgageRemainingTerms: "剩余期数",
  pinned: "置顶",
  noteType: "笔记类型",
  sourceUrl: "来源链接",
  content: "内容",
  progress: "进度",
};

const drawerHiddenFields = new Set([
  "id",
  "title",
  "description",
  "content",
  "tags",
  "entryType",
  "projectId",
  "isFavorite",
  "createdAt",
  "updatedAt",
  "originalType",
  "linkedBillId",
  "sourceUrl",
]);

const drawerValueLabels = {
  noteType: {
    note: "普通笔记",
    link: "链接收录",
    idea: "碎片想法",
  },
};

function formatDrawerValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "是" : "否";
  return value;
}

function drawerAttributeTags(item) {
  const tags = Object.entries(item)
    .filter(([key, value]) => !drawerHiddenFields.has(key) && value !== "" && value !== null && value !== undefined)
    .slice(0, 10)
    .map(([key, value]) => {
      const formatted = drawerValueLabels[key]?.[value] || formatDrawerValue(value);
      return `<span class="tag">${escapeHtml(drawerFieldLabels[key] || key)}：${escapeHtml(formatted)}</span>`;
    });
  return tags.join("") || '<span class="tag">暂无属性</span>';
}

function renderDrawer(elements, item, type, projectOverview = null, data = null) {
  const meta = typeMeta[type];
  const noteDetails =
    type === "notes"
      ? `
        <div class="detail-section">
          <h3>内容预览</h3>
          <div class="markdown-preview">${renderMarkdown(item.content || item.description || "暂无内容")}</div>
        </div>
        ${item.sourceUrl ? `<div class="detail-section"><h3>收录链接</h3><p><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.sourceUrl)}</a></p></div>` : ""}
      `
      : "";
  const projectDetails =
    type === "collections" && projectOverview
      ? `
        <div class="detail-section">
          <h3>项目汇总</h3>
          <div class="stats-grid compact-stats">
            ${statCard("事项进度", `${projectOverview.taskProgress}%`, "关联事项完成率")}
            ${statCard("项目支出", formatCurrency(projectOverview.expense), "关联账单支出")}
            ${statCard("项目结余", formatCurrency(projectOverview.balance), "收入减支出")}
            ${statCard("关联内容", projectOverview.totalLinked, "自动汇总数量")}
          </div>
        </div>
        <div class="detail-section">
          <h3>关联事项</h3>
          ${linkedSummaryList(projectOverview.tasks, "tasks", "暂无关联事项")}
        </div>
        <div class="detail-section">
          <h3>关联账单</h3>
          ${linkedSummaryList(projectOverview.bills, "bills", "暂无关联账单")}
        </div>
        <div class="detail-section">
          <h3>关联笔记</h3>
          ${linkedSummaryList(projectOverview.notes, "notes", "暂无关联笔记")}
        </div>
        <div class="detail-section">
          <h3>项目时间线</h3>
          ${timelineRows(projectOverview.timeline)}
        </div>
      `
      : "";

  elements.drawerType.textContent = meta?.eyebrow || "Detail";
  elements.drawerTitle.textContent = item.title;
  elements.drawerBody.innerHTML = `
    <div class="detail-section">
      <h3>说明</h3>
      <p>${escapeHtml(item.description || excerptText(item.content || "", 120) || "暂无说明")}</p>
    </div>
    ${noteDetails}
    ${projectDetails}
    <div class="detail-section">
      <h3>属性</h3>
      <div class="tag-row">
        ${drawerAttributeTags(item)}
      </div>
    </div>
    <div class="detail-section">
      <h3>标签</h3>
      <div class="tag-row">
        ${(item.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") || '<span class="tag">无标签</span>'}
      </div>
    </div>
    <div class="topbar-actions">
      <button class="ghost-button" data-edit="${type}:${item.id}" type="button">编辑</button>
      ${type === "notes" ? `<button class="ghost-button" data-convert-note="${item.id}" type="button">转为事项</button>` : ""}
      ${type === "tasks" ? `<button class="ghost-button" data-complete="${item.id}" type="button">标记完成</button>` : ""}
      <button class="ghost-button" data-delete="${type}:${item.id}" type="button">删除</button>
    </div>
  `;
  elements.drawerBackdrop.hidden = false;
  elements.drawer.classList.add("open");
  elements.drawer.setAttribute("aria-hidden", "false");
}

export function createRenderer(app, elements) {
  return {
    render() {
      const data = app.store.getData();
      const activeNavItem = navItems.find((item) => item.id === app.ui.activePage);
      const current = activeNavItem && (app.ui.activePage === "search" || !activeNavItem.hidden) ? activeNavItem : navItems[0];
      const recentViews = app.store.getRecentViews();
      if (app.ui.activePage !== current.id) {
        app.ui.activePage = current.id;
      }

      elements.pageTitle.textContent = current.label;
      elements.pageEyebrow.textContent = current.eyebrow;
      elements.globalSearch.value = app.ui.searchTerm;
      elements.contentArea.className = `content-area page-${current.id}`;
      document.body.dataset.activePage = current.id;

      renderNav(elements, app.ui);
      updateProgress(elements, data);

      const pageRenderers = {
        dashboard: () => renderDashboard(elements, data, app.ui, recentViews, app.store),
        tasks: () => renderTasks(elements, data, app.ui),
        bills: () => renderBills(elements, data, app.ui, app.store),
        subscriptions: () => renderSubscriptions(elements, data, app.ui, app.store),
        favors: () => renderFavors(elements, data, app.ui, app.store),
        favorites: () => renderFavorites(elements, data, app.ui),
        settings: () => renderSettings(elements, data, app.ui, app.authController),
        search: () => renderSearchResults(elements, data, app.ui),
      };

      const renderPage = pageRenderers[app.ui.activePage] || pageRenderers.dashboard;
      renderPage();
    },
    openDrawer(type, id) {
      const item = app.store.getEntry(type, id);
      if (!item) return false;
      app.store.trackRecentView(type, id);
      renderDrawer(elements, item, type, type === "collections" ? app.store.getProjectOverview(id) : null, app.store.getData());
      return true;
    },
    openContactDetail(id) {
      const contact = app.store.getEntry("contacts", id);
      if (!contact) return false;
      renderContactDrawer(elements, contact, app.store.getData());
      return true;
    },
    openFavorInsightDetail(filterType, filterValue) {
      renderFavorInsightDetail(elements, app.store.getData(), filterType, filterValue);
      return true;
    },
    closeContactDetail() {
      elements.contactDetailModal?.close();
    },
    closeDrawer() {
      elements.drawer.classList.remove("open");
      elements.drawer.setAttribute("aria-hidden", "true");
      elements.drawerBackdrop.hidden = true;
    },
  };
}
