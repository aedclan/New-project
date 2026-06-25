import { renderMarkdown } from "./utils.js";

const typeLabels = {
  tasks: "事项",
  notes: "笔记",
  bills: "账单",
  collections: "项目集",
};

function tagsToText(tags) {
  return Array.isArray(tags) ? tags.join(", ") : "";
}

function setSectionVisibility(form, type) {
  form.querySelectorAll("[data-section]").forEach((section) => {
    section.classList.toggle("is-hidden", section.dataset.section !== type);
  });
}

export function createFormController(elements) {
  const form = elements.entryForm;
  const titleEl = document.querySelector("#entryFormTitle");
  const eyebrowEl = document.querySelector("#entryFormEyebrow");
  const hintEl = document.querySelector("#entryFormHint");
  const typeSelect = document.querySelector("#entryType");
  const saveButton = document.querySelector("#saveEntry");
  const markdownPreview = document.querySelector("#noteMarkdownPreview");

  function fillCommonFields(item, type) {
    form.elements.entryId.value = item.id || "";
    form.elements.entryMode.value = item.id ? "edit" : "create";
    form.elements.originalType.value = type;
    form.elements.type.value = type;
    form.elements.title.value = item.title || "";
    form.elements.description.value = item.description || "";
    form.elements.tags.value = tagsToText(item.tags);
    form.elements.category.value = item.category || "";
  }

  function fillTypeFields(item, type) {
    form.elements.taskStatus.value = item.status || "待处理";
    form.elements.priority.value = item.priority || "中";
    form.elements.dueDate.value = item.dueDate || "";
    form.elements.taskProjectId.value = item.projectId || "";

    form.elements.billType.value = item.type === "收入" ? "收入" : "支出";
    form.elements.amount.value = item.amount ?? "";
    form.elements.billDate.value = item.date || "";
    if (form.elements.billSource) form.elements.billSource.value = item.source || "手动";
    if (form.elements.billPayer) form.elements.billPayer.value = item.payer || "家庭账户";
    if (form.elements.billFamilyMember) form.elements.billFamilyMember.value = item.familyMember || "";
    if (form.elements.billFixedExpense) form.elements.billFixedExpense.value = item.fixedExpenseType || "";
    if (form.elements.mortgageDueDay) form.elements.mortgageDueDay.value = item.mortgageDueDay || "";
    if (form.elements.mortgageRemainingTerms) form.elements.mortgageRemainingTerms.value = item.mortgageRemainingTerms || "";
    form.elements.projectId.value = item.projectId || "";

    form.elements.pinned.checked = Boolean(item.pinned);
    form.elements.noteType.value = item.noteType || "note";
    form.elements.sourceUrl.value = item.sourceUrl || "";
    form.elements.noteContent.value = item.content || "";
    form.elements.noteProjectId.value = item.projectId || "";

    form.elements.collectionStatus.value = item.status || "规划中";
    form.elements.progress.value = item.progress ?? "";

    if (type === "collections" && !form.elements.category.value) {
      form.elements.category.value = "项目";
    }
  }

  function updateMeta(mode, type) {
    const action = mode === "edit" ? "编辑" : "新增";
    titleEl.textContent = `${action}${typeLabels[type]}`;
    eyebrowEl.textContent = mode === "edit" ? "Edit Entry" : "Quick Add";
    hintEl.textContent =
      mode === "edit"
        ? "保存后会更新当前内容，并保留在本地浏览器存储中。"
        : "保存后会写入本地浏览器存储。";
    saveButton.textContent = mode === "edit" ? "更新" : "保存";
  }

  function open({ mode = "create", type = "tasks", item = {} } = {}) {
    form.reset();
    fillCommonFields(item, type);
    fillTypeFields(item, type);
    setSectionVisibility(form, type);
    updateMeta(mode, type);
    markdownPreview.innerHTML = renderMarkdown(item.content || "");
    elements.modal.showModal();
  }

  function openCreate(type = "tasks") {
    const today = new Date().toISOString().slice(0, 10);
    open({
      mode: "create",
      type,
      item: {
        dueDate: today,
        date: today,
        status: "待处理",
        priority: "中",
        type: "支出",
      },
    });
  }

  function openEdit(type, item) {
    open({ mode: "edit", type, item });
  }

  function close() {
    elements.modal.close();
  }

  typeSelect.addEventListener("change", () => {
    setSectionVisibility(form, typeSelect.value);
    updateMeta(form.elements.entryMode.value, typeSelect.value);
  });

  form.addEventListener("input", (event) => {
    if (event.target.name !== "noteContent") return;
    markdownPreview.innerHTML = renderMarkdown(event.target.value);
  });

  return {
    openCreate,
    openEdit,
    close,
  };
}
