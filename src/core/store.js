import { RECENT_VIEWS_KEY, STORAGE_KEY } from "../config/constants.js";
import { defaultData } from "../data/default-data.js";
import { clone, excerptText } from "./utils.js";

let idCounter = 0;

function createId(prefix) {
  idCounter += 1;
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${idCounter}`;
}

function normalizeContactName(name) {
  return String(name || "").replace(/\s+/g, "").trim().toLowerCase();
}

function normalizeContactIdentity(name, relationType = "", phone = "") {
  const normalizedName = normalizeContactName(name);
  const normalizedPhone = String(phone || "").replace(/\s+/g, "").trim();
  const normalizedRelation = String(relationType || "").trim().toLowerCase();
  if (!normalizedName) return "";
  if (normalizedPhone) return `${normalizedName}|phone:${normalizedPhone}`;
  if (normalizedRelation) return `${normalizedName}|relation:${normalizedRelation}`;
  return normalizedName;
}

function inferContactNameFromFavorTitle(title, contacts) {
  const text = String(title || "").replace(/\s+/g, "");
  if (!text) return null;

  return [...contacts]
    .filter((contact) => normalizeContactName(contact.name) && text.includes(normalizeContactName(contact.name)))
    .sort((left, right) => String(right.name || "").length - String(left.name || "").length)[0] || null;
}

function inferFixedExpenseType(bill) {
  const text = `${bill.title || ""} ${bill.category || ""} ${(bill.tags || []).join(" ")}`;
  return ["房贷", "车贷", "信用卡", "银行卡", "花呗", "白条", "购物平台分期", "消费分期", "借款", "保险", "学费", "订阅", "水电燃气"].find((keyword) => text.includes(keyword)) || "";
}

function inferRepaymentType(bill) {
  const text = `${bill.fixedExpenseType || ""} ${bill.category || ""} ${bill.title || ""} ${bill.description || ""} ${(bill.tags || []).join(" ")}`;
  return ["房贷", "车贷", "信用卡", "银行卡", "花呗", "白条", "购物平台分期", "消费分期", "借款"].find((keyword) => text.includes(keyword)) || "";
}

function isBillExcludedFromAnalysis(bill) {
  return Boolean(bill.excludeFromAnalysis || bill.analysisExcluded);
}

function scoreByRate(rate, ranges) {
  const currentRate = Number(rate || 0);
  return ranges.find((item) => currentRate <= item.max)?.score ?? ranges[ranges.length - 1]?.score ?? 60;
}

function calculateMonthlyFinanceHealth({ income, expense, expenseItems, contextBills }) {
  const balance = income - expense;
  const fixedExpense = expenseItems.filter((item) => inferFixedExpenseType(item)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const repayment = expenseItems.filter((item) => inferRepaymentType(item)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const categoryMap = expenseItems.reduce((map, item) => {
    const category = item.category || "未分类";
    map[category] = (map[category] || 0) + Number(item.amount || 0);
    return map;
  }, {});
  const topCategory = Object.entries(categoryMap).sort((left, right) => right[1] - left[1])[0];
  const monthlyIncomeRows = Object.values(
    (contextBills || []).reduce((map, item) => {
      const month = String(item.date || "").slice(0, 7);
      if (!month) return map;
      map[month] = map[month] || 0;
      if (item.type === "收入") map[month] += Number(item.amount || 0);
      return map;
    }, {}),
  ).filter((value) => value > 0);
  const averageIncome = monthlyIncomeRows.length ? monthlyIncomeRows.reduce((sum, value) => sum + value, 0) / monthlyIncomeRows.length : income;
  const incomeDeviation = averageIncome > 0 ? Math.abs(income - averageIncome) / averageIncome : 0;
  const averageExpense = expenseItems.length ? expense / expenseItems.length : 0;
  const highItemCount = expenseItems.filter((item) => Number(item.amount || 0) >= Math.max(1000, averageExpense * 2.5)).length;
  const expenseRate = income > 0 ? expense / income : expense > 0 ? 1.2 : 0;
  const fixedRate = income > 0 ? fixedExpense / income : fixedExpense > 0 ? 1 : 0;
  const repaymentRate = income > 0 ? repayment / income : repayment > 0 ? 1 : 0;
  const topCategoryRate = expense > 0 && topCategory ? Number(topCategory[1] || 0) / expense : 0;
  const components = [
    { label: "现金流结余", weight: 30, score: income || expense ? scoreByRate(expenseRate, [{ max: 0.5, score: 96 }, { max: 0.7, score: 82 }, { max: 0.85, score: 66 }, { max: 1, score: 46 }, { max: Infinity, score: 18 }]) : 72, hint: income ? `支出占收入 ${Math.round(expenseRate * 100)}%` : "缺少收入" },
    { label: "固定成本", weight: 20, score: scoreByRate(fixedRate, [{ max: 0.3, score: 94 }, { max: 0.45, score: 78 }, { max: 0.6, score: 58 }, { max: 0.75, score: 38 }, { max: Infinity, score: 20 }]), hint: `固定支出占收入 ${Math.round(fixedRate * 100)}%` },
    { label: "债务还款", weight: 20, score: scoreByRate(repaymentRate, [{ max: 0.15, score: 96 }, { max: 0.3, score: 76 }, { max: 0.4, score: 58 }, { max: 0.5, score: 38 }, { max: Infinity, score: 18 }]), hint: `还款占收入 ${Math.round(repaymentRate * 100)}%` },
    { label: "消费结构", weight: 15, score: scoreByRate(topCategoryRate, [{ max: 0.35, score: 92 }, { max: 0.5, score: 76 }, { max: 0.65, score: 58 }, { max: 0.8, score: 42 }, { max: Infinity, score: 28 }]), hint: topCategory ? `最大分类 ${topCategory[0]} 占支出 ${Math.round(topCategoryRate * 100)}%` : "暂无分类压力" },
    { label: "收入稳定", weight: 10, score: monthlyIncomeRows.length <= 1 ? (income > 0 ? 76 : 58) : scoreByRate(incomeDeviation, [{ max: 0.1, score: 92 }, { max: 0.25, score: 76 }, { max: 0.45, score: 58 }, { max: 0.7, score: 40 }, { max: Infinity, score: 26 }]), hint: monthlyIncomeRows.length <= 1 ? "样本较少" : `收入波动 ${Math.round(incomeDeviation * 100)}%` },
    { label: "异常波动", weight: 5, score: highItemCount >= 3 ? 36 : highItemCount ? 66 : 92, hint: highItemCount ? `${highItemCount} 笔大额待复核` : "暂无明显异常" },
  ];
  const score = Math.max(8, Math.min(98, Math.round(components.reduce((sum, item) => sum + item.score * (item.weight / 100), 0))));
  return { score, fixedExpense, repayment, components, weakItems: [...components].sort((left, right) => left.score - right.score).slice(0, 2) };
}

function buildMonthlyFinanceActions({ income, expense, expenseItems, health }) {
  const averageExpense = expenseItems.length ? expense / expenseItems.length : 0;
  const largeItems = expenseItems.filter((item) => Number(item.amount || 0) >= Math.max(1000, averageExpense * 2.5));
  const uncategorized = expenseItems.filter((item) => !item.category || item.category === "未分类");
  const reviewItems = expenseItems.filter((item) => item.classification?.needsReview);
  const missingSource = expenseItems.filter((item) => !item.source || item.source === "未指定");
  const missingPayer = expenseItems.filter((item) => !item.payer || item.payer === "未指定");
  const repaymentRate = income > 0 ? Math.round((health.repayment / income) * 100) : 0;
  const fixedRate = income > 0 ? Math.round((health.fixedExpense / income) * 100) : 0;
  return [
    !income && expense ? `- 补录工资收入：当前有支出 ${expenseItems.length} 笔，但缺少收入参照。` : "",
    uncategorized.length ? `- 处理未分类账单：${uncategorized.length} 笔，影响支出结构判断。` : "",
    reviewItems.length ? `- 复核导入流水：${reviewItems.length} 笔账单需要确认类型或分类。` : "",
    largeItems.length ? `- 复核大额支出：${largeItems.length} 笔，最大 ¥${Math.max(...largeItems.map((item) => Number(item.amount || 0))).toFixed(2)}。` : "",
    repaymentRate >= 30 ? `- 检查还款压力：还款占收入 ${repaymentRate}%。` : "",
    fixedRate >= 45 ? `- 压缩固定成本：固定支出占收入 ${fixedRate}%。` : "",
    missingSource.length ? `- 补齐账单来源：${missingSource.length} 笔缺少微信 / 支付宝 / 手动来源。` : "",
    missingPayer.length ? `- 补齐承担人：${missingPayer.length} 笔缺少男方 / 女方 / 共同归属。` : "",
  ].filter(Boolean);
}

function normalizeBillRuleText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[|/\\\-_:，,。()（）[\]【】]/g, "")
    .trim()
    .toLowerCase();
}

function billMatchesClassificationRule(bill = {}, rule = {}) {
  const keyword = normalizeBillRuleText(rule.keyword);
  if (!keyword) return false;
  const text = normalizeBillRuleText(
    [
      bill.title,
      bill.description,
      bill.category,
      bill.source,
      bill.paymentMethod,
      bill.fixedExpenseType,
      ...(bill.tags || []),
    ]
      .filter(Boolean)
      .join(" "),
  );
  return text.includes(keyword);
}

function normalizeLegacyData(data) {
  delete data.portfolio;
  delete data.relationshipGroups;
  data.bookmarks = data.bookmarks || [];
  data.billClassificationRules = [];
  data.billNonConsumptionRules = [];
  data.billImportReports = data.billImportReports || [];
  data.bills = data.bills || [];

  const contactIdMap = new Map();
  const uniqueContacts = [];
  const usedContactIds = new Set();

  (data.contacts || []).forEach((contact) => {
    delete contact.groupId;
    delete contact.closeness;
    const originalId = contact.id;
    if (!contact.id || usedContactIds.has(contact.id)) {
      contact.id = createId("contact");
    }
    usedContactIds.add(contact.id);
    const key = normalizeContactIdentity(contact.name, contact.relationType, contact.phone);
    if (!key) return;
    const existing = uniqueContacts.find((item) => normalizeContactIdentity(item.name, item.relationType, item.phone) === key);
    if (existing) {
      contactIdMap.set(originalId, existing.id);
      contactIdMap.set(contact.id, existing.id);
      existing.phone = existing.phone || contact.phone || "";
      existing.note = existing.note || contact.note || "";
      existing.relationType = existing.relationType || contact.relationType || "";
    } else {
      uniqueContacts.push(contact);
      contactIdMap.set(originalId, contact.id);
      contactIdMap.set(contact.id, contact.id);
    }
  });
  data.contacts = uniqueContacts;

  const usedFavorEventIds = new Set();

  (data.favorEvents || []).forEach((event) => {
    delete event.groupId;
    if (!event.id || usedFavorEventIds.has(event.id)) {
      event.id = createId("favor");
    }
    usedFavorEventIds.add(event.id);
    if (contactIdMap.has(event.contactId)) {
      event.contactId = contactIdMap.get(event.contactId);
    }
  });

  (data.favorEvents || []).forEach((event) => {
    const currentContact = data.contacts.find((contact) => contact.id === event.contactId);
    const inferredContact = inferContactNameFromFavorTitle(event.title, data.contacts);
    if (inferredContact && inferredContact.id !== currentContact?.id) {
      event.contactId = inferredContact.id;
    }
  });

  (data.bills || []).forEach((bill) => {
    bill.source = bill.source || "手动";
    bill.payer = bill.payer || "家庭账户";
    bill.familyMember = bill.familyMember || "";
    bill.fixedExpenseType = bill.fixedExpenseType || "";
    bill.excludeFromAnalysis = Boolean(bill.analysisExcluded || bill.excludeFromAnalysis);
    if (bill.excludeFromAnalysis) {
      bill.category = bill.category && bill.category !== "未分类" ? bill.category : "非消费流水";
      bill.tags = [...new Set([...(bill.tags || []), "不计入分析"])];
    }
    bill.mortgageDueDay = bill.mortgageDueDay || "";
    bill.mortgageRemainingTerms = bill.mortgageRemainingTerms || "";
  });
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const fallback = clone(defaultData);
    normalizeLegacyData(fallback);
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    const fallback = clone(defaultData);
    const data = {
      ...fallback,
      ...parsed,
      budgets: { ...fallback.budgets, ...(parsed.budgets || {}) },
    };

    normalizeLegacyData(data);
    return data;
  } catch {
    const fallback = clone(defaultData);
    normalizeLegacyData(fallback);
    return fallback;
  }
}

function loadRecentViews() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_VIEWS_KEY) || "[]").filter((item) => item.type !== "portfolio");
  } catch {
    return [];
  }
}

function splitCommaText(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readText(formData, fieldName) {
  return String(formData.get(fieldName) || "").trim();
}

function deriveNoteTitle({ title, description, content, sourceUrl }) {
  if (title) return title;
  if (description) return description.slice(0, 24);
  if (content) {
    const firstLine = String(content)
      .split("\n")
      .find((line) => line.trim());
    if (firstLine) return firstLine.trim().slice(0, 24);
  }
  if (sourceUrl) return sourceUrl.replace(/^https?:\/\//, "").slice(0, 24);
  return "未命名笔记";
}

function sumAmounts(items, type) {
  return items
    .filter((item) => item.type === type && !isBillExcludedFromAnalysis(item))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function averageAmount(items) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + Number(item.amount || 0), 0) / items.length;
}

function balanceLevel(balance) {
  const absolute = Math.abs(Number(balance || 0));
  if (absolute >= 1000) return "key";
  if (absolute >= 500) return "attention";
  if (absolute <= 100) return "balanced";
  return "normal";
}

function getDaysUntil(dateText) {
  if (!dateText) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateText);
  target.setHours(0, 0, 0, 0);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function getSubscriptionMonthlyCost(item) {
  const amount = Number(item.amount || 0);
  if (item.cycle === "yearly") return amount / 12;
  if (item.cycle === "quarterly") return amount / 3;
  return amount;
}

function advanceSubscriptionDate(dateText, cycle) {
  const source = dateText ? new Date(dateText) : new Date();
  if (Number.isNaN(source.getTime())) return "";
  const next = new Date(source);
  if (cycle === "yearly") {
    next.setFullYear(next.getFullYear() + 1);
  } else if (cycle === "quarterly") {
    next.setMonth(next.getMonth() + 3);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next.toISOString().slice(0, 10);
}

function parseCategoryBudgets(value) {
  return splitCommaText(value)
    .map((item) => {
      const [category, amount] = item.split(":");
      return {
        category: String(category || "").trim(),
        amount: Number(amount || 0),
      };
    })
    .filter((item) => item.category && item.amount >= 0);
}

function getMonthKey(dateText) {
  return String(dateText || "").slice(0, 7);
}

function addMonths(date, count) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + count);
  return next;
}

function addDays(dateText, count) {
  const source = dateText ? new Date(dateText) : new Date();
  if (Number.isNaN(source.getTime())) return "";
  source.setDate(source.getDate() + count);
  return source.toISOString().slice(0, 10);
}

function buildSubscriptionForecast(subscriptions, months = 6) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = addMonths(today, months);
  const forecastItems = [];

  subscriptions
    .filter((item) => item.status !== "paused" && item.status !== "cancelled")
    .forEach((item) => {
      let renewalDate = item.nextRenewalDate;
      let guard = 0;

      while (renewalDate && getDaysUntil(renewalDate) < 0 && guard < 24) {
        renewalDate = advanceSubscriptionDate(renewalDate, item.cycle);
        guard += 1;
      }

      while (renewalDate && guard < 48) {
        const date = new Date(renewalDate);
        if (Number.isNaN(date.getTime()) || date > endDate) break;
        if (date >= today) {
          forecastItems.push({
            subscriptionId: item.id,
            name: item.name,
            date: renewalDate,
            amount: Number(item.amount || 0),
            category: item.category || "订阅",
            cycle: item.cycle || "monthly",
            autoRenew: Boolean(item.autoRenew),
          });
        }
        renewalDate = advanceSubscriptionDate(renewalDate, item.cycle);
        guard += 1;
      }
    });

  forecastItems.sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));

  const forecastMonthlyTotals = Object.entries(
    forecastItems.reduce((map, item) => {
      const month = getMonthKey(item.date);
      map[month] = (map[month] || 0) + Number(item.amount || 0);
      return map;
    }, {}),
  ).map(([month, amount]) => ({ month, amount }));

  return {
    forecastItems,
    forecastMonthlyTotals,
    nextThirtyDaysTotal: forecastItems
      .filter((item) => {
        const days = getDaysUntil(item.date);
        return days !== null && days >= 0 && days <= 30;
      })
      .reduce((sum, item) => sum + Number(item.amount || 0), 0),
  };
}

function getSubscriptionReminder(daysUntilRenewal) {
  if (daysUntilRenewal === null) return { level: "normal", label: "未设置到期" };
  if (daysUntilRenewal < 0) return { level: "expired", label: `已过期 ${Math.abs(daysUntilRenewal)} 天` };
  if (daysUntilRenewal === 0) return { level: "urgent", label: "今天到期" };
  if (daysUntilRenewal <= 7) return { level: "urgent", label: "7 天内到期" };
  if (daysUntilRenewal <= 15) return { level: "soon", label: "15 天内到期" };
  if (daysUntilRenewal <= 30) return { level: "watch", label: "30 天内到期" };
  return { level: "normal", label: "正常跟进" };
}

function getSubscriptionAdvice(item, monthlyCost) {
  const usage = item.usageFrequency || "unknown";
  const necessity = item.necessity || "optional";
  const satisfaction = Number(item.satisfaction || 0);
  const isLowUsage = usage === "rare";
  const isHighCost = monthlyCost >= 100;

  if (item.status === "cancelled") return { level: "muted", label: "已取消", reason: "保留记录即可" };
  if (isLowUsage && isHighCost) return { level: "danger", label: "考虑取消", reason: "低频使用且月均成本偏高" };
  if (isLowUsage && necessity !== "essential") return { level: "warning", label: "续费前复盘", reason: "使用频率较低" };
  if (satisfaction > 0 && satisfaction <= 2) return { level: "warning", label: "考虑替代", reason: "满意度较低" };
  if (necessity === "replaceable" && monthlyCost >= 50) return { level: "warning", label: "寻找替代", reason: "可替代且存在持续成本" };
  if (necessity === "essential" && usage === "high") return { level: "good", label: "建议保留", reason: "高频且必要" };
  return { level: "normal", label: "继续观察", reason: "等待更多使用记录" };
}

function getSubscriptionReview(item, monthlyCost) {
  const daysUntilReview = getDaysUntil(item.nextReviewDate);
  const reasons = [];

  if (daysUntilReview !== null && daysUntilReview <= 0) reasons.push("复盘到期");
  if (item.daysUntilRenewal !== null && item.daysUntilRenewal >= 0 && item.daysUntilRenewal <= 7) reasons.push("续费临近");
  if (monthlyCost >= 100) reasons.push("月均成本偏高");
  if (item.usageFrequency === "rare") reasons.push("使用频率偏低");
  if (Number(item.satisfaction || 0) > 0 && Number(item.satisfaction || 0) <= 2) reasons.push("满意度偏低");
  if (item.status === "paused") reasons.push("暂停后待确认");

  const level = reasons.includes("复盘到期") || reasons.includes("续费临近") ? "urgent" : reasons.length ? "watch" : "normal";
  return {
    daysUntilReview,
    reasons,
    level,
    label: reasons.length ? reasons.slice(0, 2).join("、") : "无需立即复盘",
  };
}

function isDoneStatus(status) {
  return status === "已完成" || status === "done";
}

function sortByDateDesc(items) {
  return [...items].sort((left, right) =>
    String(right.updatedAt || right.date || right.dueDate || right.createdAt || "").localeCompare(
      String(left.updatedAt || left.date || left.dueDate || left.createdAt || ""),
    ),
  );
}

function buildEntryPayload(formData, existingEntry = null) {
  const mode = formData.get("entryMode");
  const entryId = formData.get("entryId");
  const type = formData.get("type");
  const originalType = formData.get("originalType") || type;
  const today = new Date().toISOString().slice(0, 10);
  const createdAt = existingEntry?.createdAt || today;

  const noteContent = readText(formData, "noteContent");
  const sourceUrl = readText(formData, "sourceUrl");
  const description = readText(formData, "description");
  const title = deriveNoteTitle({
    title: readText(formData, "title"),
    description,
    content: noteContent,
    sourceUrl,
  });

  const base = {
    id: mode === "edit" ? entryId : createId(type[0] || "entry"),
    title,
    description,
    tags: splitCommaText(formData.get("tags")),
    isFavorite: existingEntry?.isFavorite || false,
    createdAt,
    updatedAt: today,
  };

  const category = readText(formData, "category");
  if (category) {
    base.category = category;
  }

  const typedPayloads = {
    tasks: {
      status: formData.get("taskStatus") || "待处理",
      priority: formData.get("priority") || "中",
      dueDate: formData.get("dueDate") || today,
      projectId: readText(formData, "taskProjectId"),
    },
    notes: {
      category: category || "快速记录",
      pinned: formData.get("pinned") === "on",
      noteType: formData.get("noteType") || "note",
      content: noteContent,
      sourceUrl,
      projectId: readText(formData, "noteProjectId"),
    },
    bills: {
      type: formData.get("billType") || "支出",
      amount: Number(formData.get("amount") || 0),
      category: category || "未分类",
      date: formData.get("billDate") || today,
      projectId: readText(formData, "projectId"),
      source: readText(formData, "billSource") || "手动",
      payer: readText(formData, "billPayer") || "家庭账户",
      familyMember: readText(formData, "billFamilyMember"),
      fixedExpenseType: readText(formData, "billFixedExpense"),
      mortgageDueDay: Number(formData.get("mortgageDueDay") || 0) || "",
      mortgageRemainingTerms: Number(formData.get("mortgageRemainingTerms") || 0) || "",
    },
    collections: {
      category: category || "项目",
      status: formData.get("collectionStatus") || "规划中",
      progress: Number(formData.get("progress") || 0),
    },
  };

  const entry = { ...base, ...(typedPayloads[type] || {}) };

  return {
    type,
    originalType,
    entry,
  };
}

export function createStore() {
  let data = loadState();
  let recentViews = loadRecentViews();
  let changeHandler = null;

  function save(options = {}) {
    normalizeLegacyData(data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (options.notify !== false) changeHandler?.(data);
  }

  function saveRecentViews() {
    localStorage.setItem(RECENT_VIEWS_KEY, JSON.stringify(recentViews));
  }

  function findEntry(type, id) {
    return (data[type] || []).find((entry) => entry.id === id) || null;
  }

  function getContactById(contactId) {
    return (data.contacts || []).find((item) => item.id === contactId) || null;
  }

  function normalizeContactName(name) {
    return String(name || "").replace(/\s+/g, "").trim().toLowerCase();
  }

  function getContactByIdentity(name, relationType = "", phone = "") {
    const key = normalizeContactIdentity(name, relationType, phone);
    if (!key) return null;
    const exact = (data.contacts || []).find((item) => normalizeContactIdentity(item.name, item.relationType, item.phone) === key);
    if (exact) return exact;

    if (String(relationType || "").trim() || String(phone || "").trim()) return null;

    const nameKey = normalizeContactName(name);
    const sameName = (data.contacts || []).filter((item) => normalizeContactName(item.name) === nameKey);
    return sameName.length === 1 ? sameName[0] : null;
  }

  function matchesProject(item, project) {
    const keys = [project.id, project.title].filter(Boolean).map((value) => String(value).trim().toLowerCase());
    const projectId = String(item.projectId || "").trim().toLowerCase();
    if (projectId && keys.includes(projectId)) return true;
    return (item.tags || []).some((tag) => keys.includes(String(tag || "").trim().toLowerCase()));
  }

  function buildProjectOverview(project) {
    const tasks = (data.tasks || []).filter((item) => matchesProject(item, project));
    const bills = (data.bills || []).filter((item) => matchesProject(item, project));
    const notes = (data.notes || []).filter((item) => matchesProject(item, project));
    const favorEvents = (data.favorEvents || []).filter((item) => matchesProject(item, project));
    const subscriptions = (data.subscriptions || []).filter((item) => matchesProject(item, project));
    const expense = bills.filter((item) => item.type === "支出").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const income = bills.filter((item) => item.type === "收入").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const completedTasks = tasks.filter((item) => isDoneStatus(item.status)).length;
    const taskProgress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : Number(project.progress || 0);
    const timeline = sortByDateDesc([
      ...tasks.map((item) => ({ type: "事项", title: item.title, date: item.dueDate || item.updatedAt, ref: `tasks:${item.id}` })),
      ...bills.map((item) => ({ type: "账单", title: item.title, date: item.date || item.updatedAt, ref: `bills:${item.id}` })),
      ...notes.map((item) => ({ type: "笔记", title: item.title, date: item.updatedAt || item.createdAt, ref: `notes:${item.id}` })),
      ...favorEvents.map((item) => ({ type: "人情", title: item.title, date: item.date || item.updatedAt, ref: "" })),
      ...subscriptions.map((item) => ({ type: "订阅", title: item.name, date: item.nextRenewalDate || item.updatedAt, ref: "" })),
    ]).slice(0, 8);

    return {
      project,
      tasks,
      bills,
      notes,
      favorEvents,
      subscriptions,
      expense,
      income,
      balance: income - expense,
      taskProgress,
      totalLinked: tasks.length + bills.length + notes.length + favorEvents.length + subscriptions.length,
      timeline,
    };
  }

  return {
    getData() {
      return data;
    },
    setChangeHandler(handler) {
      changeHandler = typeof handler === "function" ? handler : null;
    },
    exportData() {
      return {
        ...clone(data),
        contacts: clone(data.contacts || []),
        favorEvents: clone(data.favorEvents || []),
        subscriptions: clone(data.subscriptions || []),
        bookmarks: clone(data.bookmarks || []),
      };
    },
    importData(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
      const fallback = clone(defaultData);
      data = {
        ...fallback,
        ...clone(payload),
        budgets: { ...fallback.budgets, ...(payload.budgets || {}) },
      };
      normalizeLegacyData(data);
      save({ notify: false });
      return true;
    },
    getEntry(type, id) {
      return findEntry(type, id);
    },
    getRecentViews() {
      return recentViews;
    },
    getCollections() {
      return data.collections || [];
    },
    getProjectOverview(projectId) {
      const project = findEntry("collections", projectId);
      return project ? buildProjectOverview(project) : null;
    },
    getProjectOverviews() {
      return (data.collections || []).map(buildProjectOverview);
    },
    confirmBillClassification(id) {
      const bill = findEntry("bills", id);
      if (!bill) return false;
      bill.classification = {
        ...(bill.classification || {}),
        category: bill.category || "未分类",
        confidence: Math.max(Number(bill.classification?.confidence || 0), 90),
        source: bill.classification?.source || "confirmed",
        reason: bill.classification?.reason || "用户确认分类",
        needsReview: false,
      };
      if (bill.type === "待确认") bill.type = "支出";
      bill.analysisExcluded = false;
      bill.excludeFromAnalysis = false;
      bill.tags = (bill.tags || []).filter((tag) => !["待确认", "不计入分析"].includes(tag));
      bill.updatedAt = new Date().toISOString().slice(0, 10);
      save();
      return true;
    },
    updateBillCategory(id, category) {
      const bill = findEntry("bills", id);
      const nextCategory = String(category || "").trim();
      if (!bill || !nextCategory) return false;
      const previous = { ...bill };
      bill.category = nextCategory;
      bill.classification = {
        ...(bill.classification || {}),
        category: nextCategory,
        confidence: 100,
        source: "manual",
        reason: "用户手动修正分类",
        needsReview: false,
        autoCategory: false,
      };
      if (bill.type === "待确认") bill.type = "支出";
      bill.analysisExcluded = false;
      bill.excludeFromAnalysis = false;
      bill.tags = [...new Set([...(bill.tags || []).filter((tag) => !["待确认", "不计入分析"].includes(tag)), "手动分类"])];
      bill.updatedAt = new Date().toISOString().slice(0, 10);
      save();
      return true;
    },
    setBillAnalysisExcluded(id, excluded) {
      const bill = findEntry("bills", id);
      if (!bill) return false;
      bill.analysisExcluded = Boolean(excluded);
      bill.excludeFromAnalysis = Boolean(excluded);
      bill.category = bill.excludeFromAnalysis && (!bill.category || bill.category === "未分类") ? "非消费流水" : bill.category;
      bill.tags = bill.excludeFromAnalysis
        ? [...new Set([...(bill.tags || []), "不计入分析"])]
        : (bill.tags || []).filter((tag) => tag !== "不计入分析");
      bill.updatedAt = new Date().toISOString().slice(0, 10);
      save();
      return true;
    },
    save,
    reset() {
      data = clone(defaultData);
      normalizeLegacyData(data);
      recentViews = [];
      save();
      saveRecentViews();
    },
    clearData() {
      const month = new Date().toISOString().slice(0, 7);
      data = {
        tasks: [],
        bills: [],
        budgets: {
          month,
          totalBudget: 0,
          categoryBudgets: [],
          subscriptionMonthlyBudget: 0,
          subscriptionAnnualBudget: 0,
          subscriptionCategoryBudgets: [],
        },
        subscriptions: [],
        contacts: [],
        favorEvents: [],
        bookmarks: [],
        notes: [],
        collections: [],
        billClassificationRules: [],
        billNonConsumptionRules: [],
        billImportReports: [],
      };
      recentViews = [];
      save();
      saveRecentViews();
    },
    clearBillsData() {
      const month = new Date().toISOString().slice(0, 7);
      data.bills = [];
      data.billClassificationRules = [];
      data.billNonConsumptionRules = [];
      data.billImportReports = [];
      data.budgets = {
        ...(data.budgets || {}),
        month,
        totalBudget: 0,
        categoryBudgets: [],
      };
      save();
      return true;
    },
    saveBillImportReport(report = {}) {
      const createdAt = new Date().toISOString();
      const normalizedReport = {
        id: createId("bill-import-report"),
        createdAt,
        importedAt: createdAt,
        source: String(report.source || "Excel 导入").trim(),
        payer: String(report.payer || "家庭账户").trim(),
        mode: String(report.mode || "").trim(),
        imported: Number(report.imported || 0),
        skipped: Number(report.skipped || 0),
        existingDuplicates: Number(report.existingDuplicates || 0),
        fileDuplicates: Number(report.fileDuplicates || 0),
        autoCategorized: Number(report.autoCategorized || 0),
        memoryMatched: Number(report.memoryMatched || 0),
        needsReview: Number(report.needsReview || 0),
        uncategorized: Number(report.uncategorized || 0),
        errors: Number(report.errors || 0),
        monthCount: Number(report.monthCount || 0),
        contactCount: Number(report.contactCount || 0),
        favorCount: Number(report.favorCount || 0),
        subscriptionCount: Number(report.subscriptionCount || 0),
        months: Array.isArray(report.months) ? report.months.slice(0, 12) : [],
        sheetReports: Array.isArray(report.sheetReports) ? report.sheetReports.slice(0, 12) : [],
        errorSamples: Array.isArray(report.errorSamples) ? report.errorSamples.slice(0, 8) : [],
        duplicateSamples: Array.isArray(report.duplicateSamples) ? report.duplicateSamples.slice(0, 8) : [],
      };
      data.billImportReports = [normalizedReport, ...(data.billImportReports || [])].slice(0, 20);
      save();
      return normalizedReport.id;
    },
    toggleFavorite(type, id) {
      const item = findEntry(type, id);
      if (!item) return false;
      item.isFavorite = !item.isFavorite;
      save();
      return true;
    },
    completeTask(id) {
      const item = findEntry("tasks", id);
      if (!item) return false;
      item.status = "已完成";
      item.updatedAt = new Date().toISOString().slice(0, 10);
      save();
      return true;
    },
    batchUpdateTasks(ids, payload) {
      const selectedIds = new Set(ids || []);
      const status = String(payload.status || "").trim();
      const projectId = String(payload.projectId || "").trim();

      if (!selectedIds.size || (!status && !projectId)) return 0;

      const today = new Date().toISOString().slice(0, 10);
      let updated = 0;
      (data.tasks || []).forEach((task) => {
        if (!selectedIds.has(task.id)) return;
        if (status) task.status = status;
        if (projectId) task.projectId = projectId;
        task.updatedAt = today;
        updated += 1;
      });

      if (updated) save();
      return updated;
    },
    deleteEntry(type, id) {
      if (type === "contacts") {
        return this.deleteContact(id);
      }
      data[type] = (data[type] || []).filter((entry) => entry.id !== id);
      recentViews = recentViews.filter((entry) => !(entry.type === type && entry.id === id));
      save();
      saveRecentViews();
      return true;
    },
    createTaskFromNote(noteId) {
      const note = findEntry("notes", noteId);
      if (!note) return false;

      const today = new Date().toISOString().slice(0, 10);
      const task = {
        id: createId("t"),
        title: note.title,
        description: note.description || note.content || "来自笔记转换",
        status: "待处理",
        priority: "中",
        dueDate: today,
        tags: [...new Set([...(note.tags || []), "笔记转事项"])],
        isFavorite: false,
        createdAt: today,
        updatedAt: today,
      };

      data.tasks.unshift(task);
      note.convertedTaskId = task.id;
      note.updatedAt = today;
      save();
      return task.id;
    },
    createRepaymentBill(payload = {}) {
      const today = new Date().toISOString().slice(0, 10);
      const repaymentType = String(payload.repaymentType || "信用卡").trim();
      const amount = Number(payload.amount || 0);
      if (!repaymentType || !Number.isFinite(amount) || amount <= 0) return "";

      const title = String(payload.title || "").trim() || `${repaymentType}还款`;
      const billId = createId("b");
      data.bills.unshift({
        id: billId,
        title,
        description: String(payload.description || "").trim() || `${repaymentType} / 还款记录`,
        type: "支出",
        amount,
        category: String(payload.category || "").trim() || "还款",
        date: String(payload.date || "").trim() || today,
        projectId: String(payload.projectId || "").trim(),
        source: String(payload.source || "").trim() || "手动",
        payer: String(payload.payer || "").trim() || "家庭账户",
        familyMember: String(payload.familyMember || "").trim(),
        fixedExpenseType: repaymentType,
        mortgageDueDay: Number(payload.dueDay || 0) || "",
        mortgageRemainingTerms: Number(payload.remainingTerms || 0) || "",
        paymentMethod: String(payload.paymentMethod || "").trim(),
        tags: [...new Set([repaymentType, "还款", ...(String(payload.tags || "").split(/[,\s，、]+/).filter(Boolean))])],
        isFavorite: false,
        createdAt: today,
        updatedAt: today,
      });
      save();
      return billId;
    },
    createIncomeBill(payload = {}) {
      const today = new Date().toISOString().slice(0, 10);
      const amount = Number(payload.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) return "";
      const incomeType = String(payload.incomeType || "工资").trim() || "工资";
      const title = String(payload.title || "").trim() || `${incomeType}收入`;
      const billId = createId("b");
      data.bills.unshift({
        id: billId,
        title,
        description: String(payload.description || "").trim() || `${incomeType} / 收入记录`,
        type: "收入",
        amount,
        category: incomeType,
        date: String(payload.date || "").trim() || today,
        projectId: String(payload.projectId || "").trim(),
        source: String(payload.source || "").trim() || "手动",
        payer: String(payload.payer || "").trim() || "家庭账户",
        familyMember: String(payload.familyMember || "").trim(),
        fixedExpenseType: "",
        mortgageDueDay: "",
        mortgageRemainingTerms: "",
        tags: [...new Set([incomeType, "收入", ...(String(payload.tags || "").split(/[,\s，、]+/).filter(Boolean))])],
        isFavorite: false,
        createdAt: today,
        updatedAt: today,
      });
      save();
      return billId;
    },
    createBillMonthlyReview(month) {
      const targetMonth = String(month || new Date().toISOString().slice(0, 7)).slice(0, 7);
      const today = new Date().toISOString().slice(0, 10);
      const bills = (data.bills || []).filter((item) => String(item.date || "").startsWith(targetMonth));
      const analysisBills = bills.filter((item) => !isBillExcludedFromAnalysis(item));
      const excludedBills = bills.filter((item) => isBillExcludedFromAnalysis(item));
      const income = analysisBills.filter((item) => item.type === "收入").reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const expenseItems = analysisBills.filter((item) => item.type !== "收入");
      const expense = expenseItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const balance = income - expense;
      const categoryMap = expenseItems.reduce((map, item) => {
        const category = item.category || "未分类";
        map[category] = (map[category] || 0) + Number(item.amount || 0);
        return map;
      }, {});
      const topCategories = Object.entries(categoryMap).sort((left, right) => right[1] - left[1]).slice(0, 5);
      const health = calculateMonthlyFinanceHealth({ income, expense, expenseItems, contextBills: data.bills || [] });
      const fixedExpense = health.fixedExpense;
      const abnormalLine = expenseItems
        .slice()
        .sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0))
        .slice(0, 3)
        .map((item) => `- ${item.date || "未设置日期"} ${item.title || item.category || "支出"}：¥${Number(item.amount || 0).toFixed(2)}`)
        .join("\n") || "- 暂无支出记录";
      const categoryLine = topCategories.map(([category, amount]) => `- ${category}：¥${Number(amount || 0).toFixed(2)}`).join("\n") || "- 暂无分类支出";
      const actionLine = buildMonthlyFinanceActions({ income, expense, expenseItems, health }).join("\n") || "- 暂无必须处理的问题，继续观察趋势。";
      const componentLine = health.components.map((item) => `- ${item.label}：${item.score} 分，权重 ${item.weight}%，${item.hint}`).join("\n");
      const weakLine = health.weakItems.map((item) => `- ${item.label}：${item.score} 分，${item.hint}`).join("\n") || "- 暂无明显短板";
      const healthText = income <= 0 ? "缺少收入数据，健康判断会偏保守。" : balance < 0 ? "本月现金流为负，需要优先复核大额支出与固定成本。" : health.score < 70 ? "本月财务健康分偏低，建议优先处理薄弱项。" : "本月现金流为正，整体较稳定。";
      const title = `${targetMonth} 生活收支复盘`;
      const content = [
        `# ${title}`,
        "",
        "## 核心数据",
        `- 收入：¥${income.toFixed(2)}`,
        `- 支出：¥${expense.toFixed(2)}`,
        `- 结余：¥${balance.toFixed(2)}`,
        `- 固定支出：¥${fixedExpense.toFixed(2)}`,
        `- 还款支出：¥${health.repayment.toFixed(2)}`,
        `- 不计入分析流水：${excludedBills.length} 笔，¥${excludedBills.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)}`,
        `- 健康评分：${health.score} 分`,
        "",
        "## 健康评分拆解",
        componentLine,
        "",
        "## 薄弱项",
        weakLine,
        "",
        "## 行动清单",
        actionLine,
        "",
        "## 支出结构",
        categoryLine,
        "",
        "## 大额支出",
        abnormalLine,
        "",
        "## 复盘判断",
        healthText,
      ].join("\n");
      const existing = (data.notes || []).find((item) => item.title === title && item.noteType === "summary");
      if (existing) {
        existing.content = content;
        existing.description = healthText;
        existing.updatedAt = today;
        save();
        return existing.id;
      }
      const note = {
        id: createId("n"),
        title,
        description: healthText,
        category: "生活收支",
        noteType: "summary",
        content,
        sourceUrl: "",
        projectId: "",
        tags: ["月度复盘", "生活收支", targetMonth],
        isFavorite: false,
        pinned: false,
        createdAt: today,
        updatedAt: today,
      };
      data.notes.unshift(note);
      save();
      return note.id;
    },
    quickCaptureNote(payload) {
      const today = new Date().toISOString().slice(0, 10);
      const noteType = payload.noteType || "idea";
      const content = String(payload.content || "").trim();
      const description = String(payload.description || "").trim();
      const sourceUrl = String(payload.sourceUrl || "").trim();
      const title = deriveNoteTitle({
        title: String(payload.title || "").trim(),
        description,
        content,
        sourceUrl,
      });

      const note = {
        id: createId("n"),
        title,
        description: description || excerptText(content, 60) || (sourceUrl ? "链接收录" : "快速记录"),
        category: payload.category || (noteType === "link" ? "链接收录" : noteType === "idea" ? "灵感池" : "快速记录"),
        tags: splitCommaText(payload.tags),
        pinned: false,
        isFavorite: false,
        noteType,
        content,
        sourceUrl,
        createdAt: today,
        updatedAt: today,
      };

      data.notes.unshift(note);
      save();
      return note.id;
    },
    saveBudget(payload) {
      const month = String(payload.month || "").trim();
      if (!month) return false;

      data.budgets = {
        ...(data.budgets || {}),
        month,
        totalBudget: Number(payload.totalBudget || 0),
        categoryBudgets: parseCategoryBudgets(payload.categoryBudgets),
      };

      save();
      return true;
    },
    saveFuturePlan(payload = {}) {
      const today = new Date().toISOString().slice(0, 10);
      const title = String(payload.title || "").trim();
      const amount = Number(payload.amount || 0);
      const date = String(payload.date || "").trim();
      if (!title || !Number.isFinite(amount) || amount <= 0 || !date) return "";

      const plan = {
        id: createId("fp"),
        title,
        amount,
        date,
        planType: String(payload.planType || "计划支出").trim(),
        priority: String(payload.priority || "中").trim(),
        fundingSource: String(payload.fundingSource || "工资").trim(),
        status: String(payload.status || "计划中").trim(),
        note: String(payload.note || "").trim(),
        createdAt: today,
        updatedAt: today,
      };

      data.budgets = {
        ...(data.budgets || {}),
        futurePlans: [plan, ...((data.budgets || {}).futurePlans || [])],
      };
      save();
      return plan.id;
    },
    updateFuturePlanStatus(planId, status = "已准备") {
      const plans = (data.budgets || {}).futurePlans || [];
      const plan = plans.find((item) => item.id === planId);
      if (!plan) return false;
      plan.status = String(status || "已准备");
      plan.updatedAt = new Date().toISOString().slice(0, 10);
      save();
      return true;
    },
    deleteFuturePlan(planId) {
      const plans = (data.budgets || {}).futurePlans || [];
      const nextPlans = plans.filter((item) => item.id !== planId);
      if (nextPlans.length === plans.length) return false;
      data.budgets = {
        ...(data.budgets || {}),
        futurePlans: nextPlans,
      };
      save();
      return true;
    },
    saveSubscriptionBudget(payload) {
      data.budgets = {
        ...(data.budgets || {}),
        subscriptionMonthlyBudget: Number(payload.subscriptionMonthlyBudget || 0),
        subscriptionAnnualBudget: Number(payload.subscriptionAnnualBudget || 0),
        subscriptionCategoryBudgets: parseCategoryBudgets(payload.subscriptionCategoryBudgets),
      };

      save();
      return true;
    },
    addContact(payload) {
      const today = new Date().toISOString().slice(0, 10);
      const contact = {
        id: createId("contact"),
        name: String(payload.name || "").trim(),
        relationType: String(payload.relationType || "").trim() || "其他",
        phone: String(payload.phone || "").trim(),
        note: String(payload.note || "").trim(),
        isImportant: Boolean(payload.isImportant),
        createdAt: today,
        updatedAt: today,
      };

      if (!contact.name) return false;
      data.contacts.unshift(contact);
      save();
      return contact.id;
    },
    updateContact(contactId, payload) {
      const contact = getContactById(contactId);
      if (!contact) return false;
      contact.name = String(payload.name || "").trim() || contact.name;
      contact.relationType = String(payload.relationType || "").trim() || "其他";
      contact.phone = String(payload.phone || "").trim();
      contact.note = String(payload.note || "").trim();
      contact.updatedAt = new Date().toISOString().slice(0, 10);
      save();
      return true;
    },
    deleteContact(contactId) {
      const relatedCount = (data.favorEvents || []).filter((event) => event.contactId === contactId).length;
      if (relatedCount > 0) return { ok: false, relatedCount };
      data.contacts = (data.contacts || []).filter((contact) => contact.id !== contactId);
      recentViews = recentViews.filter((entry) => !(entry.type === "contacts" && entry.id === contactId));
      save();
      saveRecentViews();
      return { ok: true, relatedCount: 0 };
    },
    mergeContacts(sourceContactId, targetContactId) {
      if (!sourceContactId || !targetContactId || sourceContactId === targetContactId) return false;
      const source = getContactById(sourceContactId);
      const target = getContactById(targetContactId);
      if (!source || !target) return false;

      (data.favorEvents || []).forEach((event) => {
        if (event.contactId === sourceContactId) {
          event.contactId = targetContactId;
          event.updatedAt = new Date().toISOString().slice(0, 10);
        }
      });

      target.phone = target.phone || source.phone || "";
      target.note = [target.note, source.note].filter(Boolean).join("；");
      target.relationType = target.relationType || source.relationType || "其他";
      target.updatedAt = new Date().toISOString().slice(0, 10);
      data.contacts = (data.contacts || []).filter((contact) => contact.id !== sourceContactId);
      recentViews = recentViews.filter((entry) => !(entry.type === "contacts" && entry.id === sourceContactId));
      save();
      saveRecentViews();
      return true;
    },
    addFavorEvent(payload) {
      const today = new Date().toISOString().slice(0, 10);
      let contactId = String(payload.contactId || "").trim();
      let contact = getContactById(contactId);
      const newContactName = String(payload.newContactName || "").trim();

      if (!contact && newContactName) {
        contact = getContactByIdentity(newContactName, payload.newContactRelationType, payload.newContactPhone);
        contactId = contact?.id || "";
      }

      if (!contact && newContactName) {
        const newContactId = this.addContact({
          name: newContactName,
          relationType: payload.newContactRelationType,
          phone: payload.newContactPhone,
          note: payload.newContactNote,
          isImportant: false,
        });
        contactId = newContactId || "";
        contact = getContactById(contactId);
      }

      if (!contact) return false;

      let linkedBillId = "";
      if (payload.syncBill) {
        linkedBillId = createId("b");
        data.bills.unshift({
          id: linkedBillId,
          title: `${contact.name}${payload.direction === "received" ? "随礼收入" : "人情支出"}`,
          description: String(payload.note || "").trim() || `${payload.eventType || "往来"} / ${contact.name}`,
          type: payload.direction === "received" ? "收入" : "支出",
          amount: Number(payload.amount || 0),
          category: "人情往来",
          date: payload.date || today,
          tags: ["人情往来", contact.relationType].filter(Boolean),
          projectId: String(payload.projectId || "").trim(),
          isFavorite: false,
          createdAt: today,
          updatedAt: today,
        });
      }

      const favorEvent = {
        id: createId("favor"),
        contactId,
        title: String(payload.title || "").trim() || `${contact.name}${payload.eventType || "往来"}`,
        eventType: String(payload.eventType || "").trim() || "其他",
        direction: payload.direction === "received" ? "received" : "given",
        amount: Number(payload.amount || 0),
        date: payload.date || today,
        giftName: String(payload.giftName || "").trim(),
        note: String(payload.note || "").trim(),
        projectId: String(payload.projectId || "").trim(),
        linkedBillId,
        isReturned: false,
        returnEventId: "",
        returnForEventId: "",
        createdAt: today,
        updatedAt: today,
      };

      data.favorEvents.unshift(favorEvent);

      save();

      return favorEvent.id;
    },
    updateFavorEvent(eventId, payload) {
      const event = (data.favorEvents || []).find((item) => item.id === eventId);
      if (!event) return false;
      event.title = String(payload.title || "").trim();
      event.eventType = String(payload.eventType || "").trim() || "其他";
      event.direction = payload.direction === "received" ? "received" : "given";
      event.amount = Number(payload.amount || 0);
      event.date = String(payload.date || "").trim() || event.date;
      event.giftName = String(payload.giftName || "").trim();
      event.note = String(payload.note || "").trim();
      event.projectId = String(payload.projectId || "").trim();
      event.updatedAt = new Date().toISOString().slice(0, 10);

      if (event.linkedBillId) {
        const contact = getContactById(event.contactId);
        const bill = (data.bills || []).find((item) => item.id === event.linkedBillId);
        if (bill) {
          bill.title = `${contact?.name || ""}${event.direction === "received" ? "随礼收入" : "人情支出"}`;
          bill.description = event.note || `${event.eventType || "往来"} / ${contact?.name || "未关联"}`;
          bill.type = event.direction === "received" ? "收入" : "支出";
          bill.amount = Number(event.amount || 0);
          bill.date = event.date;
          bill.projectId = event.projectId;
          bill.updatedAt = event.updatedAt;
        }
      }

      save();
      return true;
    },
    addSubscription(payload) {
      const today = new Date().toISOString().slice(0, 10);
      const subscription = {
        id: createId("sub"),
        name: String(payload.name || "").trim(),
        amount: Number(payload.amount || 0),
        cycle: String(payload.cycle || "").trim() || "monthly",
        nextRenewalDate: String(payload.nextRenewalDate || "").trim(),
        category: String(payload.category || "").trim() || "订阅",
        owner: String(payload.owner || "").trim() || "家庭账户",
        paymentMethod: String(payload.paymentMethod || "").trim(),
        projectId: String(payload.projectId || "").trim(),
        websiteUrl: String(payload.websiteUrl || "").trim(),
        accountName: String(payload.accountName || "").trim(),
        accountPassword: String(payload.accountPassword || "").trim(),
        note: String(payload.note || "").trim(),
        usageFrequency: String(payload.usageFrequency || "").trim() || "unknown",
        necessity: String(payload.necessity || "").trim() || "optional",
        satisfaction: Number(payload.satisfaction || 0),
        lastUsedAt: String(payload.lastUsedAt || "").trim(),
        lastReviewedAt: String(payload.lastReviewedAt || "").trim(),
        nextReviewDate: String(payload.nextReviewDate || "").trim() || addDays(today, 30),
        autoRenew: Boolean(payload.autoRenew),
        status: String(payload.status || "").trim() || "active",
        createdAt: today,
        updatedAt: today,
      };

      if (!subscription.name || !subscription.nextRenewalDate) return false;
      data.subscriptions = data.subscriptions || [];
      data.subscriptions.unshift(subscription);
      save();
      return subscription.id;
    },
    createBillFromSubscription(subscriptionId) {
      const today = new Date().toISOString().slice(0, 10);
      const subscription = (data.subscriptions || []).find((item) => item.id === subscriptionId);
      if (!subscription) return false;

      const billId = createId("b");
      data.bills.unshift({
        id: billId,
        title: `${subscription.name} 订阅扣费`,
        description: subscription.note || `${subscription.name} 本期订阅费用`,
        type: "支出",
        amount: Number(subscription.amount || 0),
        category: subscription.category || "订阅",
        date: today,
        source: subscription.paymentMethod || "订阅扣费",
        payer: subscription.owner || "家庭账户",
        paymentMethod: subscription.paymentMethod || "",
        tags: ["订阅", subscription.category].filter(Boolean),
        projectId: subscription.projectId || "",
        subscriptionId: subscription.id,
        isFavorite: false,
        createdAt: today,
        updatedAt: today,
      });

      subscription.lastBillDate = today;
      subscription.lastBillId = billId;
      subscription.updatedAt = today;
      save();
      return billId;
    },
    renewSubscription(subscriptionId) {
      const today = new Date().toISOString().slice(0, 10);
      const subscription = (data.subscriptions || []).find((item) => item.id === subscriptionId);
      if (!subscription) return false;

      const billId = this.createBillFromSubscription(subscriptionId);
      if (!billId) return false;

      subscription.nextRenewalDate = advanceSubscriptionDate(subscription.nextRenewalDate || today, subscription.cycle);
      subscription.status = "active";
      subscription.lastRenewedAt = today;
      subscription.updatedAt = today;
      save();
      return subscription.nextRenewalDate;
    },
    updateSubscriptionStatus(subscriptionId, status) {
      const allowed = new Set(["active", "paused", "cancelled"]);
      const nextStatus = allowed.has(status) ? status : "active";
      const subscription = (data.subscriptions || []).find((item) => item.id === subscriptionId);
      if (!subscription) return false;
      subscription.status = nextStatus;
      subscription.updatedAt = new Date().toISOString().slice(0, 10);
      save();
      return true;
    },
    reviewSubscription(subscriptionId) {
      const today = new Date().toISOString().slice(0, 10);
      const subscription = (data.subscriptions || []).find((item) => item.id === subscriptionId);
      if (!subscription) return false;
      subscription.lastReviewedAt = today;
      subscription.nextReviewDate = addDays(today, 30);
      subscription.updatedAt = today;
      save();
      return subscription.nextReviewDate;
    },
    markFavorReturned(favorEventId, returnEventId = "") {
      const event = (data.favorEvents || []).find((item) => item.id === favorEventId);
      if (!event) return false;
      event.isReturned = true;
      event.returnEventId = String(returnEventId || "").trim();
      event.updatedAt = new Date().toISOString().slice(0, 10);
      save();
      return true;
    },
    getFavorStats() {
      const events = data.favorEvents || [];
      const received = events
        .filter((item) => item.direction === "received")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const given = events
        .filter((item) => item.direction === "given")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);

      return {
        totalContacts: (data.contacts || []).length,
        totalEvents: events.length,
        received,
        given,
        balance: received - given,
      };
    },
    getPendingFavorReturns() {
      return (data.favorEvents || [])
        .filter((event) => event.direction === "received" && !event.isReturned)
        .map((event) => {
          const contact = getContactById(event.contactId);
          return {
            ...event,
            contact,
          };
        })
        .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
    },
    getFavorRecommendations() {
      const events = data.favorEvents || [];

      return this.getPendingFavorReturns().map((pendingEvent) => {
        const relatedEvents = events.filter((event) => event.contactId === pendingEvent.contactId && event.id !== pendingEvent.id);
        const sameTypeEvents = relatedEvents.filter((event) => event.eventType === pendingEvent.eventType);
        const sameTypeReceived = sameTypeEvents
          .filter((event) => event.direction === "received")
          .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
        const referenceAmount = Number(sameTypeReceived[0]?.amount || pendingEvent.amount || 0);
        const averageSource = sameTypeEvents.length ? sameTypeEvents : relatedEvents;
        const historyAverage = averageAmount(averageSource);
        const suggestedAmount = Math.max(referenceAmount, Math.round(historyAverage || 0));

        const received = relatedEvents
          .concat([pendingEvent])
          .filter((event) => event.direction === "received")
          .reduce((sum, event) => sum + Number(event.amount || 0), 0);
        const given = relatedEvents
          .filter((event) => event.direction === "given")
          .reduce((sum, event) => sum + Number(event.amount || 0), 0);
        const balance = received - given;

        return {
          event: pendingEvent,
          contact: pendingEvent.contact,
          suggestedAmount,
          balance,
          level: balanceLevel(balance),
          reason:
            sameTypeEvents.length > 0
              ? "参考同类往来记录与最近一次金额"
              : relatedEvents.length > 0
                ? "暂时没有同类历史，改为参考该关系整体往来均值"
                : "暂无历史记录，先参考本次收到金额",
        };
      });
    },
    getSubscriptionsOverview() {
      const subscriptions = (data.subscriptions || [])
        .map((item) => {
          const daysUntilRenewal = getDaysUntil(item.nextRenewalDate);
          const monthlyCost = getSubscriptionMonthlyCost(item);
          const annualCost = monthlyCost * 12;
          const reminder = getSubscriptionReminder(daysUntilRenewal);
          const advice = getSubscriptionAdvice(item, monthlyCost);
          const review = getSubscriptionReview({ ...item, daysUntilRenewal }, monthlyCost);
          return {
            ...item,
            daysUntilRenewal,
            monthlyCost,
            annualCost,
            reminderLabel: reminder.label,
            level: reminder.level,
            advice,
            review,
          };
        })
        .sort((left, right) => {
          const a = left.daysUntilRenewal ?? Number.MAX_SAFE_INTEGER;
          const b = right.daysUntilRenewal ?? Number.MAX_SAFE_INTEGER;
          return a - b;
        });

      const activeSubscriptions = subscriptions.filter((item) => item.status !== "paused" && item.status !== "cancelled");
      const estimatedMonthlyCost = activeSubscriptions.reduce((sum, item) => sum + Number(item.monthlyCost || 0), 0);
      const buildTotals = (items, getKey) =>
        Object.entries(
          items.reduce((map, item) => {
            const key = getKey(item) || "未指定";
            map[key] = map[key] || { count: 0, amount: 0 };
            map[key].count += 1;
            map[key].amount += Number(item.monthlyCost || 0);
            return map;
          }, {}),
        )
          .map(([label, value]) => ({ label, count: value.count, amount: value.amount }))
          .sort((left, right) => right.amount - left.amount);
      const categoryTotals = Object.entries(
        activeSubscriptions.reduce((map, item) => {
          const category = item.category || "订阅";
          map[category] = (map[category] || 0) + Number(item.monthlyCost || 0);
          return map;
        }, {}),
      )
        .map(([category, amount]) => ({ category, amount }))
        .sort((left, right) => right.amount - left.amount);
      const budgets = data.budgets || {};
      const subscriptionMonthlyBudget = Number(budgets.subscriptionMonthlyBudget || 0);
      const subscriptionAnnualBudget = Number(budgets.subscriptionAnnualBudget || 0);
      const subscriptionCategoryBudgets = budgets.subscriptionCategoryBudgets || [];
      const categoryBudgetRows = subscriptionCategoryBudgets.map((budget) => {
        const spent = Number(categoryTotals.find((item) => item.category === budget.category)?.amount || 0);
        const amount = Number(budget.amount || 0);
        return {
          ...budget,
          spent,
          remaining: amount - spent,
          percent: amount > 0 ? Math.min(100, Math.round((spent / amount) * 100)) : 0,
          overBudget: amount > 0 && spent > amount,
        };
      });
      const forecast = buildSubscriptionForecast(subscriptions, 6);

      return {
        items: subscriptions,
        total: subscriptions.length,
        estimatedMonthlyCost,
        estimatedAnnualCost: estimatedMonthlyCost * 12,
        subscriptionBudget: {
          monthlyBudget: subscriptionMonthlyBudget,
          annualBudget: subscriptionAnnualBudget,
          monthlyRemaining: subscriptionMonthlyBudget - estimatedMonthlyCost,
          annualRemaining: subscriptionAnnualBudget - estimatedMonthlyCost * 12,
          monthlyOverBudget: subscriptionMonthlyBudget > 0 && estimatedMonthlyCost > subscriptionMonthlyBudget,
          annualOverBudget: subscriptionAnnualBudget > 0 && estimatedMonthlyCost * 12 > subscriptionAnnualBudget,
          categoryBudgetRows,
        },
        forecastItems: forecast.forecastItems,
        forecastMonthlyTotals: forecast.forecastMonthlyTotals,
        nextThirtyDaysTotal: forecast.nextThirtyDaysTotal,
        upcoming: subscriptions.filter((item) => item.daysUntilRenewal !== null && item.daysUntilRenewal >= 0 && item.daysUntilRenewal <= 30),
        urgent: subscriptions.filter((item) => item.level === "urgent" || item.level === "expired"),
        expired: subscriptions.filter((item) => item.level === "expired"),
        dueToday: subscriptions.filter((item) => item.daysUntilRenewal === 0),
        autoRenewing: subscriptions.filter((item) => item.autoRenew && item.status !== "cancelled"),
        manualRenewing: subscriptions.filter((item) => !item.autoRenew && item.status !== "cancelled"),
        cancellable: subscriptions.filter((item) => item.advice.level === "danger" || item.advice.label.includes("取消")),
        highCost: subscriptions.filter((item) => Number(item.monthlyCost || 0) >= 100),
        reviewQueue: subscriptions.filter((item) => item.status !== "cancelled" && item.review.reasons.length > 0),
        categoryTotals,
        ownerTotals: buildTotals(activeSubscriptions, (item) => item.owner || item.payer || "家庭账户"),
        paymentTotals: buildTotals(activeSubscriptions, (item) => item.paymentMethod || "未指定"),
        statusTotals: buildTotals(subscriptions, (item) => item.status || "active"),
      };
    },
    getMonthlyBillStats(month) {
      const monthlyBills = (data.bills || []).filter((item) => String(item.date || "").startsWith(month));
      const income = sumAmounts(monthlyBills, "收入");
      const expense = sumAmounts(monthlyBills, "支出");

      return {
        month,
        items: monthlyBills,
        income,
        expense,
        balance: income - expense,
      };
    },
    importBills(items, options = {}) {
      const today = new Date().toISOString().slice(0, 10);
      const bills = items.map((item) => {
        const importedType = item.type === "收入" || item.type === "支出" ? item.type : "待确认";
        const isPendingType = importedType === "待确认";
        const base = {
          id: createId("b"),
          title: item.title,
          description: item.description || "",
          type: importedType,
          amount: Number(item.amount || 0),
          category: item.category || "未分类",
          date: item.date || today,
          source: item.source || "Excel 导入",
          payer: item.payer || "家庭账户",
          familyMember: item.familyMember || "",
          fixedExpenseType: item.fixedExpenseType || "",
          mortgageDueDay: item.mortgageDueDay || "",
          mortgageRemainingTerms: item.mortgageRemainingTerms || "",
          sourceTransactionId: item.sourceTransactionId || "",
          paymentMethod: item.paymentMethod || "",
          projectId: item.projectId || "",
          tags: [...new Set([...(item.tags || []), ...(isPendingType ? ["待确认"] : [])])],
          analysisExcluded: Boolean(isPendingType || item.analysisExcluded),
          excludeFromAnalysis: Boolean(isPendingType || item.excludeFromAnalysis || item.analysisExcluded),
          isFavorite: false,
          createdAt: today,
          updatedAt: today,
        };
        return {
          ...base,
          classification: {
            category: base.category,
            confidence: base.category && base.category !== "未分类" ? 70 : 0,
            source: "raw",
            reason: isPendingType ? "手动导入模式：文件未提供收支类型，需手动确认" : "手动导入模式：按文件收支类型导入，未套用预设规则",
            needsReview: isPendingType || !base.category || base.category === "未分类",
          },
        };
      });

      data.bills.unshift(...bills);
      save();
      return {
        count: bills.length,
        items: bills,
        autoCategorized: bills.filter((item) => item.classification?.autoCategory).length,
        memoryMatched: bills.filter((item) => item.classification?.source === "memory").length,
        needsReview: bills.filter((item) => item.classification?.needsReview).length,
        uncategorized: bills.filter((item) => !item.category || item.category === "未分类").length,
      };
    },
    addBookmark(payload) {
      const today = new Date().toISOString().slice(0, 10);
      const url = String(payload.url || "").trim();
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch {
        return false;
      }

      const bookmark = {
        id: createId("bookmark"),
        title: String(payload.title || "").trim() || parsedUrl.hostname,
        url,
        description: String(payload.description || "").trim(),
        category: String(payload.category || "").trim() || "外部资料",
        tags: splitCommaText(payload.tags),
        createdAt: today,
        updatedAt: today,
      };

      data.bookmarks = data.bookmarks || [];
      data.bookmarks.unshift(bookmark);
      save();
      return bookmark.id;
    },
    trackRecentView(type, id) {
      const entry = findEntry(type, id);
      if (!entry) return;

      const viewedAt = new Date().toISOString().slice(5, 10);
      recentViews = recentViews.filter((item) => !(item.type === type && item.id === id));
      recentViews.unshift({
        id,
        type,
        title: entry.title,
        viewedAt,
      });
      recentViews = recentViews.slice(0, 10);
      saveRecentViews();
    },
    upsertEntry(formData) {
      const type = String(formData.get("type") || "");
      const entryId = String(formData.get("entryId") || "");
      const existing = entryId ? findEntry(type, entryId) : null;
      const payload = buildEntryPayload(formData, existing);
      const { type: nextType, originalType } = payload;
      const entry = payload.entry;
      const current = findEntry(nextType, entry.id);

      if (originalType !== nextType) {
        data[originalType] = (data[originalType] || []).filter((item) => item.id !== entry.id);
      }

      if (current) {
        const index = data[nextType].findIndex((item) => item.id === entry.id);
        data[nextType][index] = { ...current, ...entry };
      } else {
        data[nextType].unshift(entry);
      }

      save();
      return nextType;
    },
  };
}
