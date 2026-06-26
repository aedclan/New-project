import { escapeHtml, excerptText, formatCurrency, isWithinLastDays, renderMarkdown } from "../core/utils.js";
import {
  getSubscriptionReminderSummary,
  groupSubscriptionReminders,
  loadSubscriptionNotificationSettings,
} from "../core/subscription-notifications.js";
import { loadServerSyncState } from "../core/server-sync.js";
import { getPinyinSearchText } from "../core/utils.js";
import { navItems } from "../data/nav-items.js";
import {
  billRow,
  budgetProgressCard,
  categoryBars,
  contentCard,
  emptyState,
  noteRow,
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
  notes: { label: "笔记", eyebrow: "Notes" },
  collections: { label: "项目集", eyebrow: "Collections" },
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
  notes: [
    { value: "updated-desc", label: "最近更新" },
    { value: "title-asc", label: "按标题" },
    { value: "pinned-desc", label: "置顶优先" },
  ],
  collections: [
    { value: "updated-desc", label: "最近更新" },
    { value: "progress-desc", label: "进度优先" },
    { value: "title-asc", label: "按标题" },
  ],
  favorites: [
    { value: "updated-desc", label: "最近更新" },
    { value: "title-asc", label: "按标题" },
  ],
  analytics: [
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

  if (page === "notes") {
    return [
      { value: "all", label: "全部" },
      { value: "note-type:note", label: "笔记" },
      { value: "note-type:idea", label: "灵感" },
      { value: "note-type:link", label: "链接" },
      { value: "pinned", label: "置顶" },
      ...uniqueValues(data.notes, (item) => item.category).slice(0, 2).map((category) => ({ value: `category:${category}`, label: category })),
    ];
  }

  if (page === "collections") {
    return [
      { value: "all", label: "全部" },
      ...uniqueValues(data.collections, (item) => item.status).map((status) => ({ value: `status:${status}`, label: status })),
    ];
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

  if (page === "collections") {
    return uniqueValues(data.collections, (item) => item.status).map((status) => ({
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

  if (page === "notes") {
    return [{ value: "pinned", label: "置顶" }];
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
    page === "search" || page === "analytics"
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
  const quickFilters = getQuickFilters(page, data);
  const compactControls = page === "subscriptions";
  const statusOptions = compactControls ? [] : getStatusOptions(page, data);
  const tagOptions = compactControls ? [] : getTagOptions(page, data, ui);
  const showTypeFilter = page === "search" || page === "analytics";
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
  const done = data.tasks.filter((task) => task.status === "已完成").length;
  const progress = Math.round((done / Math.max(data.tasks.length, 1)) * 100);
  elements.sidebarProgress.textContent = `${progress}%`;
  elements.sidebarProgressBar.style.width = `${progress}%`;
}

function renderDashboard(elements, data, ui, recentViews) {
  renderControls(elements, data, ui, "dashboard");

  const tasks = filteredItems(data, ui, "tasks");
  const notes = filteredItems(data, ui, "notes").slice(0, 3);
  const collections = filteredItems(data, ui, "collections").slice(0, 3);
  const bills = filteredItems(data, { ...ui, activeChip: "all" }, "bills");
  const income = bills.filter((bill) => bill.type === "收入").reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
  const expense = bills.filter((bill) => bill.type === "支出").reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
  const doneTasks = data.tasks.filter((task) => task.status === "已完成").length;
  const progress = Math.round((doneTasks / Math.max(data.tasks.length, 1)) * 100);
  const notificationSettings = loadSubscriptionNotificationSettings();
  const subscriptionSummary = getSubscriptionReminderSummary(data.subscriptions || []);

  elements.contentArea.innerHTML = `
    <div class="stats-grid subscription-stats-grid">
      ${statCard("待办事项", tasks.filter((task) => task.status !== "已完成").length, "今天要推进")}
      ${statCard("本月收入", formatCurrency(income), "已记录")}
      ${statCard("本月支出", formatCurrency(expense), "预算关注")}
      ${statCard("订阅提醒", subscriptionSummary.total, subscriptionSummary.text)}
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
    <div class="two-col">
      <section class="panel">
        <div class="panel-head">
          <h2>今日事项</h2>
          <button class="ghost-button" data-page-jump="tasks" type="button">查看全部</button>
        </div>
        <div class="list-stack">${tasks.slice(0, 4).map(taskRow).join("") || emptyState("暂无事项")}</div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>最近笔记</h2>
          <button class="ghost-button" data-page-jump="notes" type="button">查看全部</button>
        </div>
        <div class="list-stack">${notes.map(noteRow).join("") || emptyState("暂无笔记")}</div>
      </section>
    </div>
    <div class="two-col">
      <section class="panel">
        <div class="panel-head">
          <h2>项目集</h2>
          <button class="ghost-button" data-page-jump="collections" type="button">查看全部</button>
        </div>
        <div class="card-grid">${collections.map((item) => contentCard(item, "collections", typeMeta.collections.label)).join("") || emptyState("暂无项目集")}</div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>最近访问</h2>
          ${ui.searchTerm ? '<button class="ghost-button" id="openSearchPage" type="button">查看搜索结果</button>' : ""}
        </div>
        <div class="recent-list">${recentViews.map(recentViewRow).join("") || emptyState("还没有浏览记录")}</div>
      </section>
    </div>
  `;
}

function renderCardPage(elements, data, ui, type) {
  renderControls(elements, data, ui, type);
  const items = filteredItems(data, ui, type);
  const label = typeMeta[type].label;

  elements.contentArea.innerHTML = `
    <div class="card-grid">
      ${items.map((item) => contentCard(item, type, label)).join("") || emptyState(`暂无${label}`)}
    </div>
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

function projectOverviewCard(overview) {
  const project = overview.project;
  return `
    <article class="project-card" data-open="collections:${project.id}" tabindex="0">
      <div class="meta-row">
        <span class="tag">${escapeHtml(project.status || "规划中")}</span>
        <span>${escapeHtml(project.updatedAt || "")}</span>
      </div>
      <div>
        <h3>${escapeHtml(project.title)}</h3>
        <p>${escapeHtml(project.description || "暂无说明")}</p>
      </div>
      <div class="project-meter">
        <div class="meta-row">
          <span>事项进度</span>
          <strong>${overview.taskProgress}%</strong>
        </div>
        <div class="bar-track"><span class="bar-fill" style="width:${Math.min(Math.max(overview.taskProgress, 0), 100)}%"></span></div>
      </div>
      <div class="project-metrics">
        <span>事项 ${overview.tasks.length}</span>
        <span>账单 ${overview.bills.length}</span>
        <span>笔记 ${overview.notes.length}</span>
        <span>人情 ${overview.favorEvents.length}</span>
      </div>
      <div class="tag-row">
        <span class="tag">支出 ${formatCurrency(overview.expense)}</span>
        <span class="tag">结余 ${formatCurrency(overview.balance)}</span>
        <span class="tag">订阅 ${overview.subscriptions.length}</span>
      </div>
    </article>
  `;
}

function renderCollections(elements, data, ui, store) {
  renderControls(elements, data, ui, "collections");
  const projectItems = filteredItems(data, ui, "collections");
  const overviews = projectItems.map((project) => store.getProjectOverview(project.id)).filter(Boolean);
  const totalExpense = overviews.reduce((sum, overview) => sum + overview.expense, 0);
  const totalLinked = overviews.reduce((sum, overview) => sum + overview.totalLinked, 0);
  const avgProgress = overviews.length
    ? Math.round(overviews.reduce((sum, overview) => sum + Number(overview.taskProgress || 0), 0) / overviews.length)
    : 0;
  const latestTimeline = overviews.flatMap((overview) => overview.timeline).slice(0, 10);

  elements.contentArea.innerHTML = `
    <div class="stats-grid">
      ${statCard("项目数量", overviews.length, "当前筛选范围")}
      ${statCard("平均进度", `${avgProgress}%`, "按关联事项计算")}
      ${statCard("项目支出", formatCurrency(totalExpense), "关联账单支出")}
      ${statCard("关联内容", totalLinked, "事项、账单、笔记、人情与订阅")}
    </div>
    <section class="panel">
      <div class="panel-head">
        <h2>项目总览</h2>
        <span class="results-count">自动汇总关联内容</span>
      </div>
      <div class="project-grid">
        ${overviews.map(projectOverviewCard).join("") || emptyState("暂无项目集")}
      </div>
    </section>
    <div class="two-col">
      <section class="panel">
        <div class="panel-head">
          <h2>项目时间线</h2>
          <span class="results-count">最近动态</span>
        </div>
        ${timelineRows(latestTimeline)}
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>项目关联摘要</h2>
          <span class="results-count">按模块查看上下文</span>
        </div>
        <div class="list-stack">
          ${
            overviews
              .slice(0, 6)
              .map(
                (overview) => `
                  <article class="search-result-card" data-open="collections:${escapeHtml(overview.project.id)}">
                    <div class="meta-row">
                      <span class="tag">${escapeHtml(overview.project.status || "规划中")}</span>
                      <span>${overview.taskProgress}%</span>
                    </div>
                    <strong>${escapeHtml(overview.project.title)}</strong>
                    <p>事项 ${overview.tasks.length} · 账单 ${overview.bills.length} · 笔记 ${overview.notes.length} · 人情 ${overview.favorEvents.length}</p>
                  </article>
                `,
              )
              .join("") || emptyState("暂无项目摘要")
          }
        </div>
      </section>
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

function buildPayerBreakdown(items = []) {
  return items.filter(isExpenseBill).reduce((map, item) => {
    const payer = item.payer || "未指定";
    if (!map[payer]) map[payer] = { payer, amount: 0, count: 0 };
    map[payer].amount += Number(item.amount || 0);
    map[payer].count += 1;
    return map;
  }, {});
}

function payerBalancePanel(expenseItems, totalExpense) {
  const rows = Object.values(buildPayerBreakdown(expenseItems)).sort((left, right) => right.amount - left.amount);
  const max = Math.max(...rows.map((row) => row.amount), 1);
  const top = rows[0];

  return `
    <div class="payer-balance-panel">
      <div class="payer-balance-head">
        <span class="eyebrow">承担结构</span>
        <strong>${top ? `${escapeHtml(top.payer)}承担最多` : "暂无承担数据"}</strong>
        <small>${top && totalExpense ? `占本月支出 ${Math.round((top.amount / totalExpense) * 100)}%` : "导入时选择男方、女方或共同后显示"}</small>
      </div>
      <div class="payer-balance-list">
        ${
          rows.length
            ? rows
                .map(
                  (row) => `
                    <article class="payer-balance-row">
                      <div>
                        <strong>${escapeHtml(row.payer)}</strong>
                        <span>${row.count} 笔 · ${totalExpense ? Math.round((row.amount / totalExpense) * 100) : 0}%</span>
                      </div>
                      <div class="payer-balance-meter"><i style="width:${Math.round((row.amount / max) * 100)}%"></i></div>
                      <b>${formatCurrency(row.amount)}</b>
                    </article>
                  `,
                )
                .join("")
            : '<span class="muted-text">暂无承担人数据</span>'
        }
      </div>
    </div>
  `;
}

function familyCashflowPanel(items, income, expense, month) {
  const expenseItems = items.filter(isExpenseBill);
  const fixedItems = expenseItems.filter((item) => getBillFixedType(item));
  const fixedExpense = fixedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const mortgageExpense = expenseItems
    .filter((item) => getBillFixedType(item) === "房贷")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const childExpense = expenseItems
    .filter((item) => ["大宝", "二宝"].includes(item.familyMember) || item.payer === "孩子相关")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const disposable = income - fixedExpense;
  const mortgageRate = income > 0 ? Math.round((mortgageExpense / income) * 100) : 0;
  return `
    <section class="panel cashflow-panel">
      <div class="panel-head">
        <h2>家庭现金流</h2>
        <span class="results-count">${escapeHtml(month)} · 生活收支升级版</span>
      </div>
      <div class="cashflow-grid">
        <article class="cashflow-card cashflow-card--primary">
          <span>可支配余额</span>
          <strong>${formatCurrency(disposable)}</strong>
          <p>收入减固定支出后可安排金额</p>
        </article>
        <article class="cashflow-card">
          <span>固定支出</span>
          <strong>${formatCurrency(fixedExpense)}</strong>
          <p>房贷、车贷、保险、学费、订阅</p>
        </article>
        <article class="cashflow-card ${mortgageExpense ? "cashflow-card--warning" : ""}">
          <span>房贷压力</span>
          <strong>${formatCurrency(mortgageExpense)}</strong>
          <p>${mortgageExpense ? `约占收入 ${mortgageRate}%` : "暂无房贷记录"}</p>
        </article>
        <article class="cashflow-card">
          <span>孩子相关</span>
          <strong>${formatCurrency(childExpense)}</strong>
          <p>大宝、二宝与孩子相关承担</p>
        </article>
      </div>
      <div class="cashflow-split">
        ${payerBalancePanel(expenseItems, expense)}
        <div>
          <span class="eyebrow">数据结构</span>
          <div class="cashflow-pill-row">
            <span class="tag">来源</span>
            <span class="tag">承担人</span>
            <span class="tag">家庭成员</span>
            <span class="tag">固定支出</span>
            <span class="tag">房贷字段</span>
          </div>
        </div>
      </div>
    </section>
  `;
}

function sumBills(items) {
  return items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function groupExpenseBy(items, getKey) {
  return items.filter(isExpenseBill).reduce((map, item) => {
    const key = getKey(item) || "未指定";
    map[key] = (map[key] || 0) + Number(item.amount || 0);
    return map;
  }, {});
}

function topExpenseRows(items, getKey, limit = 5) {
  return Object.entries(groupExpenseBy(items, getKey))
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);
}

function getRecentMonths(currentMonth, count = 6) {
  const [yearText, monthText] = String(currentMonth || new Date().toISOString().slice(0, 7)).split("-");
  const date = new Date(Number(yearText), Number(monthText || 1) - 1, 1);
  return Array.from({ length: count }, (_, index) => {
    const item = new Date(date);
    item.setMonth(date.getMonth() - (count - 1 - index));
    return `${item.getFullYear()}-${String(item.getMonth() + 1).padStart(2, "0")}`;
  });
}

function billMonthTrend(allBills, currentMonth) {
  const months = getRecentMonths(currentMonth, 6);
  const rows = months.map((month) => {
    const bills = (allBills || []).filter((item) => String(item.date || "").startsWith(month));
    const income = sumBills(bills.filter(isIncomeBill));
    const expense = sumBills(bills.filter(isExpenseBill));
    return { month, income, expense, balance: income - expense };
  });
  const maxExpense = Math.max(...rows.map((item) => item.expense), 1);

  return `
    <div class="bill-trend">
      ${rows
        .map(
          (item) => `
            <div class="bill-trend__item">
              <div class="bill-trend__bar">
                <span style="height:${Math.max(8, Math.round((item.expense / maxExpense) * 100))}%"></span>
              </div>
              <strong>${formatCurrency(item.expense)}</strong>
              <small>${escapeHtml(item.month.slice(5))}</small>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function expenseInsightList(rows, emptyText) {
  const max = Math.max(...rows.map(([, value]) => value), 1);
  return `
    <div class="expense-insight-list">
      ${
        rows.length
          ? rows
              .map(
                ([label, value]) => `
                  <div class="expense-insight-row">
                    <span>${escapeHtml(label)}</span>
                    <div class="expense-insight-meter"><i style="width:${Math.round((value / max) * 100)}%"></i></div>
                    <strong>${formatCurrency(value)}</strong>
                  </div>
                `,
              )
              .join("")
          : `<div class="empty">${escapeHtml(emptyText)}</div>`
      }
    </div>
  `;
}

function expenseAlerts(items, income, expense) {
  const expenseItems = items.filter(isExpenseBill);
  const averageExpense = expenseItems.length ? expense / expenseItems.length : 0;
  const categoryRows = topExpenseRows(items, (item) => item.category, 3);
  const highItems = expenseItems
    .filter((item) => Number(item.amount || 0) >= Math.max(1000, averageExpense * 2.5))
    .sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0))
    .slice(0, 3);
  const alerts = [];

  if (income > 0 && expense / income >= 0.85) {
    alerts.push(`本月支出约占收入 ${Math.round((expense / income) * 100)}%，现金流压力偏高。`);
  }

  if (categoryRows[0] && expense > 0 && categoryRows[0][1] / expense >= 0.45) {
    alerts.push(`${categoryRows[0][0]} 占本月支出 ${Math.round((categoryRows[0][1] / expense) * 100)}%，是当前主要消费动向。`);
  }

  highItems.forEach((item) => {
    alerts.push(`${item.title || item.category} 单笔 ${formatCurrency(item.amount)}，建议复核是否为固定或特殊支出。`);
  });

  return `
    <div class="expense-alert-list">
      ${
        alerts.length
          ? alerts.map((item) => `<div class="expense-alert">${escapeHtml(item)}</div>`).join("")
          : '<div class="expense-alert expense-alert--quiet">本月暂无明显异常消费。</div>'
      }
    </div>
  `;
}

function expenseDirectionPanel(items, allBills, income, expense, month) {
  const categoryRows = topExpenseRows(items, (item) => item.category, 5);
  const payerRows = topExpenseRows(items, (item) => item.payer || "未指定", 5);
  const childRows = topExpenseRows(
    items.filter((item) => ["大宝", "二宝"].includes(item.familyMember) || item.payer === "孩子相关"),
    (item) => item.familyMember || "孩子相关",
    4,
  );
  const mainCategory = categoryRows[0];
  const mainCategoryHint = mainCategory && expense > 0 ? `${mainCategory[0]} ${Math.round((mainCategory[1] / expense) * 100)}%` : "暂无支出";

  return `
    <section class="panel expense-direction-panel">
      <div class="panel-head">
        <h2>消费动向</h2>
        <span class="results-count">${escapeHtml(month)} · 主要方向 ${escapeHtml(mainCategoryHint)}</span>
      </div>
      <div class="expense-direction-grid">
        <article class="expense-direction-card expense-direction-card--wide">
          <div class="expense-card-head">
            <span>近 6 个月支出趋势</span>
            <strong>${formatCurrency(expense)}</strong>
          </div>
          ${billMonthTrend(allBills, month)}
        </article>
        <article class="expense-direction-card">
          <div class="expense-card-head">
            <span>分类排行</span>
            <strong>${escapeHtml(mainCategory?.[0] || "暂无")}</strong>
          </div>
          ${expenseInsightList(categoryRows, "暂无分类支出")}
        </article>
        <article class="expense-direction-card">
          <div class="expense-card-head">
            <span>承担人对比</span>
            <strong>${escapeHtml(payerRows[0]?.[0] || "暂无")}</strong>
          </div>
          ${expenseInsightList(payerRows, "暂无承担人数据")}
        </article>
        <article class="expense-direction-card">
          <div class="expense-card-head">
            <span>孩子相关</span>
            <strong>${formatCurrency(sumBills(items.filter((item) => ["大宝", "二宝"].includes(item.familyMember) || item.payer === "孩子相关")))}</strong>
          </div>
          ${expenseInsightList(childRows, "暂无孩子相关支出")}
        </article>
        <article class="expense-direction-card">
          <div class="expense-card-head">
            <span>异常提醒</span>
            <strong>${expense > income && income > 0 ? "需关注" : "正常"}</strong>
          </div>
          ${expenseAlerts(items, income, expense)}
        </article>
      </div>
    </section>
  `;
}

function daysUntilDueDay(month, dueDay) {
  const day = Number(dueDay || 0);
  if (!day) return "";
  const today = new Date();
  const [year, monthNumber] = String(month || today.toISOString().slice(0, 7)).split("-").map(Number);
  const dueDate = new Date(year, monthNumber - 1, day);
  const diff = Math.ceil((dueDate.getTime() - today.setHours(0, 0, 0, 0)) / 86400000);
  if (diff < 0) return "本月已到期";
  if (diff === 0) return "今天到期";
  return `${diff} 天后`;
}

function fixedExpenseTrend(allBills, currentMonth) {
  const months = getRecentMonths(currentMonth, 6);
  const rows = months.map((month) => {
    const bills = (allBills || []).filter((item) => String(item.date || "").startsWith(month) && isExpenseBill(item) && getBillFixedType(item));
    return { month, amount: sumBills(bills) };
  });
  const maxAmount = Math.max(...rows.map((item) => item.amount), 1);

  return `
    <div class="fixed-trend">
      ${rows
        .map(
          (item) => `
            <div class="fixed-trend__item">
              <span style="height:${Math.max(8, Math.round((item.amount / maxAmount) * 100))}%"></span>
              <small>${escapeHtml(item.month.slice(5))}</small>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function mortgageDetailList(items, month) {
  return `
    <div class="mortgage-detail-list">
      ${
        items.length
          ? items
              .map(
                (item) => `
                  <article class="mortgage-detail-row">
                    <div>
                      <strong>${escapeHtml(item.title || "房贷")}</strong>
                      <span>${escapeHtml(item.payer || "未指定")} · ${escapeHtml(item.date || "")}</span>
                    </div>
                    <div>
                      <b>${formatCurrency(item.amount)}</b>
                      <small>${item.mortgageDueDay ? `${daysUntilDueDay(month, item.mortgageDueDay)} · 还款日 ${item.mortgageDueDay}` : "未设置还款日"}</small>
                    </div>
                    <em>${item.mortgageRemainingTerms ? `剩余 ${escapeHtml(item.mortgageRemainingTerms)} 期` : "未设置期数"}</em>
                  </article>
                `,
              )
              .join("")
          : '<span class="muted-text">暂无房贷账单。录入账单时把固定支出设为“房贷”后会显示。</span>'
      }
    </div>
  `;
}

function fixedExpenseSummary(fixedRows, fixedTotal) {
  const top = fixedRows[0];
  const topRate = top && fixedTotal ? Math.round((top[1] / fixedTotal) * 100) : 0;
  return `
    <div class="fixed-summary-card">
      <span>最大固定项</span>
      <strong>${escapeHtml(top?.[0] || "暂无")}</strong>
      <p>${top ? `${formatCurrency(top[1])} · 占固定支出 ${topRate}%` : "暂无固定支出"}</p>
    </div>
  `;
}

function fixedExpensePanel(items, allBills, income, expense, month) {
  const expenseItems = items.filter(isExpenseBill);
  const fixedItems = expenseItems.filter((item) => getBillFixedType(item));
  const mortgageItems = fixedItems.filter((item) => getBillFixedType(item) === "房贷");
  const fixedTotal = sumBills(fixedItems);
  const mortgageTotal = sumBills(mortgageItems);
  const disposableAfterFixed = income - fixedTotal;
  const fixedRate = income > 0 ? Math.round((fixedTotal / income) * 100) : 0;
  const mortgageRate = income > 0 ? Math.round((mortgageTotal / income) * 100) : 0;
  const fixedRows = Object.entries(groupExpenseBy(fixedItems, (item) => getBillFixedType(item)))
    .sort((left, right) => right[1] - left[1]);
  const nextMortgage = mortgageItems
    .slice()
    .sort((left, right) => Number(left.mortgageDueDay || 99) - Number(right.mortgageDueDay || 99))[0];

  return `
    <section class="panel fixed-expense-panel">
      <div class="panel-head">
        <h2>房贷与固定支出</h2>
        <span class="results-count">${escapeHtml(month)} · 固定成本 ${formatCurrency(fixedTotal)}</span>
      </div>
      <div class="fixed-expense-layout">
        <article class="fixed-hero">
          <div>
            <span>房贷压力</span>
            <strong>${formatCurrency(mortgageTotal)}</strong>
            <p>${mortgageTotal ? `约占收入 ${mortgageRate}%` : "暂无房贷记录"}</p>
          </div>
          <div class="fixed-hero__meta">
            <span>固定支出占收入 ${fixedRate}%</span>
            <span>固定后可支配 ${formatCurrency(disposableAfterFixed)}</span>
            <span>${nextMortgage ? `还款日 ${nextMortgage.mortgageDueDay || "未填"} · ${daysUntilDueDay(month, nextMortgage.mortgageDueDay)}` : "暂无还款日"}</span>
          </div>
        </article>
        <article class="fixed-expense-card">
          <div class="expense-card-head">
            <span>固定支出清单</span>
            <strong>${fixedItems.length} 笔</strong>
          </div>
          ${fixedExpenseSummary(fixedRows, fixedTotal)}
          ${expenseInsightList(fixedRows, "暂无固定支出")}
        </article>
        <article class="fixed-expense-card">
          <div class="expense-card-head">
            <span>近 6 个月固定支出</span>
            <strong>${formatCurrency(fixedTotal)}</strong>
          </div>
          ${fixedExpenseTrend(allBills, month)}
        </article>
      </div>
      <div class="mortgage-detail-panel">
        <div class="panel-head">
          <h3>房贷明细</h3>
          <span class="results-count">${mortgageItems.length} 笔 · ${formatCurrency(mortgageTotal)}</span>
        </div>
        ${mortgageDetailList(mortgageItems, month)}
      </div>
      <div class="fixed-ledger">
        ${
          fixedItems.length
            ? fixedItems
                .map(
                  (item) => `
                    <button class="fixed-ledger-row" data-open="bills:${escapeHtml(item.id)}" type="button">
                      <span class="tag">${escapeHtml(getBillFixedType(item) || "固定")}</span>
                      <strong>${escapeHtml(item.title || "未命名账单")}</strong>
                      <span>${escapeHtml(item.date || "")}</span>
                      <span>${escapeHtml(item.payer || "未指定")}</span>
                      <b>${formatCurrency(item.amount)}</b>
                    </button>
                  `,
                )
                .join("")
            : emptyState("暂无固定支出账单")
        }
      </div>
    </section>
  `;
}

function getNextMonth(month) {
  const [yearText, monthText] = String(month || new Date().toISOString().slice(0, 7)).split("-");
  const date = new Date(Number(yearText), Number(monthText || 1) - 1, 1);
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function favorCashflowForMonth(favorEvents, month) {
  const monthly = (favorEvents || []).filter((item) => String(item.date || "").startsWith(month));
  const received = monthly.filter((item) => item.direction === "received").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const given = monthly.filter((item) => item.direction !== "received").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return { items: monthly, received, given, net: received - given };
}

function nextMonthSubscriptionTotal(overview, nextMonth) {
  return (overview.items || [])
    .filter((item) => String(item.nextRenewalDate || "").startsWith(nextMonth) && item.status !== "cancelled")
    .reduce((sum, item) => sum + Number(item.monthlyCost || item.amount || 0), 0);
}

function decisionTone(balance, reserveNeed) {
  if (balance < 0) return { label: "赤字", className: "decision-status--danger", hint: "本月支出已超过收入，需要复核大额和固定支出。" };
  if (balance < reserveNeed) return { label: "偏紧", className: "decision-status--warning", hint: "本月结余不足以覆盖下月固定准备金。" };
  return { label: "健康", className: "decision-status--good", hint: "本月结余可以覆盖下月固定准备金。" };
}

function familyDecisionPanel(items, data, store, income, expense, month) {
  const nextMonth = getNextMonth(month);
  const subscriptionOverview = store.getSubscriptionsOverview();
  const currentFavor = favorCashflowForMonth(data.favorEvents || [], month);
  const nextFavor = favorCashflowForMonth(data.favorEvents || [], nextMonth);
  const fixedItems = items.filter((item) => isExpenseBill(item) && getBillFixedType(item));
  const fixedTotal = sumBills(fixedItems);
  const subscriptionMonthly = Number(subscriptionOverview.estimatedMonthlyCost || 0);
  const nextSubscription = nextMonthSubscriptionTotal(subscriptionOverview, nextMonth);
  const balance = income - expense + currentFavor.net;
  const reserveNeed = fixedTotal + Math.max(subscriptionMonthly, nextSubscription) + Math.max(0, nextFavor.given - nextFavor.received);
  const tone = decisionTone(balance, reserveNeed);
  const reserveGap = balance - reserveNeed;
  const decisionItems = [
    ["本月结余", formatCurrency(balance), "生活收支 + 人情净额"],
    ["下月准备金", formatCurrency(reserveNeed), "固定支出 + 订阅 + 人情"],
    ["固定支出", formatCurrency(fixedTotal), `${fixedItems.length} 笔固定成本`],
    ["订阅扣费", formatCurrency(Math.max(subscriptionMonthly, nextSubscription)), `${subscriptionOverview.upcoming.length} 个 30 天内到期`],
  ];
  const checklist = [
    reserveGap < 0 ? `还差 ${formatCurrency(Math.abs(reserveGap))} 才能覆盖下月固定准备金。` : `覆盖准备金后预计剩余 ${formatCurrency(reserveGap)}。`,
    fixedTotal > income * 0.5 && income > 0 ? "固定支出超过收入 50%，优先复核房贷、订阅和长期扣费。" : "固定支出占比暂未触发高压预警。",
    subscriptionOverview.upcoming.length ? `30 天内有 ${subscriptionOverview.upcoming.length} 个订阅待扣费。` : "30 天内暂无订阅扣费压力。",
    currentFavor.items.length ? `本月人情往来 ${currentFavor.items.length} 条，净额 ${formatCurrency(currentFavor.net)}。` : "本月暂无人情往来现金流。",
  ];

  return `
    <section class="panel decision-panel">
      <div class="panel-head">
        <h2>家庭现金流决策</h2>
        <span class="decision-status ${tone.className}">${tone.label}</span>
      </div>
      <div class="decision-layout">
        <article class="decision-hero">
          <span>月度判断</span>
          <strong>${formatCurrency(reserveGap)}</strong>
          <p>${escapeHtml(tone.hint)}</p>
        </article>
        <div class="decision-metrics">
          ${decisionItems
            .map(
              ([label, value, hint]) => `
                <article class="decision-metric">
                  <span>${escapeHtml(label)}</span>
                  <strong>${escapeHtml(value)}</strong>
                  <small>${escapeHtml(hint)}</small>
                </article>
              `,
            )
            .join("")}
        </div>
      </div>
      <div class="decision-checklist">
        ${checklist.map((item) => `<div class="decision-check">${escapeHtml(item)}</div>`).join("")}
      </div>
    </section>
  `;
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

function billMonthToolbar(allBills, activeMonth) {
  const historyRows = getBillHistoryRows(allBills);
  const monthMenu = historyRows
    .map(
      (row) => `
        <button class="${row.month === activeMonth ? "is-active" : ""}" data-bill-month="${escapeHtml(row.month)}" type="button">
          <span>${escapeHtml(row.month)}</span>
          <strong>支出 ${formatCurrency(row.expense)}</strong>
        </button>
      `,
    )
    .join("");

  return `
    <section class="panel bill-month-toolbar">
      <div>
        <span class="eyebrow">历史消费</span>
        <h2>${escapeHtml(activeMonth)} 生活收支</h2>
      </div>
      <div class="bill-month-actions">
        <details class="bill-month-menu">
          <summary>
            <span>查看月份</span>
            <strong>${escapeHtml(activeMonth)}</strong>
          </summary>
          <div class="bill-month-menu__panel">
            ${monthMenu || `<button class="is-active" data-bill-month="${escapeHtml(activeMonth)}" type="button"><span>${escapeHtml(activeMonth)}</span><strong>暂无支出</strong></button>`}
          </div>
        </details>
        <button class="ghost-button" data-bill-month="${escapeHtml(new Date().toISOString().slice(0, 7))}" type="button">本月</button>
      </div>
    </section>
  `;
}

function billHistoryPanel(allBills, activeMonth) {
  const historyRows = getBillHistoryRows(allBills);

  return `
    <section class="panel bill-history-panel">
      <div class="panel-head">
        <h2>历史月份总览</h2>
        <span class="results-count">${historyRows.length} 个月</span>
      </div>
      <div class="bill-history-grid">
        ${
          historyRows.length
            ? historyRows
                .map(
                  (row) => `
                    <button class="bill-history-card ${row.month === activeMonth ? "is-active" : ""}" data-bill-month="${escapeHtml(row.month)}" type="button">
                      <span>${escapeHtml(row.month)}</span>
                      <strong>${formatCurrency(row.expense)}</strong>
                      <small>收入 ${formatCurrency(row.income)} · 结余 ${formatCurrency(row.balance)} · ${row.items.length} 笔</small>
                    </button>
                  `,
                )
                .join("")
            : emptyState("暂无历史账单")
        }
      </div>
    </section>
  `;
}

function billTotalOverviewPanel(allBills, activeMonth) {
  const income = sumBills((allBills || []).filter(isIncomeBill));
  const expense = sumBills((allBills || []).filter(isExpenseBill));
  const historyRows = getBillHistoryRows(allBills);
  const activeRow = historyRows.find((row) => row.month === activeMonth);

  return `
    <section class="panel bill-total-panel">
      <div class="panel-head">
        <h2>累计总览</h2>
        <span class="results-count">总数据与当前月份分开统计</span>
      </div>
      <div class="bill-total-grid">
        ${statCard("累计收入", formatCurrency(income), `全部 ${historyRows.length} 个月`)}
        ${statCard("累计支出", formatCurrency(expense), `${(allBills || []).length} 笔账单`)}
        ${statCard("累计结余", formatCurrency(income - expense), "全部收入减全部支出")}
        ${statCard("当前月份", formatCurrency(activeRow?.expense || 0), `${activeMonth} 支出`)}
      </div>
    </section>
  `;
}

function billScopeOverviewPanel(allBills, monthlyItems, activeMonth, budget = {}) {
  const allExpenseItems = (allBills || []).filter(isExpenseBill);
  const monthExpenseItems = (monthlyItems || []).filter(isExpenseBill);
  const totalIncome = sumBills((allBills || []).filter(isIncomeBill));
  const totalExpense = sumBills(allExpenseItems);
  const monthIncome = sumBills((monthlyItems || []).filter(isIncomeBill));
  const monthExpense = sumBills(monthExpenseItems);
  const monthBudget = Number(budget.totalBudget || 0);
  const sourceRows = topExpenseRows(monthExpenseItems, (item) => item.source || "未指定", 4);
  const payerRows = topExpenseRows(monthExpenseItems, (item) => item.payer || "未指定", 4);
  const categoryRows = topExpenseRows(monthExpenseItems, (item) => item.category || "未分类", 4);
  const largestExpense = [...monthExpenseItems].sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0))[0];

  return `
    <section class="panel bill-scope-panel">
      <div class="panel-head">
        <h2>月度与累计对照</h2>
        <span class="results-count">${escapeHtml(activeMonth)} · 数据口径分开</span>
      </div>
      <div class="bill-scope-grid">
        <article class="bill-scope-card bill-scope-card--primary">
          <span>当前月份</span>
          <strong>${formatCurrency(monthExpense)}</strong>
          <small>收入 ${formatCurrency(monthIncome)} · 结余 ${formatCurrency(monthIncome - monthExpense)} · ${monthExpenseItems.length} 笔支出</small>
          ${
            monthBudget
              ? `<div class="bill-scope-meter"><i style="width:${Math.min(100, Math.round((monthExpense / monthBudget) * 100))}%"></i></div><em>预算剩余 ${formatCurrency(monthBudget - monthExpense)}</em>`
              : `<em>未设置月预算</em>`
          }
        </article>
        <article class="bill-scope-card">
          <span>累计总数据</span>
          <strong>${formatCurrency(totalExpense)}</strong>
          <small>累计收入 ${formatCurrency(totalIncome)} · 累计结余 ${formatCurrency(totalIncome - totalExpense)}</small>
          <em>${(allBills || []).length} 笔账单 · ${getBillHistoryRows(allBills).length} 个月</em>
        </article>
        <article class="bill-scope-card">
          <span>本月最大支出</span>
          <strong>${largestExpense ? formatCurrency(largestExpense.amount) : "暂无"}</strong>
          <small>${escapeHtml(largestExpense?.title || largestExpense?.category || "暂无支出")}</small>
          <em>${escapeHtml(largestExpense?.payer || "未指定")} · ${escapeHtml(largestExpense?.source || "未指定")}</em>
        </article>
      </div>
      <div class="bill-scope-insights">
        <article>
          <h3>来源</h3>
          ${expenseInsightList(sourceRows, "暂无来源数据")}
        </article>
        <article>
          <h3>承担人</h3>
          ${expenseInsightList(payerRows, "暂无承担人数据")}
        </article>
        <article>
          <h3>分类动向</h3>
          ${expenseInsightList(categoryRows, "暂无分类数据")}
        </article>
      </div>
    </section>
  `;
}

function billReviewMiniList(items, emptyText) {
  return `
    <div class="bill-review-mini-list">
      ${
        items.length
          ? items
              .slice(0, 4)
              .map(
                (item) => `
                  <button class="bill-review-row" data-open="bills:${escapeHtml(item.id)}" type="button">
                    <span>${escapeHtml(item.date || "未设置日期")}</span>
                    <strong>${escapeHtml(item.title || "未命名账单")}</strong>
                    <b>${formatCurrency(item.amount)}</b>
                  </button>
                `,
              )
              .join("")
          : `<span class="muted-text">${escapeHtml(emptyText)}</span>`
      }
    </div>
  `;
}

function billImportReviewPanel(items, month) {
  const expenseItems = items.filter(isExpenseBill);
  const averageExpense = expenseItems.length ? sumBills(expenseItems) / expenseItems.length : 0;
  const highAmountItems = expenseItems
    .filter((item) => Number(item.amount || 0) >= Math.max(1000, averageExpense * 2.5))
    .sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0));
  const missingSource = items.filter((item) => !item.source || item.source === "未指定");
  const missingPayer = items.filter((item) => !item.payer || item.payer === "未指定");
  const uncategorized = items.filter((item) => !item.category || item.category === "未分类");
  const reviewCount = highAmountItems.length + missingSource.length + missingPayer.length + uncategorized.length;

  return `
    <section class="panel bill-review-panel">
      <div class="panel-head">
        <h2>导入后复核</h2>
        <span class="results-count">${escapeHtml(month)} · ${reviewCount} 项待看</span>
      </div>
      <div class="bill-review-grid">
        <article class="bill-review-card ${highAmountItems.length ? "bill-review-card--warning" : ""}">
          <div class="expense-card-head">
            <span>异常金额</span>
            <strong>${highAmountItems.length}</strong>
          </div>
          ${billReviewMiniList(highAmountItems, "暂无异常大额支出")}
        </article>
        <article class="bill-review-card">
          <div class="expense-card-head">
            <span>缺少来源</span>
            <strong>${missingSource.length}</strong>
          </div>
          ${billReviewMiniList(missingSource, "来源字段完整")}
        </article>
        <article class="bill-review-card">
          <div class="expense-card-head">
            <span>缺少归属</span>
            <strong>${missingPayer.length}</strong>
          </div>
          ${billReviewMiniList(missingPayer, "承担人字段完整")}
        </article>
        <article class="bill-review-card">
          <div class="expense-card-head">
            <span>未分类</span>
            <strong>${uncategorized.length}</strong>
          </div>
          ${billReviewMiniList(uncategorized, "分类字段完整")}
        </article>
      </div>
    </section>
  `;
}

function renderBills(elements, data, ui, store) {
  renderControls(elements, data, ui, "bills");
  const fallbackMonth = getBillHistoryRows(data.bills || [])[0]?.month || data.budgets?.month || new Date().toISOString().slice(0, 7);
  const month = ui.filters.billMonth || data.budgets?.viewMonth || fallbackMonth;
  const monthlyStats = store.getMonthlyBillStats(month);
  const monthlyItemCount = monthlyStats.items.length;
  const items = filterCollection(
    monthlyStats.items.map((item) => ({ ...item, entryType: "bills" })),
    ui,
    { fixedType: "bills" },
  );
  const isIncome = isIncomeBill;
  const isExpense = isExpenseBill;
  const income = items.filter(isIncome).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expense = items.filter(isExpense).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const budget = data.budgets || { totalBudget: 0, categoryBudgets: [] };
  const budgetSpent = items.filter(isExpense).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const projectRows = Object.entries(
    items.reduce((map, item) => {
      if (!isExpense(item) || !item.projectId) return map;
      map[item.projectId] = (map[item.projectId] || 0) + Number(item.amount || 0);
      return map;
    }, {}),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4);

  elements.contentArea.innerHTML = `
    ${billMonthToolbar(data.bills || [], month)}
    <div class="stats-grid">
      ${statCard("月收入", formatCurrency(income), `${month} 范围`)}
      ${statCard("月支出", formatCurrency(expense), `${month} 范围`)}
      ${statCard("月结余", formatCurrency(income - expense), "收入减去支出")}
      ${statCard("预算剩余", formatCurrency((budget.totalBudget || 0) - budgetSpent), "本月预算")}
    </div>
    ${billScopeOverviewPanel(data.bills || [], items, month, budget)}
    ${billImportReviewPanel(items, month)}
    ${billTotalOverviewPanel(data.bills || [], month)}
    ${familyCashflowPanel(items, income, expense, month)}
    ${familyDecisionPanel(items, data, store, income, expense, month)}
    ${fixedExpensePanel(items, data.bills || [], income, expense, month)}
    ${expenseDirectionPanel(items, data.bills || [], income, expense, month)}
    ${billHistoryPanel(data.bills || [], month)}
    <div class="two-col">
      <section class="panel">
        <div class="panel-head">
          <h2>预算进度</h2>
          <span class="results-count">${escapeHtml(month)}</span>
        </div>
        <div class="list-stack">
          ${budgetProgressCard("总预算", budgetSpent, budget.totalBudget || 0)}
          ${(budget.categoryBudgets || [])
            .map((item) => {
              const spent = items
                .filter((bill) => isExpense(bill) && bill.category === item.category)
                .reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
              return budgetProgressCard(item.category, spent, item.amount);
            })
            .join("")}
        </div>
        <form class="quick-note-form" id="budgetForm">
          <div class="form-grid">
            <label>
              预算月份
              <input name="month" type="month" value="${escapeHtml(month)}" />
            </label>
            <label>
              总预算
              <input name="totalBudget" type="number" step="0.01" value="${escapeHtml(String(budget.totalBudget || 0))}" />
            </label>
          </div>
          <label>
            分类预算
            <input
              name="categoryBudgets"
              placeholder="例如：餐饮:1200,交通:300,学习:500"
              value="${escapeHtml((budget.categoryBudgets || []).map((item) => `${item.category}:${item.amount}`).join(","))}"
            />
          </label>
          <div class="topbar-actions">
            <button class="primary-button" type="submit">保存预算</button>
          </div>
        </form>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>项目花费</h2>
          <span class="results-count">按关联项目统计</span>
        </div>
        <div class="list-stack">
          ${
            projectRows.length
              ? projectRows
                  .map(
                    ([projectName, total]) => `
                      <article class="search-result-card">
                        <div class="meta-row">
                          <span class="tag">项目支出</span>
                          <span>${escapeHtml(month)}</span>
                        </div>
                        <strong>${escapeHtml(projectName)}</strong>
                        <p>${formatCurrency(total)}</p>
                      </article>
                    `,
                  )
                  .join("")
              : emptyState("账单还没有关联项目")
          }
        </div>
      </section>
    </div>
    <section class="panel">
      <div class="panel-head">
        <h2>分类占比</h2>
        <span class="results-count">支出结构</span>
      </div>
      ${categoryBars(items.filter(isExpense))}
    </section>
    <section class="table-wrap">
      <div class="table-head">
        <div>
          <h2>账单明细</h2>
          <span>${escapeHtml(month)} · 当前筛选 ${items.length} / ${monthlyItemCount} 条</span>
        </div>
        <span class="results-count">点击行可查看详情</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>标题</th>
            <th>分类</th>
            <th>类型</th>
            <th>承担人</th>
            <th>来源</th>
            <th>固定支出</th>
            <th>金额</th>
          </tr>
        </thead>
        <tbody>${items.map(billRow).join("")}</tbody>
      </table>
      ${items.length ? "" : emptyState("暂无符合条件的账单")}
    </section>
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
    <details class="subscription-entry-details">
      <summary>新增订阅</summary>
      <form class="quick-note-form subscription-entry-panel" id="subscriptionForm">
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
    </details>
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
    ${renderSubscriptionDistributionPanel(overview)}
    <section class="panel subscription-list-panel">
      <div class="panel-head">
        <h2>订阅项目</h2>
        <span class="results-count">共 ${items.length} 条</span>
      </div>
      <div class="subscription-list">
        ${items.map(subscriptionCompactRow).join("") || emptyState("还没有记录订阅项目")}
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
    ${
      notificationSettings.siteEnabled
        ? `<section class="panel notification-panel">
      <div class="panel-head">
        <h2>到期提醒中心</h2>
        <span class="results-count">站内提醒 V1</span>
      </div>
      <div class="reminder-grid">
        ${[
          ["已过期", reminderGroups.expired],
          ["今天到期", reminderGroups.today],
          ["7 天内", reminderGroups.week],
          ["30 天内", reminderGroups.month],
        ]
          .map(
            ([label, group]) => `
              <article class="reminder-group">
                <div class="meta-row">
                  <strong>${escapeHtml(label)}</strong>
                  <span class="tag">${group.length} 项</span>
                </div>
                <div class="list-stack">
                  ${
                    group
                      .slice(0, 3)
                      .map((item) => `<span>${escapeHtml(item.name)} · ${escapeHtml(item.reminderLabel)}</span>`)
                      .join("") || '<span class="muted-text">暂无</span>'
                  }
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>`
        : ""
    }
    <div class="two-col">
      <section class="panel">
        <div class="panel-head">
          <h2>成本分析</h2>
          <span class="results-count">年化 ${formatCurrency(overview.estimatedAnnualCost)}</span>
        </div>
        <div class="list-stack">
          ${
            overview.categoryTotals
              .slice(0, 5)
              .map((item) => {
                const percent = Math.round((Number(item.amount || 0) / Math.max(overview.estimatedMonthlyCost, 1)) * 100);
                return `
                  <article class="budget-card">
                    <div class="meta-row">
                      <strong>${escapeHtml(item.category)}</strong>
                      <span>${formatCurrency(item.amount)} / 月</span>
                    </div>
                    <div class="bar-track"><span class="bar-fill" style="width:${percent}%"></span></div>
                    <small>${percent}% 月均占比</small>
                  </article>
                `;
              })
              .join("") || emptyState("还没有分类成本")
          }
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>订阅概览</h2>
          <span class="results-count">自动续费 ${overview.autoRenewing.length} 项 / 高成本 ${overview.highCost.length} 项</span>
        </div>
        <div class="reminder-grid subscription-summary-grid">
          <article class="reminder-group">
            <strong>临期订阅</strong>
            <span class="tag tag-danger">${overview.urgent.length} 项</span>
          </article>
          <article class="reminder-group">
            <strong>自动续费</strong>
            <span class="tag">${overview.autoRenewing.length} 项</span>
          </article>
          <article class="reminder-group">
            <strong>高成本</strong>
            <span class="tag">${overview.highCost.length} 项</span>
          </article>
        </div>
      </section>
    </div>
    <section class="panel">
      <div class="panel-head">
        <h2>订阅复盘队列</h2>
        <span class="results-count">待处理 ${overview.reviewQueue.length} 项</span>
      </div>
      <div class="card-grid compact-card-grid">
        ${overview.reviewQueue.map(subscriptionCard).join("") || emptyState("当前没有需要复盘的订阅")}
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
    <div class="stats-grid favor-stats-grid">
      ${statCard("关系人", favorStats.totalContacts, "已建立关系")}
      ${statCard("往来事件", favorStats.totalEvents, "礼金与礼品记录")}
      ${statCard("收 / 给", `${formatCurrency(favorStats.received)} / ${formatCurrency(favorStats.given)}`, "人情收支")}
      ${statCard("净差额", formatCurrency(favorStats.balance), "收到减去给出")}
    </div>
    ${favorPeriodPanel(favorPeriodOverview)}
    ${favorInsightPanels(favorInsightOverview)}
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
    <section class="panel favor-archive-panel">
      <div class="panel-head">
        <h2>人情数据归档</h2>
        <span class="results-count">与生活收支共用导出按钮</span>
      </div>
      <p class="panel-copy">在设置页使用“财务 Excel 管理”导入或导出，会生成包含生活收支、人情往来、关系人和订阅项目的 Excel 文件。</p>
    </section>
  `;
}

function renderNotes(elements, data, ui) {
  renderControls(elements, data, ui, "notes");
  const items = filteredItems(data, ui, "notes");
  const ideaNotes = data.notes.filter((item) => item.noteType === "idea").slice(0, 4);
  const linkNotes = data.notes.filter((item) => item.noteType === "link").slice(0, 4);
  const weeklyNotes = data.notes.filter((item) => isWithinLastDays(item.createdAt || item.updatedAt, 7)).slice(0, 4);
  const markdownPreview = renderMarkdown([
    "# Markdown 预览",
    "",
    "## 笔记结构",
    "- 支持标题",
    "- 支持列表",
    "- 支持引用和代码",
    "",
    "访问 [Mobbin](https://mobbin.com)",
  ].join("\n"));

  elements.contentArea.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>快速记录</h2>
        <span class="results-count">用于灵感、链接和碎片想法</span>
      </div>
      <form class="quick-note-form" id="quickNoteForm">
        <div class="form-grid">
          <label>
            标题
            <input name="title" placeholder="可留空，系统会自动生成标题" />
          </label>
          <label>
            类型
            <select name="noteType">
              <option value="idea">灵感</option>
              <option value="note">笔记</option>
              <option value="link">链接</option>
              <option value="summary">回顾</option>
            </select>
          </label>
        </div>
        <label>
          摘要
          <input name="description" placeholder="一句话说明这条记录的重点" />
        </label>
        <label>
          主要内容
          <textarea name="content" rows="5" placeholder="支持基础 Markdown，例如标题、列表、引用、链接"></textarea>
        </label>
        <div class="form-grid">
          <label>
            链接地址
            <input name="sourceUrl" type="url" placeholder="https://example.com" />
          </label>
          <label>
            标签
            <input name="tags" placeholder="用逗号分隔，例如：灵感,产品" />
          </label>
        </div>
        <div class="topbar-actions">
          <button class="ghost-button" id="openNoteModal" type="button">打开完整编辑器</button>
          <button class="primary-button" type="submit">保存记录</button>
        </div>
      </form>
    </section>
    <div class="stats-grid">
      ${statCard("本周新增", weeklyNotes.length, "7 天内创建")}
      ${statCard("灵感池", data.notes.filter((item) => item.noteType === "idea").length, "待整理")}
      ${statCard("链接收录", data.notes.filter((item) => item.noteType === "link").length, "参考资料")}
      ${statCard("置顶笔记", data.notes.filter((item) => item.pinned).length, "长期保留")}
    </div>
    <div class="two-col">
      <section class="panel">
        <div class="panel-head">
          <h2>灵感池</h2>
          <span class="results-count">可继续转事项</span>
        </div>
        <div class="list-stack">${ideaNotes.map(noteRow).join("") || emptyState("灵感池还没有内容")}</div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>本周回顾</h2>
          <span class="results-count">最近 7 天的记录</span>
        </div>
        <div class="list-stack">${weeklyNotes.map(noteRow).join("") || emptyState("本周还没有新笔记")}</div>
      </section>
    </div>
    <div class="two-col">
      <section class="panel">
        <div class="panel-head">
          <h2>链接收录</h2>
          <span class="results-count">适合参考网站和资料</span>
        </div>
        <div class="list-stack">${linkNotes.map(noteRow).join("") || emptyState("还没有收录链接")}</div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>Markdown 预览</h2>
          <span class="results-count">完整编辑器中也支持预览</span>
        </div>
        <div class="markdown-preview note-preview-surface">${markdownPreview}</div>
      </section>
    </div>
    <section class="panel">
      <div class="panel-head">
        <h2>全部笔记</h2>
        <span class="results-count">当前筛选共 ${items.length} 条</span>
      </div>
      <div class="list-stack">
        ${items.map(noteRow).join("") || emptyState("暂无符合条件的笔记")}
      </div>
    </section>
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

function renderAnalytics(elements, data, ui) {
  renderControls(elements, data, ui, "analytics");
  const all = filterCollection(getAllItems(data), ui);
  const doneTasks = data.tasks.filter((task) => task.status === "已完成").length;
  const income = data.bills.filter((bill) => bill.type === "收入").reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
  const expense = data.bills.filter((bill) => bill.type === "支出").reduce((sum, bill) => sum + Number(bill.amount || 0), 0);

  elements.contentArea.innerHTML = `
    <section class="panel">
      <div class="stats-grid">
        ${statCard("全部内容", all.length, "当前搜索范围")}
        ${statCard("已完成事项", doneTasks, "任务达成")}
        ${statCard("累计收入", formatCurrency(income), "账单收入")}
        ${statCard("累计支出", formatCurrency(expense), "账单支出")}
      </div>
    </section>
  `;
}

function renderSettings(elements, data, ui) {
  renderControls(elements, data, ui, "settings");
  const notificationSettings = loadSubscriptionNotificationSettings();
  const serverSyncState = loadServerSyncState();
  const moduleStats = [
    ["生活收支", (data.bills || []).length, "可单独清空"],
    ["订阅", (data.subscriptions || []).length, "到期提醒"],
    ["人情往来", (data.favorEvents || []).length, `${(data.contacts || []).length} 位人物`],
    ["笔记 / 收藏", (data.notes || []).length + (data.bookmarks || []).length, "知识资料"],
  ];
  elements.contentArea.innerHTML = `
    <section class="panel settings-hero">
      <div>
        <span class="eyebrow">Local Storage</span>
        <h2>设置与数据安全</h2>
        <p class="panel-copy">当前版本使用浏览器本地存储，适合原型开发和自用验证。执行清空、恢复或大批量导入前，建议先导出备份。</p>
      </div>
      <div class="settings-stat-grid">
        ${moduleStats.map(([label, value, hint]) => statCard(label, value, hint)).join("")}
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
            <span>导出当前浏览器内的全部数据，适合更新前留档。</span>
          </div>
          <button class="ghost-button" id="exportData" type="button">导出 JSON</button>
        </article>
        <article class="settings-action-card">
          <div>
            <strong>恢复演示数据</strong>
            <span>用于回到默认样例，会覆盖当前本地数据。</span>
          </div>
          <button class="ghost-button" id="resetDemo" type="button">恢复示例数据</button>
        </article>
        <article class="settings-action-card settings-action-card--danger">
          <div>
            <strong>清空生活收支</strong>
            <span>只删除生活收支，不影响订阅、人情往来、笔记和收藏。</span>
          </div>
          <button class="ghost-button danger-button" id="clearBillsData" type="button">清空生活收支</button>
        </article>
        <article class="settings-action-card settings-action-card--danger">
          <div>
            <strong>清空全部数据</strong>
            <span>删除所有模块数据，执行前请确认已经导出备份。</span>
          </div>
          <button class="ghost-button danger-button" id="clearData" type="button">清空全部数据</button>
        </article>
      </div>
    </section>

    <section class="panel settings-section server-sync-panel">
      <div class="panel-head">
        <h2>服务器数据同步</h2>
        <span class="results-count">V0.25 数据持久化底座</span>
      </div>
      <p class="panel-copy">用于把当前浏览器数据保存到 VPS 数据卷，或从 VPS 恢复到当前浏览器。读取服务器会覆盖本地数据，执行前建议先导出 JSON。</p>
      <div class="server-sync-grid">
        <label>
          同步密钥
          <input id="serverSyncToken" type="password" placeholder="${serverSyncState.hasToken ? serverSyncState.maskedToken : "输入 VPS 环境变量 PERSONAL_HUB_SYNC_TOKEN"}" autocomplete="off" />
        </label>
        <article class="server-sync-status-card">
          <span>当前浏览器</span>
          <strong>${serverSyncState.hasToken ? "已保存密钥" : "未保存密钥"}</strong>
          <em>${serverSyncState.lastPushedAt ? `最近保存：${escapeHtml(serverSyncState.lastPushedAt)}` : "密钥只保存在当前浏览器，用于访问 /api/data。"}</em>
        </article>
      </div>
      <label class="setting-toggle server-sync-auto-toggle">
        <input id="serverSyncAutoEnabled" type="checkbox" ${serverSyncState.autoEnabled ? "checked" : ""} />
        <span>自动保存到服务器</span>
      </label>
      <div class="settings-action-row">
        <button class="ghost-button" id="checkServerSyncStatus" type="button">检查服务器</button>
        <button class="ghost-button" id="pullServerData" type="button">从服务器读取</button>
        <button class="ghost-button" id="mergeServerData" type="button">合并服务器数据</button>
        <button class="primary-button" id="pushServerData" type="button">保存到服务器</button>
      </div>
    </section>

    <section class="panel settings-section">
      <div class="panel-head">
        <h2>财务数据管理</h2>
        <span class="results-count">微信 / 支付宝 / Excel / CSV</span>
      </div>
      <p class="panel-copy">用于整站财务数据迁移。导入时会自动识别微信、支付宝、生活收支、人情往来、关系人和订阅项目，CSV 会自动处理常见中文编码，并在写入前提示重复账单。</p>
      <div class="finance-import-options">
        <input id="financeImportSource" type="hidden" value="自动识别" />
        <input id="financeImportPayer" type="hidden" value="家庭账户" />
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
    <section class="panel settings-section">
      <div class="panel-head"><h2>当前升级进度</h2></div>
      <div class="settings-roadmap-list">
        ${noteRow({
          id: "roadmap-1",
          title: "V0.22 稳定上线版",
          description: "当前阶段：检查线上稳定性、统一 UI、清理明显错误、整理设置面板与部署前检查。",
          category: "进行中",
          tags: ["稳定", "上线"],
          updatedAt: "当前推进",
        })}
        ${noteRow({
          id: "roadmap-2",
          title: "V0.23 生活收支增强版",
          description: "下一阶段：支付宝 / 微信导入、男女双方归属、历史月份、家庭消费动向与房贷压力分析。",
          category: "下一版本",
          tags: ["生活收支", "规划"],
          updatedAt: "待开发",
        })}
        ${noteRow({
          id: "roadmap-3",
          title: "V0.24 订阅管理成熟版",
          description: "订阅到期提醒、邮件通知、年度成本、支付渠道和归属分类。",
          category: "后续版本",
          tags: ["订阅", "提醒"],
          updatedAt: "待开发",
        })}
        ${noteRow({
          id: "roadmap-4",
          title: "V0.25 数据安全与真实登录版",
          description: "真实账号、数据库持久化、Docker 数据卷、自动备份与恢复。",
          category: "后续版本",
          tags: ["登录", "数据库"],
          updatedAt: "待开发",
        })}
      </div>
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
        ${Object.entries(item)
          .filter(([key]) => !["id", "title", "description", "tags", "entryType"].includes(key))
          .slice(0, 10)
          .map(([key, value]) => `<span class="tag">${escapeHtml(key)}: ${escapeHtml(Array.isArray(value) ? value.join(", ") : value)}</span>`)
          .join("")}
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
      const current = navItems.find((item) => item.id === app.ui.activePage) || navItems[0];
      const recentViews = app.store.getRecentViews();

      elements.pageTitle.textContent = current.label;
      elements.pageEyebrow.textContent = current.eyebrow;
      elements.globalSearch.value = app.ui.searchTerm;

      renderNav(elements, app.ui);
      updateProgress(elements, data);

      const pageRenderers = {
        dashboard: () => renderDashboard(elements, data, app.ui, recentViews),
        tasks: () => renderTasks(elements, data, app.ui),
        bills: () => renderBills(elements, data, app.ui, app.store),
        subscriptions: () => renderSubscriptions(elements, data, app.ui, app.store),
        favors: () => renderFavors(elements, data, app.ui, app.store),
        notes: () => renderNotes(elements, data, app.ui),
        collections: () => renderCollections(elements, data, app.ui, app.store),
        favorites: () => renderFavorites(elements, data, app.ui),
        analytics: () => renderAnalytics(elements, data, app.ui),
        settings: () => renderSettings(elements, data, app.ui),
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




