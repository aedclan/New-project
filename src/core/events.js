import { DEFAULT_SORT_BY_PAGE, THEME_KEY, UI_STATE_KEY } from "../config/constants.js";
import {
  getSubscriptionsDueForNotification,
  loadSubscriptionNotificationSettings,
  postSubscriptionEmail,
  requestBrowserNotificationPermission,
  runBrowserSubscriptionNotifications,
  saveSubscriptionNotificationSettings,
} from "./subscription-notifications.js";
import {
  checkServerSyncStatus,
  formatHubDataSummary,
  pullServerData,
  pushServerData,
  summarizeHubData,
} from "./server-sync.js";
import {
  changeServerPassword,
  listServerUsers,
  migrateServerUserData,
  resendServerUserVerification,
  resetServerUserPassword,
  updateServerUserEmail,
  updateServerUserStatus,
  verifyServerUserEmail,
} from "./server-auth.js";
import { applyAuthCoverImage, resetAuthCoverImage, saveAuthCoverImage } from "./auth-cover.js";
import { buildFinanceAiSummary, requestFinanceAiAnalysis, requestFinanceQuestion } from "./finance-ai.js";
import { renderMarkdown } from "./utils.js";

const FINANCE_QA_FLOAT_POSITION_KEY = "personal-hub-finance-qa-float-position";
const FINANCE_QA_AVATAR_KEY = "personal-hub-finance-qa-avatar";

function createDefaultFilters() {
  return {
    type: "all",
    status: "all",
    tag: "all",
    favoriteOnly: false,
  };
}

function persistUiState(ui) {
  localStorage.setItem(
    UI_STATE_KEY,
    JSON.stringify({
      activePage: ui.activePage,
      searchTerm: ui.searchTerm,
      sortBy: ui.sortBy,
    }),
  );
}

function toDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateValue(value) {
  const match = String(value || "").match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function createDatePicker() {
  const picker = document.createElement("div");
  picker.className = "date-picker";
  picker.hidden = true;
  document.body.appendChild(picker);

  let activeInput = null;
  let viewDate = new Date();
  let pickerMode = "day";

  function close() {
    picker.hidden = true;
    activeInput = null;
  }

  function selectDate(date) {
    if (!activeInput) return;
    activeInput.value = toDateValue(date);
    activeInput.dispatchEvent(new Event("input", { bubbles: true }));
    activeInput.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  }

  function render() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const selectedValue = activeInput?.value || "";
    const todayValue = toDateValue(new Date());
    const firstDay = new Date(year, month, 1);
    const start = new Date(firstDay);
    start.setDate(firstDay.getDate() - firstDay.getDay());
    const days = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const value = toDateValue(date);
      const outside = date.getMonth() !== month ? " date-picker__day--outside" : "";
      const selected = value === selectedValue ? " date-picker__day--selected" : "";
      const today = value === todayValue ? " date-picker__day--today" : "";
      return `<button class="date-picker__day${outside}${selected}${today}" data-date-value="${value}" type="button">${date.getDate()}</button>`;
    }).join("");
    const years = Array.from({ length: 21 }, (_, index) => year - 10 + index)
      .map((item) => {
        const selected = item === year ? " date-picker__choice--selected" : "";
        return `<button class="date-picker__choice${selected}" data-date-year="${item}" type="button">${item}</button>`;
      })
      .join("");
    const months = Array.from({ length: 12 }, (_, index) => {
      const selected = index === month ? " date-picker__choice--selected" : "";
      return `<button class="date-picker__choice${selected}" data-date-month="${index}" type="button">${String(index + 1).padStart(2, "0")}月</button>`;
    })
      .join("");
    const panel =
      pickerMode === "year"
        ? `<div class="date-picker__choice-grid date-picker__choice-grid--years">${years}</div>`
        : pickerMode === "month"
          ? `<div class="date-picker__choice-grid">${months}</div>`
          : `
            <div class="date-picker__week">
              <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
            </div>
            <div class="date-picker__grid">${days}</div>
          `;

    picker.innerHTML = `
      <div class="date-picker__head">
        <div class="date-picker__selects">
          <button class="date-picker__scope ${pickerMode === "year" ? "is-active" : ""}" data-date-mode="year" type="button">${year}年<span></span></button>
          <button class="date-picker__scope ${pickerMode === "month" ? "is-active" : ""}" data-date-mode="month" type="button">${String(month + 1).padStart(2, "0")}月<span></span></button>
        </div>
        <div>
          <button data-date-nav="-1" type="button" aria-label="上一月">‹</button>
          <button data-date-nav="1" type="button" aria-label="下一月">›</button>
        </div>
      </div>
      ${panel}
      <div class="date-picker__actions">
        <button data-date-clear type="button">清除</button>
        <button data-date-today type="button">今天</button>
      </div>
    `;
  }

  function open(input) {
    activeInput = input;
    viewDate = parseDateValue(input.value) || new Date();
    pickerMode = "day";
    render();
    const rect = input.getBoundingClientRect();
    picker.hidden = false;
    const pickerRect = picker.getBoundingClientRect();
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - pickerRect.width - 12);
    const top = rect.bottom + pickerRect.height + 8 > window.innerHeight ? rect.top - pickerRect.height - 8 : rect.bottom + 8;
    picker.style.left = `${left}px`;
    picker.style.top = `${Math.max(12, top)}px`;
  }

  document.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-date-mode]");
    if (modeButton && modeButton.closest(".date-picker")) {
      pickerMode = pickerMode === modeButton.dataset.dateMode ? "day" : modeButton.dataset.dateMode;
      render();
      return;
    }
    const yearButton = event.target.closest("[data-date-year]");
    if (yearButton && yearButton.closest(".date-picker")) {
      viewDate.setFullYear(Number(yearButton.dataset.dateYear));
      pickerMode = "day";
      render();
      return;
    }
    const monthButton = event.target.closest("[data-date-month]");
    if (monthButton && monthButton.closest(".date-picker")) {
      viewDate.setMonth(Number(monthButton.dataset.dateMonth));
      pickerMode = "day";
      render();
      return;
    }
    const nav = event.target.closest("[data-date-nav]");
    if (nav && nav.closest(".date-picker")) {
      viewDate.setMonth(viewDate.getMonth() + Number(nav.dataset.dateNav));
      pickerMode = "day";
      render();
      return;
    }
    if (event.target.closest("[data-date-today]")?.closest(".date-picker")) {
      selectDate(new Date());
      return;
    }
    if (event.target.closest("[data-date-clear]")?.closest(".date-picker")) {
      if (activeInput) {
        activeInput.value = "";
        activeInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      close();
      return;
    }
    const day = event.target.closest("[data-date-value]");
    if (day && day.closest(".date-picker")) {
      selectDate(parseDateValue(day.dataset.dateValue));
      return;
    }

    const input = event.target.closest("[data-date-input]");
    if (input) {
      event.preventDefault();
      open(input);
      return;
    }
    if (!picker.hidden && !event.target.closest(".date-picker")) close();
  });

  document.addEventListener("focusin", (event) => {
    if (event.target.matches("[data-date-input]")) open(event.target);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !picker.hidden) close();
  });
}

function resetPageState(app, nextPage) {
  app.ui.activePage = nextPage;
  app.ui.activeChip = "all";
  app.ui.sortBy = DEFAULT_SORT_BY_PAGE[nextPage] || "updated-desc";
  app.ui.filters = createDefaultFilters();
}

export function initializeTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme !== "light") {
    document.body.classList.add("dark");
  }
}

