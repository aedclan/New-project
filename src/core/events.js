import { DEFAULT_SORT_BY_PAGE, THEME_KEY, UI_STATE_KEY } from "../config/constants.js";
import {
  getSubscriptionsDueForNotification,
  loadSubscriptionNotificationSettings,
  postSubscriptionEmail,
  requestBrowserNotificationPermission,
  runBrowserSubscriptionNotifications,
  saveSubscriptionNotificationSettings,
} from "./subscription-notifications.js";

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
  if (localStorage.getItem(THEME_KEY) === "dark") {
    document.body.classList.add("dark");
  }
}

export function bindEvents(app, elements, renderer, formController, authController, billExcelController) {
  createDatePicker();

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

  document.addEventListener("click", async (event) => {
    const pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      resetPageState(app, pageButton.dataset.page);
      persistUiState(app.ui);
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

    const filterButton = event.target.closest("[data-filter]");
    if (filterButton) {
      app.ui.activeChip = filterButton.dataset.filter;
      persistUiState(app.ui);
      renderer.render();
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
      if (!authController.requireAuth()) return;
      const [type, id] = editButton.dataset.edit.split(":");
      const item = app.store.getEntry(type, id);
      if (item) {
        renderer.closeDrawer();
        formController.openEdit(type, item);
      }
      return;
    }

    const favorEditToggle = event.target.closest("[data-toggle-favor-edit]");
    if (favorEditToggle) {
      if (!authController.requireAuth()) return;
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
      if (!authController.requireAuth()) return;
      app.store.markFavorReturned(markReturnButton.dataset.markReturn);
      renderer.render();
      return;
    }

    const deleteContactButton = event.target.closest("[data-delete-contact]");
    if (deleteContactButton) {
      if (!authController.requireAuth()) return;
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
      if (!authController.requireAuth()) return;
      app.store.completeTask(completeButton.dataset.complete);
      renderer.closeDrawer();
      renderer.render();
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

    if (!event.target.closest("[data-menu-root]")) {
      document.querySelectorAll("[data-menu-root].is-open").forEach((menu) => {
        menu.classList.remove("is-open");
        menu.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "false");
      });
    }

    const subscriptionBillButton = event.target.closest("[data-subscription-bill]");
    if (subscriptionBillButton) {
      if (!authController.requireAuth()) return;
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
      if (!authController.requireAuth()) return;
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
      if (!authController.requireAuth()) return;
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
      if (!authController.requireAuth()) return;
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
      if (!authController.requireAuth()) return;
      app.store.createTaskFromNote(convertNoteButton.dataset.convertNote);
      renderer.closeDrawer();
      resetPageState(app, "tasks");
      persistUiState(app.ui);
      renderer.render();
      return;
    }

    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      if (!authController.requireAuth()) return;
      const [type, id] = deleteButton.dataset.delete.split(":");
      const confirmed = window.confirm("确定要删除这条内容吗？此操作会立刻写入本地存储。");
      if (!confirmed) return;
      app.store.deleteEntry(type, id);
      renderer.closeDrawer();
      renderer.render();
      return;
    }

    if (event.target.id === "quickAddButton") {
      if (!authController.requireAuth()) return;
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

    if (event.target.id === "exportData") {
      if (!authController.requireAuth()) return;
      const blob = new Blob([JSON.stringify(app.store.exportData(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "personal-hub-full-data.json";
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (event.target.id === "downloadBillExcelTemplate") {
      if (!authController.requireAuth()) return;
      billExcelController.downloadTemplate();
      return;
    }

    if (event.target.id === "exportFinanceExcel") {
      if (!authController.requireAuth()) return;
      billExcelController.exportFinanceWorkbook();
      return;
    }

    if (event.target.id === "importBillExcelButton") {
      if (!authController.requireAuth()) return;
      document.querySelector("#billExcelFile")?.click();
      return;
    }

    if (event.target.id === "resetDemo") {
      if (!authController.requireAuth()) return;
      const confirmed = window.confirm("确定要恢复示例数据吗？当前本地修改会被覆盖。");
      if (!confirmed) return;
      app.store.reset();
      renderer.render();
      return;
    }

    if (event.target.id === "clearData") {
      if (!authController.requireAuth()) return;
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
      if (!authController.requireAuth()) return;
      const confirmed = window.confirm("确定只清空生活收支吗？订阅、人情往来、事项、笔记和收藏都会保留。建议先导出财务 Excel。");
      if (!confirmed) return;
      app.store.clearBillsData();
      app.ui.filters.billMonth = "";
      persistUiState(app.ui);
      renderer.closeDrawer();
      renderer.render();
      return;
    }

    if (event.target.id === "requestBrowserNotification") {
      if (!authController.requireAuth()) return;
      const permission = await requestBrowserNotificationPermission();
      const enabled = permission === "granted";
      saveSubscriptionNotificationSettings({ ...loadSubscriptionNotificationSettings(), browserEnabled: enabled });
      window.alert(enabled ? "浏览器通知已开启。" : "浏览器通知未开启，请检查浏览器权限。");
      renderer.render();
      return;
    }

    if (event.target.id === "testSubscriptionEmail") {
      if (!authController.requireAuth()) return;
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
      if (!authController.requireAuth()) return;
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
      if (!authController.requireAuth()) return;
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

  document.addEventListener("change", (event) => {
    let shouldRender = false;

    if (event.target.id === "billExcelFile") {
      const [file] = event.target.files || [];
      billExcelController.importFile(file, {
        defaultPayer: document.querySelector("#financeImportPayer")?.value || "家庭账户",
      });
      event.target.value = "";
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

  elements.entryForm.addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    if (!authController.requireAuth()) return;
    const nextPage = app.store.upsertEntry(new FormData(elements.entryForm));
    resetPageState(app, nextPage);
    formController.close();
    persistUiState(app.ui);
    renderer.render();
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "bookmarkForm") return;
    event.preventDefault();
    if (!authController.requireAuth()) return;

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

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "quickNoteForm") return;
    event.preventDefault();
    if (!authController.requireAuth()) return;
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
    if (!authController.requireAuth()) return;

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

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "budgetForm") return;
    event.preventDefault();
    if (!authController.requireAuth()) return;

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

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "subscriptionBudgetForm") return;
    event.preventDefault();
    if (!authController.requireAuth()) return;

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

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "favorEventForm") return;
    event.preventDefault();
    if (!authController.requireAuth()) return;

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

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "contactEditForm") return;
    event.preventDefault();
    if (!authController.requireAuth()) return;

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

  document.addEventListener("submit", (event) => {
    if (!event.target.classList.contains("favor-event-edit-form")) return;
    event.preventDefault();
    if (!authController.requireAuth()) return;

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

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "subscriptionForm") return;
    event.preventDefault();
    if (!authController.requireAuth()) return;

    const formData = new FormData(event.target);
    app.store.addSubscription({
      name: formData.get("name"),
      amount: formData.get("amount"),
      cycle: formData.get("cycle"),
      nextRenewalDate: formData.get("nextRenewalDate"),
      category: formData.get("category"),
      projectId: formData.get("projectId"),
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
}
