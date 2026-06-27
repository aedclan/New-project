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
import { listServerUsers, migrateServerUserData, resetServerUserPassword, updateServerUserStatus } from "./server-auth.js";

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

  async function ensureAuth() {
    if (authController.ensureAuth) return authController.ensureAuth();
    return authController.requireAuth();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

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
                      <span>${escapeHtml(user.role)} · ${user.disabled ? "已禁用" : "正常"} · ${user.data?.hasData ? "已有数据" : "暂无数据"}</span>
                      <em>${escapeHtml(user.data?.legacy ? "正在兼容旧全局数据" : user.data?.dataFile || "")}</em>
                    </div>
                    <div class="user-management-actions">
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
      if (!(await ensureAuth())) return;
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

    if (event.target.id === "quickAddButton") {
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

  document.addEventListener("change", async (event) => {
    let shouldRender = false;

    if (event.target.id === "billExcelFile") {
      if (!(await ensureAuth())) {
        event.target.value = "";
        return;
      }
      const [file] = event.target.files || [];
      billExcelController.importFile(file, {
        defaultSource: document.querySelector("#financeImportSource")?.value || "自动识别",
        defaultPayer: document.querySelector("#financeImportPayer")?.value || "家庭账户",
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

  elements.entryForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    if (!(await ensureAuth())) return;
    const nextPage = app.store.upsertEntry(new FormData(elements.entryForm));
    resetPageState(app, nextPage);
    formController.close();
    persistUiState(app.ui);
    renderer.render();
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