export function bindEvents(app, elements, renderer, formController, authController, billExcelController) {
  createDatePicker();

  async function ensureAuth() {
    if (authController.ensureAuth) return authController.ensureAuth();
    return authController.requireAuth();
  }

  function closeTransientOverlays() {
    if (elements.modal?.open) closeEntryModal();
    renderer.closeDrawer();
  }

  let billLedgerReturnMonth = "";

  function getActiveBillLedgerMonth(modal = document.querySelector("#billLedgerModal")) {
    return modal?.querySelector("[data-bill-ledger-month].is-active")?.dataset.billLedgerMonth || app.ui.filters.billMonth || "";
  }

  function reopenBillLedgerPanel() {
    if (!billLedgerReturnMonth) return false;
    const month = billLedgerReturnMonth;
    billLedgerReturnMonth = "";
    if (month) app.ui.filters.billMonth = month;
    requestAnimationFrame(() => {
      document.querySelector("#billLedgerModal")?.showModal();
    });
    return true;
  }

  function closeEntryModal() {
    formController.close();
    reopenBillLedgerPanel();
  }

  function getFinanceQaFloatPosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(FINANCE_QA_FLOAT_POSITION_KEY) || "null");
      if (!saved || typeof saved !== "object") return null;
      const x = Number(saved.x);
      const y = Number(saved.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    } catch {
      return null;
    }
  }

  function saveFinanceQaFloatPosition(position) {
    localStorage.setItem(FINANCE_QA_FLOAT_POSITION_KEY, JSON.stringify(position));
  }

  function clampFinanceQaFloatPosition(button, position) {
    const margin = 12;
    const width = button.offsetWidth || 120;
    const height = button.offsetHeight || 56;
    const maxX = Math.max(margin, window.innerWidth - width - margin);
    const maxY = Math.max(margin, window.innerHeight - height - margin);
    return {
      x: Math.min(Math.max(position.x, margin), maxX),
      y: Math.min(Math.max(position.y, margin), maxY),
    };
  }

  function applyFinanceQaFloatPosition() {
    const button = document.querySelector("[data-finance-qa-float]");
    if (!button) return;
    const saved = getFinanceQaFloatPosition();
    if (!saved) return;
    const position = clampFinanceQaFloatPosition(button, saved);
    button.style.left = `${position.x}px`;
    button.style.top = `${position.y}px`;
    button.style.right = "auto";
    button.style.bottom = "auto";
  }

  function applyFinanceQaAvatar(root = document) {
    const avatarUrl = localStorage.getItem(FINANCE_QA_AVATAR_KEY) || "";
    root.querySelectorAll("[data-finance-qa-avatar]").forEach((avatar) => {
      avatar.classList.toggle("has-custom-avatar", Boolean(avatarUrl));
      avatar.style.backgroundImage = avatarUrl ? `url("${avatarUrl.replace(/"/g, "%22")}")` : "";
    });
  }

  function saveFinanceQaAvatar(file) {
    if (!file || !file.type?.startsWith("image/")) {
      window.alert("请选择图片、GIF 或 WebP 作为头像。");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      window.alert("头像图片建议小于 2MB，避免本地存储过大。");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      localStorage.setItem(FINANCE_QA_AVATAR_KEY, String(reader.result || ""));
      applyFinanceQaAvatar();
    });
    reader.readAsDataURL(file);
  }

  function bindFinanceQaFloatDrag() {
    let dragState = null;

    document.addEventListener("pointerdown", (event) => {
      const button = event.target.closest("[data-finance-qa-float]");
      if (!button || event.button !== 0) return;
      const rect = button.getBoundingClientRect();
      dragState = {
        button,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: rect.left,
        originY: rect.top,
        moved: false,
      };
      button.setPointerCapture?.(event.pointerId);
      button.classList.add("is-dragging");
    });

    document.addEventListener("pointermove", (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      if (Math.hypot(dx, dy) > 5) dragState.moved = true;
      const position = clampFinanceQaFloatPosition(dragState.button, {
        x: dragState.originX + dx,
        y: dragState.originY + dy,
      });
      dragState.button.style.left = `${position.x}px`;
      dragState.button.style.top = `${position.y}px`;
      dragState.button.style.right = "auto";
      dragState.button.style.bottom = "auto";
      if (dragState.moved) {
        dragState.button.dataset.financeQaDragged = "true";
        event.preventDefault();
      }
    });

    function finishDrag(event) {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const { button, moved } = dragState;
      button.releasePointerCapture?.(event.pointerId);
      button.classList.remove("is-dragging");
      if (moved) {
        const rect = button.getBoundingClientRect();
        const position = clampFinanceQaFloatPosition(button, { x: rect.left, y: rect.top });
        saveFinanceQaFloatPosition(position);
        button.dataset.financeQaDragged = "true";
      }
      dragState = null;
    }

    document.addEventListener("pointerup", finishDrag);
    document.addEventListener("pointercancel", finishDrag);
    window.addEventListener("resize", applyFinanceQaFloatPosition);
  }

  const renderWithFinanceQaFloat = renderer.render.bind(renderer);
  renderer.render = () => {
    renderWithFinanceQaFloat();
    requestAnimationFrame(() => {
      applyFinanceQaFloatPosition();
      applyFinanceQaAvatar();
    });
  };
  bindFinanceQaFloatDrag();

  const billTrendScopes = ["year", "month", "week", "day"];

  function getDefaultBillTrendZoomForScope(scope) {
    if (scope !== "day") return { start: 0, end: 100 };
    const month = app.ui.filters.billMonth || new Date().toISOString().slice(0, 7);
    const [year, monthIndex] = String(month).split("-").map(Number);
    const daysInMonth = year && monthIndex ? new Date(year, monthIndex, 0).getDate() : 30;
    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const activeDay = currentMonth === month ? today.getDate() : Math.ceil(daysInMonth / 2);
    const span = Math.min(34, Math.max(18, (8 / Math.max(daysInMonth, 1)) * 100));
    const center = ((Math.min(Math.max(activeDay, 1), daysInMonth) - 0.5) / daysInMonth) * 100;
    const start = Math.min(Math.max(center - span / 2, 0), 100 - span);
    return { start, end: start + span };
  }

  function setBillTrendScope(nextScope, zoomWindow = null) {
    const normalizedScope = billTrendScopes.includes(nextScope) ? nextScope : "month";
    const zoom = zoomWindow || getDefaultBillTrendZoomForScope(normalizedScope);
    app.ui.filters.billTrendScope = normalizedScope;
    app.ui.filters.billTrendRange = normalizedScope === "year" ? 5 : 6;
    app.ui.filters.billTrendZoomStart = zoom.start;
    app.ui.filters.billTrendZoomEnd = zoom.end;
    delete app.ui.filters.billTrendHiddenSeries;
    persistUiState(app.ui);
    renderer.render();
  }

  function normalizeBillTrendZoomWindow(start, end) {
    const normalizedStart = Math.min(Math.max(Number(start) || 0, 0), 96);
    const normalizedEnd = Math.min(Math.max(Number(end) || 100, normalizedStart + 4), 100);
    return { start: normalizedStart, end: normalizedEnd };
  }

  function setBillTrendZoomWindow(start, end, options = {}) {
    const { persist = true, render = true } = options;
    const normalized = normalizeBillTrendZoomWindow(start, end);
    const normalizedStart = normalized.start;
    const normalizedEnd = normalized.end;
    const previousStart = Number(app.ui.filters.billTrendZoomStart ?? 0);
    const previousEnd = Number(app.ui.filters.billTrendZoomEnd ?? 100);
    if (Math.abs(previousStart - normalizedStart) < 0.01 && Math.abs(previousEnd - normalizedEnd) < 0.01) return;
    app.ui.filters.billTrendZoomStart = normalizedStart;
    app.ui.filters.billTrendZoomEnd = normalizedEnd;
    if (persist) persistUiState(app.ui);
    if (render) renderer.render();
  }

  function resetBillTrendZoom() {
    app.ui.filters.billTrendZoomStart = 0;
    app.ui.filters.billTrendZoomEnd = 100;
    persistUiState(app.ui);
    renderer.render();
  }

  let billTrendWheelFrame = 0;
  let billTrendWheelPayload = null;
  let billTrendWheelDelta = 0;

  function zoomBillTrendFromWheel(event, chart) {
    const currentStart = Number(app.ui.filters.billTrendZoomStart ?? 0);
    const currentEnd = Number(app.ui.filters.billTrendZoomEnd ?? 100);
    const currentSpan = Math.max(currentEnd - currentStart, 4);
    const rect = chart.getBoundingClientRect();
    const pointerRatio = rect.width > 0 ? Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1) : 0.5;
    const zoomingIn = event.deltaY < 0;
    const wheelStrength = Math.min(Math.abs(event.deltaY), 180);
    const zoomFactor = Math.exp((zoomingIn ? -1 : 1) * wheelStrength * 0.0022);
    const nextSpan = Math.min(Math.max(currentSpan * zoomFactor, 4), 100);
    const center = currentStart + currentSpan * pointerRatio;
    const nextStart = Math.min(Math.max(center - nextSpan * pointerRatio, 0), 100 - nextSpan);
    const nextEnd = nextStart + nextSpan;
    const currentScope = app.ui.filters.billTrendScope || "month";
    const currentIndex = Math.max(0, billTrendScopes.indexOf(currentScope));

    if (zoomingIn && currentSpan <= 10 && currentIndex < billTrendScopes.length - 1) {
      const nextScope = billTrendScopes[currentIndex + 1];
      const nextZoom = nextScope === "day" ? getDefaultBillTrendZoomForScope(nextScope) : { start: nextStart, end: nextEnd };
      setBillTrendScope(nextScope, nextZoom);
      return;
    }
    if (!zoomingIn && currentSpan >= 99 && currentIndex > 0) {
      setBillTrendScope(billTrendScopes[currentIndex - 1]);
      return;
    }
    setBillTrendZoomWindow(nextStart, nextEnd);
  }

  function scheduleBillTrendWheelZoom(event, chart) {
    billTrendWheelDelta += event.deltaY;
    billTrendWheelPayload = {
      clientX: event.clientX,
      deltaY: billTrendWheelDelta,
      chart,
    };
    if (billTrendWheelFrame) return;
    billTrendWheelFrame = requestAnimationFrame(() => {
      const payload = billTrendWheelPayload;
      billTrendWheelFrame = 0;
      billTrendWheelPayload = null;
      billTrendWheelDelta = 0;
      if (!payload?.chart?.isConnected) return;
      zoomBillTrendFromWheel(payload, payload.chart);
    });
  }

  const billTrendTooltip = document.createElement("div");
  billTrendTooltip.className = "bill-trend-tooltip";
  billTrendTooltip.hidden = true;
  document.body.appendChild(billTrendTooltip);

  function hideBillTrendTooltip() {
    billTrendTooltip.hidden = true;
    billTrendTooltip.classList.remove("is-visible");
    document.querySelector(".bill-trend-panel.is-focusing-series")?.classList.remove("is-focusing-series");
    document.querySelectorAll(".bill-trend-panel [data-bill-trend-series].is-active-series").forEach((node) => node.classList.remove("is-active-series"));
    document.querySelectorAll(".bill-trend-cursor-line").forEach((node) => {
      node.hidden = true;
      node.classList.remove("is-visible");
    });
  }

  function moveBillTrendTooltip(event) {
    const target = event.target.closest?.("[data-bill-trend-tooltip]");
    if (!target) {
      hideBillTrendTooltip();
      return;
    }
    const panel = target.closest(".bill-trend-panel");
    const seriesId = target.dataset.billTrendSeries || "";
    const cursorX = target.dataset.billTrendCursorX;
    if (panel && seriesId) {
      panel.classList.add("is-focusing-series");
      panel.querySelectorAll("[data-bill-trend-series]").forEach((node) => node.classList.toggle("is-active-series", node.dataset.billTrendSeries === seriesId));
    }
    if (panel && cursorX) {
      const cursorLine = panel.querySelector(".bill-trend-cursor-line");
      if (cursorLine) {
        cursorLine.setAttribute("x1", cursorX);
        cursorLine.setAttribute("x2", cursorX);
        cursorLine.hidden = false;
        cursorLine.classList.add("is-visible");
      }
    }
    const parts = String(target.dataset.billTrendTooltip || "").split(" · ");
    const title = parts[0] || "趋势";
    const meta = parts.slice(1).join(" · ");
    const detailLines = String(target.dataset.billTrendTooltipLines || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const detailHtml = detailLines
      .map((line) => {
        const [type, ...textParts] = line.split("|");
        const text = textParts.length ? textParts.join("|") : type;
        const valueMatch = text.match(/(¥[\d,.-]+|[-+]?\d+(?:\.\d+)?%?)$/);
        const label = valueMatch ? text.slice(0, valueMatch.index).trim() : text;
        const value = valueMatch ? valueMatch[0] : "";
        const normalizedType = String(textParts.length ? type : "default").replace(/[^\w-]/g, "");
        return `
          <em class="bill-trend-tooltip__line--${escapeHtml(normalizedType)}">
            <i></i>
            <b>${escapeHtml(label || text)}</b>
            ${value ? `<strong>${escapeHtml(value)}</strong>` : ""}
          </em>
        `;
      })
      .join("");
    billTrendTooltip.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
      ${detailLines.length ? `<div class="bill-trend-tooltip__grid">${detailHtml}</div>` : ""}
    `;
    billTrendTooltip.hidden = false;
    billTrendTooltip.classList.add("is-visible");

    const margin = 14;
    const width = billTrendTooltip.offsetWidth || 180;
    const height = billTrendTooltip.offsetHeight || 50;
    const x = Math.min(Math.max(event.clientX, width / 2 + margin), window.innerWidth - width / 2 - margin);
    const y = Math.min(Math.max(event.clientY, height + margin), window.innerHeight - margin);
    billTrendTooltip.style.left = `${Math.round(x)}px`;
    billTrendTooltip.style.top = `${Math.round(y)}px`;
  }

  function showBillTrendProblemDialog(target) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal bill-trend-problem-modal";
    const title = target.dataset.problemTitle || "趋势异常";
    const period = target.dataset.problemPeriod || "当前节点";
    const label = target.dataset.problemLabel || "异常点";
    const basis = target.dataset.problemBasis || "当前节点触发异常规则。";
    const action = target.dataset.problemAction || "建议复核该时间点的账单。";
    const income = target.dataset.problemIncome || "¥0";
    const expense = target.dataset.problemExpense || "¥0";
    const balance = target.dataset.problemBalance || "¥0";
    dialog.innerHTML = `
      <section class="modal-panel bill-trend-problem-panel">
        <div class="drawer-head">
          <div>
            <span class="eyebrow">TREND ALERT</span>
            <h2>${escapeHtml(title)}</h2>
          </div>
          <button class="icon-button" data-close-trend-problem type="button" aria-label="关闭">×</button>
        </div>
        <div class="bill-trend-problem-body">
          <article class="bill-trend-problem-hero">
            <span>${escapeHtml(period)}</span>
            <strong>${escapeHtml(label)}</strong>
          </article>
          <div class="bill-trend-problem-metrics">
            <article><span>收入</span><strong class="is-income">${escapeHtml(income)}</strong></article>
            <article><span>支出</span><strong class="is-expense">${escapeHtml(expense)}</strong></article>
            <article><span>结余</span><strong>${escapeHtml(balance)}</strong></article>
          </div>
          <div class="bill-trend-problem-grid">
            <article>
              <span>判断依据</span>
              <p>${escapeHtml(basis)}</p>
            </article>
            <article>
              <span>处理建议</span>
              <p>${escapeHtml(action)}</p>
            </article>
          </div>
        </div>
      </section>
    `;
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close-trend-problem]")) close();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  function getBillActionDetailBasis(label, tone) {
    if (label === "预算") return "来自分类预算建议，优先处理最容易拉高本月支出的类别。";
    if (label === "节奏" || label === "额度") return "来自本月收入、已用预算、剩余天数和动态可支配额度。";
    if (label === "计划") return "来自未来计划金额与当前结余，用于提前安排资金储备。";
    if (label === "订阅") return "来自本月订阅和续费项目，避免固定支出继续堆高。";
    if (label === "延续") return "来自上月未完成行动项，本月需要继续跟进。";
    if (tone === "risk") return "来自风险提醒，当前项目可能影响本月现金流或预算判断。";
    if (tone === "watch") return "来自关注项，建议本月持续观察并控制节奏。";
    return "来自本月收支分析、预算节奏和月度复盘建议。";
  }

  function getBillActionDetailFollow(label, status) {
    if (status === "已完成") return "已完成后月底复盘时保留结果，方便对比行动是否有效。";
    if (label === "预算" || label === "节奏" || label === "额度") return "建议每周检查一次，发现超前支出后及时调低后续日均额度。";
    if (label === "计划") return "建议把预留金额写入未来计划，按月确认是否已经准备。";
    if (label === "订阅") return "建议逐项核对必要性，暂停新增订阅，并在续费前再次确认。";
    return "处理后把状态改为进行中或已完成，月底生成月报时会一并记录。";
  }

  function showBillActionDetailDialog(target) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal bill-action-detail-modal";
    const id = target.dataset.actionId || "";
    const month = target.dataset.actionMonth || "";
    const label = target.dataset.actionLabel || "行动";
    const title = target.dataset.actionTitle || "行动详情";
    const text = target.dataset.actionText || "暂无处理说明。";
    const metric = target.dataset.actionMetric || "待处理";
    const tone = target.dataset.actionTone || "good";
    const status = target.dataset.actionStatus || "待处理";
    const nextStatus = target.dataset.actionNextStatus || "进行中";
    const date = target.dataset.actionDate || "";
    const statusText = date ? `${status} · ${date}` : status;
    const basis = getBillActionDetailBasis(label, tone);
    const follow = getBillActionDetailFollow(label, status);
    const toneLabel = tone === "risk" ? "高优先级" : tone === "watch" ? "需关注" : "稳定执行";
    dialog.innerHTML = `
      <section class="modal-panel bill-action-detail-panel bill-action-detail-panel--${escapeHtml(tone)}">
        <div class="drawer-head">
          <div>
            <span class="eyebrow">ACTION DETAIL</span>
            <h2>${escapeHtml(title)}</h2>
          </div>
          <button class="icon-button" data-close-bill-action-detail type="button" aria-label="关闭">×</button>
        </div>
        <div class="bill-action-detail-body">
          <article class="bill-action-detail-hero">
            <span>${escapeHtml(month)} · ${escapeHtml(label)}</span>
            <strong>${escapeHtml(toneLabel)}</strong>
            <p>${escapeHtml(text)}</p>
          </article>
          <div class="bill-action-detail-metrics">
            <article><span>目标指标</span><strong>${escapeHtml(metric)}</strong></article>
            <article><span>当前状态</span><strong>${escapeHtml(statusText)}</strong></article>
          </div>
          <div class="bill-action-detail-grid">
            <article>
              <span>需要处理</span>
              <p>${escapeHtml(text)}</p>
            </article>
            <article>
              <span>判断依据</span>
              <p>${escapeHtml(basis)}</p>
            </article>
            <article>
              <span>建议动作</span>
              <p>${escapeHtml(text)}</p>
            </article>
            <article>
              <span>跟进方式</span>
              <p>${escapeHtml(follow)}</p>
            </article>
          </div>
          <div class="bill-action-detail-actions">
            <button
              class="bill-action-status"
              data-bill-action-status="${escapeHtml(id)}"
              data-bill-action-month="${escapeHtml(month)}"
              data-next-status="${escapeHtml(nextStatus)}"
              type="button"
            >标记为${escapeHtml(nextStatus)}</button>
            <button class="ghost-button" data-close-bill-action-detail type="button">关闭</button>
          </div>
        </div>
      </section>
    `;
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close-bill-action-detail]")) close();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  function showBillForecastDetailDialog(target) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal bill-forecast-detail-modal";
    const title = target.dataset.forecastTitle || "预测详情";
    const value = target.dataset.forecastValue || "";
    const text = target.dataset.forecastText || "";
    const basis = target.dataset.forecastBasis || "基于全库历史账单、近期趋势和已知未来压力计算。";
    let samples = [];
    try {
      samples = JSON.parse(target.dataset.forecastSamples || "[]");
    } catch {
      samples = [];
    }
    dialog.innerHTML = `
      <section class="modal-panel bill-forecast-detail-panel">
        <div class="drawer-head">
          <div>
            <span class="eyebrow">FORECAST DETAIL</span>
            <h2>${escapeHtml(title)}</h2>
          </div>
          <button class="icon-button" data-close-bill-forecast-detail type="button" aria-label="关闭">×</button>
        </div>
        <div class="bill-forecast-detail-body">
          <article class="bill-forecast-detail-hero">
            <span>预测结果</span>
            <strong>${escapeHtml(value)}</strong>
            <p>${escapeHtml(text)}</p>
          </article>
          <div class="bill-forecast-detail-grid">
            <article>
              <span>判断依据</span>
              <p>${escapeHtml(basis)}</p>
            </article>
            <article>
              <span>使用口径</span>
              <p>全库历史月均值作为基线，近 3 月趋势作为修正，未来计划和订阅作为已知压力。</p>
            </article>
          </div>
          ${
            samples.length
              ? `<div class="bill-forecast-sample-list">
                  <div class="bill-forecast-sample-list__head">
                    <span>校准样本</span>
                    <strong>最近 ${escapeHtml(String(samples.length))} 个月</strong>
                  </div>
                  ${samples.map((item) => `
                    <article class="${item.used === false ? "is-excluded" : "is-used"}">
                      <div>
                        <strong>${escapeHtml(item.month || "未记录")}</strong>
                        <span>${escapeHtml(item.used === false ? `已排除 · ${item.excludeReason || "样本异常"}` : `已采用 · ${item.cause || item.level || "已验证"}`)}</span>
                      </div>
                      <dl>
                        <div><dt>预测结余</dt><dd>${formatReportCurrency(item.predictedBalance)}</dd></div>
                        <div><dt>实际结余</dt><dd>${formatReportCurrency(item.actualBalance)}</dd></div>
                        <div><dt>结余偏差</dt><dd class="${Number(item.balanceDelta || 0) < 0 ? "is-risk" : "is-good"}">${formatReportCurrency(item.balanceDelta)}</dd></div>
                      </dl>
                    </article>
                  `).join("")}
                </div>`
              : ""
          }
        </div>
      </section>
    `;
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close-bill-forecast-detail]")) close();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  async function showFinanceAiAnalysisDialog(month) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal finance-ai-analysis-modal";
    dialog.innerHTML = `
      <section class="modal-panel finance-ai-analysis-panel">
        <div class="drawer-head">
          <div>
            <span class="eyebrow">AI ANALYSIS</span>
            <h2>${escapeHtml(month)} 智能分析</h2>
          </div>
          <button class="icon-button" data-close-finance-ai-analysis type="button" aria-label="关闭">×</button>
        </div>
        <div class="finance-ai-analysis-body">
          <article class="finance-ai-loading">正在分析聚合后的财务数据...</article>
        </div>
      </section>
    `;
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close-finance-ai-analysis]")) close();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    document.body.appendChild(dialog);
    dialog.showModal();

    const body = dialog.querySelector(".finance-ai-analysis-body");
    try {
      const summary = buildFinanceAiSummary(app.store.getData(), month);
      const result = await requestFinanceAiAnalysis(summary);
      const modeLabel = result.mode === "local-rule" ? "本地智能分析" : "AI 智能分析";
      const privacyLabel = result.privacyMode === "local-only" ? "本地聚合计算" : "聚合摘要分析";
      const aiActionDecisions = ((app.store.getData().budgets || {}).billAiActionDecisions || {})[summary.month] || {};
      body.innerHTML = `
        <article class="finance-ai-hero finance-ai-hero--${escapeHtml(result.tone || "good")}">
          <span>${escapeHtml(modeLabel)}</span>
          <strong>${escapeHtml(result.title || "智能分析")}</strong>
          <p>${escapeHtml(result.conclusion || "暂无分析结论。")}</p>
        </article>
        <div class="finance-ai-source-grid">
          <article><span>隐私口径</span><strong>${escapeHtml(privacyLabel)}</strong><small>${escapeHtml(result.privacyMode === "local-only" ? "不上传原始流水，不调用第三方模型" : "仅发送聚合摘要")}</small></article>
          <article><span>数据范围</span><strong>${escapeHtml(summary.month)}</strong><small>收入、支出、预算、分类、预测区间</small></article>
          <article><span>可信度</span><strong>${escapeHtml(summary.dataQuality?.confidence || "-")}</strong><small>数据质量 ${escapeHtml(String(summary.dataQuality?.score ?? "-"))} 分</small></article>
        </div>
        ${
          result.riskBreakdown
            ? `<section class="finance-ai-risk-score finance-ai-risk-score--${escapeHtml(result.tone || "good")}">
                <div>
                  <span>综合风险</span>
                  <strong>${escapeHtml(result.riskBreakdown.level || "-")}</strong>
                  <small>${escapeHtml(String(result.riskBreakdown.total ?? "-"))} / 100</small>
                </div>
                <div class="finance-ai-risk-score__rows">
                  ${(result.riskBreakdown.rows || []).map((item) => `
                    <article>
                      <span>${escapeHtml(item.label || "-")}</span>
                      <strong>${escapeHtml(String(item.score ?? 0))}</strong>
                      <p>${escapeHtml(item.text || "")}</p>
                    </article>
                  `).join("")}
                </div>
              </section>`
            : ""
        }
        ${
          result.priorityActions?.length
            ? `<section class="finance-ai-priority-actions">
                <h3>优先处理</h3>
                <div>
                  ${result.priorityActions.map((item) => `
                    <article class="finance-ai-priority-action-card finance-ai-priority-action-card--${escapeHtml(aiActionDecisions[item.key]?.decision || "new")}">
                      <span>P${escapeHtml(String(item.rank || ""))} · ${escapeHtml(item.label || "-")}${aiActionDecisions[item.key]?.decision === "adopted" ? " · 已采纳" : aiActionDecisions[item.key]?.decision === "ignored" ? " · 已忽略" : ""}</span>
                      <strong>${escapeHtml(item.action || "")}</strong>
                      <p>${escapeHtml(item.reason || "")}</p>
                      <div class="finance-ai-priority-action-card__actions">
                        <button
                          class="ghost-button"
                          data-finance-ai-action-decision="adopted"
                          data-ai-action-month="${escapeHtml(summary.month)}"
                          data-ai-action-key="${escapeHtml(item.key || "")}"
                          data-ai-action-label="${escapeHtml(item.label || "AI")}"
                          data-ai-action-title="${escapeHtml(item.title || `${item.label || "AI"}行动`)}"
                          data-ai-action-text="${escapeHtml(item.action || "")}"
                          data-ai-action-metric="${escapeHtml(`P${item.rank || ""} · ${item.score || 0}分`)}"
                          data-ai-action-score="${escapeHtml(String(item.score || 0))}"
                          data-ai-action-reason="${escapeHtml(item.reason || "")}"
                          type="button"
                        >采纳</button>
                        <button
                          class="ghost-button"
                          data-finance-ai-action-decision="modify"
                          data-ai-action-month="${escapeHtml(summary.month)}"
                          data-ai-action-key="${escapeHtml(item.key || "")}"
                          data-ai-action-label="${escapeHtml(item.label || "AI")}"
                          data-ai-action-title="${escapeHtml(item.title || `${item.label || "AI"}行动`)}"
                          data-ai-action-text="${escapeHtml(item.action || "")}"
                          data-ai-action-metric="${escapeHtml(`P${item.rank || ""} · ${item.score || 0}分`)}"
                          data-ai-action-score="${escapeHtml(String(item.score || 0))}"
                          data-ai-action-reason="${escapeHtml(item.reason || "")}"
                          type="button"
                        >修改采纳</button>
                        <button
                          class="ghost-button"
                          data-finance-ai-action-decision="ignored"
                          data-ai-action-month="${escapeHtml(summary.month)}"
                          data-ai-action-key="${escapeHtml(item.key || "")}"
                          data-ai-action-label="${escapeHtml(item.label || "AI")}"
                          data-ai-action-title="${escapeHtml(item.title || `${item.label || "AI"}行动`)}"
                          data-ai-action-text="${escapeHtml(item.action || "")}"
                          data-ai-action-metric="${escapeHtml(`P${item.rank || ""} · ${item.score || 0}分`)}"
                          data-ai-action-score="${escapeHtml(String(item.score || 0))}"
                          data-ai-action-reason="${escapeHtml(item.reason || "")}"
                          type="button"
                        >忽略</button>
                      </div>
                    </article>
                  `).join("")}
                </div>
              </section>`
            : ""
        }
        <section class="finance-ai-evidence">
          <h3>判断依据</h3>
          <div>
            ${(result.evidence || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("") || "<p>暂无可核对依据。</p>"}
          </div>
        </section>
        <div class="finance-ai-grid">
          <section>
            <h3>风险解释</h3>
            ${(result.risks || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("") || "<p>暂无明显风险。</p>"}
          </section>
          <section>
            <h3>建议动作</h3>
            ${(result.actions || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("") || "<p>继续保持记录完整。</p>"}
          </section>
        </div>
        <section class="finance-ai-note">
          <h3>分析口径</h3>
          <p>当前只在本地使用月度聚合数据、分类汇总、预测区间和情景结果进行判断，不上传原始流水明细。后续如需接入大模型 API，需要单独确认授权。</p>
        </section>
      `;
    } catch (error) {
      body.innerHTML = `<article class="finance-ai-loading is-error">${escapeHtml(error.message || "智能分析失败。")}</article>`;
    }
  }

  function renderFinanceQaResult(result, month) {
    return `
      <article class="finance-qa-answer">
        <span>意图：${escapeHtml(result.intent || "general")}</span>
        <strong>${escapeHtml(result.answer || "暂无回答。")}</strong>
      </article>
      <div class="finance-qa-detail-grid">
        <section>
          <h3>数据依据</h3>
          ${(result.evidence || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("") || "<p>暂无依据。</p>"}
        </section>
        <section>
          <h3>计算过程</h3>
          ${(result.calculations || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("") || "<p>暂无计算。</p>"}
        </section>
      </div>
      ${
        result.actions?.length
          ? `<section class="finance-qa-actions">
              <h3>可采纳行动</h3>
              <div>
                ${result.actions.map((item, index) => `
                  <article>
                    <span>A${index + 1} · ${escapeHtml(item.title || "问答行动")}</span>
                    <strong>${escapeHtml(item.action || item.title || "")}</strong>
                    <p>${escapeHtml(item.reason || "")}</p>
                    <button
                      class="ghost-button"
                      data-finance-ai-action-decision="adopted"
                      data-ai-action-month="${escapeHtml(month)}"
                      data-ai-action-key="${escapeHtml(`qa-${item.key || index + 1}`)}"
                      data-ai-action-label="问答"
                      data-ai-action-title="${escapeHtml(item.title || "问答行动")}"
                      data-ai-action-text="${escapeHtml(item.action || item.title || "")}"
                      data-ai-action-metric="${escapeHtml(`问答 · ${Number(item.score || 0)}分`)}"
                      data-ai-action-score="${escapeHtml(String(item.score || 0))}"
                      data-ai-action-reason="${escapeHtml(item.reason || "")}"
                      type="button"
                    >采纳为行动</button>
                  </article>
                `).join("")}
              </div>
            </section>`
          : ""
      }
      ${
        result.followUps?.length
          ? `<section class="finance-qa-followups">
              <h3>可以继续问</h3>
              ${result.followUps.map((item) => `<button class="ghost-button" data-finance-qa-sample="${escapeHtml(item)}" type="button">${escapeHtml(item)}</button>`).join("")}
            </section>`
          : ""
      }
    `;
  }

  function showFinanceQaDialog(month) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal finance-qa-modal";
    const samples = ["为什么这个月风险高？", "钱主要花到哪里了？", "下个月怎么控制？", "如果餐饮减少 20%，结余会变多少？", "哪些订阅可以暂停？", "未来三个月压力大不大？"];
    dialog.innerHTML = `
      <section class="modal-panel finance-qa-panel">
        <div class="drawer-head">
          <div class="finance-qa-title">
            <span class="finance-qa-mascot finance-qa-mascot--panel" data-finance-qa-avatar><i></i></span>
            <div>
              <span class="eyebrow">FINANCE Q&A</span>
              <h2>${escapeHtml(month)} 财务问答助手</h2>
            </div>
          </div>
          <div class="finance-qa-head-actions">
            <label class="ghost-button finance-qa-avatar-upload">
              更换头像
              <input data-finance-qa-avatar-input type="file" accept="image/png,image/jpeg,image/gif,image/webp" />
            </label>
            <button class="ghost-button" data-finance-qa-avatar-reset type="button">恢复默认</button>
            <button class="icon-button" data-close-finance-qa type="button" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="finance-qa-form" data-finance-qa-form>
          <label>
            <span>问题</span>
            <textarea name="question" rows="3" placeholder="直接问你的账本，例如：如果餐饮减少 20%，结余会变多少？"></textarea>
          </label>
          <div class="finance-qa-options">
            <label><input type="checkbox" name="includeTransactions" /> 包含脱敏逐笔流水（仅本次问答，最多 120 条）</label>
          </div>
          <div class="finance-qa-samples">
            ${samples.map((item) => `<button class="ghost-button" data-finance-qa-sample="${escapeHtml(item)}" type="button">${escapeHtml(item)}</button>`).join("")}
          </div>
          <button class="primary-button" type="submit">提问</button>
        </form>
        <div class="finance-qa-result" data-finance-qa-result>
          <article class="finance-ai-loading">默认只发送聚合摘要；勾选后才发送脱敏逐笔流水。</article>
        </div>
      </section>
    `;
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close-finance-qa]")) close();
      if (event.target.closest("[data-finance-qa-avatar-reset]")) {
        localStorage.removeItem(FINANCE_QA_AVATAR_KEY);
        applyFinanceQaAvatar();
      }
      const sample = event.target.closest("[data-finance-qa-sample]");
      if (sample) {
        dialog.querySelector('[name="question"]').value = sample.dataset.financeQaSample || "";
      }
    });
    dialog.addEventListener("change", (event) => {
      if (!event.target.matches("[data-finance-qa-avatar-input]")) return;
      saveFinanceQaAvatar(event.target.files?.[0]);
      event.target.value = "";
    });
    dialog.addEventListener("submit", async (event) => {
      if (!event.target.matches("[data-finance-qa-form]")) return;
      event.preventDefault();
      const form = event.target;
      const resultBox = dialog.querySelector("[data-finance-qa-result]");
      const question = String(new FormData(form).get("question") || "").trim();
      const includeTransactions = Boolean(form.querySelector('[name="includeTransactions"]')?.checked);
      if (!question) {
        resultBox.innerHTML = `<article class="finance-ai-loading is-error">请先输入问题。</article>`;
        return;
      }
      resultBox.innerHTML = `<article class="finance-ai-loading">正在调用大模型分析${includeTransactions ? "（包含脱敏流水）" : "（仅聚合摘要）"}...</article>`;
      try {
        const summary = buildFinanceAiSummary(app.store.getData(), month, { includeTransactions });
        const result = await requestFinanceQuestion(question, summary);
        resultBox.innerHTML = renderFinanceQaResult(result, summary.month);
      } catch (error) {
        resultBox.innerHTML = `<article class="finance-ai-loading is-error">${escapeHtml(error.message || "财务问答失败。")}</article>`;
      }
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    applyFinanceQaAvatar(dialog);
  }

  function formatReportCurrency(value) {
    const amount = Number(value || 0);
    return `¥${amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  }

  function isReportIncomeBill(item) {
    return item?.type === "收入";
  }

  function isReportExpenseBill(item) {
    return item?.type === "支出" || !isReportIncomeBill(item);
  }

  function getReportMonthActual(month) {
    const bills = (app.store.getData().bills || [])
      .filter((item) => String(item.date || "").startsWith(month))
      .filter((item) => !item.excludeFromAnalysis && !item.analysisExcluded);
    const income = bills.filter(isReportIncomeBill).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const expenseItems = bills.filter(isReportExpenseBill);
    const expense = expenseItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const categoryTotals = Object.entries(
      expenseItems.reduce((map, item) => {
        const category = item.category || "未分类";
        map[category] = (map[category] || 0) + Number(item.amount || 0);
        return map;
      }, {}),
    )
      .map(([category, amount]) => ({ category, amount }))
      .sort((left, right) => right.amount - left.amount);
    const unclassifiedCount = bills.filter((item) => !item.category || item.category === "未分类").length;
    return { month, bills, income, expense, balance: income - expense, categoryTotals, unclassifiedCount };
  }

  function buildForecastCalibration(check, forecast) {
    if (!check.hasActual) {
      return {
        title: "等待实际数据",
        text: "目标月份还没有形成有效账单，暂不校准预测模型。",
        action: "录入收入、支出和分类后，系统会自动复盘偏差来源。",
      };
    }
    const topCategory = check.actual.categoryTotals[0];
    const growingTrend = (forecast.categoryTrends || []).find((item) => item.trend === "增长" || item.trend === "up");
    if (check.actual.unclassifiedCount > 0) {
      return {
        title: "分类不完整",
        text: `${check.actual.unclassifiedCount} 条流水缺少分类，分类流向和风险判断会被稀释。`,
        action: "先补齐未分类流水，再复盘预测是否仍然偏离。",
      };
    }
    if (check.predicted.income > 0 && check.actual.income < check.predicted.income * 0.68) {
      return {
        title: "收入低于预测",
        text: `实际收入比预测少 ${formatReportCurrency(Math.abs(check.delta.income))}，结余偏差主要来自收入端。`,
        action: "确认工资、报销、副业等收入是否漏录；若不是漏录，下轮预测降低收入基线权重。",
      };
    }
    if (check.actual.expense > check.predicted.expense * 1.22) {
      return {
        title: growingTrend ? "分类增长放大偏差" : "支出高于预测",
        text: topCategory ? `最大流向是「${topCategory.category}」${formatReportCurrency(topCategory.amount)}，实际支出超出预测 ${formatReportCurrency(check.delta.expense)}。` : `实际支出超出预测 ${formatReportCurrency(check.delta.expense)}。`,
        action: growingTrend ? `下轮提高「${growingTrend.category}」近期增长权重，并给该分类设置控制线。` : "检查是否有一次性大额支出或未来计划未提前录入。",
      };
    }
    if (check.actual.expense < check.predicted.expense * 0.78) {
      return {
        title: "预测偏保守",
        text: `实际支出比预测少 ${formatReportCurrency(Math.abs(check.delta.expense))}，模型可能高估了未来压力。`,
        action: "检查计划支出是否延期、订阅是否取消；下轮适当降低已知压力修正权重。",
      };
    }
    return {
      title: "模型可沿用",
      text: "预测与实际走势接近，长期基线和近期趋势的组合较稳定。",
      action: "继续保持分类完整，月底复盘异常分类即可。",
    };
  }

  function buildBillReportForecastCheck(report) {
    const forecast = report?.forecast || {};
    const month = forecast.nextMonth || forecast.nextMonthMonth || forecast.month || "";
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    const actual = getReportMonthActual(month);
    const hasActual = actual.bills.length > 0 || actual.income > 0 || actual.expense > 0;
    const predicted = {
      income: Number(forecast.nextMonthIncome ?? forecast.income ?? 0),
      expense: Number(forecast.nextMonthExpense ?? forecast.expense ?? 0),
      balance: Number(forecast.nextMonthBalance ?? forecast.balance ?? 0),
    };
    const delta = {
      income: actual.income - predicted.income,
      expense: actual.expense - predicted.expense,
      balance: actual.balance - predicted.balance,
    };
    const expenseBase = Math.max(Math.abs(predicted.expense), Math.abs(actual.expense), 1);
    const balanceBase = Math.max(Math.abs(predicted.balance), Math.abs(actual.balance), 1);
    const drift = Math.max(Math.abs(delta.expense) / expenseBase, Math.abs(delta.balance) / balanceBase);
    const level = !hasActual ? "pending" : drift <= 0.18 ? "good" : drift <= 0.36 ? "watch" : "risk";
    const label = level === "pending" ? "待验证" : level === "good" ? "偏差可控" : level === "watch" ? "需要校准" : "明显偏离";
    const conclusion = !hasActual
      ? `${month} 尚未形成有效账单，预测会在录入数据后自动复盘。`
      : level === "good"
        ? "预测与实际接近，当前基线可以继续沿用。"
        : level === "watch"
        ? "实际走势和预测存在差距，建议下次提高近期趋势和分类变化权重。"
        : "实际走势明显偏离预测，需要检查异常支出、收入缺失或分类录入是否完整。";
    const check = { month, hasActual, actual, predicted, delta, level, label, conclusion };
    return { ...check, calibration: buildForecastCalibration(check, forecast) };
  }

  function renderBillReportForecastCheck(report) {
    const check = buildBillReportForecastCheck(report);
    if (!check) return "";
    return `
      <section class="bill-report-forecast-check bill-report-forecast-check--${escapeHtml(check.level)}">
        <div class="bill-report-forecast-check__head">
          <div>
            <span>FORECAST REVIEW</span>
            <h2>${escapeHtml(check.month)} 预测复盘</h2>
          </div>
          <strong>${escapeHtml(check.label)}</strong>
        </div>
        <div class="bill-report-forecast-check__grid">
          <article><span>预测收入</span><strong>${formatReportCurrency(check.predicted.income)}</strong><small>实际 ${formatReportCurrency(check.actual.income)}</small></article>
          <article><span>预测支出</span><strong>${formatReportCurrency(check.predicted.expense)}</strong><small>实际 ${formatReportCurrency(check.actual.expense)}</small></article>
          <article><span>预测结余</span><strong>${formatReportCurrency(check.predicted.balance)}</strong><small>实际 ${formatReportCurrency(check.actual.balance)}</small></article>
          <article><span>结余偏差</span><strong class="${check.level === "risk" ? "is-risk" : "is-good"}">${formatReportCurrency(check.delta.balance)}</strong><small>${escapeHtml(check.conclusion)}</small></article>
        </div>
        <div class="bill-report-forecast-calibration">
          <article>
            <span>偏差来源</span>
            <strong>${escapeHtml(check.calibration.title)}</strong>
            <p>${escapeHtml(check.calibration.text)}</p>
          </article>
          <article>
            <span>校准动作</span>
            <strong>下轮预测</strong>
            <p>${escapeHtml(check.calibration.action)}</p>
          </article>
        </div>
      </section>
    `;
  }

  function getBillReportById(id) {
    return (app.store.getData().notes || []).find((item) => item.id === id);
  }

  function getBillReportSections(markdown = "") {
    const lines = String(markdown || "").replace(/\r/g, "").split("\n");
    const sections = [];
    let current = null;
    lines.forEach((line) => {
      if (line.startsWith("# ")) return;
      if (line.startsWith("## ")) {
        if (current) sections.push(current);
        current = { title: line.slice(3).trim(), lines: [] };
        return;
      }
      if (current) current.lines.push(line);
    });
    if (current) sections.push(current);
    return sections
      .map((section) => ({ ...section, body: section.lines.join("\n").trim() }))
      .filter((section) => section.body);
  }

  function renderBillReportSection(section) {
    return `
      <section class="bill-report-section-card">
        <h2>${escapeHtml(section.title)}</h2>
        <div class="markdown-preview">${renderMarkdown(section.body)}</div>
      </section>
    `;
  }

  function renderBillReportForecastSnapshot(report) {
    const forecast = report?.forecast || {};
    if (!forecast.nextMonth && !forecast.expenseBreakdown && !forecast.predictionRange) return "";
    const range = forecast.predictionRange || {};
    const breakdown = forecast.expenseBreakdown || {};
    const scenarios = forecast.scenarios || [];
    const rangeRows = [
      ["收入区间", range.income ? `${formatReportCurrency(range.income.low)} - ${formatReportCurrency(range.income.high)}` : "暂无", range.income ? `中位 ${formatReportCurrency(range.income.mid)}` : "待生成"],
      ["支出区间", range.expense ? `${formatReportCurrency(range.expense.low)} - ${formatReportCurrency(range.expense.high)}` : "暂无", range.expense ? `中位 ${formatReportCurrency(range.expense.mid)}` : "待生成"],
      ["结余区间", range.balance ? `${formatReportCurrency(range.balance.low)} - ${formatReportCurrency(range.balance.high)}` : "暂无", range.riskLine ? `风险线 ${formatReportCurrency(range.riskLine)}` : "待生成"],
    ];
    const breakdownRows = [
      ["固定", breakdown.fixed],
      ["订阅", breakdown.subscription],
      ["日常", breakdown.daily],
      ["计划", breakdown.plan],
      ["异常排除", breakdown.abnormalExcluded],
    ];
    return `
      <section class="bill-report-forecast-snapshot">
        <div class="bill-report-forecast-snapshot__head">
          <div>
            <span>FORECAST SNAPSHOT</span>
            <h2>${escapeHtml(forecast.nextMonth || "下月")} 预测摘要</h2>
          </div>
          <strong>${escapeHtml(forecast.level || "预测")}</strong>
        </div>
        <div class="bill-report-forecast-snapshot__quality">
          <article><span>数据质量</span><strong>${escapeHtml(report.qualityScore != null ? `${report.qualityScore} 分` : report.qualityStatus || "旧版")}</strong><small>可信度 ${escapeHtml(report.qualityConfidence || forecast.confidence || "-")}</small></article>
          <article><span>下月预测</span><strong>${formatReportCurrency(forecast.nextMonthBalance)}</strong><small>收入 ${formatReportCurrency(forecast.nextMonthIncome)} · 支出 ${formatReportCurrency(forecast.nextMonthExpense)}</small></article>
          <article><span>年度预测</span><strong>${formatReportCurrency(forecast.nextYearBalance)}</strong><small>${escapeHtml(forecast.nextYear || "年度")} 结余</small></article>
        </div>
        <div class="bill-report-forecast-snapshot__range">
          ${rangeRows.map(([label, value, hint]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`).join("")}
        </div>
        <div class="bill-report-forecast-snapshot__breakdown">
          ${breakdownRows.map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${formatReportCurrency(value)}</strong></article>`).join("")}
        </div>
        ${
          scenarios.length
            ? `<div class="bill-report-forecast-snapshot__scenarios">
                ${scenarios.map((item) => `<article class="is-${escapeHtml(item.tone || "good")}"><span>${escapeHtml(item.label)}情景</span><strong>${formatReportCurrency(item.balance)}</strong><small>收入 ${formatReportCurrency(item.income)} · 支出 ${formatReportCurrency(item.expense)}</small></article>`).join("")}
              </div>`
            : ""
        }
      </section>
    `;
  }

  function buildBillReportHtml(note, options = {}) {
    const report = note?.billReportSummary || {};
    const month = note?.billReportMonth || String(note?.title || "").match(/\d{4}-\d{2}/)?.[0] || "未记录";
    const qualityStatus = report.qualityStatus || "旧版";
    const sections = getBillReportSections(note?.content || "");
    const priorityTitles = ["核心摘要", "智能分析摘要", "AI 行动采纳复盘", "风险提醒", "预算节奏", "未来计划", "分类流向", "行动清单", "月报结论"];
    const primarySections = priorityTitles
      .map((title) => sections.find((section) => section.title === title))
      .filter(Boolean);
    const secondarySections = sections.filter((section) => !priorityTitles.includes(section.title));
    const printableClass = options.printable ? " bill-report-document--print" : "";
    return `
      <article class="bill-report-document${printableClass}">
        <header class="bill-report-document__cover">
          <div>
            <span>MONTHLY FINANCE REPORT · ${escapeHtml(qualityStatus)}</span>
            <h1>${escapeHtml(month)} 生活收支月报</h1>
            <p>${escapeHtml(note?.description || "暂无月报结论")}</p>
          </div>
          <div class="bill-report-score-badge">
            <span>健康分</span>
            <strong>${escapeHtml(String(report.healthScore ?? "-"))}</strong>
          </div>
        </header>
        <section class="bill-report-document__kpis">
          <article><span>收入</span><strong>${formatReportCurrency(report.income)}</strong></article>
          <article><span>支出</span><strong>${formatReportCurrency(report.expense)}</strong></article>
          <article><span>结余</span><strong class="${Number(report.balance || 0) < 0 ? "is-risk" : "is-good"}">${formatReportCurrency(report.balance)}</strong></article>
          <article><span>预算使用</span><strong>${escapeHtml(String(report.budgetUsedRate ?? "-"))}%</strong></article>
        </section>
        <section class="bill-report-document__meta">
          <article><span>最大流向</span><strong>${escapeHtml(report.topCategory || "暂无")}</strong><small>${formatReportCurrency(report.topCategoryAmount)}</small></article>
          <article><span>待处理风险</span><strong>${escapeHtml(String(report.riskCount ?? 0))} 项</strong><small>高优先级事项</small></article>
          <article><span>未来缺口</span><strong>${formatReportCurrency(report.futureGap)}</strong><small>未来 3 个月计划/续费</small></article>
          <article><span>行动完成</span><strong>${escapeHtml(String(report.actionDone ?? 0))}/${escapeHtml(String(report.actionTotal ?? 0))}</strong><small>AI 采纳 ${escapeHtml(String(report.aiActionTotal ?? 0))} · 忽略 ${escapeHtml(String(report.aiActionIgnored ?? 0))}</small></article>
        </section>
        ${renderBillReportForecastSnapshot(report)}
        ${renderBillReportForecastCheck(report)}
        <section class="bill-report-document__layout">
          <div class="bill-report-document__main">
            ${primarySections.map(renderBillReportSection).join("") || `<section class="bill-report-section-card"><h2>月报内容</h2><div class="markdown-preview">${renderMarkdown(note?.content || note?.description || "暂无月报内容")}</div></section>`}
          </div>
          <aside class="bill-report-document__side">
            ${secondarySections.slice(0, 5).map(renderBillReportSection).join("")}
          </aside>
        </section>
      </article>
    `;
  }

  function printBillReport(note) {
    const frame = document.createElement("iframe");
    frame.className = "bill-report-print-frame";
    const title = `${note?.billReportMonth || "生活收支"}-月报`;
    frame.srcdoc = `
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(title)}</title>
          <style>
            * { box-sizing: border-box; }
            html, body { width: 210mm; min-height: 297mm; }
            body { margin: 0; background: #f4f7f4; color: #17322a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
            .bill-report-document { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 13mm; background: #fff; }
            .bill-report-document__cover { display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: end; border: 1px solid #d9e7df; border-radius: 14px; background: linear-gradient(135deg, #eef8f1, #fff 62%); padding: 18px; }
            .bill-report-document__cover span, .bill-report-document__kpis span, .bill-report-document__meta span, .bill-report-score-badge span, .bill-report-section-card h2 { color: #60776d; font-size: 10.5px; font-weight: 800; letter-spacing: .04em; }
            .bill-report-document__cover h1 { margin: 5px 0 7px; color: #0f2f27; font-size: 25px; line-height: 1.1; }
            .bill-report-document__cover p { margin: 0; color: #39564c; font-size: 12px; line-height: 1.55; }
            .bill-report-score-badge { min-width: 78px; border-radius: 12px; background: #0f7a4d; color: #fff; padding: 10px; text-align: center; }
            .bill-report-score-badge span { display: block; color: rgba(255,255,255,.76); }
            .bill-report-score-badge strong { display: block; margin-top: 3px; color: #fff; font-size: 38px; line-height: 1; }
            .bill-report-document__kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; }
            .bill-report-document__meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 8px; }
            .bill-report-document__kpis article, .bill-report-document__meta article, .bill-report-section-card { border: 1px solid #dfeae3; border-radius: 10px; background: #fbfdfb; padding: 9px; break-inside: avoid; }
            .bill-report-document__kpis strong, .bill-report-document__meta strong { display: block; margin-top: 4px; color: #18362d; font-size: 15px; line-height: 1.18; }
            .bill-report-document__meta small { display: block; margin-top: 3px; color: #6a8077; font-size: 10.5px; }
            .is-good { color: #0f7a4d !important; }
            .is-risk { color: #d23b3b !important; }
            .bill-report-forecast-snapshot { margin-top: 9px; border: 1px solid #dce8e1; border-radius: 10px; background: #fbfdfb; padding: 10px; break-inside: avoid; }
            .bill-report-forecast-snapshot__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
            .bill-report-forecast-snapshot__head span, .bill-report-forecast-snapshot article span { color: #60776d; font-size: 10px; font-weight: 800; letter-spacing: .04em; }
            .bill-report-forecast-snapshot__head h2 { margin: 2px 0 0; color: #17322a; font-size: 14px; line-height: 1.2; }
            .bill-report-forecast-snapshot__head strong { border-radius: 999px; background: #eaf6ef; color: #0f7a4d; padding: 4px 8px; font-size: 11px; }
            .bill-report-forecast-snapshot__quality, .bill-report-forecast-snapshot__range, .bill-report-forecast-snapshot__scenarios { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-top: 8px; }
            .bill-report-forecast-snapshot__breakdown { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; margin-top: 8px; }
            .bill-report-forecast-snapshot article { border: 1px solid #e2ece6; border-radius: 9px; background: #fff; padding: 8px; }
            .bill-report-forecast-snapshot article strong { display: block; margin-top: 3px; color: #18362d; font-size: 12.5px; line-height: 1.15; }
            .bill-report-forecast-snapshot article small { display: block; margin-top: 3px; color: #6a8077; font-size: 9.8px; line-height: 1.35; }
            .bill-report-forecast-check { margin-top: 9px; border: 1px solid #dce8e1; border-radius: 10px; background: #fbfdfb; padding: 10px; break-inside: avoid; }
            .bill-report-forecast-check__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
            .bill-report-forecast-check__head span { color: #60776d; font-size: 10px; font-weight: 800; letter-spacing: .04em; }
            .bill-report-forecast-check__head h2 { margin: 2px 0 0; color: #17322a; font-size: 14px; line-height: 1.2; }
            .bill-report-forecast-check__head strong { border-radius: 999px; background: #eaf6ef; color: #0f7a4d; padding: 4px 8px; font-size: 11px; }
            .bill-report-forecast-check--risk .bill-report-forecast-check__head strong { background: #fdeeee; color: #d23b3b; }
            .bill-report-forecast-check--watch .bill-report-forecast-check__head strong { background: #fff7df; color: #95680f; }
            .bill-report-forecast-check__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-top: 8px; }
            .bill-report-forecast-check__grid article { border: 1px solid #e2ece6; border-radius: 9px; background: #fff; padding: 8px; }
            .bill-report-forecast-check__grid span { color: #60776d; font-size: 10px; font-weight: 800; }
            .bill-report-forecast-check__grid strong { display: block; margin-top: 3px; color: #18362d; font-size: 13px; line-height: 1.15; }
            .bill-report-forecast-check__grid small { display: block; margin-top: 3px; color: #6a8077; font-size: 9.8px; line-height: 1.35; }
            .bill-report-forecast-calibration { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; margin-top: 8px; }
            .bill-report-forecast-calibration article { border: 1px solid #dfeae3; border-radius: 9px; background: #fff; padding: 8px; }
            .bill-report-forecast-calibration span { color: #60776d; font-size: 10px; font-weight: 800; }
            .bill-report-forecast-calibration strong { display: block; margin-top: 3px; color: #18362d; font-size: 12.5px; line-height: 1.15; }
            .bill-report-forecast-calibration p { margin: 3px 0 0; color: #536b61; font-size: 9.8px; line-height: 1.35; }
            .bill-report-document__layout { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, .85fr); gap: 9px; margin-top: 10px; align-items: start; }
            .bill-report-document__main, .bill-report-document__side { display: grid; gap: 8px; }
            .bill-report-section-card h2 { margin: 0 0 7px; border-bottom: 1px solid #e2ece6; padding-bottom: 5px; color: #15372e; font-size: 13px; }
            .bill-report-section-card h1 { display: none; }
            .bill-report-section-card .markdown-preview h1, .bill-report-section-card .markdown-preview h2 { display: none; }
            .bill-report-section-card p, .bill-report-section-card li { color: #2d4b41; font-size: 10.5px; line-height: 1.5; }
            .bill-report-section-card ul { margin: 0; padding-left: 16px; }
            .bill-report-section-card p { margin: 0 0 5px; }
            @page { size: A4; margin: 0; }
          </style>
        </head>
        <body>${buildBillReportHtml(note, { printable: true })}</body>
      </html>
    `;
    frame.addEventListener("load", () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 1200);
    }, { once: true });
    document.body.appendChild(frame);
  }

  function showBillReportDialog(note) {
    if (!note) {
      window.alert("未找到这份月报。");
      return;
    }
    const dialog = document.createElement("dialog");
    dialog.className = "modal bill-report-modal";
    dialog.innerHTML = `
      <section class="modal-panel bill-report-modal__panel">
        <div class="drawer-head bill-report-modal__head">
          <div>
            <span class="eyebrow">REPORT DETAIL</span>
            <h2>${escapeHtml(note.title || "生活收支月报")}</h2>
          </div>
          <div class="bill-report-modal__actions">
            <button class="ghost-button" data-bill-report-print="${escapeHtml(note.id)}" type="button">导出 PDF</button>
            <button class="icon-button" data-close-bill-report type="button" aria-label="关闭">×</button>
          </div>
        </div>
        <div class="bill-report-modal__body">
          ${buildBillReportHtml(note)}
        </div>
      </section>
    `;
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close-bill-report]")) close();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  document.addEventListener("pointermove", moveBillTrendTooltip);
  document.addEventListener("pointerleave", hideBillTrendTooltip);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const billActionDetailTarget = event.target.closest?.("[data-bill-action-detail]");
    const billReportTarget = event.target.closest?.("[data-bill-report-open]");
    if (billActionDetailTarget && !event.target.closest?.("button")) {
      event.preventDefault();
      showBillActionDetailDialog(billActionDetailTarget);
      return;
    }
    const billForecastDetailTarget = event.target.closest?.("[data-bill-forecast-detail]");
    if (billForecastDetailTarget && !event.target.closest?.("button")) {
      event.preventDefault();
      showBillForecastDetailDialog(billForecastDetailTarget);
      return;
    }
    if (billReportTarget && !event.target.closest?.("button")) {
      event.preventDefault();
      showBillReportDialog(getBillReportById(billReportTarget.dataset.billReportOpen));
    }
  });

  document.addEventListener(
    "wheel",
    (event) => {
      const chart = event.target.closest?.(".bill-trend-chart");
      if (!chart) return;
      event.preventDefault();
      hideBillTrendTooltip();
      scheduleBillTrendWheelZoom(event, chart);
    },
    { passive: false },
  );

  let billTrendPanState = null;
  let billTrendPanFrame = 0;
  let billTrendPanX = 0;
  let billTrendSelectionState = null;

  function updateBillTrendPanWindow(clientX) {
    if (!billTrendPanState?.chart?.isConnected) return;
    const rect = billTrendPanState.chart.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const deltaPercent = ((clientX - billTrendPanState.startX) / width) * billTrendPanState.span;
    const nextStart = Math.min(Math.max(billTrendPanState.start - deltaPercent, 0), 100 - billTrendPanState.span);
    const nextEnd = nextStart + billTrendPanState.span;
    billTrendPanState.latestStart = nextStart;
    billTrendPanState.latestEnd = nextEnd;
    const plotWidth = 920 - 40;
    const visualShift = ((billTrendPanState.start - nextStart) / billTrendPanState.span) * plotWidth;
    billTrendPanState.chart.querySelector(".bill-trend-zoom-layer")?.setAttribute("transform", `translate(${Math.round(visualShift)} 0)`);
    const startInput = billTrendPanState.chart.querySelector("[data-bill-trend-zoom-start]");
    const endInput = billTrendPanState.chart.querySelector("[data-bill-trend-zoom-end]");
    if (startInput) startInput.value = String(Math.round(Math.min(nextStart, 96)));
    if (endInput) endInput.value = String(Math.round(Math.max(nextEnd, 4)));
  }

  function scheduleBillTrendPan(clientX) {
    billTrendPanX = clientX;
    if (billTrendPanFrame) return;
    billTrendPanFrame = requestAnimationFrame(() => {
      billTrendPanFrame = 0;
      updateBillTrendPanWindow(billTrendPanX);
    });
  }

  function beginBillTrendPan(chart, clientX, pointerId, captureTarget = null) {
    const start = Number(app.ui.filters.billTrendZoomStart ?? 0);
    const end = Number(app.ui.filters.billTrendZoomEnd ?? 100);
    const span = end - start;
    if (span >= 99) return;
    billTrendPanState = {
      chart,
      pointerId,
      startX: clientX,
      start,
      end,
      span,
      latestStart: start,
      latestEnd: end,
      captureTarget,
    };
    chart.classList.add("is-panning");
    try {
      captureTarget?.setPointerCapture?.(pointerId);
    } catch {
      chart.setPointerCapture?.(pointerId);
    }
    hideBillTrendTooltip();
  }

  function getBillTrendPlotRatio(chart, clientX) {
    const svg = chart.querySelector("svg");
    const rect = svg?.getBoundingClientRect() || chart.getBoundingClientRect();
    const leftPadding = rect.width * (20 / 920);
    const rightPadding = rect.width * (20 / 920);
    const plotLeft = rect.left + leftPadding;
    const plotWidth = Math.max(rect.width - leftPadding - rightPadding, 1);
    return Math.min(Math.max((clientX - plotLeft) / plotWidth, 0), 1);
  }

  function svgSelectionXFromRatio(ratio) {
    return 20 + Math.min(Math.max(ratio, 0), 1) * (920 - 40);
  }

  function updateBillTrendSelection(clientX) {
    if (!billTrendSelectionState?.chart?.isConnected) return;
    const ratio = getBillTrendPlotRatio(billTrendSelectionState.chart, clientX);
    const startX = svgSelectionXFromRatio(billTrendSelectionState.startRatio);
    const endX = svgSelectionXFromRatio(ratio);
    const selection = billTrendSelectionState.chart.querySelector(".bill-trend-selection");
    if (!selection) return;
    selection.hidden = false;
    selection.setAttribute("x", String(Math.round(Math.min(startX, endX))));
    selection.setAttribute("width", String(Math.max(1, Math.round(Math.abs(endX - startX)))));
    billTrendSelectionState.latestRatio = ratio;
    if (Math.abs(clientX - billTrendSelectionState.startX) > 6) billTrendSelectionState.moved = true;
  }

  function beginBillTrendSelection(chart, clientX, pointerId, captureTarget = null) {
    const ratio = getBillTrendPlotRatio(chart, clientX);
    billTrendSelectionState = {
      chart,
      pointerId,
      startX: clientX,
      startRatio: ratio,
      latestRatio: ratio,
      moved: false,
      captureTarget,
    };
    chart.classList.add("is-selecting");
    try {
      captureTarget?.setPointerCapture?.(pointerId);
    } catch {
      chart.setPointerCapture?.(pointerId);
    }
    hideBillTrendTooltip();
  }

  function endBillTrendSelection(pointerId) {
    if (!billTrendSelectionState || pointerId !== billTrendSelectionState.pointerId) return;
    const { chart, startRatio, latestRatio, moved, captureTarget } = billTrendSelectionState;
    chart.classList.remove("is-selecting");
    const selection = chart.querySelector(".bill-trend-selection");
    if (selection) {
      selection.hidden = true;
      selection.setAttribute("width", "0");
    }
    try {
      captureTarget?.releasePointerCapture?.(pointerId);
    } catch {
      chart.releasePointerCapture?.(pointerId);
    }
    billTrendSelectionState = null;
    if (!moved || Math.abs(latestRatio - startRatio) < 0.025) return;
    const currentStart = Number(app.ui.filters.billTrendZoomStart ?? 0);
    const currentEnd = Number(app.ui.filters.billTrendZoomEnd ?? 100);
    const span = Math.max(currentEnd - currentStart, 4);
    const selectedStart = currentStart + Math.min(startRatio, latestRatio) * span;
    const selectedEnd = currentStart + Math.max(startRatio, latestRatio) * span;
    setBillTrendZoomWindow(selectedStart, selectedEnd);
  }

  document.addEventListener("pointerdown", (event) => {
    const chart = event.target.closest?.(".bill-trend-chart");
    if (!chart || event.button !== 0) return;
    const currentStart = Number(app.ui.filters.billTrendZoomStart ?? 0);
    const currentEnd = Number(app.ui.filters.billTrendZoomEnd ?? 100);
    const isZoomed = currentEnd - currentStart < 99;
    if (isZoomed) {
      beginBillTrendPan(chart, event.clientX, event.pointerId, event.target);
    } else {
      beginBillTrendSelection(chart, event.clientX, event.pointerId, event.target);
    }
    event.preventDefault();
  });

  document.addEventListener("pointermove", (event) => {
    if (billTrendSelectionState && event.pointerId === billTrendSelectionState.pointerId) {
      updateBillTrendSelection(event.clientX);
      event.preventDefault();
      return;
    }
    if (!billTrendPanState || event.pointerId !== billTrendPanState.pointerId) return;
    scheduleBillTrendPan(event.clientX);
    event.preventDefault();
  });

  document.addEventListener("mousedown", (event) => {
    const chart = event.target.closest?.(".bill-trend-chart");
    if (!chart || event.button !== 0 || billTrendSelectionState) return;
    const currentStart = Number(app.ui.filters.billTrendZoomStart ?? 0);
    const currentEnd = Number(app.ui.filters.billTrendZoomEnd ?? 100);
    if (currentEnd - currentStart >= 99) return;
    beginBillTrendPan(chart, event.clientX, "mouse", null);
    event.preventDefault();
  });

  document.addEventListener("mousemove", (event) => {
    if (!billTrendPanState || billTrendPanState.pointerId !== "mouse") return;
    scheduleBillTrendPan(event.clientX);
    event.preventDefault();
  });

  function endBillTrendPan(pointerId) {
    if (!billTrendPanState || pointerId !== billTrendPanState.pointerId) return;
    if (billTrendPanFrame) {
      cancelAnimationFrame(billTrendPanFrame);
      billTrendPanFrame = 0;
      updateBillTrendPanWindow(billTrendPanX);
    }
    const { latestStart, latestEnd } = billTrendPanState;
    billTrendPanState.chart.querySelector(".bill-trend-zoom-layer")?.removeAttribute("transform");
    billTrendPanState.chart.classList.remove("is-panning");
    try {
      billTrendPanState.captureTarget?.releasePointerCapture?.(pointerId);
    } catch {
      billTrendPanState.chart.releasePointerCapture?.(pointerId);
    }
    billTrendPanState = null;
    setBillTrendZoomWindow(latestStart, latestEnd);
  }

  document.addEventListener("pointerup", (event) => endBillTrendPan(event.pointerId));
  document.addEventListener("pointerup", (event) => endBillTrendSelection(event.pointerId));
  document.addEventListener("pointercancel", (event) => {
    endBillTrendPan(event.pointerId);
    endBillTrendSelection(event.pointerId);
  });
  document.addEventListener("mouseup", () => endBillTrendPan("mouse"));

  document.addEventListener("dblclick", (event) => {
    const chart = event.target.closest?.(".bill-trend-chart");
    if (!chart) return;
    event.preventDefault();
    hideBillTrendTooltip();
    resetBillTrendZoom();
  });

  function renderPreviewList(items = []) {
    if (!items.length) return `<span class="merge-preview-empty">无</span>`;
    return items.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  }

  function showMergePreviewDialog(report, summaries) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "modal merge-preview-modal";
      const rows = report.collections
        .map(
          (item) => `
            <article class="merge-preview-row">
              <div class="merge-preview-row__head">
                <strong>${escapeHtml(item.label)}</strong>
                <span>本地 ${item.localCount} / 服务器 ${item.serverCount}</span>
              </div>
              <div class="merge-preview-metrics">
                <span><b>${item.localOnlyCount}</b> 本地新增</span>
                <span><b>${item.serverOnlyCount}</b> 服务器新增</span>
                <span class="${item.conflictCount ? "is-warning" : ""}"><b>${item.conflictCount}</b> 冲突</span>
                <span><b>${item.sameCount}</b> 相同</span>
              </div>
              ${
                item.localOnlyCount || item.serverOnlyCount || item.conflictCount
                  ? `
                    <div class="merge-preview-detail-grid">
                      <div>
                        <em>本地独有</em>
                        <div class="merge-preview-tags">${renderPreviewList(item.localOnlyPreview)}</div>
                      </div>
                      <div>
                        <em>服务器独有</em>
                        <div class="merge-preview-tags">${renderPreviewList(item.serverOnlyPreview)}</div>
                      </div>
                    </div>
                  `
                  : ""
              }
              ${
                item.conflicts.length
                  ? `
                    <div class="merge-conflict-list">
                      ${item.conflicts
                        .map(
                          (conflict) => `
                            <div>
                              <strong>${escapeHtml(conflict.title)}</strong>
                              <span>保留${conflict.winner === "local" ? "本地" : "服务器"}较新版本</span>
                            </div>
                          `,
                        )
                        .join("")}
                    </div>
                  `
                  : ""
              }
            </article>
          `,
        )
        .join("");

      dialog.innerHTML = `
        <div class="modal-panel merge-preview-panel">
          <div class="drawer-head">
            <div>
              <span class="eyebrow">SERVER MERGE</span>
              <h2>合并前数据对照</h2>
            </div>
            <button class="icon-button" data-merge-preview-cancel type="button" aria-label="关闭">×</button>
          </div>
          <div class="merge-preview-summary">
            <article><span>本地独有</span><strong>${report.totals.localOnlyCount}</strong></article>
            <article><span>服务器独有</span><strong>${report.totals.serverOnlyCount}</strong></article>
            <article><span>冲突记录</span><strong>${report.totals.conflictCount}</strong></article>
            <article><span>相同记录</span><strong>${report.totals.sameCount}</strong></article>
          </div>
          <div class="merge-preview-compare">
            <p><strong>当前浏览器</strong>${escapeHtml(summaries.localSummary)}</p>
            <p><strong>服务器</strong>${escapeHtml(summaries.serverSummary)}</p>
            <p><strong>合并后</strong>${escapeHtml(summaries.mergedSummary)}</p>
          </div>
          <div class="merge-preview-list">${rows}</div>
          <div class="modal-actions">
            <button class="ghost-button" data-merge-preview-cancel type="button">取消</button>
            <button class="primary-button" data-merge-preview-confirm type="button">确认合并</button>
          </div>
        </div>
      `;

      function close(confirmed) {
        dialog.close();
        dialog.remove();
        resolve(confirmed);
      }

      dialog.addEventListener("click", (event) => {
        if (event.target === dialog || event.target.closest("[data-merge-preview-cancel]")) {
          close(false);
          return;
        }
        if (event.target.closest("[data-merge-preview-confirm]")) close(true);
      });
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        close(false);
      });
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

  async function showUserManagementDialog() {
    const dialog = document.createElement("dialog");
    dialog.className = "modal user-management-modal";
    dialog.innerHTML = `
      <div class="modal-panel user-management-panel">
        <div class="drawer-head">
          <div>
            <span class="eyebrow">USERS</span>
            <h2>用户管理</h2>
          </div>
          <button class="icon-button" data-user-management-close type="button" aria-label="关闭">×</button>
        </div>
        <div class="user-management-body">
          <p class="panel-copy">正在读取用户列表...</p>
        </div>
      </div>
    `;

    async function renderUsers() {
      const body = dialog.querySelector(".user-management-body");
      try {
        const result = await listServerUsers();
        const users = result.users || [];
        const legacyData = result.legacyData || {};
        const legacyBytes = Number(legacyData.dataBytes || 0);
        const legacySize = legacyBytes >= 1024 ? `${(legacyBytes / 1024).toFixed(1)} KB` : `${legacyBytes} B`;
        body.innerHTML = `
          <div class="user-management-summary">
            <article><span>用户总数</span><strong>${users.length}</strong></article>
            <article><span>管理员</span><strong>${users.filter((user) => user.role === "admin").length}</strong></article>
            <article><span>已禁用</span><strong>${users.filter((user) => user.disabled).length}</strong></article>
          </div>
          <div class="user-migration-panel ${legacyData.hasData ? "" : "is-empty"}">
            <div>
              <strong>旧全局数据迁移</strong>
              <span>${legacyData.hasData ? `发现旧数据文件，可迁移给指定用户 · ${legacySize}` : "未发现旧全局数据文件"}</span>
            </div>
            <em>${escapeHtml(legacyData.hasData ? legacyData.dataFile || "" : "迁移会覆盖目标用户现有服务器数据，请先导出备份。")}</em>
          </div>
          <div class="user-management-list">
            ${users
              .map(
                (user) => `
                  <article class="user-management-row ${user.disabled ? "is-disabled" : ""}">
                    <div>
                      <strong>${escapeHtml(user.email || user.username)}${user.isCurrent ? "（当前）" : ""}</strong>
                      <span>${escapeHtml(user.role)} · ${user.disabled ? "已禁用" : "正常"} · ${user.emailVerified ? "邮箱已验证" : "邮箱未验证"} · ${user.data?.hasData ? "已有数据" : "暂无数据"}</span>
                      <em>${escapeHtml(user.data?.legacy ? "正在兼容旧全局数据" : user.data?.dataFile || "")}</em>
                    </div>
                    <div class="user-management-actions">
                      <button class="ghost-button" data-user-update-email="${user.id}" data-user-email="${escapeHtml(user.email || "")}" type="button">修改邮箱</button>
                      <button class="ghost-button" data-user-resend-verification="${user.id}" ${user.email && !user.emailVerified ? "" : "disabled"} type="button">重发验证</button>
                      <button class="ghost-button" data-user-verify-email="${user.id}" ${user.email && !user.emailVerified ? "" : "disabled"} type="button">标记已验证</button>
                      <button class="ghost-button" data-user-migrate-legacy="${user.id}" ${legacyData.hasData ? "" : "disabled"} type="button">迁移旧数据</button>
                      <button class="ghost-button" data-user-reset-password="${user.id}" type="button">重置密码</button>
                      <button class="ghost-button ${user.disabled ? "" : "danger-button"}" data-user-toggle-status="${user.id}" data-user-disabled="${user.disabled ? "false" : "true"}" ${user.isCurrent ? "disabled" : ""} type="button">
                        ${user.disabled ? "启用" : "禁用"}
                      </button>
                    </div>
                  </article>
                `,
              )
              .join("")}
          </div>
          <div class="modal-actions">
            <button class="ghost-button" data-user-management-close type="button">关闭</button>
          </div>
        `;
      } catch (error) {
        body.innerHTML = `<p class="panel-copy">${escapeHtml(error.message || "用户列表读取失败。")}</p>`;
      }
    }

    dialog.addEventListener("click", async (event) => {
      if (event.target === dialog || event.target.closest("[data-user-management-close]")) {
        dialog.close();
        dialog.remove();
        return;
      }
      const statusButton = event.target.closest("[data-user-toggle-status]");
      if (statusButton) {
        const disabled = statusButton.dataset.userDisabled === "true";
        const confirmed = window.confirm(disabled ? "确定禁用这个用户吗？该用户会被强制退出。" : "确定启用这个用户吗？");
        if (!confirmed) return;
        try {
          await updateServerUserStatus(statusButton.dataset.userToggleStatus, disabled);
          await renderUsers();
        } catch (error) {
          window.alert(error.message);
        }
        return;
      }
      const migrateButton = event.target.closest("[data-user-migrate-legacy]");
      if (migrateButton) {
        const confirmed = window.confirm("确定把旧全局数据迁移到这个用户吗？如果该用户已有服务器数据，将会被旧数据覆盖。建议先导出备份。");
        if (!confirmed) return;
        try {
          await migrateServerUserData(migrateButton.dataset.userMigrateLegacy, { source: "legacy", overwrite: true });
          window.alert("旧数据已迁移到指定用户。");
          await renderUsers();
        } catch (error) {
          window.alert(error.message);
        }
        return;
      }
      const emailButton = event.target.closest("[data-user-update-email]");
      if (emailButton) {
        const email = window.prompt("请输入用户邮箱：", emailButton.dataset.userEmail || "");
        if (!email) return;
        try {
          await updateServerUserEmail(emailButton.dataset.userUpdateEmail, email);
          window.alert("邮箱已更新，该用户需要重新验证邮箱并登录。");
          await renderUsers();
        } catch (error) {
          window.alert(error.message);
        }
        return;
      }
      const resendButton = event.target.closest("[data-user-resend-verification]");
      if (resendButton) {
        try {
          await resendServerUserVerification(resendButton.dataset.userResendVerification);
          window.alert("验证邮件已发送。");
          await renderUsers();
        } catch (error) {
          window.alert(error.message);
        }
        return;
      }
      const verifyButton = event.target.closest("[data-user-verify-email]");
      if (verifyButton) {
        const confirmed = window.confirm("确定手动标记该用户邮箱为已验证吗？");
        if (!confirmed) return;
        try {
          await verifyServerUserEmail(verifyButton.dataset.userVerifyEmail);
          window.alert("邮箱已标记为已验证。");
          await renderUsers();
        } catch (error) {
          window.alert(error.message);
        }
        return;
      }
      const resetButton = event.target.closest("[data-user-reset-password]");
      if (resetButton) {
        const password = window.prompt("请输入新密码，至少 8 位：");
        if (!password) return;
        try {
          await resetServerUserPassword(resetButton.dataset.userResetPassword, password);
          window.alert("密码已重置，该用户需要重新登录。");
          await renderUsers();
        } catch (error) {
          window.alert(error.message);
        }
      }
    });

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dialog.close();
      dialog.remove();
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    await renderUsers();
  }

  function normalizeInlineFilter(value) {
    return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
  }

  function applyFavorLedgerFilters() {
    const searchTerm = normalizeInlineFilter(document.querySelector("#favorContactSearch")?.value || "");
    const relation = document.querySelector('input[name="favorRelation"]:checked')?.value || "all";
    const balance = document.querySelector('input[name="favorBalance"]:checked')?.value || "all";
    const rows = [...document.querySelectorAll(".relationship-ledger-grid .relationship-row")];
    let visibleCount = 0;

    rows.forEach((row) => {
      const matchesSearch = !searchTerm || normalizeInlineFilter(row.dataset.contactSearch).includes(searchTerm);
      const matchesRelation = relation === "all" || row.dataset.contactRelation === relation;
      const matchesBalance = balance === "all" || row.dataset.contactBalance === balance;
      const visible = matchesSearch && matchesRelation && matchesBalance;
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    const countText = document.querySelector("#favorLedgerFilterCount");
    if (countText) countText.textContent = `${visibleCount} / ${rows.length} 人`;

    const empty = document.querySelector("#favorLedgerEmpty");
    if (empty) empty.hidden = visibleCount > 0 || rows.length === 0;
  }

  function getAuthCoverListFromInput() {
    return String(document.querySelector("#authCoverImageInput")?.value || "")
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function setAuthCoverListInput(imageUrls) {
    const input = document.querySelector("#authCoverImageInput");
    if (input) input.value = imageUrls.join("\n");
  }

  function formatFileSize(bytes) {
    const value = Number(bytes || 0);
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.ceil(value / 1024)} KB`;
    return `${value} B`;
  }

  async function loadAuthCoverLibrary() {
    const library = document.querySelector("#authCoverLibrary");
    if (!library || !authController?.isAdmin) return;
    library.innerHTML = '<div class="auth-cover-library__empty">正在读取封面资源...</div>';
    try {
      const response = await fetch("/api/auth-cover/files");
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        library.innerHTML = `<div class="auth-cover-library__empty">${result.message || "封面资源读取失败。"}</div>`;
        return;
      }
      const files = Array.isArray(result.files) ? result.files : [];
      if (!files.length) {
        library.innerHTML = '<div class="auth-cover-library__empty">还没有上传封面。点击“上传封面”添加图片。</div>';
        return;
      }
      library.innerHTML = files
        .map(
          (file) => {
            const isVideo = file.mediaType === "video" || /\.(mp4|webm|mov)$/i.test(file.filename || "");
            const safePath = String(file.path || "").replace(/"/g, "&quot;");
            const preview = isVideo
              ? `<video class="auth-cover-file-card__media" src="${safePath}" muted loop playsinline controls></video>`
              : `<div class="auth-cover-file-card__image" style="background-image:url('${String(file.path || "").replace(/'/g, "%27")}')"></div>`;
            const useButton = isVideo
              ? `<span class="auth-cover-file-card__note">视频可上传和删除，登录轮播请使用图片 / GIF / WebP。</span>`
              : `<button class="ghost-button" data-auth-cover-use="${file.path || ""}" type="button">加入轮播</button>`;
            return `
            <article class="auth-cover-file-card">
              ${preview}
              <div class="auth-cover-file-card__body">
                <strong title="${file.filename || ""}">${file.filename || ""}</strong>
                <span>${isVideo ? "视频" : "图片"} · ${formatFileSize(file.size)} · ${file.updatedAt ? new Date(file.updatedAt).toLocaleString() : "未知时间"}</span>
                <code>${file.path || ""}</code>
              </div>
              <div class="auth-cover-file-card__actions">
                ${useButton}
                <button class="ghost-button" data-auth-cover-rename="${file.filename || ""}" type="button">重命名</button>
                <button class="ghost-button danger-button" data-auth-cover-delete="${file.filename || ""}" type="button">删除</button>
              </div>
            </article>
          `;
          },
        )
        .join("");
    } catch (error) {
      library.innerHTML = `<div class="auth-cover-library__empty">${error.message || "封面资源读取失败。"}</div>`;
    }
  }

  document.addEventListener("click", async (event) => {
    const trendProblemTarget = event.target.closest("[data-bill-trend-problem]");
    if (trendProblemTarget) {
      event.preventDefault();
      hideBillTrendTooltip();
      showBillTrendProblemDialog(trendProblemTarget);
      return;
    }

    if (event.target.closest('#entryForm button[value="cancel"]') || event.target.id === "entryModal") {
      closeEntryModal();
      return;
    }

    const pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      resetPageState(app, pageButton.dataset.page);
      persistUiState(app.ui);
      renderer.render();
      if (pageButton.dataset.page === "settings") {
        await loadAuthCoverLibrary();
      }
      return;
    }

    const authCoverButton = event.target.closest("#saveAuthCoverImage, #previewAuthCoverImage, #resetAuthCoverImage, #openAuthCoverManager, #closeAuthCoverManager, #refreshAuthCoverLibrary");
    if (authCoverButton) {
      if (!authController?.isAdmin) {
        window.alert("只有管理员可以管理登录封面。");
        return;
      }
      if (authCoverButton.id === "openAuthCoverManager") {
        document.querySelector("#authCoverManagerModal")?.showModal();
        await loadAuthCoverLibrary();
        return;
      }
      if (authCoverButton.id === "closeAuthCoverManager") {
        document.querySelector("#authCoverManagerModal")?.close();
        return;
      }
      if (authCoverButton.id === "refreshAuthCoverLibrary") {
        await loadAuthCoverLibrary();
        return;
      }
      if (authCoverButton.id === "resetAuthCoverImage") {
        const imageUrl = resetAuthCoverImage();
        setAuthCoverListInput([imageUrl]);
        renderer.render();
        await loadAuthCoverLibrary();
        return;
      }
      const imageUrls = getAuthCoverListFromInput();
      if (!imageUrls.length) {
        window.alert("请填写至少一张图片路径，或点击恢复默认。");
        return;
      }
      if (authCoverButton.id === "previewAuthCoverImage") {
        applyAuthCoverImage(imageUrls);
        return;
      }
      saveAuthCoverImage(imageUrls);
      window.alert(`登录封面已保存，共 ${imageUrls.length} 张。`);
      renderer.render();
      await loadAuthCoverLibrary();
      return;
    }

    const useAuthCoverButton = event.target.closest("[data-auth-cover-use]");
    if (useAuthCoverButton) {
      if (!authController?.isAdmin) return;
      const path = useAuthCoverButton.dataset.authCoverUse;
      const imageUrls = getAuthCoverListFromInput().filter((item) => item !== path);
      imageUrls.unshift(path);
      setAuthCoverListInput(imageUrls);
      saveAuthCoverImage(imageUrls);
      applyAuthCoverImage(imageUrls);
      window.alert("已加入登录轮播，并设为第一张。");
      return;
    }

    const renameAuthCoverButton = event.target.closest("[data-auth-cover-rename]");
    if (renameAuthCoverButton) {
      if (!authController?.isAdmin) return;
      const from = renameAuthCoverButton.dataset.authCoverRename;
      const nextName = window.prompt("请输入新的文件名，保留 jpg/png/gif/webp/mp4/webm/mov 后缀：", from);
      if (!nextName || nextName === from) return;
      const response = await fetch("/api/auth-cover/rename", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: nextName }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        window.alert(result.message || "重命名失败。");
        return;
      }
      const oldPath = `/assets/login-covers/${from}`;
      const nextPath = result.file?.path || `/assets/login-covers/${nextName}`;
      const imageUrls = getAuthCoverListFromInput().map((item) => (item === oldPath ? nextPath : item));
      setAuthCoverListInput(imageUrls);
      saveAuthCoverImage(imageUrls);
      await loadAuthCoverLibrary();
      return;
    }

    const deleteAuthCoverButton = event.target.closest("[data-auth-cover-delete]");
    if (deleteAuthCoverButton) {
      if (!authController?.isAdmin) return;
      const filename = deleteAuthCoverButton.dataset.authCoverDelete;
      const confirmed = window.confirm(`确定删除 ${filename} 吗？文件会从 assets/login-covers 中移除。`);
      if (!confirmed) return;
      const response = await fetch(`/api/auth-cover/file?filename=${encodeURIComponent(filename)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        window.alert(result.message || "删除失败。");
        return;
      }
      const deletedPath = `/assets/login-covers/${filename}`;
      const imageUrls = getAuthCoverListFromInput().filter((item) => item !== deletedPath);
      setAuthCoverListInput(imageUrls);
      saveAuthCoverImage(imageUrls);
      await loadAuthCoverLibrary();
      return;
    }

    const createBillReviewButton = event.target.closest("[data-create-bill-review]");
    if (createBillReviewButton) {
      if (!(await ensureAuth())) return;
      const noteId = app.store.createBillMonthlyReview(createBillReviewButton.dataset.createBillReview);
      if (!noteId) {
        window.alert("生成月报失败，请确认当前月份有可分析数据。");
        return;
      }
      window.alert("月报已保存到历史月报。");
      renderer.render();
      return;
    }

    const billActionStatusButton = event.target.closest("[data-bill-action-status]");
    if (billActionStatusButton) {
      if (!(await ensureAuth())) return;
      const ok = app.store.updateBillActionStatus(
        billActionStatusButton.dataset.billActionMonth,
        billActionStatusButton.dataset.billActionStatus,
        billActionStatusButton.dataset.nextStatus || "待处理",
      );
      if (!ok) window.alert("行动项状态更新失败。");
      billActionStatusButton.closest(".bill-action-detail-modal")?.close();
      billActionStatusButton.closest(".bill-action-detail-modal")?.remove();
      renderer.render();
      return;
    }

    const billActionDetailTarget = event.target.closest("[data-bill-action-detail]");
    if (billActionDetailTarget && !event.target.closest("button")) {
      event.preventDefault();
      showBillActionDetailDialog(billActionDetailTarget);
      return;
    }

    const financeAiAnalysisButton = event.target.closest("[data-finance-ai-analysis]");
    if (financeAiAnalysisButton) {
      event.preventDefault();
      await showFinanceAiAnalysisDialog(financeAiAnalysisButton.dataset.financeAiAnalysis || new Date().toISOString().slice(0, 7));
      return;
    }

    const financeQaButton = event.target.closest("[data-finance-qa]");
    if (financeQaButton) {
      event.preventDefault();
      if (financeQaButton.dataset.financeQaDragged === "true") {
        delete financeQaButton.dataset.financeQaDragged;
        return;
      }
      showFinanceQaDialog(financeQaButton.dataset.financeQa || new Date().toISOString().slice(0, 7));
      return;
    }

    const financeAiActionDecisionButton = event.target.closest("[data-finance-ai-action-decision]");
    if (financeAiActionDecisionButton) {
      event.preventDefault();
      if (!(await ensureAuth())) return;
      const decision = financeAiActionDecisionButton.dataset.financeAiActionDecision;
      const payload = {
        key: financeAiActionDecisionButton.dataset.aiActionKey,
        label: financeAiActionDecisionButton.dataset.aiActionLabel,
        title: financeAiActionDecisionButton.dataset.aiActionTitle,
        text: financeAiActionDecisionButton.dataset.aiActionText,
        metric: financeAiActionDecisionButton.dataset.aiActionMetric,
        score: Number(financeAiActionDecisionButton.dataset.aiActionScore || 0),
        reason: financeAiActionDecisionButton.dataset.aiActionReason,
      };
      if (decision === "modify") {
        const nextTitle = window.prompt("行动标题", payload.title || "");
        if (nextTitle === null) return;
        const nextText = window.prompt("行动内容", payload.text || "");
        if (nextText === null) return;
        payload.title = nextTitle.trim() || payload.title;
        payload.text = nextText.trim() || payload.text;
      }
      const ok = app.store.saveBillAiActionDecision(
        financeAiActionDecisionButton.dataset.aiActionMonth,
        payload,
        decision === "ignored" ? "ignored" : "adopted",
      );
      if (!ok) {
        window.alert("AI 行动处理失败。");
        return;
      }
      renderer.render();
      const dialog = financeAiActionDecisionButton.closest(".finance-ai-analysis-modal");
      dialog?.close();
      dialog?.remove();
      return;
    }

    const billForecastDetailTarget = event.target.closest("[data-bill-forecast-detail]");
    if (billForecastDetailTarget && !event.target.closest("button")) {
      event.preventDefault();
      showBillForecastDetailDialog(billForecastDetailTarget);
      return;
    }

    const applyBudgetSuggestionsButton = event.target.closest("[data-apply-budget-suggestions]");
    if (applyBudgetSuggestionsButton) {
      const form = document.querySelector("#budgetForm");
      const field = form?.querySelector('[name="categoryBudgets"]');
      if (field) {
        field.value = applyBudgetSuggestionsButton.dataset.applyBudgetSuggestions || "";
        field.focus();
        field.classList.add("is-focus-pulse");
        window.setTimeout(() => field.classList.remove("is-focus-pulse"), 1200);
      }
      return;
    }

    const futurePlanStatusButton = event.target.closest("[data-future-plan-status]");
    if (futurePlanStatusButton) {
      if (!(await ensureAuth())) return;
      const ok = app.store.updateFuturePlanStatus(futurePlanStatusButton.dataset.futurePlanStatus, futurePlanStatusButton.dataset.nextStatus || "已准备");
      if (!ok) window.alert("更新未来计划失败。");
      renderer.render();
      return;
    }

    const futurePlanDeleteButton = event.target.closest("[data-delete-future-plan]");
    if (futurePlanDeleteButton) {
      if (!(await ensureAuth())) return;
      const confirmed = window.confirm("确定删除这条未来计划吗？");
      if (!confirmed) return;
      const ok = app.store.deleteFuturePlan(futurePlanDeleteButton.dataset.deleteFuturePlan);
      if (!ok) window.alert("删除未来计划失败。");
      renderer.render();
      return;
    }

    const favorFilterPill = event.target.closest(".favor-filter-pill");
    if (favorFilterPill) {
      window.requestAnimationFrame(() => {
        app.ui.filters.favorRelation = document.querySelector('input[name="favorRelation"]:checked')?.value || "all";
        app.ui.filters.favorBalance = document.querySelector('input[name="favorBalance"]:checked')?.value || "all";
        persistUiState(app.ui);
        applyFavorLedgerFilters();
      });
      return;
    }

    const pageJump = event.target.closest("[data-page-jump]");
    if (pageJump) {
      resetPageState(app, pageJump.dataset.pageJump);
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const dashboardActionsButton = event.target.closest("[data-dashboard-open-actions]");
    if (dashboardActionsButton) {
      resetPageState(app, "bills");
      app.ui.filters.billMonth = dashboardActionsButton.dataset.dashboardOpenActions || app.ui.filters.billMonth || "";
      app.ui.filters.billTimelineScope = "month";
      persistUiState(app.ui);
      renderer.render();
      requestAnimationFrame(() => {
        const panel = document.querySelector("[data-bill-action-panel]");
        panel?.scrollIntoView({ behavior: "smooth", block: "center" });
        panel?.classList.add("is-focus-pulse");
        window.setTimeout(() => panel?.classList.remove("is-focus-pulse"), 1400);
      });
      return;
    }

    const dashboardLedgerButton = event.target.closest("[data-dashboard-open-ledger]");
    if (dashboardLedgerButton) {
      resetPageState(app, "bills");
      app.ui.filters.billMonth = dashboardLedgerButton.dataset.dashboardOpenLedger || "";
      app.ui.filters.billTimelineScope = "month";
      app.ui.filters.billLedgerCategory = "";
      persistUiState(app.ui);
      renderer.render();
      requestAnimationFrame(() => {
        document.querySelector("#billLedgerModal")?.showModal();
      });
      return;
    }

    const filterButton = event.target.closest("[data-filter]");
    if (filterButton) {
      app.ui.activeChip = filterButton.dataset.filter;
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const billReportCompareButton = event.target.closest("[data-bill-report-compare]");
    if (billReportCompareButton) {
      app.ui.filters.billMonth = billReportCompareButton.dataset.billReportCompare;
      app.ui.filters.billTimelineScope = "month";
      persistUiState(app.ui);
      renderer.render();
      requestAnimationFrame(() => {
        const panel = document.querySelector("[data-bill-report-panel]");
        panel?.scrollIntoView({ behavior: "smooth", block: "center" });
        panel?.classList.add("is-focus-pulse");
        window.setTimeout(() => panel?.classList.remove("is-focus-pulse"), 1400);
      });
      return;
    }

    const billReportPrintButton = event.target.closest("[data-bill-report-print]");
    if (billReportPrintButton) {
      printBillReport(getBillReportById(billReportPrintButton.dataset.billReportPrint));
      return;
    }

    const billReportOpenTarget = event.target.closest("[data-bill-report-open]");
    if (billReportOpenTarget) {
      if (event.target.closest("button, input, select, textarea, a, label")) return;
      showBillReportDialog(getBillReportById(billReportOpenTarget.dataset.billReportOpen));
      return;
    }

    const openTarget = event.target.closest("[data-open]");
    if (openTarget) {
      if (event.target.closest("button, input, select, textarea, a, label")) return;
      const [type, id] = openTarget.dataset.open.split(":");
      if (type === "contacts") {
        renderer.openContactDetail(id);
        return;
      }
      if (type === "favor-year") {
        renderer.openFavorInsightDetail("year", id);
        return;
      }
      if (type === "favor-type") {
        renderer.openFavorInsightDetail("eventType", id);
        return;
      }
      if (type === "favor-month") {
        renderer.openFavorInsightDetail("month", id);
        return;
      }
      renderer.openDrawer(type, id);
      return;
    }

    const editButton = event.target.closest("[data-edit]");
    if (editButton) {
      if (!(await ensureAuth())) return;
      const [type, id] = editButton.dataset.edit.split(":");
      const item = app.store.getEntry(type, id);
      if (item) {
        const ledgerModal = editButton.closest("#billLedgerModal");
        if (ledgerModal) billLedgerReturnMonth = getActiveBillLedgerMonth(ledgerModal);
        document.querySelector("#billLedgerModal")?.close();
        renderer.closeDrawer();
        formController.openEdit(type, item);
      }
      return;
    }

    const favorEditToggle = event.target.closest("[data-toggle-favor-edit]");
    if (favorEditToggle) {
      if (!(await ensureAuth())) return;
      const panel = [...document.querySelectorAll("[data-favor-edit-panel]")].find(
        (item) => item.dataset.favorEditPanel === favorEditToggle.dataset.toggleFavorEdit,
      );
      if (panel) {
        panel.hidden = false;
        panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      return;
    }

    const markReturnButton = event.target.closest("[data-mark-return]");
    if (markReturnButton) {
      if (!(await ensureAuth())) return;
      app.store.markFavorReturned(markReturnButton.dataset.markReturn);
      renderer.render();
      return;
    }

    const deleteContactButton = event.target.closest("[data-delete-contact]");
    if (deleteContactButton) {
      if (!(await ensureAuth())) return;
      const result = app.store.deleteContact(deleteContactButton.dataset.deleteContact);
      if (!result?.ok) {
        window.alert(`这个人物还有 ${result?.relatedCount || 0} 条往来记录，不能直接删除。请先使用“人物合并”处理重复人物，或保留历史关系。`);
        return;
      }
      renderer.closeContactDetail();
      renderer.render();
      return;
    }

    const completeButton = event.target.closest("[data-complete]");
    if (completeButton) {
      if (!(await ensureAuth())) return;
      app.store.completeTask(completeButton.dataset.complete);
      renderer.closeDrawer();
      renderer.render();
      return;
    }

    const billTimelineScopeButton = event.target.closest("[data-bill-timeline-scope]");
    if (billTimelineScopeButton) {
      const nextScope = billTimelineScopeButton.dataset.billTimelineScope || "week";
      app.ui.filters.billTimelineScope = nextScope;
      app.ui.filters.billTrendScope = nextScope === "month" ? "day" : nextScope === "year" ? "month" : "week";
      app.ui.filters.billTrendRange = nextScope === "year" ? 12 : 6;
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const billTimelineDayButton = event.target.closest("[data-bill-timeline-day]");
    if (billTimelineDayButton) {
      app.ui.filters.billMonth = String(billTimelineDayButton.dataset.billTimelineDay || "").slice(0, 7) || app.ui.filters.billMonth;
      app.ui.filters.billTimelineScope = "month";
      app.ui.filters.billTrendScope = "day";
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const billTimelineMonthButton = event.target.closest("[data-bill-timeline-month]");
    if (billTimelineMonthButton) {
      app.ui.filters.billMonth = billTimelineMonthButton.dataset.billTimelineMonth;
      app.ui.filters.billTimelineScope = "month";
      app.ui.filters.billTrendScope = "day";
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const billTimelineTodayButton = event.target.closest("[data-bill-timeline-today]");
    if (billTimelineTodayButton) {
      app.ui.filters.billMonth = new Date().toISOString().slice(0, 7);
      app.ui.filters.billTimelineScope = "week";
      app.ui.filters.billTrendScope = "day";
      persistUiState(app.ui);
      renderer.render();
      requestAnimationFrame(() => {
        document.querySelector(".bill-time-node.is-active")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
      });
      return;
    }

    const billTrendModeButton = event.target.closest("[data-bill-trend-mode]");
    if (billTrendModeButton) {
      app.ui.filters.billTrendMode = billTrendModeButton.dataset.billTrendMode || "cashflow";
      delete app.ui.filters.billTrendHiddenSeries;
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const billTrendScopeButton = event.target.closest("[data-bill-trend-scope]");
    if (billTrendScopeButton) {
      const nextScope = billTrendScopeButton.dataset.billTrendScope || "month";
      setBillTrendScope(nextScope);
      return;
    }

    const billTrendRangeButton = event.target.closest("[data-bill-trend-range]");
    if (billTrendRangeButton) {
      app.ui.filters.billTrendRange = Number(billTrendRangeButton.dataset.billTrendRange || 6);
      delete app.ui.filters.billTrendHiddenSeries;
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const billTrendCategoryToggle = event.target.closest("[data-bill-trend-category-toggle]");
    if (billTrendCategoryToggle) {
      const category = billTrendCategoryToggle.dataset.billTrendCategoryToggle || "";
      const current = Array.isArray(app.ui.filters.billTrendCategories) ? [...app.ui.filters.billTrendCategories] : [];
      const existingIndex = current.indexOf(category);
      if (existingIndex >= 0) {
        current.splice(existingIndex, 1);
      } else {
        if (current.length >= 3) current.shift();
        current.push(category);
      }
      app.ui.filters.billTrendMode = "category";
      app.ui.filters.billTrendCategories = current;
      delete app.ui.filters.billTrendHiddenSeries;
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const billTrendSeriesToggle = event.target.closest("[data-bill-trend-series-toggle]");
    if (billTrendSeriesToggle) {
      const seriesId = billTrendSeriesToggle.dataset.billTrendSeriesToggle;
      const current = new Set(
        Array.isArray(app.ui.filters.billTrendHiddenSeries)
          ? app.ui.filters.billTrendHiddenSeries
          : [...document.querySelectorAll("[data-bill-trend-series-toggle].is-muted")].map((button) => button.dataset.billTrendSeriesToggle).filter(Boolean),
      );
      const allSeries = [...document.querySelectorAll("[data-bill-trend-series-toggle]")].map((button) => button.dataset.billTrendSeriesToggle).filter(Boolean);
      const visibleCount = allSeries.filter((id) => !current.has(id)).length;
      if (current.has(seriesId)) {
        current.delete(seriesId);
      } else if (visibleCount > 1) {
        current.add(seriesId);
      }
      app.ui.filters.billTrendHiddenSeries = [...current];
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const billTrendCategoryFocus = event.target.closest("[data-bill-trend-category-focus]");
    if (billTrendCategoryFocus) {
      const category = billTrendCategoryFocus.dataset.billTrendCategoryFocus || "";
      app.ui.filters.billMonth = billTrendCategoryFocus.dataset.billCategoryMonth || app.ui.filters.billMonth;
      app.ui.filters.billTrendMode = "category";
      app.ui.filters.billTrendCategories = category ? [category] : [];
      delete app.ui.filters.billTrendHiddenSeries;
      persistUiState(app.ui);
      renderer.render();
      requestAnimationFrame(() => {
        document.querySelector(".bill-trend-panel")?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      return;
    }

    const billTrendMonthButton = event.target.closest("[data-bill-trend-month]");
    if (billTrendMonthButton) {
      app.ui.filters.billMonth = billTrendMonthButton.dataset.billTrendMonth;
      app.ui.filters.billTimelineScope = "month";
      persistUiState(app.ui);
      renderer.render();
      requestAnimationFrame(() => {
        document.querySelector("#billLedgerModal")?.showModal();
      });
      return;
    }

    const openBillLedgerButton = event.target.closest("[data-open-bill-ledger]");
    if (openBillLedgerButton) {
      app.ui.filters.billLedgerCategory = "";
      persistUiState(app.ui);
      renderer.render();
      requestAnimationFrame(() => {
        document.querySelector("#billLedgerModal")?.showModal();
      });
      return;
    }

    const openBillCategoryButton = event.target.closest("[data-open-bill-category]");
    if (openBillCategoryButton) {
      app.ui.filters.billMonth = openBillCategoryButton.dataset.billCategoryMonth || app.ui.filters.billMonth;
      app.ui.filters.billLedgerCategory = openBillCategoryButton.dataset.openBillCategory || "";
      persistUiState(app.ui);
      renderer.render();
      requestAnimationFrame(() => {
        document.querySelector("#billLedgerModal")?.showModal();
      });
      return;
    }

    const clearBillCategoryFilterButton = event.target.closest("[data-clear-bill-category-filter]");
    if (clearBillCategoryFilterButton) {
      app.ui.filters.billLedgerCategory = "";
      persistUiState(app.ui);
      renderer.render();
      requestAnimationFrame(() => {
        document.querySelector("#billLedgerModal")?.showModal();
      });
      return;
    }

    const closeBillLedgerButton = event.target.closest("#closeBillLedgerModal");
    if (closeBillLedgerButton || event.target.id === "billLedgerModal") {
      document.querySelector("#billLedgerModal")?.close();
      return;
    }

    const billLedgerMonthButton = event.target.closest("[data-bill-ledger-month]");
    if (billLedgerMonthButton) {
      const month = billLedgerMonthButton.dataset.billLedgerMonth;
      const activeCategory = app.ui.filters.billLedgerCategory || "";
      const modal = billLedgerMonthButton.closest("#billLedgerModal");
      let visibleCount = 0;
      modal?.querySelectorAll("[data-bill-ledger-month]").forEach((button) => {
        button.classList.toggle("is-active", button === billLedgerMonthButton);
      });
      modal?.querySelectorAll("[data-bill-ledger-row]").forEach((row) => {
        const isVisible = row.dataset.billMonthKey === month && (!activeCategory || row.dataset.billCategoryKey === activeCategory);
        row.hidden = !isVisible;
        if (isVisible) visibleCount += 1;
      });
      const count = modal?.querySelector("[data-bill-ledger-count]");
      if (count) count.textContent = `${month}${activeCategory ? ` · ${activeCategory}` : ""} · ${visibleCount} 条`;
      return;
    }

    const reopenBillLedger = () => {
      renderer.render();
      requestAnimationFrame(() => {
        document.querySelector("#billLedgerModal")?.showModal();
      });
    };

    const billCategorySaveButton = event.target.closest("[data-bill-category-save]");
    if (billCategorySaveButton) {
      if (!(await ensureAuth())) return;
      const id = billCategorySaveButton.dataset.billCategorySave;
      const input = document.querySelector(`[data-bill-category-input="${CSS.escape(id)}"]`);
      const ok = app.store.updateBillCategory(id, input?.value || "");
      if (!ok) {
        window.alert("分类保存失败，请填写有效分类。");
        return;
      }
      reopenBillLedger();
      return;
    }

    const billAnalysisExcludeButton = event.target.closest("[data-bill-analysis-exclude]");
    if (billAnalysisExcludeButton) {
      if (!(await ensureAuth())) return;
      const id = billAnalysisExcludeButton.dataset.billAnalysisExclude;
      const nextExcluded = billAnalysisExcludeButton.dataset.nextExcluded === "true";
      const ok = app.store.setBillAnalysisExcluded(id, nextExcluded);
      if (!ok) {
        window.alert("保存失败，请确认流水仍然存在。");
        return;
      }
      reopenBillLedger();
      return;
    }

    const billLedgerDetailButton = event.target.closest("[data-bill-ledger-detail]");
    if (billLedgerDetailButton) {
      document.querySelector("#billLedgerModal")?.close();
      renderer.openDrawer("bills", billLedgerDetailButton.dataset.billLedgerDetail);
      return;
    }

    const billMonthButton = event.target.closest("[data-bill-month]");
    if (billMonthButton) {
      app.ui.filters.billMonth = billMonthButton.dataset.billMonth;
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const filterSelectButton = event.target.closest("[data-filter-select]");
    if (filterSelectButton) {
      const [filterId, ...valueParts] = filterSelectButton.dataset.filterSelect.split(":");
      const value = valueParts.join(":");
      if (filterId === "typeFilter") app.ui.filters.type = value;
      if (filterId === "statusFilter") app.ui.filters.status = value;
      if (filterId === "tagFilter") app.ui.filters.tag = value;
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const menuToggle = event.target.closest("[data-menu-toggle]");
    if (menuToggle) {
      const menuRoot = menuToggle.closest("[data-menu-root]");
      const shouldOpen = !menuRoot?.classList.contains("is-open");
      document.querySelectorAll("[data-menu-root].is-open").forEach((menu) => {
        menu.classList.remove("is-open");
        menu.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "false");
      });
      if (menuRoot && shouldOpen) {
        menuRoot.classList.add("is-open");
        menuToggle.setAttribute("aria-expanded", "true");
      }
      return;
    }

    const financePayerButton = event.target.closest("[data-finance-payer]");
    if (financePayerButton) {
      const payer = financePayerButton.dataset.financePayer;
      const input = document.querySelector("#financeImportPayer");
      const label = document.querySelector("#financeImportPayerLabel");
      if (input) input.value = payer;
      if (label) label.textContent = payer;
      document.querySelectorAll("[data-finance-payer]").forEach((button) => button.classList.toggle("is-active", button === financePayerButton));
      const menuRoot = financePayerButton.closest("[data-menu-root]");
      menuRoot?.classList.remove("is-open");
      menuRoot?.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "false");
      return;
    }

    const financeSourceButton = event.target.closest("[data-finance-source]");
    if (financeSourceButton) {
      const source = financeSourceButton.dataset.financeSource;
      const input = document.querySelector("#financeImportSource");
      const label = document.querySelector("#financeImportSourceLabel");
      if (input) input.value = source;
      if (label) label.textContent = source;
      document.querySelectorAll("[data-finance-source]").forEach((button) => button.classList.toggle("is-active", button === financeSourceButton));
      const menuRoot = financeSourceButton.closest("[data-menu-root]");
      menuRoot?.classList.remove("is-open");
      menuRoot?.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "false");
      return;
    }

    if (!event.target.closest("[data-menu-root]")) {
      document.querySelectorAll("[data-menu-root].is-open").forEach((menu) => {
        menu.classList.remove("is-open");
        menu.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "false");
      });
    }

    const subscriptionBillButton = event.target.closest("[data-subscription-bill]");
    if (subscriptionBillButton) {
      if (!(await ensureAuth())) return;
      const billId = app.store.createBillFromSubscription(subscriptionBillButton.dataset.subscriptionBill);
      if (!billId) {
        window.alert("生成账单失败，请确认订阅仍然存在。");
        return;
      }
      renderer.render();
      return;
    }

    const subscriptionRenewButton = event.target.closest("[data-subscription-renew]");
    if (subscriptionRenewButton) {
      if (!(await ensureAuth())) return;
      const nextRenewalDate = app.store.renewSubscription(subscriptionRenewButton.dataset.subscriptionRenew);
      if (!nextRenewalDate) {
        window.alert("续费失败，请确认订阅仍然存在。");
        return;
      }
      window.alert(`已生成账单，下次到期日已更新为 ${nextRenewalDate}。`);
      renderer.render();
      return;
    }

    const subscriptionStatusButton = event.target.closest("[data-subscription-status]");
    if (subscriptionStatusButton) {
      if (!(await ensureAuth())) return;
      const [subscriptionId, status] = subscriptionStatusButton.dataset.subscriptionStatus.split(":");
      const updated = app.store.updateSubscriptionStatus(subscriptionId, status);
      if (!updated) {
        window.alert("更新订阅状态失败，请确认订阅仍然存在。");
        return;
      }
      renderer.render();
      return;
    }

    const subscriptionReviewButton = event.target.closest("[data-subscription-review]");
    if (subscriptionReviewButton) {
      if (!(await ensureAuth())) return;
      const nextReviewDate = app.store.reviewSubscription(subscriptionReviewButton.dataset.subscriptionReview);
      if (!nextReviewDate) {
        window.alert("复盘失败，请确认订阅仍然存在。");
        return;
      }
      window.alert(`已完成复盘，下次复盘日期为 ${nextReviewDate}。`);
      renderer.render();
      return;
    }

    const convertNoteButton = event.target.closest("[data-convert-note]");
    if (convertNoteButton) {
      if (!(await ensureAuth())) return;
      app.store.createTaskFromNote(convertNoteButton.dataset.convertNote);
      renderer.closeDrawer();
      resetPageState(app, "tasks");
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      if (!(await ensureAuth())) return;
      const [type, id] = deleteButton.dataset.delete.split(":");
      const confirmed = window.confirm("确定要删除这条内容吗？此操作会立刻写入本地存储。");
      if (!confirmed) return;
      app.store.deleteEntry(type, id);
      renderer.closeDrawer();
      renderer.render();
      return;
    }

    if (event.target.id === "quickAddButton" || event.target.id === "dashboardQuickAdd") {
      if (!(await ensureAuth())) return;
      formController.openCreate();
      return;
    }

    if (event.target.id === "closeDrawer" || event.target.id === "drawerBackdrop") {
      renderer.closeDrawer();
      return;
    }

    if (event.target.id === "closeContactDetail") {
      renderer.closeContactDetail();
      return;
    }

    if (event.target.id === "contactDetailModal") {
      renderer.closeContactDetail();
      return;
    }

    if (event.target.id === "themeToggle") {
      document.body.classList.toggle("dark");
      localStorage.setItem(THEME_KEY, document.body.classList.contains("dark") ? "dark" : "light");
      return;
    }

    if (event.target.id === "exportData" || event.target.id === "exportServerBackup") {
      if (!(await ensureAuth())) return;
      const blob = new Blob([JSON.stringify(app.store.exportData(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "personal-hub-full-data.json";
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (event.target.id === "importJsonButton") {
      if (!(await ensureAuth())) return;
      document.querySelector("#importJsonFile")?.click();
      return;
    }

    if (event.target.id === "downloadBillExcelTemplate") {
      if (!(await ensureAuth())) return;
      billExcelController.downloadTemplate();
      return;
    }

    if (event.target.id === "exportFinanceExcel") {
      if (!(await ensureAuth())) return;
      billExcelController.exportFinanceWorkbook();
      return;
    }

    if (event.target.id === "importBillExcelButton") {
      if (!(await ensureAuth())) return;
      document.querySelector("#billExcelFile")?.click();
      return;
    }

    if (event.target.id === "resetDemo") {
      if (!(await ensureAuth())) return;
      const confirmed = window.confirm("确定要恢复示例数据吗？当前本地修改会被覆盖。");
      if (!confirmed) return;
      app.store.reset();
      renderer.render();
      return;
    }

    if (event.target.id === "clearData") {
      if (!(await ensureAuth())) return;
      const confirmed = window.confirm("确定要清空全部数据吗？事项、账单、订阅、人情往来、笔记、项目集和收藏都会被删除。");
      if (!confirmed) return;
      const doubleConfirmed = window.confirm("此操作无法撤销。建议先导出备份。仍要继续吗？");
      if (!doubleConfirmed) return;
      app.store.clearData();
      renderer.closeDrawer();
      renderer.render();
      return;
    }

    if (event.target.id === "clearBillsData") {
      if (!(await ensureAuth())) return;
      const confirmed = window.confirm("确定只清空生活收支吗？订阅、人情往来、事项、笔记和收藏都会保留。建议先导出财务 Excel。");
      if (!confirmed) return;
      app.store.clearBillsData();
      app.ui.filters.billMonth = "";
      persistUiState(app.ui);
      renderer.closeDrawer();
      renderer.render();
      return;
    }

    if (event.target.id === "checkServerSyncStatus") {
      if (!(await ensureAuth())) return;
      try {
        const result = await checkServerSyncStatus();
        const configuredText = result.configured ? "服务器同步可用" : "服务器同步未配置";
        const dataText = result.hasData ? "服务器已有数据" : "服务器暂无数据";
        const userText = result.user?.username ? `当前账号：${result.user.username}。` : "";
        const fileText = result.dataFile ? `数据文件：${result.dataFile}` : "";
        window.alert(`${configuredText}，${dataText}。${userText}${fileText}`);
      } catch (error) {
        window.alert(error.message);
      }
      return;
    }

    if (event.target.id === "pushServerData") {
      if (!(await ensureAuth())) return;
      const localSummary = formatHubDataSummary(summarizeHubData(app.store.exportData()));
      const confirmed = window.confirm(`确定立即把当前浏览器数据同步到服务器吗？服务器上的旧数据会被覆盖。\n\n当前浏览器：${localSummary}`);
      if (!confirmed) return;
      try {
        const result = await pushServerData(app.store.exportData());
        window.alert(`服务器数据已同步：${result.savedAt || "刚刚"}`);
        renderer.render();
      } catch (error) {
        window.alert(error.message);
      }
      return;
    }

    if (event.target.id === "pullServerData") {
      if (!(await ensureAuth())) return;
      const localSummary = formatHubDataSummary(summarizeHubData(app.store.exportData()));
      const confirmed = window.confirm(`确定从服务器读取数据并覆盖当前浏览器数据吗？建议先导出 JSON 备份。\n\n当前浏览器：${localSummary}`);
      if (!confirmed) return;
      try {
        const result = await pullServerData();
        if (!result.data) {
          window.alert("服务器暂无可恢复的数据。");
          return;
        }
        app.store.importData(result.data);
        renderer.render();
        window.alert(`已从服务器恢复数据：${result.savedAt || "未知时间"}`);
      } catch (error) {
        window.alert(error.message);
      }
      return;
    }

    if (event.target.id === "openUserManagement") {
      if (!(await ensureAuth())) return;
      await showUserManagementDialog();
      return;
    }

    if (event.target.id === "changeOwnPassword") {
      if (!(await ensureAuth())) return;
      const oldPassword = window.prompt("请输入当前密码：");
      if (!oldPassword) return;
      const newPassword = window.prompt("请输入新密码，至少 8 位：");
      if (!newPassword) return;
      const confirmPassword = window.prompt("请再次输入新密码：");
      if (!confirmPassword) return;
      try {
        const result = await changeServerPassword(oldPassword, newPassword, confirmPassword);
        window.alert(result.message || "密码已修改，请重新登录。");
        window.location.reload();
      } catch (error) {
        window.alert(error.message || "密码修改失败。");
      }
      return;
    }

    if (event.target.id === "requestBrowserNotification") {
      if (!(await ensureAuth())) return;
      const permission = await requestBrowserNotificationPermission();
      const enabled = permission === "granted";
      saveSubscriptionNotificationSettings({ ...loadSubscriptionNotificationSettings(), browserEnabled: enabled });
      window.alert(enabled ? "浏览器通知已开启。" : "浏览器通知未开启，请检查浏览器权限。");
      renderer.render();
      return;
    }

    if (event.target.id === "testSubscriptionEmail") {
      if (!(await ensureAuth())) return;
      const settings = loadSubscriptionNotificationSettings();
      if (!settings.email) {
        window.alert("请先保存接收邮箱。");
        return;
      }
      try {
        await postSubscriptionEmail("/api/subscription-email/test", { settings });
        window.alert("测试邮件已发送，请检查邮箱。");
      } catch (error) {
        window.alert(error.message);
      }
      return;
    }

    if (event.target.id === "scanSubscriptionEmail") {
      if (!(await ensureAuth())) return;
      const settings = loadSubscriptionNotificationSettings();
      const overview = app.store.getSubscriptionsOverview();
      const dueItems = getSubscriptionsDueForNotification(overview.items, settings);
      try {
        const result = await postSubscriptionEmail("/api/subscription-email/scan", { settings, subscriptions: dueItems });
        window.alert(`邮件扫描完成，发送 ${result.sent || 0} 封。`);
      } catch (error) {
        window.alert(error.message);
      }
      return;
    }

    if (event.target.id === "openSearchPage") {
      resetPageState(app, "search");
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    if (event.target.id === "openNoteModal") {
      if (!(await ensureAuth())) return;
      formController.openCreate("notes");
      return;
    }

    if (event.target.id === "clearSearchTerm") {
      app.ui.searchTerm = "";
      if (elements.globalSearch) {
        elements.globalSearch.value = "";
      }
      persistUiState(app.ui);
      renderer.render();
    }
  });

  let timelineDragState = null;

  document.addEventListener("pointerdown", (event) => {
    const rail = event.target.closest(".bill-week-timeline__days[data-draggable='true']");
    if (!rail) return;
    timelineDragState = {
      rail,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: rail.scrollLeft,
      moved: false,
    };
    rail.classList.add("is-dragging");
    rail.setPointerCapture?.(event.pointerId);
  });

  document.addEventListener("pointermove", (event) => {
    if (!timelineDragState || event.pointerId !== timelineDragState.pointerId) return;
    const deltaX = event.clientX - timelineDragState.startX;
    if (Math.abs(deltaX) > 3) timelineDragState.moved = true;
    timelineDragState.rail.scrollLeft = timelineDragState.startScrollLeft - deltaX;
  });

  document.addEventListener("pointerup", (event) => {
    if (!timelineDragState || event.pointerId !== timelineDragState.pointerId) return;
    timelineDragState.rail.classList.remove("is-dragging");
    timelineDragState.rail.releasePointerCapture?.(event.pointerId);
    timelineDragState = null;
  });

  document.addEventListener("pointercancel", (event) => {
    if (!timelineDragState || event.pointerId !== timelineDragState.pointerId) return;
    timelineDragState.rail.classList.remove("is-dragging");
    timelineDragState = null;
  });

  document.addEventListener("input", (event) => {
    if (!event.target.matches("[data-bill-trend-zoom-start], [data-bill-trend-zoom-end]")) return;
    const chart = event.target.closest(".bill-trend-chart");
    const startInput = chart?.querySelector("[data-bill-trend-zoom-start]");
    const endInput = chart?.querySelector("[data-bill-trend-zoom-end]");
    if (!startInput || !endInput) return;
    const start = Number(startInput.value || 0);
    const end = Number(endInput.value || 100);
    setBillTrendZoomWindow(Math.min(start, end - 4), Math.max(end, start + 4));
  });

  document.addEventListener("change", async (event) => {
    let shouldRender = false;

    if (event.target.id === "authCoverUploadFile") {
      if (!authController?.isAdmin) {
        event.target.value = "";
        window.alert("只有管理员可以上传登录封面。");
        return;
      }
      const [file] = event.target.files || [];
      event.target.value = "";
      if (!file) return;
      const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm", "video/quicktime"];
      if (file.type && !allowedTypes.includes(file.type)) {
        window.alert("仅支持 jpg、png、gif、webp、mp4、webm、mov 文件。");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        window.alert("封面图片不能超过 8MB。");
        return;
      }
      try {
        const formData = new FormData();
        formData.append("cover", file);
        const response = await fetch("/api/auth-cover/upload", { method: "POST", body: formData });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok || !result.file?.path) {
          window.alert(result.message || "封面上传失败。");
          return;
        }
        const imageUrls = getAuthCoverListFromInput().filter((item) => item !== result.file.path);
        if (result.file.mediaType !== "video") {
          imageUrls.unshift(result.file.path);
          setAuthCoverListInput(imageUrls);
          saveAuthCoverImage(imageUrls);
          applyAuthCoverImage(imageUrls);
        }
        await loadAuthCoverLibrary();
        window.alert(`${result.file.mediaType === "video" ? "视频" : "封面"}已上传：${result.file.path}`);
      } catch (error) {
        window.alert(error.message || "封面上传失败。");
      }
      return;
    }

    if (event.target.id === "billExcelFile") {
      if (!(await ensureAuth())) {
        event.target.value = "";
        return;
      }
      const [file] = event.target.files || [];
      billExcelController.importFile(file, {
        defaultSource: document.querySelector("#financeImportSource")?.value || "自动识别",
        defaultPayer: document.querySelector("#financeImportPayer")?.value || "家庭账户",
        importMode: document.querySelector("#financeImportMode")?.value || "raw",
      });
      event.target.value = "";
      return;
    }

    if (event.target.id === "importJsonFile") {
      if (!(await ensureAuth())) {
        event.target.value = "";
        return;
      }
      const [file] = event.target.files || [];
      event.target.value = "";
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          window.alert("JSON 格式不正确：根内容必须是对象。");
          return;
        }
        const importPayload = payload && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : payload;
        const summary = formatHubDataSummary(summarizeHubData(importPayload));
        const confirmed = window.confirm(`确定导入这份 JSON 数据吗？当前页面数据会被覆盖。\n\n导入内容：${summary}`);
        if (!confirmed) return;
        const imported = app.store.importData(importPayload);
        if (!imported) {
          window.alert("导入失败：JSON 数据结构不符合要求。");
          return;
        }
        renderer.closeDrawer();
        renderer.render();
        app.autoServerSync?.schedule(100);
        window.alert("JSON 已导入。若当前为服务器账号，数据会自动同步到当前账号。");
      } catch (error) {
        window.alert(error.message || "JSON 文件读取失败。");
      }
      return;
    }

    if (event.target.id === "favoriteOnlyToggle") {
      app.ui.filters.favoriteOnly = event.target.checked;
      shouldRender = true;
    }

    if (event.target.name === "favorRelation") {
      app.ui.filters.favorRelation = event.target.value;
      persistUiState(app.ui);
      applyFavorLedgerFilters();
      return;
    }

    if (event.target.name === "favorBalance") {
      app.ui.filters.favorBalance = event.target.value;
      persistUiState(app.ui);
      applyFavorLedgerFilters();
      return;
    }

    if (!shouldRender) return;
    persistUiState(app.ui);
    renderer.render();
  });

  elements.globalSearch.addEventListener("input", (event) => {
    app.ui.searchTerm = event.target.value.trim();
    persistUiState(app.ui);
    renderer.render();
  });

  document.addEventListener("input", (event) => {
    if (event.target.id !== "favorContactSearch") return;
    app.ui.filters.favorContactSearch = event.target.value.trim();
    persistUiState(app.ui);
    applyFavorLedgerFilters();
  });

  elements.globalSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !app.ui.searchTerm) return;
    event.preventDefault();
    resetPageState(app, "search");
    persistUiState(app.ui);
    renderer.render();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeTransientOverlays();
  });

  elements.entryForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") {
      closeEntryModal();
      return;
    }
    event.preventDefault();
    if (!(await ensureAuth())) return;
    const nextPage = app.store.upsertEntry(new FormData(elements.entryForm));
    resetPageState(app, nextPage);
    formController.close();
    persistUiState(app.ui);
    renderer.render();
    reopenBillLedgerPanel();
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "bookmarkForm") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;

    const formData = new FormData(event.target);
    const created = app.store.addBookmark({
      title: formData.get("title"),
      url: formData.get("url"),
      description: formData.get("description"),
      category: formData.get("category"),
      tags: formData.get("tags"),
    });

    if (!created) {
      window.alert("收藏失败，请确认外部链接格式正确。");
      return;
    }

    event.target.reset();
    resetPageState(app, "favorites");
    persistUiState(app.ui);
    renderer.render();
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "quickNoteForm") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;
    const formData = new FormData(event.target);
    app.store.quickCaptureNote({
      title: formData.get("title"),
      description: formData.get("description"),
      content: formData.get("content"),
      sourceUrl: formData.get("sourceUrl"),
      noteType: formData.get("noteType"),
      tags: formData.get("tags"),
    });
    resetPageState(app, "notes");
    persistUiState(app.ui);
    event.target.reset();
    renderer.render();
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "subscriptionNotificationForm") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;

    const formData = new FormData(event.target);
    saveSubscriptionNotificationSettings({
      siteEnabled: formData.get("siteEnabled") === "on",
      browserEnabled: formData.get("browserEnabled") === "on",
      emailEnabled: formData.get("emailEnabled") === "on",
      email: formData.get("email"),
      leadDays: formData.get("leadDays"),
      dailyTime: formData.get("dailyTime"),
      remindAutoRenew: formData.get("remindAutoRenew") === "on",
      remindManualRenew: formData.get("remindManualRenew") === "on",
      remindHighCost: formData.get("remindHighCost") === "on",
      remindLowValue: formData.get("remindLowValue") === "on",
    });
    const overview = app.store.getSubscriptionsOverview();
    await runBrowserSubscriptionNotifications(overview.items);
    renderer.render();
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "budgetForm") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;

    const formData = new FormData(event.target);
    app.store.saveBudget({
      month: formData.get("month"),
      totalBudget: formData.get("totalBudget"),
      categoryBudgets: formData.get("categoryBudgets"),
    });
    resetPageState(app, "bills");
    persistUiState(app.ui);
    renderer.render();
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "incomeEntryForm") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;

    const formData = new FormData(event.target);
    const billId = app.store.createIncomeBill({
      incomeType: formData.get("incomeType"),
      title: formData.get("title"),
      amount: formData.get("amount"),
      date: formData.get("date"),
      payer: formData.get("payer"),
      source: "手动",
    });
    if (!billId) {
      window.alert("保存收入失败，请确认金额大于 0。");
      return;
    }
    event.target.reset();
    resetPageState(app, "bills");
    persistUiState(app.ui);
    renderer.render();
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "repaymentEntryForm") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;

    const formData = new FormData(event.target);
    const billId = app.store.createRepaymentBill({
      repaymentType: formData.get("repaymentType"),
      title: formData.get("title"),
      amount: formData.get("amount"),
      date: formData.get("date"),
      payer: formData.get("payer"),
      source: "手动",
    });
    if (!billId) {
      window.alert("保存还款失败，请确认金额大于 0。");
      return;
    }
    event.target.reset();
    resetPageState(app, "bills");
    persistUiState(app.ui);
    renderer.render();
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "futurePlanForm") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;

    const formData = new FormData(event.target);
    const planId = app.store.saveFuturePlan({
      title: formData.get("title"),
      amount: formData.get("amount"),
      date: formData.get("date"),
      planType: formData.get("planType"),
      priority: formData.get("priority"),
      fundingSource: formData.get("fundingSource"),
      note: formData.get("note"),
    });
    if (!planId) {
      window.alert("保存未来计划失败，请填写名称、金额和日期。");
      return;
    }
    event.target.reset();
    resetPageState(app, "bills");
    persistUiState(app.ui);
    renderer.render();
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "subscriptionBudgetForm") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;

    const formData = new FormData(event.target);
    app.store.saveSubscriptionBudget({
      subscriptionMonthlyBudget: formData.get("subscriptionMonthlyBudget"),
      subscriptionAnnualBudget: formData.get("subscriptionAnnualBudget"),
      subscriptionCategoryBudgets: formData.get("subscriptionCategoryBudgets"),
    });
    resetPageState(app, "subscriptions");
    persistUiState(app.ui);
    renderer.render();
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "favorEventForm") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;

    const formData = new FormData(event.target);
    app.store.addFavorEvent({
      title: formData.get("title"),
      eventType: formData.get("eventType"),
      direction: formData.get("direction"),
      amount: formData.get("amount"),
      date: formData.get("date"),
      giftName: formData.get("giftName"),
      note: formData.get("note"),
      projectId: formData.get("projectId"),
      newContactName: formData.get("newContactName"),
      newContactRelationType: formData.get("newContactRelationType"),
      newContactPhone: formData.get("newContactPhone"),
      newContactNote: formData.get("newContactNote"),
      syncBill: formData.get("syncBill") === "on",
    });
    event.target.reset();
    resetPageState(app, "favors");
    persistUiState(app.ui);
    renderer.render();
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "contactEditForm") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;

    const formData = new FormData(event.target);
    const contactId = event.target.dataset.contactId;
    const updated = app.store.updateContact(contactId, {
      name: formData.get("name"),
      relationType: formData.get("relationType"),
      phone: formData.get("phone"),
      note: formData.get("note"),
    });
    if (!updated) {
      window.alert("保存人物失败，请确认人物仍然存在。");
      return;
    }
    renderer.render();
    renderer.openContactDetail(contactId);
  });

  document.addEventListener("submit", async (event) => {
    if (!event.target.classList.contains("favor-event-edit-form")) return;
    event.preventDefault();
    if (!(await ensureAuth())) return;

    const formData = new FormData(event.target);
    const eventId = event.target.dataset.favorEventId;
    const data = app.store.getData();
    const originalEvent = (data.favorEvents || []).find((item) => item.id === eventId);
    const contactId = originalEvent?.contactId || "";
    const modal = document.querySelector("#contactDetailModal");
    const detailType = modal?.dataset.detailType || "";
    const filterType = modal?.dataset.filterType || "";
    const filterValue = modal?.dataset.filterValue || "";
    const updated = app.store.updateFavorEvent(eventId, {
      title: "",
      eventType: formData.get("eventType"),
      direction: formData.get("direction"),
      amount: formData.get("amount"),
      date: formData.get("date"),
      giftName: formData.get("giftName"),
      projectId: formData.get("projectId"),
      note: formData.get("note"),
    });
    if (!updated) {
      window.alert("保存往来失败，请确认记录仍然存在。");
      return;
    }
    renderer.render();
    if (detailType === "favorInsight" && filterType && filterValue) {
      renderer.openFavorInsightDetail(filterType, filterValue);
    } else if (contactId) {
      renderer.openContactDetail(contactId);
    }
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "subscriptionForm") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;

    const formData = new FormData(event.target);
    app.store.addSubscription({
      name: formData.get("name"),
      amount: formData.get("amount"),
      cycle: formData.get("cycle"),
      nextRenewalDate: formData.get("nextRenewalDate"),
      category: formData.get("category"),
      owner: formData.get("owner"),
      paymentMethod: formData.get("paymentMethod"),
      projectId: formData.get("projectId"),
      websiteUrl: formData.get("websiteUrl"),
      accountName: formData.get("accountName"),
      accountPassword: formData.get("accountPassword"),
      note: formData.get("note"),
      usageFrequency: formData.get("usageFrequency"),
      necessity: formData.get("necessity"),
      satisfaction: formData.get("satisfaction"),
      lastUsedAt: formData.get("lastUsedAt"),
      lastReviewedAt: formData.get("lastReviewedAt"),
      nextReviewDate: formData.get("nextReviewDate"),
      autoRenew: formData.get("autoRenew") === "on",
      status: formData.get("status"),
    });
    event.target.reset();
    resetPageState(app, "subscriptions");
    persistUiState(app.ui);
    renderer.render();
  });

  if (app.ui.activePage === "settings") {
    window.requestAnimationFrame(() => {
      loadAuthCoverLibrary();
    });
  }
}
