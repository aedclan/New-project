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
  if (action.billActionsMonth) return `data-dashboard-open-actions="${escapeHtml(action.billActionsMonth)}"`;
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

function getDashboardBudgetPace(summary) {
  if (!summary.totalBudget) {
    return {
      label: "未设置",
      hint: "进入生活收支设置总预算",
      tone: "watch",
    };
  }
  const days = getMonthDays(summary.month);
  const todayKey = getDateKey(new Date());
  const todayDay = todayKey.startsWith(summary.month) ? Number(todayKey.slice(8, 10)) : days.length;
  const elapsedRate = days.length ? Math.round((todayDay / days.length) * 100) : 100;
  const usedRate = Math.round((summary.expense / Math.max(summary.totalBudget, 1)) * 100);
  const gap = usedRate - elapsedRate;
  const label = gap > 10 ? "超前消耗" : gap < -10 ? "节奏宽松" : "节奏正常";
  const tone = gap > 10 || usedRate >= 100 ? "risk" : gap >= 0 || usedRate >= 80 ? "watch" : "good";
  return {
    label,
    hint: `时间 ${elapsedRate}% / 使用 ${usedRate}% · 剩余 ${formatCurrency(Math.max(summary.totalBudget - summary.expense, 0))}`,
    tone,
  };
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
  const healthTone = healthStatus === "风险" ? "risk" : healthStatus === "关注" || healthStatus === "待补录" ? "watch" : "good";
  const topFinanceRisk = financeRisks.find((risk) => risk.level === "risk") || financeRisks.find((risk) => risk.level === "watch") || financeRisks[0] || { level: "good", title: "暂无明显风险", text: "生活收支处于可控状态。" };
  const topFinanceRiskTone = topFinanceRisk.level === "risk" ? "risk" : topFinanceRisk.level === "watch" ? "watch" : "good";
  const financeForecast = buildFinanceForecast(data, month);
  const forecastTone = financeForecast.level === "risk" ? "risk" : financeForecast.level === "watch" || financeForecast.level === "stable" ? "watch" : "good";
  const forecastPrimaryRisk = financeForecast.risks.find((risk) => risk.level === "risk") || financeForecast.risks[0];
  const budgetPace = getDashboardBudgetPace(financeSummary);
  const billActions = buildMonthlyActionItems(data, financeSummary, financeRisks, commitments);
  const billActionStatusMap = ((data.budgets || {}).billActionStatuses || {})[month] || {};
  const doneBillActions = billActions.filter((item) => billActionStatusMap[item.id] === "已完成").length;
  const doingBillActions = billActions.filter((item) => billActionStatusMap[item.id] === "进行中").length;
  const openBillActions = Math.max(billActions.length - doneBillActions, 0);
  const carriedBillActions = billActions.filter((item) => item.label === "延续").length;
  const actionTone = !openBillActions ? "good" : carriedBillActions ? "risk" : doingBillActions ? "watch" : "watch";
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
    forecastPrimaryRisk ? dashboardQueueItem("预测风险", `${financeForecast.nextMonth.month} · ${forecastPrimaryRisk.title}`, "处理预告", { billActionsMonth: month }, forecastTone) : "",
    openBillActions ? dashboardQueueItem("本月行动", `${doneBillActions}/${billActions.length} 已完成${carriedBillActions ? `，${carriedBillActions} 项上月延续` : `，${doingBillActions} 项进行中`}`, "处理行动", { billActionsMonth: month }, actionTone) : "",
    unclassifiedBills.length ? dashboardQueueItem("未分类流水", `${month} 有 ${unclassifiedBills.length} 条需要复核`, "复核流水", { ledgerMonth: month }, "risk") : "",
    subscriptionsOverview.upcoming?.length ? dashboardQueueItem("订阅临期", `30 天内 ${subscriptionsOverview.upcoming.length} 项到期`, "看订阅", { page: "subscriptions" }, subscriptionsOverview.urgent?.length ? "risk" : "watch") : "",
    overdueTasks.length ? dashboardQueueItem("逾期事项", `${overdueTasks.length} 项已经逾期`, "处理事项", { page: "tasks" }, "risk") : "",
    latestImport?.needsReview || latestImport?.uncategorized ? dashboardQueueItem("导入待复核", `${latestImport.uncategorized || 0} 条未分类，${latestImport.needsReview || 0} 条需确认`, "打开流水", { ledgerMonth: latestImport.months?.[0] || month }, "watch") : "",
    !forecastPrimaryRisk && !unclassifiedBills.length && !subscriptionsOverview.upcoming?.length && !overdueTasks.length ? dashboardQueueItem("暂无紧急处理", "关键事项处于可控状态", "查看总账", { page: "bills" }, "good") : "",
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
      ${dashboardMetricCard("本月健康状态", healthStatus, `${month} · 支出率 ${financeSummary.income > 0 ? `${Math.round(financeSummary.expenseRate * 100)}%` : "缺少收入"}`, { page: "bills" }, healthTone)}
      ${dashboardMetricCard("下月风险预告", financeForecast.levelLabel, `${financeForecast.nextMonth.month} 预计结余 ${formatCurrency(financeForecast.nextMonth.balance)}`, { billActionsMonth: month }, forecastTone)}
      ${dashboardMetricCard("最大风险", topFinanceRisk.title, topFinanceRisk.text, { page: "bills" }, topFinanceRiskTone)}
      ${dashboardMetricCard("当前预算节奏", budgetPace.label, budgetPace.hint, { page: "bills" }, budgetPace.tone)}
      ${dashboardMetricCard("行动进度", `${doneBillActions}/${billActions.length} 已完成`, `${openBillActions} 项待推进${carriedBillActions ? ` · ${carriedBillActions} 项延续` : ""}`, { billActionsMonth: month }, actionTone)}
      ${dashboardMetricCard("本月现金流", formatCurrency(financeSummary.balance), `收入 ${formatCurrency(financeSummary.income)} / 支出 ${formatCurrency(financeSummary.expense)}`, { page: "bills" }, financeSummary.balance < 0 ? "risk" : "good")}
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
  return (allBills || []).filter((item) => String(item.date || "").startsWith(month) && !item.excludeFromAnalysis && !item.analysisExcluded);
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

function getFutureCommitments(data, month, months = 3) {
  const { startKey, endKey } = getFutureWindow(month, months);
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

function averageRows(rows, key) {
  return rows.length ? rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / rows.length : 0;
}

function medianRows(rows, key) {
  const values = rows.map((row) => Number(row[key] || 0)).filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!values.length) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function getForecastExpenseBaseline(rows) {
  const average = averageRows(rows, "expense");
  const median = medianRows(rows, "expense") || average;
  const threshold = Math.max(median * 1.75, average * 1.45, 1000);
  const outliers = rows.filter((row) => Number(row.expense || 0) > threshold);
  const regularRows = rows.filter((row) => Number(row.expense || 0) <= threshold);
  const regularAverage = averageRows(regularRows.length ? regularRows : rows, "expense");
  return {
    average,
    median,
    regularAverage,
    threshold,
    outliers,
  };
}

function getRelativeMonth(month, offset) {
  const { year, monthIndex } = getMonthDateParts(month);
  const date = new Date(year, monthIndex + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getFinanceForecastRows(data) {
  return getBillHistoryRows((data.bills || []).filter((bill) => !bill.excludeFromAnalysis && !bill.analysisExcluded))
    .slice()
    .reverse()
    .map((row) => {
      const summary = getMonthlyFinanceSummary(data, row.month);
      return {
        month: row.month,
        income: summary.income,
        expense: summary.expense,
        balance: summary.balance,
        fixedExpense: summary.fixedExpense,
        repayment: summary.repayment,
        categoryTotals: summary.categoryTotals,
      };
    });
}

function buildFinanceDataQuality(data, activeMonth) {
  const summary = getMonthlyFinanceSummary(data, activeMonth);
  const rows = getFinanceForecastRows(data);
  const bills = summary.bills || [];
  const expenseItems = summary.expenseItems || [];
  const unclassified = expenseItems.filter((item) => !item.category || item.category === "未分类" || item.classification?.needsReview);
  const missingPayer = expenseItems.filter((item) => !item.payer || item.payer === "未指定");
  const excludedCount = (data.bills || []).filter((item) => String(item.date || "").startsWith(activeMonth) && (item.excludeFromAnalysis || item.analysisExcluded)).length;
  const expenseAmounts = rows.map((row) => Number(row.expense || 0)).filter((value) => value > 0);
  const medianExpense = expenseAmounts.length ? medianRows(expenseAmounts.map((value) => ({ value })), "value") : 0;
  const abnormalItems = expenseItems.filter((item) => Number(item.amount || 0) > Math.max(medianExpense * 0.45, 1000));
  const futurePlans = ((data.budgets || {}).futurePlans || []).filter((item) => item.status !== "取消");
  const subscriptions = data.subscriptions || [];
  const issues = [];
  const actions = [];
  let score = 100;
  const addIssue = (penalty, title, text, action, level = "watch") => {
    score -= penalty;
    issues.push({ title, text, action, level, penalty });
    if (action) actions.push(action);
  };

  if (rows.length < 3) {
    addIssue(22, "历史样本不足", `目前只有 ${rows.length} 个有效月份，长期预测容易波动。`, "至少连续保留 3-6 个月完整账单后再判断长期趋势。", "risk");
  } else if (rows.length < 6) {
    addIssue(10, "历史样本偏少", `目前有 ${rows.length} 个有效月份，预测可信度为中。`, "继续积累到 6 个月以上，模型稳定度会更高。");
  }
  if (summary.income <= 0 && summary.expense > 0) {
    addIssue(20, "缺少收入参照", `本月已有支出 ${formatCurrency(summary.expense)}，但收入为 0。`, "补录工资、报销、副业等收入，否则支出率和结余预测会偏保守。", "risk");
  }
  if (unclassified.length) {
    addIssue(Math.min(18, 6 + unclassified.length * 3), "未分类流水", `${unclassified.length} 笔支出缺少有效分类。`, "先补齐未分类流水，分类趋势和钱流向判断才会准确。", "risk");
  }
  if (missingPayer.length) {
    addIssue(Math.min(10, missingPayer.length * 2), "承担人缺失", `${missingPayer.length} 笔支出缺少承担人。`, "补齐承担人，方便后续做家庭成员分摊和责任归因。");
  }
  if (abnormalItems.length) {
    addIssue(Math.min(12, abnormalItems.length * 4), "大额波动待确认", `${abnormalItems.length} 笔支出明显高于常规水平。`, "确认是否为一次性支出；如不是常规消费，可标记为异常或不参与常规预测。");
  }
  if (excludedCount) {
    addIssue(Math.min(8, excludedCount * 2), "分析排除项", `${excludedCount} 笔流水不计入分析。`, "复核排除项是否合理，避免误排除真实消费。");
  }
  if (!Number((data.budgets || {}).totalBudget || 0)) {
    addIssue(6, "缺少总预算", "未设置总预算，预算节奏只能弱判断。", "设置本月总预算，让风险提醒能判断是否超前消耗。");
  }
  if (!futurePlans.length && !subscriptions.length) {
    addIssue(5, "未来项不足", "未来计划和订阅记录为空，未来压力可能被低估。", "补充固定续费、计划支出和订阅，预测会更接近真实现金流。");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 86 ? "good" : score >= 70 ? "watch" : "risk";
  const label = level === "good" ? "良好" : level === "watch" ? "需补录" : "需复核";
  const confidence = score >= 86 ? "高" : score >= 70 ? "中" : "低";
  return {
    score,
    level,
    label,
    confidence,
    issues,
    actions: [...new Set(actions)].slice(0, 4),
    metrics: {
      months: rows.length,
      unclassified: unclassified.length,
      abnormal: abnormalItems.length,
      excluded: excludedCount,
    },
  };
}

function buildForecastBiasAdjustment(data) {
  const checks = (data.notes || [])
    .filter((item) => item.noteType === "summary" && item.billReportSummary?.forecast)
    .map((item) => buildForecastActualComparison(data, item))
    .filter((item) => item && item.hasActual)
    .sort((left, right) => String(right.month || "").localeCompare(String(left.month || "")))
    .slice(0, 6);
  if (!checks.length) {
    return { count: 0, income: 0, expense: 0, balance: 0, weight: 0, label: "暂无校准样本", samples: [], excludedSamples: [] };
  }
  const preparedChecks = checks.map((item) => {
    const hasPrediction = Math.abs(Number(item.predictedIncome || 0)) + Math.abs(Number(item.predictedExpense || 0)) + Math.abs(Number(item.predictedBalance || 0)) > 0;
    const excludeReason = item.causeLabel === "分类待补"
      ? "分类待补"
      : !hasPrediction
        ? "缺少预测值"
        : Number(item.drift || 0) > 1.2
          ? "极端偏差"
          : "";
    return { ...item, usedForCalibration: !excludeReason, excludeReason };
  });
  const rows = preparedChecks.filter((item) => item.usedForCalibration);
  if (!rows.length) {
    return { count: 0, income: 0, expense: 0, balance: 0, weight: 0, label: "样本待清理", samples: preparedChecks, excludedSamples: preparedChecks };
  }
  const weightSum = rows.reduce((sum, _item, index) => sum + (rows.length - index), 0) || 1;
  const weighted = (key) => rows.reduce((sum, item, index) => sum + Number(item[key] || 0) * (rows.length - index), 0) / weightSum;
  const rawIncome = weighted("incomeDelta");
  const rawExpense = weighted("expenseDelta");
  const rawBalance = weighted("balanceDelta");
  const sampleWeight = rows.length >= 4 ? 0.38 : rows.length >= 2 ? 0.26 : 0.16;
  return {
    count: rows.length,
    income: rawIncome * sampleWeight,
    expense: rawExpense * sampleWeight,
    balance: rawBalance * sampleWeight,
    weight: sampleWeight,
    label: rows.length >= 4 ? "高" : rows.length >= 2 ? "中" : "低",
    samples: preparedChecks,
    excludedSamples: preparedChecks.filter((item) => !item.usedForCalibration),
  };
}

function buildFinanceForecast(data, activeMonth) {
  const rows = getFinanceForecastRows(data);
  const latestMonth = activeMonth || rows[rows.length - 1]?.month || new Date().toISOString().slice(0, 7);
  const recent3 = rows.slice(-3);
  const recent6 = rows.slice(-6);
  const previous3 = rows.slice(-6, -3);
  const expenseBaseline = getForecastExpenseBaseline(rows);
  const recentExpenseBaseline = getForecastExpenseBaseline(recent3);
  const nextMonth = getRelativeMonth(latestMonth, 1);
  const nextYear = String(Number(latestMonth.slice(0, 4)) + 1);
  const monthCount = rows.length;
  const baseline = {
    monthCount,
    income: averageRows(rows, "income"),
    expense: averageRows(rows, "expense"),
    regularExpense: expenseBaseline.regularAverage,
    balance: averageRows(rows, "balance"),
    fixedExpense: averageRows(rows, "fixedExpense"),
    recentIncome: averageRows(recent3, "income"),
    recentExpense: averageRows(recent3, "expense"),
    recentRegularExpense: recentExpenseBaseline.regularAverage,
    recentBalance: averageRows(recent3, "balance"),
    sixMonthExpense: averageRows(recent6, "expense"),
    previousExpense: averageRows(previous3, "expense"),
  };
  const expenseTrend = baseline.previousExpense > 0 ? baseline.recentExpense - baseline.previousExpense : baseline.recentExpense - baseline.expense;
  const incomeTrend = averageRows(recent3, "income") - averageRows(previous3, "income");
  const nextCommitments = getFutureCommitments(data, nextMonth);
  const nextCommitmentMonthly = nextCommitments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const annualCommitments = getFutureCommitments(data, nextMonth, 12);
  const subscriptionMonthly = (data.subscriptions || []).reduce((sum, item) => sum + Number(item.monthlyCost || item.amount || 0), 0);
  const categoryMap = rows.reduce((map, row) => {
    row.categoryTotals.forEach((item) => {
      map[item.category] = map[item.category] || { category: item.category, total: 0, months: 0, recent: 0, previous: 0 };
      map[item.category].total += Number(item.amount || 0);
      map[item.category].months += 1;
    });
    return map;
  }, {});
  recent3.forEach((row) => row.categoryTotals.forEach((item) => {
    if (!categoryMap[item.category]) categoryMap[item.category] = { category: item.category, total: 0, months: 0, recent: 0, previous: 0 };
    categoryMap[item.category].recent += Number(item.amount || 0);
  }));
  previous3.forEach((row) => row.categoryTotals.forEach((item) => {
    if (!categoryMap[item.category]) categoryMap[item.category] = { category: item.category, total: 0, months: 0, recent: 0, previous: 0 };
    categoryMap[item.category].previous += Number(item.amount || 0);
  }));
  const categorySignals = Object.values(categoryMap)
    .map((item) => {
      const monthlyAverage = item.months ? item.total / item.months : 0;
      const recentAverage = item.recent / Math.max(recent3.length, 1);
      const previousAverage = item.previous / Math.max(previous3.length, 1);
      const growth = recentAverage - previousAverage;
      const growthRate = previousAverage > 0 ? growth / previousAverage : recentAverage > 0 ? 1 : 0;
      const trend = growth > Math.max(monthlyAverage * 0.18, 50) ? "up" : growth < -Math.max(monthlyAverage * 0.18, 50) ? "down" : "flat";
      return { ...item, monthlyAverage, recentAverage, previousAverage, growth, growthRate, trend };
    })
    .filter((item) => item.monthlyAverage > 0 || item.recentAverage > 0)
    .sort((left, right) => right.recentAverage - left.recentAverage);
  const growingCategories = categorySignals.filter((item) => item.growth > Math.max(item.monthlyAverage * 0.18, 50)).slice(0, 3);
  const categoryTrendRows = categorySignals
    .slice()
    .sort((left, right) => Math.abs(right.growth) - Math.abs(left.growth) || right.recentAverage - left.recentAverage)
    .slice(0, 4);
  const biasAdjustment = buildForecastBiasAdjustment(data);
  let forecastIncome = Math.max(0, baseline.income * 0.62 + baseline.recentIncome * 0.38 + Math.max(incomeTrend, 0) * 0.08);
  const fixedForecast = Math.max(0, baseline.fixedExpense * 0.55 + averageRows(recent3, "fixedExpense") * 0.45);
  const plannedCommitments = nextCommitments.filter((item) => item.source !== "subscription" && item.planType !== "订阅续费");
  const planForecast = plannedCommitments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const normalExpenseBase = Math.max(baseline.regularExpense - baseline.fixedExpense - subscriptionMonthly, 0);
  const recentNormalExpenseBase = Math.max(baseline.recentRegularExpense - averageRows(recent3, "fixedExpense") - subscriptionMonthly, 0);
  const dailyForecast = Math.max(0, normalExpenseBase * 0.5 + recentNormalExpenseBase * 0.4 + Math.max(expenseTrend, 0) * 0.1);
  const abnormalForecast = expenseBaseline.outliers.reduce((sum, row) => sum + Math.max(Number(row.expense || 0) - expenseBaseline.regularAverage, 0), 0);
  const expenseBreakdown = {
    fixed: fixedForecast,
    subscription: subscriptionMonthly,
    daily: dailyForecast,
    plan: planForecast,
    abnormalExcluded: abnormalForecast,
  };
  let forecastExpense = Math.max(0, expenseBreakdown.fixed + expenseBreakdown.subscription + expenseBreakdown.daily + expenseBreakdown.plan * 0.72 + Math.max(expenseTrend, 0) * 0.08);
  const incomeCap = Math.max(forecastIncome * 0.18, 120);
  const expenseCap = Math.max(forecastExpense * 0.2, 120);
  const appliedIncomeAdjustment = Math.max(-incomeCap, Math.min(incomeCap, biasAdjustment.income));
  const appliedExpenseAdjustment = Math.max(-expenseCap, Math.min(expenseCap, biasAdjustment.expense));
  forecastIncome = Math.max(0, forecastIncome + appliedIncomeAdjustment);
  forecastExpense = Math.max(0, forecastExpense + appliedExpenseAdjustment);
  const forecastBalance = forecastIncome - forecastExpense;
  const dataQuality = buildFinanceDataQuality(data, latestMonth);
  const uncertaintyRate = dataQuality.score >= 86 ? 0.08 : dataQuality.score >= 70 ? 0.14 : 0.22;
  const incomeSwing = Math.max(Math.abs(incomeTrend) * 0.35, forecastIncome > 0 ? forecastIncome * uncertaintyRate : 0, forecastIncome > 0 ? 80 : 0);
  const expenseSwing = Math.max(Math.abs(expenseTrend) * 0.35, forecastExpense > 0 ? forecastExpense * (uncertaintyRate + 0.04) : 0, forecastExpense > 0 ? 80 : 0);
  const predictionRange = {
    income: {
      low: Math.max(0, forecastIncome - incomeSwing),
      mid: forecastIncome,
      high: forecastIncome + incomeSwing,
    },
    expense: {
      low: Math.max(0, forecastExpense - expenseSwing * 0.65),
      mid: forecastExpense,
      high: forecastExpense + expenseSwing,
    },
    balance: {
      low: Math.max(0, forecastIncome - incomeSwing) - (forecastExpense + expenseSwing),
      mid: forecastBalance,
      high: (forecastIncome + incomeSwing) - Math.max(0, forecastExpense - expenseSwing * 0.65),
    },
    riskLine: Math.max(forecastIncome * 0.08, expenseBreakdown.fixed * 0.25, forecastExpense > 0 ? 300 : 0),
    uncertaintyRate,
  };
  const riskScenarioExtra = Math.max(expenseBreakdown.daily * 0.16, expenseBreakdown.plan * 0.18, expenseSwing * 0.35);
  const scenarios = [
    {
      key: "optimistic",
      label: "乐观",
      income: predictionRange.income.high,
      expense: predictionRange.expense.low,
      text: "支出控制良好，计划支出按低位发生。",
    },
    {
      key: "normal",
      label: "正常",
      income: forecastIncome,
      expense: forecastExpense,
      text: "按当前全库基线、近期趋势和已知计划推演。",
    },
    {
      key: "pressure",
      label: "压力",
      income: forecastIncome,
      expense: Math.max(forecastExpense, predictionRange.expense.high),
      text: "日常消费或未来计划继续抬高。",
    },
    {
      key: "risk",
      label: "风险",
      income: predictionRange.income.low,
      expense: predictionRange.expense.high + riskScenarioExtra,
      text: "收入低位叠加支出上行，现金流安全边际被压缩。",
    },
  ].map((item) => ({
    ...item,
    balance: item.income - item.expense,
    tone: item.income - item.expense < predictionRange.riskLine ? "risk" : item.income - item.expense < forecastIncome * 0.12 ? "watch" : "good",
  }));
  const annualIncome = forecastIncome * 12;
  const annualExpense = forecastExpense * 12 + annualCommitments.reduce((sum, item) => sum + Number(item.amount || 0), 0) * 0.18;
  const annualBalance = annualIncome - annualExpense;
  const annualRiskLoss = Math.max(0, (baseline.balance * 12) - annualBalance);
  const nextExpenseRate = forecastIncome > 0 ? forecastExpense / forecastIncome : 0;
  const riskScore =
    (monthCount < 3 ? 18 : 0)
    + (forecastBalance < 0 ? 32 : forecastBalance < forecastIncome * 0.12 ? 18 : 0)
    + (nextExpenseRate >= 0.95 ? 24 : nextExpenseRate >= 0.82 ? 12 : 0)
    + (expenseTrend > Math.max(baseline.expense * 0.12, 80) ? 14 : 0)
    + (expenseBaseline.outliers.length ? 6 : 0)
    + (nextCommitmentMonthly > Math.max(forecastBalance, 0) ? 14 : 0)
    + (annualBalance < 0 ? 24 : annualRiskLoss > Math.max(annualIncome * 0.08, 500) ? 10 : 0);
  const level = riskScore >= 58 ? "risk" : riskScore >= 32 ? "watch" : riskScore >= 16 ? "stable" : "good";
  const levelLabel = level === "risk" ? "高风险" : level === "watch" ? "关注" : level === "stable" ? "可控" : "健康";
  const risks = [
    forecastBalance < 0 ? { level: "risk", title: "下月可能负结余", text: `预计结余 ${formatCurrency(forecastBalance)}，现金流可能转负。`, consequence: "若连续发生，储备金会被动消耗，未来计划更难覆盖。" } : "",
    nextExpenseRate >= 0.82 ? { level: nextExpenseRate >= 0.95 ? "risk" : "watch", title: "支出率偏高", text: `预计下月支出率 ${Math.round(nextExpenseRate * 100)}%。`, consequence: "自由支配空间变小，临时支出会直接挤压结余。" } : "",
    expenseTrend > Math.max(baseline.expense * 0.12, 80) ? { level: "watch", title: "近期支出上行", text: `近 3 月支出较前期月均增加 ${formatCurrency(expenseTrend)}。`, consequence: "如果不压降，年度结余会继续被侵蚀。" } : "",
    expenseBaseline.outliers.length ? { level: "watch", title: "存在异常波动月份", text: `${expenseBaseline.outliers.map((row) => row.month).join("、")} 支出明显高于常规水平。`, consequence: "预测已降低异常月份权重，但仍建议确认是否为一次性支出。" } : "",
    nextCommitmentMonthly > Math.max(forecastBalance, 0) ? { level: "risk", title: "未来计划覆盖不足", text: `下月起 3 个月已知计划/续费 ${formatCurrency(nextCommitmentMonthly)}。`, consequence: "计划到期时可能需要挪用生活预算或延后安排。" } : "",
    growingCategories[0] ? { level: "watch", title: `${growingCategories[0].category}持续增长`, text: `近 3 月月均比前期高 ${formatCurrency(growingCategories[0].growth)}。`, consequence: "长期会形成固定漏点，年度支出被持续抬高。" } : "",
  ].filter(Boolean).slice(0, 5);
  const actions = [
    growingCategories[0] ? `下月优先给「${growingCategories[0].category}」设置控制线，建议不超过 ${formatCurrency(Math.max(growingCategories[0].monthlyAverage, growingCategories[0].recentAverage * 0.9))}。` : "",
    nextExpenseRate >= 0.82 ? "下月前 10 天先观察日均支出，超过节奏时暂停非必要消费。" : "",
    nextCommitmentMonthly > 0 ? `提前预留未来计划/订阅 ${formatCurrency(Math.min(nextCommitmentMonthly, Math.max(forecastIncome * 0.2, 0)))}。` : "",
    subscriptionMonthly > 0 ? `复核订阅月均 ${formatCurrency(subscriptionMonthly)}，非必要项目先暂停新增。` : "",
    forecastBalance < 0 ? "先补齐收入或减少可变支出，避免下月现金流转负。" : "保持分类记录完整，月底对比预测和实际偏差。",
  ].filter(Boolean).slice(0, 5);
  const confidence = monthCount < 3 ? "低" : expenseBaseline.outliers.length >= Math.max(2, Math.ceil(monthCount / 3)) ? "中" : monthCount >= 6 ? "高" : "中";
  const conclusion =
    level === "risk"
      ? `按全库趋势推演，${nextMonth} 可能进入现金流承压状态。`
      : level === "watch"
        ? `长期基线仍可参考，但${nextMonth} 有支出上行或计划压力。`
        : `全库基线显示走势基本可控，重点保持分类和预算节奏。`;
  return {
    baseline,
    expenseBaseline,
    nextMonth: { month: nextMonth, income: forecastIncome, expense: forecastExpense, balance: forecastBalance, expenseRate: nextExpenseRate, commitments: nextCommitmentMonthly },
    nextYear: { year: nextYear, income: annualIncome, expense: annualExpense, balance: annualBalance, riskLoss: annualRiskLoss },
    categorySignals,
    categoryTrendRows,
    growingCategories,
    risks,
    actions,
    level,
    levelLabel,
    confidence,
    conclusion,
    variableExpense: dailyForecast,
    expenseBreakdown,
    predictionRange,
    scenarios,
    calibrationAdjustment: {
      count: biasAdjustment.count,
      confidence: biasAdjustment.label,
      income: appliedIncomeAdjustment,
      expense: appliedExpenseAdjustment,
      balance: appliedIncomeAdjustment - appliedExpenseAdjustment,
      samples: biasAdjustment.samples,
      excludedCount: biasAdjustment.excludedSamples.length,
    },
  };
}

function buildForecastActualComparison(data, noteOrSummary) {
  const report = noteOrSummary?.billReportSummary || noteOrSummary || {};
  const forecast = report.forecast || {};
  const forecastMonth = forecast.nextMonth || forecast.nextMonthMonth || forecast.month || "";
  if (!/^\d{4}-\d{2}$/.test(forecastMonth)) return null;
  const actual = getMonthlyFinanceSummary(data, forecastMonth);
  const hasActual = actual.bills.length > 0 || actual.income > 0 || actual.expense > 0;
  const predictedIncome = Number(forecast.nextMonthIncome ?? forecast.income ?? 0);
  const predictedExpense = Number(forecast.nextMonthExpense ?? forecast.expense ?? 0);
  const predictedBalance = Number(forecast.nextMonthBalance ?? forecast.balance ?? 0);
  const expenseDelta = actual.expense - predictedExpense;
  const balanceDelta = actual.balance - predictedBalance;
  const expenseBase = Math.max(Math.abs(predictedExpense), Math.abs(actual.expense), 1);
  const balanceBase = Math.max(Math.abs(predictedBalance), Math.abs(actual.balance), 1);
  const expenseDrift = Math.abs(expenseDelta) / expenseBase;
  const balanceDrift = Math.abs(balanceDelta) / balanceBase;
  const drift = Math.max(expenseDrift, balanceDrift);
  const level = !hasActual ? "pending" : drift <= 0.18 ? "good" : drift <= 0.36 ? "watch" : "risk";
  const label = level === "pending" ? "待验证" : level === "good" ? "偏差可控" : level === "watch" ? "需要校准" : "明显偏离";
  const unclassifiedCount = actual.bills.filter((item) => !item.category || item.category === "未分类").length;
  const causeLabel = !hasActual
    ? "待验证"
    : unclassifiedCount > 0
      ? "分类待补"
      : predictedIncome > 0 && actual.income < predictedIncome * 0.68
        ? "收入偏差"
        : actual.expense > predictedExpense * 1.22
          ? "支出偏差"
          : actual.expense < predictedExpense * 0.78
            ? "预测偏保守"
            : "模型可沿用";
  return {
    month: forecastMonth,
    hasActual,
    level,
    label,
    causeLabel,
    predictedIncome,
    predictedExpense,
    predictedBalance,
    actualIncome: actual.income,
    actualExpense: actual.expense,
    actualBalance: actual.balance,
    incomeDelta: actual.income - predictedIncome,
    expenseDelta,
    balanceDelta,
    drift,
  };
}

function buildForecastCalibrationSummary(data) {
  const checks = (data.notes || [])
    .filter((item) => item.noteType === "summary" && item.billReportSummary?.forecast)
    .map((item) => ({
      ...buildForecastActualComparison(data, item),
      reportMonth: item.billReportMonth || String(item.title || "").match(/\d{4}-\d{2}/)?.[0] || "",
    }))
    .filter((item) => item && item.hasActual)
    .sort((left, right) => String(right.month || "").localeCompare(String(left.month || "")));
  const latest = checks[0] || null;
  const verifiedCount = checks.length;
  const stableCount = checks.filter((item) => item.level === "good").length;
  const riskCount = checks.filter((item) => item.level === "risk").length;
  const averageDrift = verifiedCount ? checks.reduce((sum, item) => sum + Number(item.drift || 0), 0) / verifiedCount : 0;
  const stability = verifiedCount
    ? Math.max(0, Math.round((1 - Math.min(averageDrift, 0.85)) * 100))
    : 0;
  const level = !verifiedCount ? "pending" : stability >= 78 && !riskCount ? "good" : stability >= 60 ? "watch" : "risk";
  const label = !verifiedCount ? "待积累" : level === "good" ? "稳定" : level === "watch" ? "需观察" : "需校准";
  const basis = verifiedCount
    ? `已验证 ${verifiedCount} 个月，偏差可控 ${stableCount} 次，明显偏离 ${riskCount} 次，平均偏差 ${Math.round(averageDrift * 100)}%。`
    : "保存月报后，系统会在目标月份产生实际账单时自动回看预测偏差。";
  const action = !verifiedCount
    ? "先连续保存月报，积累预测样本。"
    : latest?.causeLabel === "收入偏差"
      ? "下轮优先确认收入是否漏录，再调整收入预测基线。"
      : latest?.causeLabel === "支出偏差"
        ? "下轮提高近期支出和分类增长权重，重点检查大额流向。"
        : latest?.causeLabel === "分类待补"
          ? "先补齐未分类流水，否则分类流向会影响预测校准。"
          : latest?.causeLabel === "预测偏保守"
            ? "检查未来计划或订阅是否延期，适当降低已知压力权重。"
            : "当前模型可继续沿用，月底保持复盘。";
  return { checks, latest, verifiedCount, stableCount, riskCount, averageDrift, stability, level, label, basis, action };
}

function buildForecastReviewDashboard(data) {
  const calibration = buildForecastCalibrationSummary(data);
  const adjustment = buildForecastBiasAdjustment(data);
  const checks = calibration.checks || [];
  const causeCounts = checks.reduce((map, item) => {
    const cause = item.causeLabel || "未识别";
    map[cause] = (map[cause] || 0) + 1;
    return map;
  }, {});
  const topCause = Object.entries(causeCounts).sort((left, right) => right[1] - left[1])[0];
  const avgBalanceDelta = checks.length
    ? checks.reduce((sum, item) => sum + Math.abs(Number(item.balanceDelta || 0)), 0) / checks.length
    : 0;
  const accuracy = checks.length ? Math.round((calibration.stableCount / checks.length) * 100) : 0;
  const tone = !checks.length ? "pending" : accuracy >= 70 && calibration.riskCount === 0 ? "good" : accuracy >= 45 ? "watch" : "risk";
  const label = !checks.length ? "待验证" : tone === "good" ? "表现稳定" : tone === "watch" ? "需要观察" : "需要校准";
  return {
    ...calibration,
    tone,
    label,
    accuracy,
    avgBalanceDelta,
    topCause: topCause?.[0] || "暂无",
    topCauseCount: topCause?.[1] || 0,
    excludedCount: (adjustment.excludedSamples || []).length,
  };
}

function getForecastExcludedSampleSummary(data) {
  const adjustment = buildForecastBiasAdjustment(data);
  const excluded = adjustment.excludedSamples || [];
  if (!excluded.length) return null;
  const reasonMap = excluded.reduce((map, item) => {
    const reason = item.excludeReason || "样本异常";
    map[reason] = (map[reason] || 0) + 1;
    return map;
  }, {});
  const topReason = Object.entries(reasonMap).sort((left, right) => right[1] - left[1])[0];
  const latest = excluded[0];
  const title = topReason?.[0] === "分类待补"
    ? "清理预测样本分类"
    : topReason?.[0] === "极端偏差"
      ? "复核极端预测偏差"
      : "补齐预测样本数据";
  const text = topReason?.[0] === "分类待补"
    ? `有 ${excluded.length} 个预测样本因分类待补被排除，先补齐 ${latest?.month || "相关月份"} 流水分类。`
    : topReason?.[0] === "极端偏差"
      ? `有 ${excluded.length} 个预测样本偏差过大，建议复核 ${latest?.month || "相关月份"} 是否有一次性大额或漏录。`
      : `有 ${excluded.length} 个预测样本暂未参与模型修正，需要补齐预测值或实际账单。`;
  return { count: excluded.length, topReason: topReason?.[0] || "样本异常", latest, title, text };
}

function buildFinanceRisks(summary, commitments) {
  const risks = [];
  if (summary.income <= 0 && summary.expense > 0) {
    risks.push({
      level: "risk",
      title: "缺少收入参照",
      text: "当前月份已有支出，但未录入工资或其他收入，无法判断支出是否健康。",
      basis: `收入 ${formatCurrency(summary.income)}，支出 ${formatCurrency(summary.expense)}。`,
      action: "先补录工资、奖金或其他固定收入，再判断支出率。",
    });
  }
  if (summary.income > 0 && summary.expenseRate >= 0.9) {
    risks.push({
      level: "risk",
      title: "支出率过高",
      text: `本月支出已达收入 ${Math.round(summary.expenseRate * 100)}%，建议暂停非必要消费。`,
      basis: `支出率 ${Math.round(summary.expenseRate * 100)}% >= 风险线 90%。`,
      action: "暂停新增非必要消费，优先复核最大分类和大额流水。",
    });
  }
  if (summary.income > 0 && summary.repaymentRate >= 0.35) {
    risks.push({
      level: "risk",
      title: "还款压力偏高",
      text: `还款占收入 ${Math.round(summary.repaymentRate * 100)}%，需要关注信用卡、房贷或分期。`,
      basis: `还款 ${formatCurrency(summary.repayment)} / 收入 ${formatCurrency(summary.income)} = ${Math.round(summary.repaymentRate * 100)}%，风险线 35%。`,
      action: "优先确认还款日和最低还款额，避免同月叠加大额消费。",
    });
  }
  if (summary.income > 0 && summary.fixedRate >= 0.4) {
    risks.push({
      level: "watch",
      title: "固定支出偏高",
      text: `固定支出占收入 ${Math.round(summary.fixedRate * 100)}%，下月可支配空间会被压缩。`,
      basis: `固定支出 ${formatCurrency(summary.fixedExpense)} / 收入 ${formatCurrency(summary.income)} = ${Math.round(summary.fixedRate * 100)}%，关注线 40%。`,
      action: "先预留固定支出，再给可变生活费设置日均上限。",
    });
  }
  if (summary.totalBudget > 0 && summary.expense / summary.totalBudget >= 0.8) {
    const budgetRate = summary.expense / summary.totalBudget;
    risks.push({
      level: summary.expense > summary.totalBudget ? "risk" : "watch",
      title: "预算接近上限",
      text: `总预算已使用 ${Math.round(budgetRate * 100)}%。`,
      basis: `已用 ${formatCurrency(summary.expense)} / 总预算 ${formatCurrency(summary.totalBudget)} = ${Math.round(budgetRate * 100)}%，关注线 80%。`,
      action: summary.expense > summary.totalBudget ? "本月停止非必要支出，月底复盘超支来源。" : "剩余时间按日均额度控制，避免提前耗尽预算。",
    });
  }
  const futureExpense = commitments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const futureCapacity = Math.max(summary.balance, 0) + Math.max(summary.income, 0);
  if (futureExpense > futureCapacity) {
    risks.push({
      level: "watch",
      title: "未来计划压力",
      text: `未来 3 个月计划/续费约 ${formatCurrency(futureExpense)}，建议提前安排储备。`,
      basis: `未来压力 ${formatCurrency(futureExpense)} > 当前缓冲 ${formatCurrency(futureCapacity)}。`,
      action: "把高优先级计划拆成月储备，低优先级计划先延后。",
    });
  }
  if (!risks.length) {
    risks.push({
      level: "good",
      title: "暂无明显风险",
      text: "当前数据未触发高风险规则，继续保持收入、支出和预算录入。",
      basis: "支出率、固定支出、还款、预算和未来计划均未触发风险线。",
      action: "保持分类完整，月底保存复盘即可。",
    });
  }
  return risks.slice(0, 4);
}

function buildMonthlySpendingAdvice(data, summary) {
  const previousMonth = getRelativeMonth(summary.month, -1);
  const previousSummary = getMonthlyFinanceSummary(data, previousMonth);
  const topPrevious = previousSummary.categoryTotals[0] || null;
  const topCurrent = summary.categoryTotals[0] || null;
  const growthRows = summary.categoryTotals
    .map((row) => {
      const previous = previousSummary.categoryTotals.find((item) => item.category === row.category)?.amount || 0;
      return { ...row, previous, growth: row.amount - previous };
    })
    .filter((row) => row.growth > 0)
    .sort((left, right) => right.growth - left.growth);
  const topGrowth = growthRows[0] || null;
  const days = getMonthDays(summary.month);
  const todayKey = getDateKey(new Date());
  const todayDay = todayKey.startsWith(summary.month) ? Number(todayKey.slice(8, 10)) : days.length;
  const daysLeft = Math.max(days.length - todayDay + 1, 1);
  const spendingTarget = summary.totalBudget || Math.max(summary.income - Math.max(summary.income * 0.15, 0), 0);
  const remainingTarget = Math.max(spendingTarget - summary.expense, 0);
  const dailyAllowance = remainingTarget / daysLeft;
  const suggestedReserve = Math.max(summary.income * 0.1, 0);
  const flexibleTarget = Math.max(spendingTarget - summary.fixedExpense, 0);
  const avoidCategory = topGrowth || topPrevious || topCurrent;
  const hasPreviousData = previousSummary.expense > 0 || previousSummary.income > 0;
  const focusItems = [
    hasPreviousData && topPrevious
      ? `上月主要流向是「${topPrevious.category}」，占上月支出 ${Math.round((topPrevious.amount / Math.max(previousSummary.expense, 1)) * 100)}%。`
      : "上月数据不足，先保持本月分类和收入录入完整。",
    topGrowth
      ? `本月「${topGrowth.category}」已比上月多 ${formatCurrency(topGrowth.growth)}，建议优先检查是否必要。`
      : topCurrent
        ? `本月当前最大支出是「${topCurrent.category}」，继续观察是否超过预算节奏。`
        : "本月暂无可分析支出，建议先导入或补录账单。",
    spendingTarget
      ? `本月剩余可用目标约 ${formatCurrency(remainingTarget)}，日均可安排 ${formatCurrency(dailyAllowance)}。`
      : "尚未设置预算或收入，建议先录入月收入与总预算。",
  ];
  return {
    previousMonth,
    previousSummary,
    topPrevious,
    topCurrent,
    topGrowth,
    avoidCategory,
    spendingTarget,
    remainingTarget,
    dailyAllowance,
    suggestedReserve,
    flexibleTarget,
    focusItems,
  };
}

function buildMonthlyActionItems(data, summary, risks, commitments) {
  const actions = [];
  const pushAction = (item) => {
    if (!item?.title || actions.some((action) => action.title === item.title)) return;
    const id = String(item.id || `${item.label}-${item.title}`)
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    actions.push({ ...item, id });
  };
  const actionTitleFromId = (id) => String(id || "")
    .replace(/^carry-\d{4}-\d{2}-/, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const budgetLimit = Number(summary.totalBudget || 0);
  const dynamicPlan = getDynamicBudgetPlan(summary, commitments);
  const pacePlan = getBudgetPacePlan(summary);
  const categorySuggestions = buildCategoryBudgetSuggestions(data, summary, dynamicPlan);
  const topCategorySuggestion = categorySuggestions[0];
  const topCategory = summary.categoryTotals[0];
  const futureExpense = commitments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const reserve = Math.max(summary.balance, 0);
  const futureGap = Math.max(futureExpense - reserve, 0);
  const monthlyReserve = futureExpense > 0 ? (futureGap > 0 ? futureGap / 3 : futureExpense / 3) : 0;
  const subscriptions = commitments.filter((item) => item.source === "subscription" || item.planType === "订阅续费");
  const subscriptionAmount = subscriptions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const advice = buildMonthlySpendingAdvice(data, summary);
  const forecast = buildFinanceForecast(data, summary.month);
  const excludedForecastSamples = getForecastExcludedSampleSummary(data);
  const dataQuality = buildFinanceDataQuality(data, summary.month);

  if (summary.income <= 0 && summary.expense > 0) {
    pushAction({
      tone: "risk",
      label: "风险",
      title: "补录本月收入",
      text: "先补齐工资或固定收入，避免预算和风险判断失真。",
      metric: "优先",
    });
  }

  if (dataQuality.level !== "good" && dataQuality.issues[0]) {
    pushAction({
      id: `data-quality-${summary.month}-${dataQuality.issues[0].title}`,
      tone: dataQuality.level,
      label: "质量",
      title: dataQuality.issues[0].title,
      text: dataQuality.issues[0].action || dataQuality.issues[0].text,
      metric: `${dataQuality.score} 分`,
    });
  }

  if (forecast.level === "risk" || forecast.level === "watch") {
    const forecastRisk = forecast.risks.find((item) => item.level === "risk") || forecast.risks[0];
    pushAction({
      id: `forecast-${forecast.nextMonth.month}-${forecast.level}`,
      tone: forecast.level,
      label: "预告",
      title: forecastRisk?.title || "处理下月风险预告",
      text: forecast.actions[0] || forecastRisk?.text || forecast.conclusion,
      metric: forecast.levelLabel,
    });
  }

  if (excludedForecastSamples) {
    pushAction({
      id: `forecast-sample-cleanup-${summary.month}`,
      tone: excludedForecastSamples.topReason === "极端偏差" ? "watch" : "risk",
      label: "校准",
      title: excludedForecastSamples.title,
      text: excludedForecastSamples.text,
      metric: `${excludedForecastSamples.count} 个样本`,
    });
  }

  if (topCategorySuggestion) {
    pushAction({
      tone: topCategorySuggestion.level,
      label: "预算",
      title: `${topCategorySuggestion.category}控制线`,
      text: topCategorySuggestion.action,
      metric: formatCurrency(topCategorySuggestion.target),
    });
  } else if (topCategory) {
    const categoryTarget = budgetLimit > 0 ? Math.max(budgetLimit - summary.expense + topCategory.amount, 0) : Math.max(topCategory.amount * 0.85, 0);
    pushAction({
      tone: summary.expenseRate >= 0.9 ? "risk" : "watch",
      label: "流向",
      title: `${topCategory.category}降频`,
      text: `本月最大流向 ${formatCurrency(topCategory.amount)}，后续控制在 ${formatCurrency(categoryTarget)} 内。`,
      metric: formatCurrency(topCategory.amount),
    });
  }

  if (budgetLimit > 0) {
    pushAction({
      tone: pacePlan.level === "stable" ? "good" : pacePlan.level,
      label: "节奏",
      title: pacePlan.label,
      text: pacePlan.action,
      metric: formatCurrency(pacePlan.dailyBudget),
    });
  } else if (summary.income > 0) {
    pushAction({
      tone: "watch",
      label: "节奏",
      title: "设置总预算",
      text: `建议先以 ${formatCurrency(Math.max(summary.income - summary.fixedExpense, 0))} 作为本月可安排上限。`,
      metric: "待设",
    });
  }

  if (summary.income > 0) {
    pushAction({
      tone: dynamicPlan.level,
      label: "额度",
      title: "按动态可支配执行",
      text: `剩余自由支配 ${formatCurrency(dynamicPlan.freeRemaining)}，日均不超过 ${formatCurrency(dynamicPlan.dailyFree)}。`,
      metric: formatCurrency(dynamicPlan.freeRemaining),
    });
  }

  if (subscriptions.length) {
    pushAction({
      tone: subscriptionAmount > Math.max(summary.balance, 0) ? "watch" : "good",
      label: "订阅",
      title: "订阅暂停新增",
      text: `先确认 ${subscriptions.length} 项续费，合计 ${formatCurrency(subscriptionAmount)}。`,
      metric: `${subscriptions.length} 项`,
    });
  }

  if (futureExpense > 0) {
    pushAction({
      tone: futureGap > 0 ? "watch" : "good",
      label: "计划",
      title: "预留未来计划",
      text: `每月预留 ${formatCurrency(monthlyReserve)}，优先覆盖未来 3 个月安排。`,
      metric: formatCurrency(futureExpense),
    });
  }

  const primaryRisk = risks.find((item) => item.level === "risk" || item.level === "watch");
  if (primaryRisk) {
    pushAction({
      tone: primaryRisk.level,
      label: "提醒",
      title: primaryRisk.title,
      text: primaryRisk.text,
      metric: primaryRisk.level === "risk" ? "高" : "中",
    });
  }

  pushAction({
    tone: "good",
    label: "复盘",
    title: "保留月底复盘",
    text: `月底保存 ${summary.month} 复盘，记录风险、预算、计划和分类流向。`,
    metric: "月底",
  });
  pushAction({
    tone: "good",
    label: "分类",
    title: "保持分类完整",
    text: advice.avoidCategory ? `重点检查「${advice.avoidCategory.category}」是否需要拆分或改类。` : "导入后按文件类型入账，不合理项再手动修正。",
    metric: "持续",
  });

  const previousMonth = getRelativeMonth(summary.month, -1);
  const previousStatuses = ((data.budgets || {}).billActionStatuses || {})[previousMonth] || {};
  Object.entries(previousStatuses)
    .filter(([, status]) => status !== "已完成")
    .slice(0, 3)
    .forEach(([id, status]) => {
      const title = actionTitleFromId(id);
      if (!title || actions.some((action) => action.title === title)) return;
      const beforeCount = actions.length;
      pushAction({
        id: `carry-${previousMonth}-${id}`,
        tone: status === "进行中" ? "watch" : "risk",
        label: "延续",
        title,
        text: `${previousMonth} 未完成，建议本月继续跟进并标记结果。`,
        metric: status || "待处理",
      });
      if (actions.length > beforeCount) {
        const [carryAction] = actions.splice(actions.length - 1, 1);
        actions.unshift(carryAction);
      }
    });

  return actions.slice(0, 5);
}

function billDecisionStrip(summary, commitments) {
  const futureExpense = commitments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const status = summary.income <= 0 ? "待补录" : summary.balance >= futureExpense * 0.5 ? "可控" : summary.balance >= 0 ? "关注" : "风险";
  const reserveGap = Math.max(futureExpense - Math.max(summary.balance, 0), 0);
  const dynamicPlan = getDynamicBudgetPlan(summary, commitments);
  const action =
    summary.income <= 0
      ? "先补录收入"
      : summary.balance < 0
        ? "复核大额支出"
        : reserveGap > 0
          ? "安排未来储备"
          : summary.totalBudget > 0 && summary.expense / summary.totalBudget >= 0.8
            ? "控制预算节奏"
            : "保持当前节奏";
  const text =
    summary.income <= 0
      ? "请先录入当月工资，分析才有收入参照。"
      : summary.balance < 0
        ? "本月现金流为负，优先复核大额支出和还款。"
        : `本月结余 ${formatCurrency(summary.balance)}，未来 3 个月已知计划 ${formatCurrency(futureExpense)}。`;
  return `
    <section class="bill-decision-strip bill-decision-strip--${status === "风险" ? "risk" : status === "关注" ? "watch" : "stable"}">
      <div class="bill-decision-strip__main">
        <span>${escapeHtml(summary.month)} 月度结论</span>
        <strong>${escapeHtml(status)}</strong>
        <p>${escapeHtml(text)}</p>
      </div>
      <div class="bill-decision-strip__metrics">
        <article><span>动态可支配</span><b>${formatCurrency(dynamicPlan.freeRemaining)}</b></article>
        <article><span>未来压力</span><b>${formatCurrency(futureExpense)}</b></article>
        <article><span>资金缺口</span><b>${formatCurrency(reserveGap)}</b></article>
        <article><span>下一步</span><b>${escapeHtml(action)}</b></article>
      </div>
    </section>
  `;
}

function billMonthlyActionPanel(data, summary, risks, commitments) {
  const actions = buildMonthlyActionItems(data, summary, risks, commitments);
  const statusMap = ((data.budgets || {}).billActionStatuses || {})[summary.month] || {};
  const statusMetaMap = ((data.budgets || {}).billActionStatusMeta || {})[summary.month] || {};
  const statusMeta = {
    待处理: { next: "进行中", label: "待处理" },
    进行中: { next: "已完成", label: "进行中" },
    已完成: { next: "待处理", label: "已完成" },
  };
  const doneCount = actions.filter((item) => statusMap[item.id] === "已完成").length;
  const doingCount = actions.filter((item) => statusMap[item.id] === "进行中").length;
  const todoCount = Math.max(actions.length - doneCount - doingCount, 0);
  const statusWeight = { 进行中: 0, 待处理: 1, 已完成: 3 };
  const toneWeight = { risk: 0, watch: 1, good: 2 };
  const orderedActions = actions
    .map((item, index) => ({ ...item, originalIndex: index }))
    .sort((left, right) => {
      const leftStatus = statusMap[left.id] || "待处理";
      const rightStatus = statusMap[right.id] || "待处理";
      const leftCarry = left.label === "延续" ? -1 : 0;
      const rightCarry = right.label === "延续" ? -1 : 0;
      return (
        (statusWeight[leftStatus] ?? 1) - (statusWeight[rightStatus] ?? 1)
        || leftCarry - rightCarry
        || (toneWeight[left.tone] ?? 2) - (toneWeight[right.tone] ?? 2)
        || left.originalIndex - right.originalIndex
      );
    });
  return `
    <section class="panel bill-action-panel" id="billActionPanel" data-bill-action-panel>
      <div class="panel-head">
        <h2>本月行动清单</h2>
        <span class="results-count">${doneCount}/${actions.length} 已完成 · ${doingCount} 进行中 · ${todoCount} 待处理</span>
      </div>
      <div class="bill-action-list">
        ${orderedActions.map((item, index) => {
          const status = statusMap[item.id] || "待处理";
          const meta = statusMeta[status] || statusMeta["待处理"];
          const actionMeta = statusMetaMap[item.id] || {};
          const statusDate = String(actionMeta.completedAt || actionMeta.updatedAt || "").slice(0, 10);
          return `
          <article
            class="bill-action-item bill-action-item--${escapeHtml(item.tone)} bill-action-item--status-${status === "已完成" ? "done" : status === "进行中" ? "doing" : "todo"}"
            data-bill-action-detail
            data-action-id="${escapeHtml(item.id)}"
            data-action-month="${escapeHtml(summary.month)}"
            data-action-tone="${escapeHtml(item.tone)}"
            data-action-label="${escapeHtml(item.label)}"
            data-action-title="${escapeHtml(item.title)}"
            data-action-text="${escapeHtml(item.text)}"
            data-action-metric="${escapeHtml(item.metric)}"
            data-action-status="${escapeHtml(status)}"
            data-action-next-status="${escapeHtml(meta.next)}"
            data-action-date="${escapeHtml(statusDate)}"
            tabindex="0"
            role="button"
            aria-label="查看${escapeHtml(item.title)}详情"
          >
            <b>${String(index + 1).padStart(2, "0")}</b>
            <div>
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.text)}</p>
            </div>
            <em>${escapeHtml(item.metric)}</em>
            ${statusDate ? `<small class="bill-action-date">${status === "已完成" ? "完成" : "更新"} ${escapeHtml(statusDate)}</small>` : ""}
            <button class="bill-action-status" data-bill-action-status="${escapeHtml(item.id)}" data-bill-action-month="${escapeHtml(summary.month)}" data-next-status="${escapeHtml(meta.next)}" type="button">${escapeHtml(meta.label)}</button>
          </article>
        `;
        }).join("")}
      </div>
    </section>
  `;
}

function getMonthlyReserveFromCommitments(summary, commitments) {
  const futureExpense = commitments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const reserve = Math.max(summary.balance, 0);
  const fundingGap = Math.max(futureExpense - reserve, 0);
  const monthlyReserve = futureExpense > 0 ? (fundingGap > 0 ? fundingGap / 3 : futureExpense / 3) : 0;
  return { futureExpense, reserve, fundingGap, monthlyReserve };
}

function getDynamicBudgetPlan(summary, commitments) {
  const { futureExpense, fundingGap, monthlyReserve } = getMonthlyReserveFromCommitments(summary, commitments);
  const fixedReserve = Math.max(summary.fixedExpense, 0);
  const plannedReserve = Math.max(monthlyReserve, 0);
  const variableSpent = Math.max(summary.expense - summary.fixedExpense, 0);
  const freeLimit = Math.max(summary.income - fixedReserve - plannedReserve, 0);
  const freeRemaining = Math.max(freeLimit - variableSpent, 0);
  const days = getMonthDays(summary.month);
  const todayKey = getDateKey(new Date());
  const todayDay = todayKey.startsWith(summary.month) ? Number(todayKey.slice(8, 10)) : days.length;
  const daysLeft = Math.max(days.length - todayDay + 1, 1);
  const dailyFree = freeRemaining / daysLeft;
  const level = summary.income <= 0 || freeRemaining <= 0 ? "risk" : freeRemaining < freeLimit * 0.2 ? "watch" : "good";
  return {
    futureExpense,
    fundingGap,
    fixedReserve,
    plannedReserve,
    variableSpent,
    freeLimit,
    freeRemaining,
    daysLeft,
    dailyFree,
    level,
  };
}

function buildCategoryBudgetSuggestions(data, summary, dynamicPlan) {
  const previousMonth = getRelativeMonth(summary.month, -1);
  const previousSummary = getMonthlyFinanceSummary(data, previousMonth);
  const configuredBudgets = new Map((summary.categoryBudgets || []).map((item) => [item.category, Number(item.amount || 0)]));
  const categoryNames = [
    ...summary.categoryTotals.slice(0, 6).map((item) => item.category),
    ...previousSummary.categoryTotals.slice(0, 4).map((item) => item.category),
    ...configuredBudgets.keys(),
  ];
  const uniqueNames = [...new Set(categoryNames.filter(Boolean))];
  const flexiblePool = summary.totalBudget > 0 ? summary.totalBudget : dynamicPlan.freeLimit;
  return uniqueNames
    .map((category) => {
      const used = summary.categoryTotals.find((item) => item.category === category)?.amount || 0;
      const previous = previousSummary.categoryTotals.find((item) => item.category === category)?.amount || 0;
      const configured = configuredBudgets.get(category) || 0;
      const previousShare = previousSummary.expense > 0 ? previous / previousSummary.expense : 0;
      const currentShare = summary.expense > 0 ? used / summary.expense : 0;
      const share = Math.max(previousShare, currentShare);
      const poolTarget = flexiblePool > 0 && share > 0 ? flexiblePool * share : 0;
      const suggested =
        configured > 0
          ? configured
          : previous > 0
            ? Math.max(previous * (used > previous * 1.15 ? 0.9 : 1), poolTarget * 0.85)
            : used > 0
              ? used * 0.85
              : 0;
      const target = Math.max(0, Math.round(suggested));
      const remaining = target - used;
      const percent = target > 0 ? Math.round((used / target) * 100) : 0;
      const level = remaining < 0 ? "risk" : percent >= 80 ? "watch" : "good";
      const source = configured > 0 ? "手动预算" : previous > 0 ? "参考上月" : "按本月压降";
      const action = remaining < 0
        ? `已超 ${formatCurrency(Math.abs(remaining))}，本月暂停新增。`
        : `剩余控制在 ${formatCurrency(remaining)} 内。`;
      return { category, used, previous, target, remaining, percent, level, source, action };
    })
    .filter((item) => item.target > 0 || item.used > 0)
    .sort((left, right) => {
      const weight = { risk: 0, watch: 1, good: 2 };
      return weight[left.level] - weight[right.level] || right.used - left.used;
    })
    .slice(0, 5);
}

function getBudgetPacePlan(summary) {
  const days = getMonthDays(summary.month);
  const todayKey = getDateKey(new Date());
  const todayDay = todayKey.startsWith(summary.month) ? Number(todayKey.slice(8, 10)) : days.length;
  const daysLeft = Math.max(days.length - todayDay + 1, 1);
  const elapsedRate = days.length ? Math.round((todayDay / days.length) * 100) : 100;
  const totalBudget = Number(summary.totalBudget || 0);
  const usedRate = totalBudget > 0 ? Math.round((summary.expense / totalBudget) * 100) : 0;
  const remainingBudget = Math.max(totalBudget - summary.expense, 0);
  const dailyBudget = totalBudget > 0 ? remainingBudget / daysLeft : 0;
  const paceGap = totalBudget > 0 ? usedRate - elapsedRate : 0;
  const expectedSpend = totalBudget > 0 ? totalBudget * (elapsedRate / 100) : 0;
  const paceAmount = summary.expense - expectedSpend;
  const level = totalBudget <= 0 ? "watch" : summary.expense > totalBudget || paceGap > 15 ? "risk" : paceGap > 5 ? "watch" : paceGap < -12 ? "good" : "stable";
  const label = totalBudget <= 0 ? "待设置" : level === "risk" ? "明显超前" : level === "watch" ? "略微超前" : level === "good" ? "节奏宽松" : "节奏正常";
  const action =
    totalBudget <= 0
      ? "先设置总预算，才能判断本月消耗速度。"
      : summary.expense > totalBudget
        ? "预算已超，本月暂停非必要支出。"
        : paceGap > 15
          ? `比时间进度快 ${paceGap}%，优先压降最大支出分类。`
          : paceGap > 5
            ? `比时间进度快 ${paceGap}%，剩余日均控制在 ${formatCurrency(dailyBudget)} 内。`
            : paceGap < -12
              ? `比时间进度慢 ${Math.abs(paceGap)}%，可保持当前节奏。`
              : `按当前节奏执行，日均不超过 ${formatCurrency(dailyBudget)}。`;
  return { daysLeft, elapsedRate, usedRate, remainingBudget, dailyBudget, paceGap, paceAmount, expectedSpend, level, label, action };
}

function buildBillAnalysisComparison(data, summary) {
  const previousMonth = getRelativeMonth(summary.month, -1);
  const previousSummary = getMonthlyFinanceSummary(data, previousMonth);
  const categoryChanges = summary.categoryTotals
    .map((row) => {
      const previous = previousSummary.categoryTotals.find((item) => item.category === row.category)?.amount || 0;
      return { category: row.category, amount: row.amount, previous, change: row.amount - previous };
    })
    .sort((left, right) => Math.abs(right.change) - Math.abs(left.change));
  const topChange = categoryChanges[0] || null;
  const fixedPercent = summary.expense > 0 ? Math.round((summary.fixedExpense / summary.expense) * 100) : 0;
  const variableExpense = Math.max(summary.expense - summary.fixedExpense, 0);
  const variablePercent = summary.expense > 0 ? Math.round((variableExpense / summary.expense) * 100) : 0;
  return { previousMonth, previousSummary, topChange, fixedPercent, variableExpense, variablePercent };
}

function getBillCategoryFlowRows(summary, limit = 8) {
  return summary.categoryTotals.slice(0, limit).map((row, index) => {
    const items = summary.expenseItems.filter((item) => (item.category || "未分类") === row.category);
    const percent = summary.expense > 0 ? Math.round((row.amount / summary.expense) * 100) : 0;
    const sample = items
      .slice()
      .sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0))[0];
    return { ...row, index, count: items.length, percent, sampleTitle: sample?.title || sample?.note || sample?.source || "暂无代表流水" };
  });
}

function billAnalysisPanel(summary, data) {
  const comparison = buildBillAnalysisComparison(data, summary);
  const metrics = [
    ["收入", formatCurrency(summary.income), `${summary.incomeItems.length} 笔`],
    ["支出", formatCurrency(summary.expense), `${summary.expenseItems.length} 笔`],
    ["结余", formatCurrency(summary.balance), summary.balance >= 0 ? "现金流为正" : "现金流为负"],
    ["支出率", summary.income > 0 ? `${Math.round(summary.expenseRate * 100)}%` : "缺少收入", "支出 / 收入"],
  ];
  const comparisonRows = [
    ["较上月收入", summary.income - comparison.previousSummary.income],
    ["较上月支出", summary.expense - comparison.previousSummary.expense],
    ["较上月结余", summary.balance - comparison.previousSummary.balance],
  ];
  return `
    <section class="panel bill-decision-panel" data-bill-report-panel>
      <div class="panel-head">
        <h2>收支分析</h2>
        <span class="results-count">${escapeHtml(summary.month)}</span>
      </div>
      <div class="bill-metric-grid">
        ${metrics.map(([label, value, hint]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`).join("")}
      </div>
      <div class="bill-analysis-compare">
        ${comparisonRows.map(([label, value]) => `<article class="${value > 0 ? "is-up" : value < 0 ? "is-down" : ""}"><span>${escapeHtml(label)}</span><strong>${value >= 0 ? "+" : ""}${formatCurrency(value)}</strong><small>${escapeHtml(comparison.previousMonth)}</small></article>`).join("")}
        <article>
          <span>变化主因</span>
          <strong>${comparison.topChange ? `${escapeHtml(comparison.topChange.category)} ${comparison.topChange.change >= 0 ? "+" : ""}${formatCurrency(comparison.topChange.change)}` : "暂无"}</strong>
          <small>分类环比</small>
        </article>
      </div>
      <div class="bill-analysis-split">
        <article><span>固定支出</span><strong>${formatCurrency(summary.fixedExpense)}</strong><i><b style="width:${comparison.fixedPercent}%"></b></i><small>${comparison.fixedPercent}%</small></article>
        <article><span>可变生活</span><strong>${formatCurrency(comparison.variableExpense)}</strong><i><b style="width:${comparison.variablePercent}%"></b></i><small>${comparison.variablePercent}%</small></article>
      </div>
    </section>
  `;
}

function billCategoryFlowPanel(summary) {
  const rows = getBillCategoryFlowRows(summary, 8);
  const topRows = rows.slice(0, 4);
  const topCategory = rows[0];
  const categoryCount = summary.categoryTotals.length;
  return `
    <section class="panel bill-category-flow-panel">
      <div class="panel-head">
        <h2>分类流向</h2>
        <span class="results-count">${categoryCount ? `${categoryCount} 类 · ${escapeHtml(summary.month)}` : "暂无分类"}</span>
      </div>
      <div class="bill-category-flow-hero">
        <article>
          <span>最大流向</span>
          <strong>${topCategory ? escapeHtml(topCategory.category) : "暂无支出"}</strong>
          <small>${topCategory ? `${formatCurrency(topCategory.amount)} · ${topCategory.percent}%` : "导入或补录后生成"}</small>
        </article>
        <div class="bill-category-flow-stack" aria-label="分类流向占比">
          ${topRows.map((row) => `<i class="bill-category-flow-stack__seg bill-category-flow-stack__seg--${row.index % 5}" style="width:${Math.max(row.percent, 4)}%" title="${escapeHtml(row.category)} ${row.percent}%"></i>`).join("")}
        </div>
      </div>
      <div class="bill-flow-list bill-flow-list--interactive">
        ${rows
          .map(
            (row) => `
              <article class="bill-flow-row bill-flow-row--${row.index % 5}" data-open-bill-category="${escapeHtml(row.category)}" data-bill-category-month="${escapeHtml(summary.month)}" tabindex="0" role="button">
                <b>${String(row.index + 1).padStart(2, "0")}</b>
                <div>
                  <strong>${escapeHtml(row.category)}</strong>
                  <span>${escapeHtml(row.sampleTitle)} · ${row.count} 笔</span>
                </div>
                <i><u style="width:${row.percent}%"></u></i>
                <em>${formatCurrency(row.amount)}</em>
                <small>${row.percent}%</small>
                <button class="bill-flow-row__trend" data-bill-trend-category-focus="${escapeHtml(row.category)}" data-bill-category-month="${escapeHtml(summary.month)}" type="button">趋势</button>
              </article>
            `,
          )
          .join("") || emptyState("本月暂无支出流向")}
      </div>
    </section>
  `;
}

function billRiskPanel(risks, summary, data) {
  const advice = buildMonthlySpendingAdvice(data, summary);
  const hasActionableRisk = risks.some((risk) => risk.level !== "good");
  const conclusion = hasActionableRisk ? "需要关注" : "整体可控";
  const reserveText = summary.income > 0 ? formatCurrency(advice.suggestedReserve) : "待录入收入";
  const primaryRisk = risks[0] || { level: "good", title: "暂无明显风险", text: "当前数据未触发高风险规则。", basis: "继续保持记录完整。", action: "月底保存复盘即可。" };
  const secondaryRisks = risks.slice(1, 3);
  return `
    <section class="panel bill-decision-panel">
      <div class="panel-head">
        <h2>风险提醒</h2>
        <span class="results-count">${escapeHtml(conclusion)} · 本月建议</span>
      </div>
      <div class="bill-risk-layout">
        <article class="bill-risk-item bill-risk-item--primary bill-risk-item--${escapeHtml(primaryRisk.level)}">
          <div class="bill-risk-item__summary">
            <div class="bill-risk-item__head">
              <strong>${escapeHtml(primaryRisk.title)}</strong>
              <span>${primaryRisk.level === "risk" ? "高风险" : primaryRisk.level === "watch" ? "关注" : "正常"}</span>
            </div>
            <p>${escapeHtml(primaryRisk.text)}</p>
          </div>
          <dl>
            <div><dt>依据</dt><dd>${escapeHtml(primaryRisk.basis || "暂无判断依据")}</dd></div>
            <div><dt>动作</dt><dd>${escapeHtml(primaryRisk.action || "继续观察")}</dd></div>
          </dl>
        </article>
        ${
          secondaryRisks.length
            ? `<div class="bill-risk-list bill-risk-list--compact">
                ${secondaryRisks.map((risk) => `
                  <article class="bill-risk-item bill-risk-item--${escapeHtml(risk.level)}">
                    <div class="bill-risk-item__head">
                      <strong>${escapeHtml(risk.title)}</strong>
                      <span>${risk.level === "risk" ? "高风险" : risk.level === "watch" ? "关注" : "正常"}</span>
                    </div>
                    <p>${escapeHtml(risk.text)}</p>
                  </article>
                `).join("")}
              </div>`
            : ""
        }
      </div>
      <div class="bill-risk-advice-grid">
        <article>
          <span>上月支出</span>
          <strong>${formatCurrency(advice.previousSummary.expense)}</strong>
          <small>${escapeHtml(advice.previousMonth)}</small>
        </article>
        <article>
          <span>上月主项</span>
          <strong>${escapeHtml(advice.topPrevious?.category || "暂无")}</strong>
          <small>${advice.topPrevious ? formatCurrency(advice.topPrevious.amount) : "数据不足"}</small>
        </article>
        <article>
          <span>本月余量</span>
          <strong>${formatCurrency(advice.remainingTarget)}</strong>
          <small>日均 ${formatCurrency(advice.dailyAllowance)}</small>
        </article>
        <article>
          <span>建议储备</span>
          <strong>${escapeHtml(reserveText)}</strong>
          <small>优先留存</small>
        </article>
      </div>
      <div class="bill-risk-focus">
        ${advice.focusItems.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
      </div>
      <div class="bill-risk-allocation">
        <article><span>固定支出</span><strong>${formatCurrency(summary.fixedExpense)}</strong><em>先预留</em></article>
        <article><span>可变生活</span><strong>${formatCurrency(advice.flexibleTarget)}</strong><em>按日控制</em></article>
        <article><span>重点压降</span><strong>${escapeHtml(advice.avoidCategory?.category || "暂无")}</strong><em>${advice.avoidCategory ? "非必要先缓" : "继续记录"}</em></article>
      </div>
    </section>
  `;
}

function billForecastPanel(data, activeMonth) {
  const forecast = buildFinanceForecast(data, activeMonth);
  const calibration = buildForecastCalibrationSummary(data);
  const reviewDashboard = buildForecastReviewDashboard(data);
  const dataQuality = buildFinanceDataQuality(data, activeMonth);
  const excludedSampleSummary = getForecastExcludedSampleSummary(data);
  const calibrationSamples = escapeHtml(JSON.stringify((forecast.calibrationAdjustment.samples || []).slice(0, 6).map((item) => ({
    month: item.month,
    cause: item.causeLabel,
    level: item.label,
    predictedBalance: item.predictedBalance,
    actualBalance: item.actualBalance,
    balanceDelta: item.balanceDelta,
    expenseDelta: item.expenseDelta,
    incomeDelta: item.incomeDelta,
    used: item.usedForCalibration,
    excludeReason: item.excludeReason,
  }))));
  const tone = forecast.level === "risk" ? "risk" : forecast.level === "watch" ? "watch" : forecast.level === "stable" ? "stable" : "good";
  const metricRows = [
    ["历史月均收入", formatCurrency(forecast.baseline.income), `${forecast.baseline.monthCount} 个月样本`],
    ["常规月均支出", formatCurrency(forecast.baseline.regularExpense), `原始月均 ${formatCurrency(forecast.baseline.expense)}`],
    ["下月预计结余", formatCurrency(forecast.nextMonth.balance), `支出率 ${Math.round(forecast.nextMonth.expenseRate * 100)}%`],
    ["年度预计结余", formatCurrency(forecast.nextYear.balance), forecast.nextYear.riskLoss > 0 ? `可能少结余 ${formatCurrency(forecast.nextYear.riskLoss)}` : "走势可控"],
  ];
  const forecastRows = [
    ["下月预测", forecast.nextMonth.month, `收入 ${formatCurrency(forecast.nextMonth.income)} · 支出 ${formatCurrency(forecast.nextMonth.expense)}`],
    ["年度预测", forecast.nextYear.year, `收入 ${formatCurrency(forecast.nextYear.income)} · 支出 ${formatCurrency(forecast.nextYear.expense)}`],
    ["模型修正", forecast.calibrationAdjustment.count ? `${forecast.calibrationAdjustment.confidence}可信` : "未启用", forecast.calibrationAdjustment.count ? `收入 ${forecast.calibrationAdjustment.income >= 0 ? "+" : "-"}${formatCurrency(Math.abs(forecast.calibrationAdjustment.income))} · 支出 ${forecast.calibrationAdjustment.expense >= 0 ? "+" : "-"}${formatCurrency(Math.abs(forecast.calibrationAdjustment.expense))}${forecast.calibrationAdjustment.excludedCount ? ` · 排除 ${forecast.calibrationAdjustment.excludedCount}` : ""}` : "等待历史预测样本"],
    ["已知压力", formatCurrency(forecast.nextMonth.commitments), "未来计划 + 订阅续费"],
    ["特殊波动", `${forecast.expenseBaseline.outliers.length} 个月`, forecast.expenseBaseline.outliers.length ? forecast.expenseBaseline.outliers.map((row) => row.month).join("、") : "暂无明显异常月份"],
  ];
  const breakdownRows = [
    ["固定支出", forecast.expenseBreakdown.fixed, "房贷/保险/学费等"],
    ["订阅续费", forecast.expenseBreakdown.subscription, "当前订阅月均"],
    ["日常消费", forecast.expenseBreakdown.daily, "常规生活支出"],
    ["未来计划", forecast.expenseBreakdown.plan, "已登记计划"],
    ["异常排除", forecast.expenseBreakdown.abnormalExcluded, "不进常规预测"],
  ];
  const rangeRows = [
    ["收入区间", forecast.predictionRange.income, `中位 ${formatCurrency(forecast.predictionRange.income.mid)}`],
    ["支出区间", forecast.predictionRange.expense, `中位 ${formatCurrency(forecast.predictionRange.expense.mid)}`],
    ["结余区间", forecast.predictionRange.balance, `风险线 ${formatCurrency(forecast.predictionRange.riskLine)}`],
  ];
  return `
    <section class="panel bill-forecast-panel bill-forecast-panel--${escapeHtml(tone)}">
      <div class="panel-head">
        <div>
          <span class="eyebrow">FORECAST</span>
          <h2>长期预测与风险预告</h2>
        </div>
        <span class="results-count">可信度 ${escapeHtml(forecast.confidence)} · 数据 ${escapeHtml(String(dataQuality.score))} 分</span>
      </div>
      <div class="bill-forecast-hero">
        <div>
          <span>全库趋势判断</span>
          <strong>${escapeHtml(forecast.levelLabel)}</strong>
          <p>${escapeHtml(forecast.conclusion)}</p>
        </div>
        <b>${escapeHtml(forecast.confidence)}</b>
      </div>
      <div class="bill-data-quality-strip bill-data-quality-strip--${escapeHtml(dataQuality.level)}">
        <article data-bill-forecast-detail data-forecast-title="数据质量" data-forecast-value="${escapeHtml(`${dataQuality.score} 分`)}" data-forecast-text="${escapeHtml(dataQuality.issues[0]?.text || "当前数据质量良好，可作为预测依据。")}" data-forecast-basis="${escapeHtml(dataQuality.actions.join(" ") || "继续保持收入、支出、分类、预算和未来计划完整。")}">
          <span>数据质量</span>
          <strong>${escapeHtml(dataQuality.score)} 分 · ${escapeHtml(dataQuality.label)}</strong>
          <small>预测可信度 ${escapeHtml(dataQuality.confidence)}</small>
        </article>
        <article>
          <span>有效样本</span>
          <strong>${escapeHtml(String(dataQuality.metrics.months))} 个月</strong>
          <small>建议至少 6 个月</small>
        </article>
        <article>
          <span>待补流水</span>
          <strong>${escapeHtml(String(dataQuality.metrics.unclassified))} 笔</strong>
          <small>未分类/待复核</small>
        </article>
        <article>
          <span>异常检查</span>
          <strong>${escapeHtml(String(dataQuality.metrics.abnormal))} 项</strong>
          <small>大额波动</small>
        </article>
      </div>
      ${
        dataQuality.issues.length
          ? `<div class="bill-data-quality-issues">
              ${dataQuality.issues.slice(0, 3).map((item) => `
                <article class="bill-data-quality-issue bill-data-quality-issue--${escapeHtml(item.level)}" data-bill-forecast-detail data-forecast-title="${escapeHtml(item.title)}" data-forecast-value="影响 ${escapeHtml(String(item.penalty))} 分" data-forecast-text="${escapeHtml(item.text)}" data-forecast-basis="${escapeHtml(item.action)}">
                  <strong>${escapeHtml(item.title)}</strong>
                  <span>${escapeHtml(item.text)}</span>
                </article>
              `).join("")}
            </div>`
          : ""
      }
      <div class="bill-forecast-metrics">
        ${metricRows.map(([label, value, hint]) => `<article data-bill-forecast-detail data-forecast-title="${escapeHtml(label)}" data-forecast-value="${escapeHtml(value)}" data-forecast-text="${escapeHtml(hint)}" data-forecast-basis="基于全部历史账单、近 3 月趋势、未来计划与订阅压力综合计算。"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`).join("")}
      </div>
      <div class="bill-forecast-range-grid">
        ${rangeRows.map(([label, range, hint]) => `
          <article data-bill-forecast-detail data-forecast-title="${escapeHtml(label)}" data-forecast-value="${escapeHtml(`${formatCurrency(range.low)} - ${formatCurrency(range.high)}`)}" data-forecast-text="${escapeHtml(hint)}" data-forecast-basis="区间由历史波动、近期趋势、数据质量分和异常样本共同决定；数据越完整，区间越窄。">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(formatCurrency(range.low))} - ${escapeHtml(formatCurrency(range.high))}</strong>
            <small>${escapeHtml(hint)}</small>
          </article>
        `).join("")}
      </div>
      <div class="bill-forecast-scenario-grid">
        ${forecast.scenarios.map((item) => `
          <article class="bill-forecast-scenario bill-forecast-scenario--${escapeHtml(item.tone)}" data-bill-forecast-detail data-forecast-title="${escapeHtml(item.label)}情景" data-forecast-value="${escapeHtml(formatCurrency(item.balance))}" data-forecast-text="${escapeHtml(`收入 ${formatCurrency(item.income)} · 支出 ${formatCurrency(item.expense)}。${item.text}`)}" data-forecast-basis="情景推演基于预测区间、支出拆分和风险线，用于判断现金流在不同走势下的安全边际。">
            <span>${escapeHtml(item.label)}情景</span>
            <strong>${escapeHtml(formatCurrency(item.balance))}</strong>
            <small>收入 ${escapeHtml(formatCurrency(item.income))} · 支出 ${escapeHtml(formatCurrency(item.expense))}</small>
          </article>
        `).join("")}
      </div>
      <div class="bill-forecast-review-board bill-forecast-review-board--${escapeHtml(reviewDashboard.tone)}">
        <article data-bill-forecast-detail data-forecast-title="预测准确率" data-forecast-value="${escapeHtml(reviewDashboard.verifiedCount ? `${reviewDashboard.accuracy}%` : "待验证")}" data-forecast-text="${escapeHtml(reviewDashboard.verifiedCount ? `最近 ${reviewDashboard.verifiedCount} 个已验证月报中，${reviewDashboard.stableCount} 次偏差可控。` : "暂无已完成验证的预测样本。")}" data-forecast-basis="${escapeHtml(reviewDashboard.action)}" data-forecast-samples="${calibrationSamples}">
          <span>预测准确率</span>
          <strong>${escapeHtml(reviewDashboard.verifiedCount ? `${reviewDashboard.accuracy}%` : "待验证")}</strong>
          <small>${escapeHtml(reviewDashboard.label)}</small>
        </article>
        <article data-bill-forecast-detail data-forecast-title="平均偏差" data-forecast-value="${escapeHtml(formatCurrency(reviewDashboard.avgBalanceDelta))}" data-forecast-text="${escapeHtml(reviewDashboard.verifiedCount ? `最近已验证样本的平均结余偏差为 ${formatCurrency(reviewDashboard.avgBalanceDelta)}。` : "暂无平均偏差。")}" data-forecast-basis="偏差越小，预测区间和模型修正越可信。" data-forecast-samples="${calibrationSamples}">
          <span>平均偏差</span>
          <strong>${escapeHtml(formatCurrency(reviewDashboard.avgBalanceDelta))}</strong>
          <small>结余口径</small>
        </article>
        <article data-bill-forecast-detail data-forecast-title="主要偏差原因" data-forecast-value="${escapeHtml(reviewDashboard.topCause)}" data-forecast-text="${escapeHtml(reviewDashboard.topCauseCount ? `${reviewDashboard.topCause} 出现 ${reviewDashboard.topCauseCount} 次。` : "暂无可统计偏差原因。")}" data-forecast-basis="${escapeHtml(reviewDashboard.action)}" data-forecast-samples="${calibrationSamples}">
          <span>主要原因</span>
          <strong>${escapeHtml(reviewDashboard.topCause)}</strong>
          <small>${escapeHtml(reviewDashboard.topCauseCount ? `${reviewDashboard.topCauseCount} 次` : "待积累")}</small>
        </article>
        <article data-bill-forecast-detail data-forecast-title="排除样本" data-forecast-value="${escapeHtml(`${reviewDashboard.excludedCount} 个`)}" data-forecast-text="${escapeHtml(reviewDashboard.excludedCount ? `有 ${reviewDashboard.excludedCount} 个样本因分类待补、缺少预测值或极端偏差被排除。` : "暂无被排除样本。")}" data-forecast-basis="排除样本不会参与自动修正，但会进入数据质量和行动提醒。" data-forecast-samples="${calibrationSamples}">
          <span>排除样本</span>
          <strong>${escapeHtml(String(reviewDashboard.excludedCount))} 个</strong>
          <small>不参与修正</small>
        </article>
      </div>
      <div class="bill-forecast-breakdown">
        ${breakdownRows.map(([label, amount, hint]) => `
          <article data-bill-forecast-detail data-forecast-title="${escapeHtml(label)}预测" data-forecast-value="${escapeHtml(formatCurrency(amount))}" data-forecast-text="${escapeHtml(hint)}" data-forecast-basis="支出拆分预测会把固定、订阅、日常、未来计划和异常波动分开处理，避免所有支出混在一个总数里。">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(formatCurrency(amount))}</strong>
            <small>${escapeHtml(hint)}</small>
          </article>
        `).join("")}
      </div>
      <div class="bill-forecast-calibration-strip bill-forecast-calibration-strip--${escapeHtml(calibration.level)}">
        <article data-bill-forecast-detail data-forecast-title="模型校准" data-forecast-value="${escapeHtml(calibration.label)}" data-forecast-text="${escapeHtml(calibration.basis)}" data-forecast-basis="${escapeHtml(calibration.action)}" data-forecast-samples="${calibrationSamples}">
          <span>模型校准</span>
          <strong>${escapeHtml(calibration.label)}</strong>
          <small>${escapeHtml(calibration.basis)}</small>
        </article>
        <article data-bill-forecast-detail data-forecast-title="最近偏差" data-forecast-value="${escapeHtml(calibration.latest?.causeLabel || "暂无")}" data-forecast-text="${escapeHtml(calibration.latest ? `${calibration.latest.month} · ${calibration.latest.label} · 结余偏差 ${formatCurrency(calibration.latest.balanceDelta)}` : "暂无可验证预测。")}" data-forecast-basis="${escapeHtml(calibration.action)}" data-forecast-samples="${calibrationSamples}">
          <span>最近偏差</span>
          <strong>${escapeHtml(calibration.latest?.causeLabel || "暂无")}</strong>
          <small>${escapeHtml(calibration.latest ? `${calibration.latest.month} · 结余偏差 ${formatCurrency(calibration.latest.balanceDelta)}` : "等待月报样本")}</small>
        </article>
        <article data-bill-forecast-detail data-forecast-title="稳定度" data-forecast-value="${escapeHtml(calibration.verifiedCount ? `${calibration.stability}%` : "待积累")}" data-forecast-text="${escapeHtml(calibration.verifiedCount ? `预测稳定度 ${calibration.stability}%，已验证 ${calibration.verifiedCount} 个月。` : "暂无已完成验证的预测样本。")}" data-forecast-basis="${escapeHtml(calibration.action)}" data-forecast-samples="${calibrationSamples}">
          <span>稳定度</span>
          <strong>${escapeHtml(calibration.verifiedCount ? `${calibration.stability}%` : "待积累")}</strong>
          <small>${escapeHtml(calibration.action)}</small>
        </article>
      </div>
      ${
        excludedSampleSummary
          ? `<div class="bill-forecast-quality-note">
              <strong>${escapeHtml(excludedSampleSummary.title)}</strong>
              <span>${escapeHtml(excludedSampleSummary.text)} 排除样本只展示原因，不参与自动修正。</span>
            </div>`
          : ""
      }
      ${
        forecast.categoryTrendRows.length
          ? `<div class="bill-forecast-category-strip">
              ${forecast.categoryTrendRows.map((item) => {
                const trendLabel = item.trend === "up" ? "增长" : item.trend === "down" ? "回落" : "稳定";
                const trendValue = item.growth >= 0 ? `+${formatCurrency(item.growth)}` : `-${formatCurrency(Math.abs(item.growth))}`;
                return `
                  <article class="bill-forecast-category bill-forecast-category--${escapeHtml(item.trend)}" data-bill-forecast-detail data-forecast-title="${escapeHtml(item.category)}趋势" data-forecast-value="${escapeHtml(trendLabel)}" data-forecast-text="近 3 月月均 ${escapeHtml(formatCurrency(item.recentAverage))}，较前期 ${escapeHtml(trendValue)}。" data-forecast-basis="分类趋势按近 3 月月均与前 3 月月均对比，异常月份已降低对整体预测的权重。">
                    <span>${escapeHtml(item.category)}</span>
                    <strong>${escapeHtml(trendLabel)}</strong>
                    <small>${escapeHtml(trendValue)} · 近 3 月 ${formatCurrency(item.recentAverage)}</small>
                  </article>
                `;
              }).join("")}
            </div>`
          : ""
      }
      <div class="bill-forecast-grid">
        <div class="bill-forecast-stack">
          ${forecastRows.map(([label, value, hint]) => `<article data-bill-forecast-detail data-forecast-title="${escapeHtml(label)}" data-forecast-value="${escapeHtml(value)}" data-forecast-text="${escapeHtml(hint)}" data-forecast-basis="历史基线占主权重，近期趋势和已知未来支出作为修正项。"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><p>${escapeHtml(hint)}</p></article>`).join("")}
        </div>
        <div class="bill-forecast-list">
          <h3>风险来源</h3>
          ${forecast.risks.length ? forecast.risks.map((item) => `
            <article class="bill-forecast-risk bill-forecast-risk--${escapeHtml(item.level)}" data-bill-forecast-detail data-forecast-title="${escapeHtml(item.title)}" data-forecast-value="${escapeHtml(item.level === "risk" ? "高风险" : "关注")}" data-forecast-text="${escapeHtml(item.text)}" data-forecast-basis="${escapeHtml(item.consequence)}">
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.text)}</p>
              <small>${escapeHtml(item.consequence)}</small>
            </article>
          `).join("") : emptyState("全库趋势暂未发现明显风险")}
        </div>
        <div class="bill-forecast-list">
          <h3>建议动作</h3>
          ${forecast.actions.map((item) => `<article class="bill-forecast-action" data-bill-forecast-detail data-forecast-title="建议动作" data-forecast-value="执行建议" data-forecast-text="${escapeHtml(item)}" data-forecast-basis="来自风险预告、预算节奏、分类增长和未来计划压力。"><span>${escapeHtml(item)}</span></article>`).join("")}
        </div>
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

function trendSeriesId(series) {
  return `${series.category || series.key || series.label || "series"}`.replace(/[^\w\u4e00-\u9fa5-]+/g, "-");
}

function trendCurvePath(rows, series, scale) {
  const points = trendSeriesPoints(rows, series, scale);
  const d = buildSmoothTrendPath(points);
  const currentPoint = points[points.length - 1];
  const currentLabel = currentPoint ? `${series.label} · ${trendAxisLabel(currentPoint.row, currentPoint.row.scope)} · ${formatCurrency(currentPoint.value)}` : series.label;
  const seriesId = trendSeriesId(series);
  return `
    <path class="bill-trend-line ${series.className}" d="${d}" data-bill-trend-series="${escapeHtml(seriesId)}"></path>
    <path class="bill-trend-line-hit ${series.className}" d="${d}" data-bill-trend-series="${escapeHtml(seriesId)}" data-bill-trend-tooltip="${escapeHtml(currentLabel)}"></path>
  `;
}

function trendBudgetBand(rows, scale) {
  const budgetRows = rows.filter((row) => Number(row.budget || 0) > 0);
  if (!budgetRows.length) return "";
  const latestBudget = Number(budgetRows[budgetRows.length - 1].budget || 0);
  const warning = latestBudget * 0.8;
  const yBudget = trendPoint(latestBudget, 0, 1, scale.max, scale.min, scale.width, scale.height, scale.padding).y;
  const yWarning = trendPoint(warning, 0, 1, scale.max, scale.min, scale.width, scale.height, scale.padding).y;
  const bandY = Math.min(yBudget, yWarning);
  const bandHeight = Math.max(4, Math.abs(yWarning - yBudget));
  return `
    <g class="bill-trend-budget-band" aria-label="预算警戒带">
      <rect x="${scale.padding}" y="${bandY}" width="${scale.width - scale.padding * 2}" height="${bandHeight}"></rect>
      <line x1="${scale.padding}" y1="${yBudget}" x2="${scale.width - scale.padding}" y2="${yBudget}"></line>
      <text x="${scale.width - scale.padding - 116}" y="${Math.max(scale.padding + 12, yBudget - 8)}">预算线 ${escapeHtml(formatCurrency(latestBudget))}</text>
    </g>
  `;
}

function trendPointMarkers(rows, series, scale) {
  const seriesId = trendSeriesId(series);
  return trendSeriesPoints(rows, series, scale)
    .map((point) => {
      const period = trendAxisLabel(point.row, point.row.scope);
      const value = formatCurrency(point.value);
      return `
        <g class="bill-trend-point ${series.className}" data-bill-trend-series="${escapeHtml(seriesId)}">
          <circle class="bill-trend-point__dot" cx="${point.x}" cy="${point.y}" r="2.4"></circle>
          <circle
            class="bill-trend-point__hit"
            cx="${point.x}"
            cy="${point.y}"
            r="10"
            data-bill-trend-series="${escapeHtml(seriesId)}"
            data-bill-trend-tooltip="${escapeHtml(`${series.label} · ${period} · ${value}`)}"
          ></circle>
        </g>
      `;
    })
    .join("");
}

function getTrendProblems(rows, mode) {
  return rows
    .map((row, index) => {
      if ((mode === "budget" || mode === "all") && row.budget > 0 && row.expense > row.budget) {
        return {
          row,
          index,
          value: row.expense,
          label: `超预算 ${formatCurrency(row.expense - row.budget)}`,
          type: "预算超支",
          basis: `支出 ${formatCurrency(row.expense)} 高于预算 ${formatCurrency(row.budget)}。`,
          action: "优先暂停非必要支出，并检查最大支出分类。",
        };
      }
      if ((mode === "raw" || mode === "all") && row.rawExpense > row.expense) {
        return {
          row,
          index,
          value: row.rawExpense,
          label: `已剔除 ${formatCurrency(row.rawExpense - row.expense)}`,
          type: "原始差异",
          basis: `原始支出 ${formatCurrency(row.rawExpense)}，过滤后支出 ${formatCurrency(row.expense)}。`,
          action: "确认不计入分析的流水是否合理，避免误判生活支出。",
        };
      }
      if ((mode === "cashflow" || mode === "all") && row.balance < 0) {
        return {
          row,
          index,
          value: row.balance,
          label: `负结余 ${formatCurrency(Math.abs(row.balance))}`,
          type: "现金流风险",
          basis: `收入 ${formatCurrency(row.income)}，支出 ${formatCurrency(row.expense)}，结余为负。`,
          action: "先补录收入或压降当期支出，避免预算判断失真。",
        };
      }
      if ((mode === "fixed" || mode === "all") && row.expense > 0 && row.fixedExpense / row.expense >= 0.7) {
        const fixedRate = Math.round((row.fixedExpense / row.expense) * 100);
        return {
          row,
          index,
          value: row.fixedExpense,
          label: `固定占比 ${fixedRate}%`,
          type: "固定支出偏高",
          basis: `固定支出 ${formatCurrency(row.fixedExpense)}，占总支出 ${fixedRate}%。`,
          action: "优先预留固定支出，再安排可变生活费。",
        };
      }
      return null;
    })
    .filter(Boolean)
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, 3);
}

function trendProblemMarkers(problems, rows, scale) {
  return problems
    .map((problem) => {
      const point = trendPoint(problem.value, problem.index, rows.length, scale.max, scale.min, scale.width, scale.height, scale.padding);
      return `
        <circle
          class="bill-trend-problem-hit"
          cx="${point.x}"
          cy="${point.y}"
          r="11"
          data-bill-trend-tooltip="${escapeHtml(`${problem.label} · ${trendAxisLabel(problem.row, problem.row.scope)}`)}"
          data-bill-trend-tooltip-lines="${escapeHtml(trendDetailLine("problem", "异常说明 " + problem.label))}"
          data-bill-trend-problem
          data-problem-title="${escapeHtml(problem.type || "趋势异常")}"
          data-problem-label="${escapeHtml(problem.label)}"
          data-problem-period="${escapeHtml(trendAxisLabel(problem.row, problem.row.scope))}"
          data-problem-basis="${escapeHtml(problem.basis || "当前节点触发异常规则。")}"
          data-problem-action="${escapeHtml(problem.action || "建议复核该时间点的账单。")}"
          data-problem-income="${escapeHtml(formatCurrency(problem.row.income || 0))}"
          data-problem-expense="${escapeHtml(formatCurrency(problem.row.expense || 0))}"
          data-problem-balance="${escapeHtml(formatCurrency(problem.row.balance || 0))}"
        ></circle>
      `;
    })
    .join("");
}

function trendProblemSummary(problems) {
  if (!problems.length) return "";
  return `
    <div class="bill-trend-problems" aria-label="趋势异常点说明">
      ${problems
        .map(
          (problem) => `
            <span>
              <i></i>
              <b>${escapeHtml(trendAxisLabel(problem.row, problem.row.scope))}</b>
              <em>${escapeHtml(problem.label)}</em>
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function trendSummaryMetrics(rows) {
  const current = rows[rows.length - 1] || {};
  const previous = rows[Math.max(rows.length - 2, 0)] || {};
  const income = Number(current.income || 0);
  const expense = Number(current.expense || 0);
  const balance = Number(current.balance || 0);
  const budget = Number(current.budget || 0);
  const expenseDelta = expense - Number(previous.expense || 0);
  const budgetRate = budget > 0 ? Math.round((expense / budget) * 100) : 0;
  return [
    { label: "收入", value: formatCurrency(income), hint: income - Number(previous.income || 0), tone: "income" },
    { label: "支出", value: formatCurrency(expense), hint: expenseDelta, tone: "expense" },
    { label: "结余", value: formatCurrency(balance), hint: balance >= 0 ? "现金流为正" : "现金流为负", tone: balance >= 0 ? "good" : "risk" },
    { label: "预算", value: budget ? `${budgetRate}%` : "未设", hint: budget ? `${formatCurrency(expense)} / ${formatCurrency(budget)}` : "暂无预算线", tone: budgetRate >= 100 ? "risk" : budgetRate >= 80 ? "watch" : "good" },
  ];
}

function trendSummaryStrip(rows) {
  const metrics = trendSummaryMetrics(rows);
  return `
    <div class="bill-trend-summary">
      ${metrics
        .map((item) => {
          const hint = typeof item.hint === "number" ? `${item.hint >= 0 ? "+" : ""}${formatCurrency(item.hint)}` : item.hint;
          return `<article class="bill-trend-summary__item bill-trend-summary__item--${escapeHtml(item.tone)}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><small>${escapeHtml(hint)}</small></article>`;
        })
        .join("")}
    </div>
  `;
}

function trendEndpointLabels(rows, series, scale) {
  const labelGap = 15;
  const topLimit = scale.padding + 8;
  const bottomLimit = scale.height - scale.padding - 8;
  const rawLabels = series
    .map((item) => {
      const points = trendSeriesPoints(rows, item, scale);
      const point = points[points.length - 1];
      return point ? { item, point, value: trendValue(point.row, item) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, 6);
  const visible = rawLabels
    .sort((left, right) => left.point.y - right.point.y)
    .map((label, index, labels) => {
      const previousY = index ? labels[index - 1].labelY : topLimit - labelGap;
      const labelY = Math.min(bottomLimit, Math.max(label.point.y, previousY + labelGap));
      label.labelY = labelY;
      return label;
    });
  for (let index = visible.length - 2; index >= 0; index -= 1) {
    const nextY = visible[index + 1]?.labelY ?? bottomLimit;
    visible[index].labelY = Math.min(visible[index].labelY, nextY - labelGap);
  }
  visible.forEach((label) => {
    label.labelY = Math.min(bottomLimit, Math.max(topLimit, label.labelY));
  });
  return `
    <g class="bill-trend-end-labels">
      ${visible
        .map(({ item, point, labelY }) => {
          const x = Math.min(scale.width - 132, Math.max(scale.padding + 2, point.x + 7));
          const y = labelY || Math.min(scale.height - scale.padding - 6, Math.max(scale.padding + 8, point.y));
          return `
            <g class="${escapeHtml(item.className)}" data-bill-trend-series="${escapeHtml(trendSeriesId(item))}" transform="translate(${x} ${y})">
              <text>${escapeHtml(item.label)} ${escapeHtml(formatCurrency(point.value))}</text>
            </g>
          `;
        })
        .join("")}
    </g>
  `;
}

function trendInsights(rows, problems) {
  if (!rows.length) return "";
  const current = rows[rows.length - 1];
  const first = rows[0];
  const expenseChange = Number(current.expense || 0) - Number(first.expense || 0);
  const topCategory = Object.entries(current.categories || {}).sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))[0];
  const insights = [
    expenseChange > 0 ? `本期支出较起点增加 ${formatCurrency(expenseChange)}，需要关注后续节奏。` : `本期支出较起点减少 ${formatCurrency(Math.abs(expenseChange))}，控制效果较好。`,
    current.budget > 0 ? `当前预算使用 ${Math.round((Number(current.expense || 0) / Math.max(Number(current.budget || 0), 1)) * 100)}%，可作为后续消费上限参照。` : "当前缺少预算参照，建议先设置总预算线。",
    topCategory ? `当前最大流向是「${topCategory[0]}」，金额 ${formatCurrency(topCategory[1])}。` : "当前区间没有明显分类流向。",
    problems[0] ? `异常点：${problems[0].label}。` : "当前区间未触发明显异常点。",
  ].slice(0, 4);
  return `
    <div class="bill-trend-insights">
      ${insights.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
    </div>
  `;
}

function trendAxisLabel(row, scope) {
  if (scope === "day") return row.label;
  if (scope === "week") return row.detail;
  if (scope === "year") return row.label;
  return `${row.label}月`;
}

function trendDetailLine(type, text) {
  return `${type}|${text}`;
}

function trendDetailType(series) {
  if (series.category) {
    if (series.className?.includes("category-a")) return "category-a";
    if (series.className?.includes("category-b")) return "category-b";
    if (series.className?.includes("category-c")) return "category-c";
    return "category";
  }
  return series.key || "default";
}

function trendCursorDetail(row, mode, series) {
  return series.map((item) => trendDetailLine(trendDetailType(item), `${item.label} ${formatCurrency(trendValue(row, item))}`));
}

function trendCursorTargets(rows, series, scale, mode, scope) {
  const divisor = Math.max(rows.length - 1, 1);
  const plotWidth = scale.width - scale.padding * 2;
  const bandWidth = rows.length > 1 ? plotWidth / divisor : plotWidth;
  return `
    <line class="bill-trend-cursor-line" x1="${scale.padding}" y1="${scale.padding}" x2="${scale.padding}" y2="${scale.height - scale.padding}" hidden></line>
    <g class="bill-trend-cursor-targets">
      ${rows
        .map((row, index) => {
          const x = Math.round(scale.padding + (index * plotWidth) / divisor);
          const startX = Math.max(scale.padding, x - bandWidth / 2);
          const endX = Math.min(scale.width - scale.padding, x + bandWidth / 2);
          const title = `${trendAxisLabel(row, scope)} · ${row.detail || row.month || row.key}`;
          const lines = trendCursorDetail(row, mode, series).join("\n");
          return `
            <rect
              x="${Math.round(startX)}"
              y="${scale.padding}"
              width="${Math.max(8, Math.round(endX - startX))}"
              height="${scale.height - scale.padding * 2}"
              data-bill-trend-cursor
              data-bill-trend-cursor-x="${x}"
              data-bill-trend-tooltip="${escapeHtml(title)}"
              data-bill-trend-tooltip-lines="${escapeHtml(lines)}"
            ></rect>
          `;
        })
        .join("")}
    </g>
  `;
}

function trendAxisLabels(rows, scale, scope, activeTrendKey) {
  const divisor = Math.max(rows.length - 1, 1);
  const dayStep = rows.length <= 16 ? 1 : rows.length <= 24 ? 2 : 5;
  const axisY = scale.height - scale.padding;
  const tickEndY = axisY + 5;
  const labelY = Math.min(scale.height - 4, axisY + 16);
  return `
    <g class="bill-trend-axis-labels">
      ${rows
        .map((row, index) => {
          const x = Math.round(scale.padding + (index * (scale.width - scale.padding * 2)) / divisor);
          const activeClass = row.key === activeTrendKey ? "is-active" : "";
          const shouldShowLabel = scope !== "day" || index === 0 || index === rows.length - 1 || row.key === activeTrendKey || index % dayStep === 0;
          return `
            <g class="${activeClass}" transform="translate(${x} 0)">
              <line x1="0" y1="${axisY - 3}" x2="0" y2="${tickEndY}"></line>
              ${shouldShowLabel ? `<text x="0" y="${labelY}">${escapeHtml(trendAxisLabel(row, scope))}</text>` : ""}
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

function getTrendCategoryOptions(rows) {
  return Object.entries(
    rows.reduce((map, row) => {
      Object.entries(row.categories || {}).forEach(([category, amount]) => {
        map[category] = (map[category] || 0) + Number(amount || 0);
      });
      return map;
    }, {}),
  )
    .sort((left, right) => right[1] - left[1])
    .map(([category, amount]) => ({ category, amount }));
}

function buildTrendCategorySeries(rows, selectedCategories = []) {
  const options = getTrendCategoryOptions(rows);
  const available = new Set(options.map((item) => item.category));
  const selected = (Array.isArray(selectedCategories) ? selectedCategories : []).filter((category) => available.has(category)).slice(0, 3);
  const categories = selected.length ? selected : options.slice(0, 3).map((item) => item.category);
  return categories.map((category, index) => ({
    category,
    label: category,
    className: ["bill-trend-line--category-a", "bill-trend-line--category-b", "bill-trend-line--category-c"][index],
  }));
}

function trendCategorySelector(options, activeCategories) {
  if (!options.length) return "";
  const activeSet = new Set(activeCategories);
  return `
    <div class="bill-trend-category-picker" aria-label="分类曲线选择">
      ${options.slice(0, 10).map((item) => {
        const active = activeSet.has(item.category);
        return `<button class="${active ? "is-active" : ""}" data-bill-trend-category-toggle="${escapeHtml(item.category)}" type="button"><span>${escapeHtml(item.category)}</span><em>${formatCurrency(item.amount)}</em></button>`;
      }).join("")}
    </div>
  `;
}

function normalizeTrendRange(value, scope = "month") {
  const options = trendRangeOptions(scope);
  if (!options.length) return 0;
  const range = Number(value || options[1] || options[0]);
  return options.includes(range) ? range : options[1] || options[0];
}

function normalizeTrendZoom(start = 0, end = 100) {
  const normalizedStart = Math.min(Math.max(Number(start) || 0, 0), 96);
  const normalizedEnd = Math.min(Math.max(Number(end) || 100, normalizedStart + 4), 100);
  return { start: normalizedStart, end: normalizedEnd };
}

function sliceTrendRows(rows, start = 0, end = 100) {
  if (rows.length <= 2) return rows;
  const zoom = normalizeTrendZoom(start, end);
  const startIndex = Math.floor((zoom.start / 100) * rows.length);
  const endIndex = Math.ceil((zoom.end / 100) * rows.length);
  return rows.slice(startIndex, Math.max(startIndex + 2, endIndex));
}

function billTrendPanel(data, activeMonth, mode = "cashflow", range = 6, scope = "month", zoomStart = 0, zoomEnd = 100, hiddenSeries = [], selectedCategories = []) {
  const normalizedMode = ["cashflow", "budget", "fixed", "raw", "category"].includes(mode) ? mode : "cashflow";
  const normalizedScope = normalizeTrendScope(scope);
  const normalizedRange = normalizeTrendRange(range, normalizedScope);
  const allRows = getBillTrendRows(data, activeMonth, normalizedScope, normalizedRange);
  const zoom = normalizeTrendZoom(zoomStart, zoomEnd);
  const rows = sliceTrendRows(allRows, zoom.start, zoom.end);
  const categoryOptions = getTrendCategoryOptions(allRows);
  const selectedCategoryNames = (Array.isArray(selectedCategories) ? selectedCategories : []).filter((category) => categoryOptions.some((item) => item.category === category)).slice(0, 3);
  const categorySeries = buildTrendCategorySeries(allRows, selectedCategoryNames);
  const activeCategoryNames = categorySeries.map((item) => item.category);
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
  const allSeries = [
    ...seriesByMode.cashflow,
    ...seriesByMode.budget,
    ...seriesByMode.fixed,
    ...seriesByMode.raw,
    ...seriesByMode.category,
  ].filter((item, index, source) => {
    const id = trendSeriesId(item);
    return source.findIndex((row) => trendSeriesId(row) === id) === index;
  });
  const coreTrendSeriesIds = new Set(["income", "expense", "balance"]);
  const defaultHiddenSeries = allSeries.map((item) => trendSeriesId(item)).filter((id) => !coreTrendSeriesIds.has(id));
  const hiddenSet = new Set(Array.isArray(hiddenSeries) && hiddenSeries.length ? hiddenSeries : defaultHiddenSeries);
  const visibleSeries = allSeries.filter((item) => !hiddenSet.has(trendSeriesId(item)));
  const series = visibleSeries.length ? visibleSeries : allSeries;
  const values = rows.flatMap((row) => series.map((item) => trendValue(row, item)));
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(1, ...values);
  const scale = { min: minValue, max: maxValue, width: 920, height: 210, padding: 20 };
  const scopeLabel = { day: `${activeMonth} · 按日`, week: `${activeMonth} · 按周`, month: `近 ${normalizedRange} 月`, year: `近 ${normalizedRange} 年` }[normalizedScope];
  const rangeOptions = trendRangeOptions(normalizedScope);
  const activeTrendKey = getActiveTrendKey(activeMonth, normalizedScope);
  const problems = getTrendProblems(rows, "all");
  const canPanTrend = zoom.end - zoom.start < 99;
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
          ${
            rangeOptions.length
              ? `<div class="bill-trend-tabs bill-trend-tabs--range">
                  ${rangeOptions.map((item) => `<button class="${normalizedRange === item ? "is-active" : ""}" data-bill-trend-range="${item}" type="button">${item}${normalizedScope === "year" ? "年" : "月"}</button>`).join("")}
                </div>`
              : ""
          }
        </div>
      </div>
      ${trendSummaryStrip(rows)}
      <div class="bill-trend-chart ${canPanTrend ? "is-pan-ready" : ""}">
        <svg viewBox="0 0 ${scale.width} ${scale.height}" role="img" aria-label="收支趋势折线图">
          <g class="bill-trend-grid">
            <line x1="${scale.padding}" y1="${scale.padding}" x2="${scale.padding}" y2="${scale.height - scale.padding}"></line>
            <line x1="${scale.padding}" y1="${scale.height - scale.padding}" x2="${scale.width - scale.padding}" y2="${scale.height - scale.padding}"></line>
            <line x1="${scale.padding}" y1="${Math.round(scale.height / 2)}" x2="${scale.width - scale.padding}" y2="${Math.round(scale.height / 2)}"></line>
          </g>
          ${trendBudgetBand(rows, scale)}
          <g class="bill-trend-zoom-layer">
            ${series.map((item) => trendCurvePath(rows, item, scale)).join("")}
            <g class="bill-trend-point-layer">
              ${series.map((item) => trendPointMarkers(rows, item, scale)).join("")}
              ${trendProblemMarkers(problems, rows, scale)}
            </g>
            ${trendAxisLabels(rows, scale, normalizedScope, activeTrendKey)}
            ${trendEndpointLabels(rows, series, scale)}
          </g>
          <rect class="bill-trend-selection" x="0" y="${scale.padding}" width="0" height="${scale.height - scale.padding * 2}" hidden></rect>
          ${trendCursorTargets(rows, series, scale, normalizedMode, normalizedScope)}
        </svg>
        <div class="bill-trend-datazoom" aria-label="趋势范围缩放">
          <span>${escapeHtml(trendAxisLabel(rows[0] || allRows[0] || {}, normalizedScope))}</span>
          <div class="bill-trend-datazoom__range">
            <input type="range" min="0" max="96" value="${zoom.start}" data-bill-trend-zoom-start aria-label="范围起点" />
            <input type="range" min="4" max="100" value="${zoom.end}" data-bill-trend-zoom-end aria-label="范围终点" />
          </div>
          <span>${escapeHtml(trendAxisLabel(rows[rows.length - 1] || allRows[allRows.length - 1] || {}, normalizedScope))}</span>
        </div>
        ${trendProblemSummary(problems)}
      </div>
      ${trendInsights(rows, problems)}
      ${trendCategorySelector(categoryOptions, activeCategoryNames)}
      <div class="bill-trend-legend">
        ${allSeries
          .map((item) => {
            const seriesId = trendSeriesId(item);
            const isHidden = hiddenSet.has(seriesId) && allSeries.length > 1;
            return `<button class="${escapeHtml(item.className)} ${isHidden ? "is-muted" : ""}" data-bill-trend-series-toggle="${escapeHtml(seriesId)}" type="button"><i></i>${escapeHtml(item.label)}</button>`;
          })
          .join("")}
      </div>
    </section>
  `;
}

function billBudgetPanel(summary, commitments, data) {
  const dynamicPlan = getDynamicBudgetPlan(summary, commitments);
  const suggestedRows = buildCategoryBudgetSuggestions(data, summary, dynamicPlan);
  const pacePlan = getBudgetPacePlan(summary);
  const totalUsed = summary.totalBudget > 0 ? Math.round((summary.expense / summary.totalBudget) * 100) : 0;
  const categoryRows = (summary.categoryBudgets || []).slice(0, 5).map((budget) => {
    const used = summary.categoryTotals.find((item) => item.category === budget.category)?.amount || 0;
    const percent = Number(budget.amount || 0) > 0 ? Math.round((used / Number(budget.amount || 0)) * 100) : 0;
    const remaining = Math.max(Number(budget.amount || 0) - used, 0);
    const level = percent >= 100 ? "risk" : percent >= 80 ? "watch" : "good";
    return { category: budget.category, used, budget: Number(budget.amount || 0), percent, remaining, level };
  }).sort((left, right) => {
    const weight = { risk: 0, watch: 1, good: 2 };
    return weight[left.level] - weight[right.level] || right.percent - left.percent;
  });
  const suggestionText = suggestedRows.map((row) => `${row.category} ${Math.round(row.target)}`).join("\n");
  return `
    <section class="panel bill-decision-panel">
      <div class="panel-head">
        <h2>预算目标</h2>
        <span class="results-count">${summary.totalBudget ? `${totalUsed}% 已用 · ${escapeHtml(pacePlan.label)}` : "未设置总预算"}</span>
      </div>
      <div class="bill-budget-total">
        <span>本月总预算</span>
        <strong>${formatCurrency(summary.expense)} / ${formatCurrency(summary.totalBudget)}</strong>
        <i><b style="width:${Math.min(totalUsed, 100)}%"></b></i>
      </div>
      <form class="bill-budget-form" id="budgetForm">
        <label>
          月份
          <input name="month" type="month" value="${escapeHtml(summary.month)}" />
        </label>
        <label>
          本月总预算
          <input name="totalBudget" type="number" min="0" step="0.01" value="${escapeHtml(String(summary.totalBudget || ""))}" placeholder="例如 3000" />
        </label>
        <label class="bill-budget-form__categories">
          分类预算
          <textarea name="categoryBudgets" rows="2" placeholder="餐饮 1200&#10;交通 300">${escapeHtml((summary.categoryBudgets || []).map((item) => `${item.category} ${item.amount}`).join("\n"))}</textarea>
        </label>
        <button class="primary-button" type="submit">保存预算</button>
      </form>
      <div class="bill-dynamic-budget bill-dynamic-budget--${escapeHtml(dynamicPlan.level)}">
        <article>
          <span>动态可支配</span>
          <strong>${formatCurrency(dynamicPlan.freeRemaining)}</strong>
          <small>日均 ${formatCurrency(dynamicPlan.dailyFree)}</small>
        </article>
        <div>
          <span>计算口径</span>
          <p>收入 ${formatCurrency(summary.income)} - 固定 ${formatCurrency(dynamicPlan.fixedReserve)} - 未来预留 ${formatCurrency(dynamicPlan.plannedReserve)} - 可变已花 ${formatCurrency(dynamicPlan.variableSpent)}</p>
        </div>
        <article>
          <span>自由额度</span>
          <strong>${formatCurrency(dynamicPlan.freeLimit)}</strong>
          <small>剩余 ${dynamicPlan.daysLeft} 天</small>
        </article>
      </div>
      <div class="bill-budget-pacing">
        <article class="bill-budget-pacing--${escapeHtml(pacePlan.level)}"><span>预算节奏</span><strong>${escapeHtml(pacePlan.label)}</strong><small>时间 ${pacePlan.elapsedRate}% / 使用 ${pacePlan.usedRate}%</small></article>
        <article><span>偏差金额</span><strong>${pacePlan.paceAmount >= 0 ? "+" : ""}${formatCurrency(pacePlan.paceAmount)}</strong><small>相对时间预算</small></article>
        <article><span>日均额度</span><strong>${formatCurrency(pacePlan.dailyBudget)}</strong><small>剩余 ${pacePlan.daysLeft} 天</small></article>
      </div>
      <div class="bill-budget-pace-detail bill-budget-pace-detail--${escapeHtml(pacePlan.level)}">
        <span>节奏依据</span>
        <p>${escapeHtml(pacePlan.action)}</p>
        <em>当前已花 ${formatCurrency(summary.expense)}，按时间进度应花约 ${formatCurrency(pacePlan.expectedSpend)}，剩余预算 ${formatCurrency(pacePlan.remainingBudget)}。</em>
      </div>
      <div class="bill-budget-list">
        ${categoryRows.map((row) => `<article class="bill-budget-row bill-budget-row--${escapeHtml(row.level)}"><span>${escapeHtml(row.category)}</span><i><b style="width:${Math.min(row.percent, 100)}%"></b></i><strong>${formatCurrency(row.used)} / ${formatCurrency(row.budget)}</strong><em>余 ${formatCurrency(row.remaining)} · ${row.percent}%</em></article>`).join("") || emptyState("可在设置预算后查看分类目标")}
      </div>
      <div class="bill-budget-suggestions">
        <div class="bill-budget-subhead">
          <div>
            <strong>分类预算建议</strong>
            <span>${suggestedRows.length ? "自动参考上月与本月节奏" : "暂无可建议分类"}</span>
          </div>
          ${suggestedRows.length ? `<button class="ghost-button" data-apply-budget-suggestions="${escapeHtml(suggestionText)}" type="button">应用建议</button>` : ""}
        </div>
        ${suggestedRows.map((row) => `
          <article class="bill-budget-suggestion bill-budget-suggestion--${escapeHtml(row.level)}">
            <div class="bill-budget-suggestion__head">
              <div>
                <span>${escapeHtml(row.category)}</span>
                <strong>${formatCurrency(row.target)}</strong>
              </div>
              <em>${row.remaining < 0 ? `超 ${formatCurrency(Math.abs(row.remaining))}` : `余 ${formatCurrency(row.remaining)}`}</em>
            </div>
            <div class="bill-budget-suggestion__progress">
              <i><b style="width:${Math.min(row.percent, 100)}%"></b></i>
              <small>${Math.max(row.percent, 0)}% 已用 · 当前 ${formatCurrency(row.used)}</small>
            </div>
            <div class="bill-budget-suggestion__meta">
              <section>
                <span>控制动作</span>
                <p>${escapeHtml(row.action)}</p>
              </section>
              <section>
                <span>建议依据</span>
                <p>${escapeHtml(row.source)} · 参考 ${formatCurrency(row.previous || row.target)}</p>
              </section>
            </div>
          </article>
        `).join("") || emptyState("本月暂无支出分类，导入后生成建议")}
      </div>
    </section>
  `;
}

function billFuturePlanPanel(summary, commitments) {
  const futureExpense = commitments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const reserve = Math.max(summary.balance, 0);
  const today = new Date();
  const fundingGap = Math.max(futureExpense - reserve, 0);
  const monthlyReserve = futureExpense > 0 ? (fundingGap > 0 ? fundingGap / 3 : futureExpense / 3) : 0;
  const controlRows = commitments
    .map((item) => {
      const amount = Number(item.amount || 0);
      const dueDate = String(item.date || "").slice(0, 10);
      const dueTime = dueDate ? new Date(`${dueDate}T00:00:00`) : null;
      const dueDays = dueTime ? Math.ceil((dueTime - today) / 86400000) : 999;
      const gap = Math.max(amount - reserve, 0);
      const pressure = reserve > 0 ? amount / reserve : amount > 0 ? 99 : 0;
      const monthlySave = dueDays > 0 && dueDays < 999 ? amount / Math.max(Math.ceil(dueDays / 30), 1) : amount / 3;
      const reasons = [];
      if (gap > 0) reasons.push(`资金缺口 ${formatCurrency(gap)}`);
      if (item.priority === "高") reasons.push("高优先级");
      if (item.priority === "中") reasons.push("中优先级");
      if (dueDays <= 30) reasons.push("30 天内");
      else if (dueDays <= 60) reasons.push("60 天内");
      if (pressure >= 0.35 && reserve > 0) reasons.push(`占结余 ${Math.round(pressure * 100)}%`);
      const isRisk = gap > 0 || item.priority === "高" || (dueDays <= 30 && pressure >= 0.35);
      const isWatch = !isRisk && (dueDays <= 60 || pressure >= 0.2 || item.priority === "中");
      const level = isRisk ? "risk" : isWatch ? "watch" : "good";
      const action = gap > 0
        ? `缺口 ${formatCurrency(gap)}，建议拆分准备或推迟。`
        : dueDays <= 30
          ? "临近发生，建议锁定资金来源。"
          : "可控，按计划跟踪即可。";
      return { ...item, amount, dueDate, dueDays, gap, monthlySave, level, action, reasons: reasons.length ? reasons : ["未触发风险规则"] };
    })
    .sort((left, right) => {
      const levelWeight = { risk: 0, watch: 1, good: 2 };
      return levelWeight[left.level] - levelWeight[right.level] || left.dueDays - right.dueDays || right.amount - left.amount;
    })
    .slice(0, 5);
  const riskCount = controlRows.filter((item) => item.level === "risk").length;
  const nearestPlan = controlRows.find((item) => item.dueDays < 999);
  return `
    <section class="panel bill-decision-panel">
      <div class="panel-head">
        <h2>未来计划</h2>
        <span class="results-count">${riskCount ? `${riskCount} 项高风险` : "风险可控"} · 未来 3 个月 ${formatCurrency(futureExpense)}</span>
      </div>
      <div class="bill-future-control-summary">
        <article><span>可用结余</span><strong>${formatCurrency(reserve)}</strong></article>
        <article><span>计划压力</span><strong>${formatCurrency(futureExpense)}</strong></article>
        <article><span>资金缺口</span><strong>${formatCurrency(fundingGap)}</strong></article>
        <article><span>月储备建议</span><strong>${formatCurrency(monthlyReserve)}</strong></article>
        <article><span>最近计划</span><strong>${nearestPlan ? `${Math.max(nearestPlan.dueDays, 0)} 天` : "未排期"}</strong></article>
        <article><span>控制目标</span><strong>${futureExpense > reserve ? "先补缺口" : "按期准备"}</strong></article>
      </div>
      <div class="bill-future-funding">
        <span>资金安排</span>
        <strong>${fundingGap > 0 ? `未来 3 个月建议每月预留 ${formatCurrency(monthlyReserve)}，优先覆盖高风险计划。` : "当前结余可覆盖已知计划，继续按期准备即可。"}</strong>
      </div>
      <div class="bill-future-list">
        ${controlRows.map((item) => `
          <article class="bill-future-item bill-future-item--${escapeHtml(item.level)}">
            <div class="bill-future-card__head">
              <div>
                <strong>${escapeHtml(item.title || "未命名计划")}</strong>
                <span>${escapeHtml(item.dueDate || "未设置日期")} · ${escapeHtml(item.planType || "计划")}</span>
              </div>
              <b>${item.level === "risk" ? "高风险" : item.level === "watch" ? "关注" : "可控"}</b>
            </div>
            <div class="bill-future-card__body">
              <em>${formatCurrency(item.amount)}</em>
              <p>${escapeHtml(item.action)}<small>月储备 ${formatCurrency(item.monthlySave)}</small></p>
            </div>
            <div class="bill-future-reasons">
              ${item.reasons.map((reason) => `<small>${escapeHtml(reason)}</small>`).join("")}
              <small>${item.dueDays < 999 ? `${Math.max(item.dueDays, 0)} 天内` : "未排期"}</small>
            </div>
            <div class="bill-future-card__actions">
              ${item.source === "plan" ? `<button class="ghost-button" data-future-plan-status="${escapeHtml(item.id)}" data-next-status="${item.status === "已准备" ? "计划中" : "已准备"}" type="button">${item.status === "已准备" ? "转计划" : "已准备"}</button><button class="ghost-button danger-button" data-delete-future-plan="${escapeHtml(item.id)}" type="button">删除</button>` : `<span class="tag">订阅</span>`}
            </div>
          </article>
        `).join("") || emptyState("暂无未来计划，建议录入保险、学费、旅行、大件消费等")}
      </div>
    </section>
  `;
}

function buildMonthlyReviewInsights(summary, risks) {
  const topCategory = summary.categoryTotals[0];
  const riskCount = risks.filter((item) => item.level === "risk").length;
  const watchCount = risks.filter((item) => item.level === "watch").length;
  const budgetUsed = summary.totalBudget > 0 ? summary.expense / summary.totalBudget : 0;
  let score = 100;
  if (summary.income <= 0) score -= 25;
  if (summary.balance < 0) score -= 25;
  if (summary.expenseRate >= 0.9) score -= 18;
  if (summary.fixedRate >= 0.4) score -= 10;
  if (budgetUsed >= 1) score -= 16;
  else if (budgetUsed >= 0.8) score -= 8;
  score -= riskCount * 8 + watchCount * 4;
  score = Math.min(100, Math.max(0, Math.round(score)));
  const grade = score >= 85 ? "健康" : score >= 70 ? "可控" : score >= 55 ? "关注" : "风险";
  const reviewText = summary.balance < 0 ? "现金流为负，优先处理风险提醒。" : summary.income <= 0 ? "缺少收入数据，先补录工资。" : budgetUsed >= 1 ? "预算已经超出，优先压降非必要支出。" : "现金流为正，继续观察预算和未来计划。";
  const problemItems = [
    topCategory ? `最大支出集中在「${topCategory.category}」，本月 ${formatCurrency(topCategory.amount)}。` : "暂无支出结构，先补齐分类。",
    summary.totalBudget > 0 ? `预算使用 ${Math.round(budgetUsed * 100)}%，剩余 ${formatCurrency(Math.max(summary.totalBudget - summary.expense, 0))}。` : "未设置总预算，无法判断支出上限。",
    risks.find((item) => item.level !== "good")?.text || "未触发明显风险规则。",
  ];
  const actionItems = [
    summary.income <= 0 ? "补录工资/固定收入，避免风险判断失真。" : "下月开始先预留固定支出和储备金。",
    topCategory ? `给「${topCategory.category}」设置控制线，避免继续成为最大流向。` : "完成分类后再制定分类预算。",
    budgetUsed >= 0.8 ? "本月剩余时间暂停新增非必要消费。" : "保持日均预算节奏，月底再复盘偏差。",
  ];
  return { score, grade, reviewText, topCategory, riskCount, problemItems, actionItems };
}

function billMonthlyReviewPanel(data, summary, risks, commitments) {
  const review = buildMonthlyReviewInsights(summary, risks);
  const actions = buildMonthlyActionItems(data, summary, risks, commitments);
  const statusMap = ((data.budgets || {}).billActionStatuses || {})[summary.month] || {};
  const doneCount = actions.filter((item) => statusMap[item.id] === "已完成").length;
  const doingCount = actions.filter((item) => statusMap[item.id] === "进行中").length;
  const todoCount = Math.max(actions.length - doneCount - doingCount, 0);
  const doneRate = actions.length ? Math.round((doneCount / actions.length) * 100) : 0;
  return `
    <section class="panel bill-decision-panel">
      <div class="panel-head">
        <h2>月度报告</h2>
        <span class="results-count">${escapeHtml(summary.month)} · ${escapeHtml(review.grade)}</span>
      </div>
      <div class="bill-review-summary">
        <article class="bill-review-score bill-review-score--${review.score >= 85 ? "good" : review.score >= 70 ? "stable" : review.score >= 55 ? "watch" : "risk"}">
          <span>健康分</span>
          <strong>${review.score}</strong>
          <small>${escapeHtml(review.grade)}</small>
        </article>
        <article>
          <span>复盘判断</span>
          <strong>${escapeHtml(review.reviewText)}</strong>
        </article>
        <article>
          <span>最大支出</span>
          <strong>${review.topCategory ? `${escapeHtml(review.topCategory.category)} ${formatCurrency(review.topCategory.amount)}` : "暂无支出"}</strong>
        </article>
        <article>
          <span>待处理风险</span>
          <strong>${review.riskCount} 项</strong>
        </article>
      </div>
      <div class="bill-review-progress">
        <div>
          <span>行动执行</span>
          <strong>${doneCount}/${actions.length} 已完成</strong>
          <small>${doingCount} 进行中 · ${todoCount} 待处理</small>
        </div>
        <div class="bill-review-progress__bar" aria-label="行动完成进度 ${doneRate}%">
          <i style="width: ${doneRate}%"></i>
        </div>
      </div>
      <div class="bill-review-columns">
        <div>
          <h3>问题来源</h3>
          ${review.problemItems.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
        </div>
        <div>
          <h3>下月动作</h3>
          ${review.actionItems.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
        </div>
      </div>
      <button class="ghost-button" data-create-bill-review="${escapeHtml(summary.month)}" type="button">保存为月报</button>
    </section>
  `;
}

function billMonthlyReportHistoryPanel(data) {
  const reports = (data.notes || [])
    .filter((item) => item.noteType === "summary" && (item.billReportMonth || (item.tags || []).includes("月度复盘") || /生活收支(月报|复盘)/.test(item.title || "")))
    .sort((left, right) => String(right.billReportMonth || right.title || right.updatedAt || "").localeCompare(String(left.billReportMonth || left.title || left.updatedAt || "")))
    .slice(0, 6);
  const reportMonths = new Set(reports.map((item) => item.billReportMonth || String(item.title || "").match(/\d{4}-\d{2}/)?.[0]).filter(Boolean));
  const billMonths = [...new Set((data.bills || [])
    .filter((item) => !item.excludeFromAnalysis && !item.analysisExcluded)
    .map((item) => String(item.date || "").slice(0, 7))
    .filter((month) => /^\d{4}-\d{2}$/.test(month)))]
    .sort((left, right) => right.localeCompare(left))
    .slice(0, 6);
  const missingReportMonths = billMonths.filter((month) => !reportMonths.has(month)).slice(0, 3);
  const trendRows = reports
    .map((item) => ({
      month: item.billReportMonth || String(item.title || "").match(/\d{4}-\d{2}/)?.[0] || "",
      summary: item.billReportSummary || {},
    }))
    .filter((item) => item.month && Number.isFinite(Number(item.summary.balance)))
    .slice()
    .reverse();
  const maxBalance = Math.max(...trendRows.map((item) => Math.abs(Number(item.summary.balance || 0))), 1);
  const maxRisk = Math.max(...trendRows.map((item) => Number(item.summary.riskCount || 0)), 1);
  const reportTrend = trendRows.length >= 2
    ? `
      <div class="bill-report-trend" style="--report-count:${trendRows.length}">
        <div class="bill-report-trend__row">
          <span>健康分</span>
          ${trendRows.map((item) => `<i class="is-health" style="height:${Math.max(8, Math.round((Number(item.summary.healthScore || 0) / 100) * 36))}px" title="${escapeHtml(item.month)} 健康 ${escapeHtml(String(item.summary.healthScore ?? "-"))}"></i>`).join("")}
        </div>
        <div class="bill-report-trend__row">
          <span>结余</span>
          ${trendRows.map((item) => `<i class="${Number(item.summary.balance || 0) < 0 ? "is-risk" : "is-balance"}" style="height:${Math.max(8, Math.round((Math.abs(Number(item.summary.balance || 0)) / maxBalance) * 36))}px" title="${escapeHtml(item.month)} 结余 ${formatCurrency(item.summary.balance || 0)}"></i>`).join("")}
        </div>
        <div class="bill-report-trend__row">
          <span>风险</span>
          ${trendRows.map((item) => `<i class="is-risk" style="height:${Math.max(6, Math.round((Number(item.summary.riskCount || 0) / maxRisk) * 32))}px" title="${escapeHtml(item.month)} 风险 ${escapeHtml(String(item.summary.riskCount || 0))}"></i>`).join("")}
        </div>
        <div class="bill-report-trend__months">${trendRows.map((item) => `<b>${escapeHtml(item.month.slice(5) || item.month)}</b>`).join("")}</div>
      </div>
    `
    : "";
  return `
    <section class="panel bill-report-history-panel">
      <div class="panel-head">
        <div>
          <span class="eyebrow">REPORTS</span>
          <h2>历史月报</h2>
        </div>
        <span class="results-count">${reports.length} 份</span>
      </div>
      ${reportTrend}
      ${
        missingReportMonths.length
          ? `<div class="bill-report-missing">
              <span>待生成月报</span>
              ${missingReportMonths.map((month) => `<button class="ghost-button" data-create-bill-review="${escapeHtml(month)}" type="button">${escapeHtml(month)}</button>`).join("")}
            </div>`
          : ""
      }
      <div class="bill-report-history-list">
        ${
          reports.length
            ? reports.map((item) => {
              const month = item.billReportMonth || String(item.title || "").match(/\d{4}-\d{2}/)?.[0] || "未记录";
              const report = item.billReportSummary || {};
              const hasSummary = Number.isFinite(Number(report.income)) || Number.isFinite(Number(report.expense));
              const forecastCheck = buildForecastActualComparison(data, item);
              return `
                <article class="bill-report-history-item" data-bill-report-open="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="打开${escapeHtml(month)}月报">
                  <div>
                    <strong>${escapeHtml(month)} 月报</strong>
                    <span>${escapeHtml(item.description || "暂无月报结论")}</span>
                    ${
                      hasSummary
                        ? `<div class="bill-report-history-metrics">
                            <b class="${Number(report.balance || 0) < 0 ? "is-risk" : "is-good"}">结余 ${formatCurrency(report.balance || 0)}</b>
                            <b>健康 ${escapeHtml(String(report.healthScore ?? "-"))}</b>
                            <b>风险 ${escapeHtml(String(report.riskCount ?? 0))}</b>
                            <b>行动 ${escapeHtml(String(report.actionDone ?? 0))}/${escapeHtml(String(report.actionTotal ?? 0))}</b>
                            <b class="${Number(report.qualityScore ?? 100) >= 86 ? "is-good" : Number(report.qualityScore ?? 100) >= 70 ? "is-watch" : "is-risk"}">质量 ${escapeHtml(report.qualityScore != null ? `${report.qualityScore}分` : report.qualityStatus || "旧版")}</b>
                            ${forecastCheck ? `<b class="is-${escapeHtml(forecastCheck.level)}">预测 ${escapeHtml(forecastCheck.causeLabel || forecastCheck.label)}</b>` : ""}
                          </div>`
                        : ""
                    }
                  </div>
                  <div class="bill-report-history-actions">
                    <small>${escapeHtml(item.updatedAt || item.createdAt || "")}</small>
                    <button class="ghost-button" data-bill-report-compare="${escapeHtml(month)}" type="button">对比</button>
                  </div>
                </article>
              `;
            }).join("")
            : emptyState("保存月报后会显示在这里")
        }
      </div>
    </section>
  `;
}

function billLedgerRow(bill, activeMonth, activeCategory = "") {
  const isIncome = isIncomeBill(bill);
  const isPendingType = bill.type === "待确认";
  const needsCategoryReview = !isPendingType && bill.classification?.needsReview;
  const monthKey = String(bill.date || "").slice(0, 7);
  const category = bill.category || "未分类";
  const isVisible = monthKey === activeMonth && (!activeCategory || category === activeCategory);
  const excluded = Boolean(bill.excludeFromAnalysis || bill.analysisExcluded);
  return `
    <article class="bill-ledger-card" data-bill-ledger-row data-bill-month-key="${escapeHtml(monthKey)}" data-bill-category-key="${escapeHtml(category)}" ${isVisible ? "" : "hidden"}>
      <div class="bill-ledger-card__top">
        <time>${escapeHtml(bill.date || "未设置")}</time>
        <div class="bill-ledger-title">
          <strong>${escapeHtml(bill.title || "未命名流水")}</strong>
          <span>${escapeHtml(bill.note || bill.goods || bill.remark || "")}</span>
          ${isPendingType ? '<em>待确认类型</em>' : needsCategoryReview ? '<em>待分类</em>' : excluded ? '<em>不计入分析</em>' : ""}
        </div>
        <strong class="money ${isPendingType ? "pending" : isIncome ? "income" : "expense"}">${isPendingType ? "" : isIncome ? "+" : "-"}${formatCurrency(bill.amount)}</strong>
      </div>
      <div class="bill-ledger-card__bottom">
        <div class="bill-ledger-category-editor">
          <input data-bill-category-input="${escapeHtml(bill.id)}" value="${escapeHtml(bill.category || "未分类")}" list="billCategoryOptions" aria-label="分类" />
          <button class="ghost-button" data-bill-category-save="${escapeHtml(bill.id)}" type="button">保存</button>
        </div>
        <div class="bill-ledger-meta">
          <span>${escapeHtml(bill.payer || bill.familyMember || "未指定")}</span>
          <span>${escapeHtml(bill.source || "手动")}</span>
        </div>
        <div class="bill-ledger-actions">
          <button class="ghost-button" data-bill-analysis-exclude="${escapeHtml(bill.id)}" data-next-excluded="${excluded ? "false" : "true"}" type="button">${excluded ? "计入" : "不计入"}</button>
          <button class="ghost-button" data-edit="bills:${escapeHtml(bill.id)}" type="button">编辑</button>
        </div>
      </div>
    </article>
  `;
}

function billLedgerModal(allBills, activeMonth, data = {}, activeCategory = "") {
  const months = getBillHistoryRows(allBills || []).map((row) => row.month);
  const normalizedMonths = months.includes(activeMonth) ? months : [activeMonth, ...months].filter(Boolean);
  const rows = [...(allBills || [])].sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  const monthRows = rows.filter((bill) => String(bill.date || "").startsWith(activeMonth));
  const monthCount = monthRows.filter((bill) => !activeCategory || (bill.category || "未分类") === activeCategory).length;
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
          <div class="bill-ledger-active-filter" ${activeCategory ? "" : "hidden"}>
            <span>分类：${escapeHtml(activeCategory)}</span>
            <button class="ghost-button" data-clear-bill-category-filter type="button">查看全部</button>
          </div>
          <span class="results-count" data-bill-ledger-count>${escapeHtml(activeMonth)}${activeCategory ? ` · ${escapeHtml(activeCategory)}` : ""} · ${monthCount} 条</span>
        </div>
        <div class="bill-ledger-table-wrap">
          <datalist id="billCategoryOptions">
            ${categoryOptions.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}
          </datalist>
          <div class="bill-ledger-card-grid">
            ${rows.map((bill) => billLedgerRow(bill, activeMonth, activeCategory)).join("") || emptyState("暂无流水")}
          </div>
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
  const trendZoomStart = ui.filters.billTrendZoomStart ?? 0;
  const trendZoomEnd = ui.filters.billTrendZoomEnd ?? 100;
  const hiddenTrendSeries = ui.filters.billTrendHiddenSeries;
  const trendCategories = ui.filters.billTrendCategories || [];
  const summary = getMonthlyFinanceSummary(data, month);
  const commitments = getFutureCommitments(data, month);
  const risks = buildFinanceRisks(summary, commitments);

  elements.contentArea.innerHTML = `
    <div class="bill-dashboard-layout">
      <main class="bill-dashboard-layout__main">
        ${billTimelinePanel(data.bills || [], month, timelineScope)}
        ${billTrendPanel(data, month, trendMode, trendRange, trendScope, trendZoomStart, trendZoomEnd, hiddenTrendSeries, trendCategories)}
        ${billDecisionStrip(summary, commitments)}
        ${billMonthlyActionPanel(data, summary, risks, commitments)}
        ${billForecastPanel(data, month)}
        <div class="bill-decision-grid">
          ${billAnalysisPanel(summary, data)}
          ${billRiskPanel(risks, summary, data)}
        </div>
        ${billCategoryFlowPanel(summary)}
        <div class="bill-decision-grid">
          ${billBudgetPanel(summary, commitments, data)}
          ${billFuturePlanPanel(summary, commitments)}
        </div>
        ${billMonthlyReviewPanel(data, summary, risks, commitments)}
        ${billMonthlyReportHistoryPanel(data)}
      </main>
      <aside class="bill-dashboard-layout__side">
        ${financeEntryPanel(month)}
        ${futurePlanEntryPanel(month)}
      </aside>
    </div>
    ${billLedgerModal(data.bills || [], month, data, ui.filters.billLedgerCategory || "")}
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
      <p class="panel-copy">用于整站财务数据迁移。默认采用手动确认模式，以文件内填写的收入 / 支出为准，不套用系统预设关键词规则；CSV 会自动处理常见中文编码，并在写入前提示重复账单。</p>
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
        <span>按文件类型列导入收入 / 支出，不使用历史规则或预设关键词；文件未写类型的流水才标记为待确认。</span>
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
