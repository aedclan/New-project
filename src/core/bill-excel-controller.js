import XLSX from "../vendor/xlsx.full.min.js";

const BILL_HEADERS = [
  "日期",
  "标题",
  "类型",
  "金额",
  "分类",
  "来源",
  "承担人",
  "家庭成员",
  "固定支出",
  "还款日",
  "剩余期数",
  "交易单号",
  "付款方式",
  "关联项目",
  "标签",
  "备注",
];
const FAVOR_EVENT_HEADERS = ["日期", "关系人", "关系", "事件类型", "方向", "金额", "礼品", "关联项目", "备注"];
const FAVOR_CONTACT_HEADERS = ["姓名", "关系", "电话", "备注", "创建日期"];
const SUBSCRIPTION_HEADERS = [
  "名称",
  "分类",
  "金额",
  "周期",
  "下次到期",
  "自动续费",
  "状态",
  "月均成本",
  "年化成本",
  "使用频率",
  "必要性",
  "满意度",
  "最近使用",
  "最近记账",
  "最近续费",
  "取消建议",
  "建议原因",
  "归属人",
  "付款渠道",
  "关联项目",
  "备注",
];

function getXlsx() {
  return XLSX || null;
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function splitTags(value) {
  return String(value || "")
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDate(value, xlsx) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && xlsx?.SSF?.parse_date_code) {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.replaceAll("/", "-").replaceAll(".", "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?$/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function readRowValue(row, keys) {
  const key = keys.find((item) => Object.prototype.hasOwnProperty.call(row, item));
  return key ? row[key] : "";
}

function hasAnyColumn(row, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(row, key));
}

function readFirstText(row, keys) {
  return String(readRowValue(row, keys) || "").trim();
}

function detectPaymentSource(row, sheetName = "") {
  const text = `${sheetName} ${Object.keys(row || {}).join(" ")}`;
  if (text.includes("微信") || text.includes("WeChat")) return "微信";
  if (text.includes("支付宝") || text.includes("Alipay")) return "支付宝";
  return "";
}

function normalizePersonName(value) {
  return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
}

function normalizePersonKey(name, relationType = "", phone = "") {
  const normalizedName = normalizePersonName(name);
  const normalizedPhone = String(phone || "").replace(/\s+/g, "").trim();
  const normalizedRelation = String(relationType || "").trim().toLowerCase();
  if (!normalizedName) return "";
  if (normalizedPhone) return `${normalizedName}|phone:${normalizedPhone}`;
  if (normalizedRelation) return `${normalizedName}|relation:${normalizedRelation}`;
  return normalizedName;
}

function addContactToIndexes(contact, contactMap, nameMap) {
  const keys = [
    normalizePersonKey(contact.name, contact.relationType, contact.phone),
    normalizePersonKey(contact.name, contact.relationType, ""),
    normalizePersonKey(contact.name, "", ""),
  ].filter(Boolean);
  const nameKey = normalizePersonName(contact.name);
  keys.forEach((key) => {
    if (!contactMap.has(key)) contactMap.set(key, contact.id);
  });
  if (nameKey) {
    const ids = nameMap.get(nameKey) || new Set();
    ids.add(contact.id);
    nameMap.set(nameKey, ids);
  }
}

function resolveContactId(item, contactMap, nameMap) {
  const key = normalizePersonKey(item.contactName || item.name, item.relationType, item.phone);
  if (key && contactMap.has(key)) return contactMap.get(key);

  if (String(item.relationType || "").trim() || String(item.phone || "").trim()) return "";

  const nameKey = normalizePersonName(item.contactName || item.name);
  const ids = nameMap.get(nameKey);
  return ids?.size === 1 ? [...ids][0] : "";
}

function parseAmount(value) {
  if (typeof value === "number") return value;
  const normalized = String(value || "")
    .replace(/,/g, "")
    .replace(/[¥￥元\s]/g, "")
    .replace(/[()（）]/g, "")
    .trim();
  const match = normalized.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number(normalized);
}

function inferBillCategory(title, description = "") {
  const text = `${title || ""} ${description || ""}`;
  const rules = [
    ["房贷", "住房"],
    ["房租", "住房"],
    ["物业", "住房"],
    ["水费", "水电燃气"],
    ["电费", "水电燃气"],
    ["燃气", "水电燃气"],
    ["餐饮", "餐饮"],
    ["美团", "餐饮"],
    ["饿了么", "餐饮"],
    ["滴滴", "交通"],
    ["地铁", "交通"],
    ["公交", "交通"],
    ["加油", "交通"],
    ["医院", "医疗"],
    ["药", "医疗"],
    ["学费", "教育"],
    ["幼儿园", "教育"],
    ["学校", "教育"],
    ["淘宝", "购物"],
    ["京东", "购物"],
    ["拼多多", "购物"],
    ["订阅", "订阅"],
    ["会员", "订阅"],
  ];
  return rules.find(([keyword]) => text.includes(keyword))?.[1] || "未分类";
}

function normalizeDirection(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["收礼", "收到", "收入", "received"].includes(text)) return "received";
  return "given";
}

function normalizeBillType(value) {
  const text = String(value || "").trim();
  if (["收入", "收", "+", "入账", "退款", "转入"].includes(text) || text.includes("退款")) return "收入";
  return "支出";
}

function shouldSkipBillRow(rawType, status, title, description) {
  const text = `${rawType || ""} ${status || ""} ${title || ""} ${description || ""}`;
  return ["不计收支", "交易关闭", "支付失败", "付款失败", "已取消", "已关闭", "订单关闭"].some((keyword) => text.includes(keyword));
}

function buildBillTitle(counterparty, goods, fallback) {
  const parts = [counterparty, goods].filter(Boolean);
  if (parts.length >= 2 && parts[0] !== parts[1]) return parts.join(" · ");
  return parts[0] || fallback || "";
}

function isTruthyText(value) {
  return ["是", "true", "1", "yes", "自动"].includes(String(value || "").trim().toLowerCase());
}

function billToExcelRow(bill) {
  return {
    日期: bill.date || "",
    标题: bill.title || "",
    类型: bill.type || "支出",
    金额: Number(bill.amount || 0),
    分类: bill.category || "未分类",
    来源: bill.source || "手动",
    承担人: bill.payer || "家庭账户",
    家庭成员: bill.familyMember || "",
    固定支出: bill.fixedExpenseType || "",
    还款日: bill.mortgageDueDay || "",
    剩余期数: bill.mortgageRemainingTerms || "",
    交易单号: bill.sourceTransactionId || "",
    付款方式: bill.paymentMethod || "",
    关联项目: bill.projectId || "",
    标签: (bill.tags || []).join(","),
    备注: bill.description || "",
  };
}

function favorEventToExcelRow(event, contact) {
  return {
    日期: event.date || "",
    关系人: contact?.name || "未关联",
    关系: contact?.relationType || "",
    事件类型: event.eventType || "往来",
    方向: event.direction === "received" ? "收礼" : "送礼",
    金额: Number(event.amount || 0),
    礼品: event.giftName || "",
    关联项目: event.projectId || "",
    备注: event.note || "",
  };
}

function contactToExcelRow(contact) {
  return {
    姓名: contact.name || "",
    关系: contact.relationType || "",
    电话: contact.phone || "",
    备注: contact.note || "",
    创建日期: contact.createdAt || "",
  };
}

function getSubscriptionMonthlyCost(item) {
  const amount = Number(item.amount || 0);
  if (item.cycle === "yearly") return amount / 12;
  if (item.cycle === "quarterly") return amount / 3;
  return amount;
}

function subscriptionToExcelRow(item) {
  const monthlyCost = Number(item.monthlyCost ?? getSubscriptionMonthlyCost(item));
  const advice = item.advice || {};
  return {
    名称: item.name || "",
    分类: item.category || "订阅",
    金额: Number(item.amount || 0),
    周期: item.cycle || "monthly",
    下次到期: item.nextRenewalDate || "",
    自动续费: item.autoRenew ? "是" : "否",
    状态: item.status || "active",
    月均成本: monthlyCost,
    年化成本: Number(item.annualCost ?? monthlyCost * 12),
    使用频率: item.usageFrequency || "",
    必要性: item.necessity || "",
    满意度: item.satisfaction || "",
    最近使用: item.lastUsedAt || "",
    最近记账: item.lastBillDate || "",
    最近续费: item.lastRenewedAt || "",
    取消建议: advice.label || "",
    建议原因: advice.reason || "",
    归属人: item.owner || item.payer || "家庭账户",
    付款渠道: item.paymentMethod || "",
    关联项目: item.projectId || "",
    备注: item.note || "",
  };
}

function appendSheet(xlsx, workbook, rows, sheetName, headers) {
  const worksheet = xlsx.utils.json_to_sheet(rows, { header: headers });
  worksheet["!cols"] = headers.map((header) => ({ wch: Math.max(String(header).length + 6, 12) }));
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
}

function parseBillRows(rows, xlsx, sheetName = "", options = {}) {
  const valid = [];
  const errors = [];
  const selectedSource = options.defaultSource && options.defaultSource !== "自动识别" ? options.defaultSource : "";
  const useRuleMode = options.importMode === "rules";

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const detectedSource = detectPaymentSource(row, sheetName);
    const date = normalizeDate(readRowValue(row, ["日期", "交易时间", "付款时间", "支付时间", "交易创建时间", "最近修改时间", "记账时间", "创建时间", "date", "Date"]), xlsx);
    const counterparty = readFirstText(row, ["交易对方", "收/付款方式", "商户名称", "对方账户", "对方", "商家名称", "交易来源地", "名称"]);
    const goods = readFirstText(row, ["商品", "商品名称", "商品说明", "交易商品", "商品详情", "交易说明", "说明", "标题", "备注", "title", "Title"]);
    const title = buildBillTitle(counterparty, goods, readFirstText(row, ["标题", "名称", "title", "Title"]));
    const rawType = readRowValue(row, ["类型", "交易类型", "收支类型", "收/支", "收支", "资金流向", "type", "Type"]) || "支出";
    const type = normalizeBillType(rawType);
    const amount = parseAmount(readRowValue(row, ["金额", "金额(元)", "金额（元）", "交易金额", "人民币金额", "支出金额", "收入金额", "amount", "Amount"]));
    const fileCategory = readRowValue(row, ["分类", "交易分类", "账单分类", "类型", "category", "Category"]);
    const category = String(fileCategory || (useRuleMode ? (type === "收入" && String(rawType).includes("退款") ? "退款" : inferBillCategory(title, goods)) : "未分类")).trim();
    const source = String(readRowValue(row, ["来源", "账单来源", "source", "Source"]) || selectedSource || detectedSource || "Excel 导入").trim();
    const payer = String(readRowValue(row, ["承担人", "付款人", "payer", "Payer"]) || options.defaultPayer || "家庭账户").trim();
    const familyMember = String(readRowValue(row, ["家庭成员", "孩子", "familyMember", "Family Member"]) || "").trim();
    const fixedExpenseType = String(readRowValue(row, ["固定支出", "固定支出类型", "fixedExpenseType", "Fixed Expense"]) || "").trim();
    const mortgageDueDay = parseAmount(readRowValue(row, ["还款日", "房贷还款日", "mortgageDueDay", "Mortgage Due Day"]));
    const mortgageRemainingTerms = parseAmount(readRowValue(row, ["剩余期数", "房贷剩余期数", "mortgageRemainingTerms", "Mortgage Remaining Terms"]));
    const projectId = String(readRowValue(row, ["关联项目", "项目", "projectId", "Project"]) || "").trim();
    const transactionId = String(readRowValue(row, ["交易单号", "交易号", "交易订单号", "商户单号", "商家订单号", "账单单号", "transactionId", "TransactionId"]) || "").trim();
    const status = String(readRowValue(row, ["交易状态", "当前状态", "状态", "status", "Status"]) || "").trim();
    const paymentMethod = String(readRowValue(row, ["支付方式", "收/付款方式", "付款方式", "资金状态", "支付渠道", "paymentMethod"]) || "").trim();
    const tags = splitTags(readRowValue(row, ["标签", "tags", "Tags"]));
    const rawDescription = String(readRowValue(row, ["备注", "描述", "description", "Description"]) || "").trim();
    const description = [rawDescription, counterparty && `交易对方：${counterparty}`, goods && `商品：${goods}`, paymentMethod && `方式：${paymentMethod}`, status && `状态：${status}`]
      .filter(Boolean)
      .join("；");

    if (shouldSkipBillRow(rawType, status, title, description)) return;
    if (!date) return errors.push(`生活收支第 ${rowNumber} 行：日期为空或格式无法识别`);
    if (!title) return errors.push(`生活收支第 ${rowNumber} 行：标题不能为空`);
    if (!Number.isFinite(amount) || amount < 0) return errors.push(`生活收支第 ${rowNumber} 行：金额必须是大于等于 0 的数字`);

    valid.push({
      title,
      description,
      type,
      amount,
      category,
      date,
      source,
      payer,
      familyMember,
      fixedExpenseType,
      mortgageDueDay: Number.isFinite(mortgageDueDay) && mortgageDueDay > 0 ? mortgageDueDay : "",
      mortgageRemainingTerms: Number.isFinite(mortgageRemainingTerms) && mortgageRemainingTerms > 0 ? mortgageRemainingTerms : "",
      projectId,
      sourceTransactionId: transactionId,
      paymentMethod,
      tags: [...new Set([...tags, source].filter(Boolean))],
    });
  });

  return { valid, errors };
}

function parseContactRows(rows, xlsx) {
  const valid = [];

  rows.forEach((row) => {
    const name = String(readRowValue(row, ["姓名", "关系人", "name", "Name"]) || "").trim();
    if (!name) return;

    valid.push({
      name,
      relationType: String(readRowValue(row, ["关系", "relationType", "Relation"]) || "其他").trim(),
      phone: String(readRowValue(row, ["电话", "phone", "Phone"]) || "").trim(),
      note: String(readRowValue(row, ["备注", "note", "Note"]) || "").trim(),
      createdAt: normalizeDate(readRowValue(row, ["创建日期", "createdAt", "CreatedAt"]), xlsx) || todayText(),
    });
  });

  return valid;
}

function parseFavorRows(rows, xlsx) {
  const valid = [];
  const errors = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const contactName = String(readRowValue(row, ["关系人", "姓名", "contactName", "Contact"]) || "").trim();
    const date = normalizeDate(readRowValue(row, ["日期", "date", "Date"]), xlsx);
    const amount = parseAmount(readRowValue(row, ["金额", "amount", "Amount"]));

    if (!contactName) return errors.push(`人情往来第 ${rowNumber} 行：关系人不能为空`);
    if (!date) return errors.push(`人情往来第 ${rowNumber} 行：日期为空或格式无法识别`);
    if (!Number.isFinite(amount) || amount < 0) return errors.push(`人情往来第 ${rowNumber} 行：金额必须是大于等于 0 的数字`);

    valid.push({
      contactName,
      relationType: String(readRowValue(row, ["关系", "relationType", "Relation"]) || "其他").trim(),
      eventType: String(readRowValue(row, ["事件类型", "eventType", "EventType"]) || "其他").trim(),
      direction: normalizeDirection(readRowValue(row, ["方向", "direction", "Direction"])),
      amount,
      date,
      giftName: String(readRowValue(row, ["礼品", "giftName", "Gift"]) || "").trim(),
      projectId: String(readRowValue(row, ["关联项目", "项目", "projectId", "Project"]) || "").trim(),
      note: String(readRowValue(row, ["备注", "note", "Note"]) || "").trim(),
    });
  });

  return { valid, errors };
}

function parseSubscriptionRows(rows, xlsx) {
  const valid = [];
  const errors = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = String(readRowValue(row, ["名称", "name", "Name"]) || "").trim();
    const nextRenewalDate = normalizeDate(readRowValue(row, ["下次到期", "nextRenewalDate", "NextRenewalDate"]), xlsx);

    if (!name) return;
    if (!nextRenewalDate) return errors.push(`订阅项目第 ${rowNumber} 行：下次到期为空或格式无法识别`);

    valid.push({
      name,
      category: String(readRowValue(row, ["分类", "category", "Category"]) || "订阅").trim(),
      amount: parseAmount(readRowValue(row, ["金额", "amount", "Amount"]) || 0),
      cycle: String(readRowValue(row, ["周期", "cycle", "Cycle"]) || "monthly").trim(),
      nextRenewalDate,
      autoRenew: isTruthyText(readRowValue(row, ["自动续费", "autoRenew", "AutoRenew"])),
      status: String(readRowValue(row, ["状态", "status", "Status"]) || "active").trim(),
      usageFrequency: String(readRowValue(row, ["使用频率", "usageFrequency"]) || "unknown").trim(),
      necessity: String(readRowValue(row, ["必要性", "necessity"]) || "optional").trim(),
      satisfaction: Number(readRowValue(row, ["满意度", "satisfaction"]) || 0),
      lastUsedAt: normalizeDate(readRowValue(row, ["最近使用", "lastUsedAt"]), xlsx),
      lastRenewedAt: normalizeDate(readRowValue(row, ["最近续费", "lastRenewedAt"]), xlsx),
      owner: String(readRowValue(row, ["归属人", "承担人", "付款人", "owner", "payer", "Owner", "Payer"]) || "家庭账户").trim(),
      paymentMethod: String(readRowValue(row, ["付款渠道", "付款方式", "支付方式", "paymentMethod", "PaymentMethod"]) || "").trim(),
      projectId: String(readRowValue(row, ["关联项目", "项目", "projectId", "Project"]) || "").trim(),
      note: String(readRowValue(row, ["备注", "note", "Note"]) || "").trim(),
    });
  });

  return { valid, errors };
}

function rowsFromSheet(xlsx, workbook, sheetName) {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return [];
  return xlsx.utils.sheet_to_json(worksheet, { defval: "", raw: false });
}

function scoreCsvText(text) {
  return ["交易时间", "交易分类", "交易对方", "商品说明", "收/支", "金额", "交易订单号", "支付宝", "微信"].reduce(
    (score, keyword) => score + (String(text || "").includes(keyword) ? 1 : 0),
    0,
  );
}

function decodeCsvBuffer(buffer) {
  const utf8Text = new TextDecoder("utf-8").decode(buffer);
  let gbText = "";

  try {
    gbText = new TextDecoder("gb18030").decode(buffer);
  } catch {
    try {
      gbText = new TextDecoder("gbk").decode(buffer);
    } catch {
      gbText = "";
    }
  }

  return scoreCsvText(gbText) > scoreCsvText(utf8Text) ? gbText : utf8Text;
}

function classifySheet(sheetName, rows) {
  const name = String(sheetName || "");
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));

  if (name.includes("人情") || keys.has("关系人") || keys.has("事件类型")) return "favors";
  if (name.includes("关系人") || (keys.has("姓名") && keys.has("关系") && !keys.has("金额"))) return "contacts";
  if (name.includes("订阅") || keys.has("下次到期") || keys.has("自动续费")) return "subscriptions";
  if (name.includes("微信") || name.includes("支付宝")) return "bills";
  if (keys.has("交易时间") || keys.has("交易对方") || keys.has("商品") || keys.has("商品名称") || keys.has("收/支") || keys.has("交易单号") || keys.has("交易号")) return "bills";
  if (name.includes("账单") || name.includes("生活收支") || keys.has("类型") || keys.has("标题")) return "bills";
  return "";
}

function buildFavorImportWarnings(favors) {
  const warnings = [];
  const nameCounts = favors.reduce((map, item) => {
    const name = String(item.contactName || "").trim();
    if (!name) return map;
    map[name] = (map[name] || 0) + 1;
    return map;
  }, {});
  const duplicateNames = Object.entries(nameCounts)
    .filter(([, count]) => count > 1)
    .map(([name, count]) => `${name} ${count} 条`);
  const highAmountItems = favors.filter((item) => Number(item.amount || 0) >= 5000);
  const missingContextItems = favors.filter((item) => !String(item.note || "").trim() && !String(item.giftName || "").trim());

  if (duplicateNames.length) warnings.push(`疑似同名或多次往来：${duplicateNames.slice(0, 8).join("、")}`);
  if (highAmountItems.length) warnings.push(`大额记录：${highAmountItems.length} 条金额大于等于 5000，建议导入后抽查。`);
  if (missingContextItems.length) warnings.push(`缺少礼品/备注：${missingContextItems.length} 条，后续可能不便回忆场景。`);

  return warnings;
}

function getBillImportSignature(bill) {
  const transactionId = String(bill.sourceTransactionId || "").trim();
  if (transactionId) return `tx:${bill.source || ""}:${transactionId}`;
  return [
    bill.date || "",
    bill.title || "",
    bill.type || "",
    Number(bill.amount || 0).toFixed(2),
    bill.source || "",
  ].join("|");
}

function filterDuplicateBills(importedBills, existingBills = []) {
  const existingEntries = new Map();
  (existingBills || []).forEach((bill) => {
    const signature = getBillImportSignature(bill);
    if (signature && !existingEntries.has(signature)) existingEntries.set(signature, bill);
  });
  const existingSeen = new Set(existingEntries.keys());
  const importSeen = new Set();
  const importEntries = new Map();
  const unique = [];
  const duplicates = [];
  const existingDuplicates = [];
  const fileDuplicates = [];
  const existingDuplicatePairs = [];
  const fileDuplicatePairs = [];

  importedBills.forEach((bill) => {
    const signature = getBillImportSignature(bill);
    if (signature && existingSeen.has(signature)) {
      duplicates.push(bill);
      existingDuplicates.push(bill);
      existingDuplicatePairs.push({ imported: bill, existing: existingEntries.get(signature) || null });
      return;
    }
    if (signature && importSeen.has(signature)) {
      duplicates.push(bill);
      fileDuplicates.push(bill);
      fileDuplicatePairs.push({ imported: bill, existing: importEntries.get(signature) || null });
      return;
    }
    if (signature) importSeen.add(signature);
    if (signature && !importEntries.has(signature)) importEntries.set(signature, bill);
    unique.push(bill);
  });

  return { unique, duplicates, existingDuplicates, fileDuplicates, existingDuplicatePairs, fileDuplicatePairs };
}

function summarizeImportedBills(bills = [], field, fallback = "未指定") {
  const rows = bills.reduce((map, bill) => {
    const key = String(bill[field] || fallback).trim() || fallback;
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  const entries = Object.entries(rows).sort((left, right) => right[1] - left[1]);
  return entries.length ? entries.map(([label, count]) => `- ${label}：${count} 条`) : ["- 暂无生活收支"];
}

function summarizeBillMonths(bills = []) {
  const rows = bills.reduce((map, bill) => {
    const month = String(bill.date || "").slice(0, 7) || "未设置月份";
    map[month] = map[month] || { count: 0, income: 0, expense: 0 };
    map[month].count += 1;
    if (bill.type === "收入") {
      map[month].income += Number(bill.amount || 0);
    } else {
      map[month].expense += Number(bill.amount || 0);
    }
    return map;
  }, {});

  const entries = Object.entries(rows).sort((left, right) => right[0].localeCompare(left[0]));
  return entries.length
    ? entries.map(([month, row]) => `- ${month}：${row.count} 条，收入 ${row.income.toFixed(2)}，支出 ${row.expense.toFixed(2)}`)
    : ["- 暂无生活收支"];
}

function summarizeImportOptions(options = {}) {
  return [
    `- 选择来源：${options.defaultSource || "自动识别"}`,
    `- 选择归属：${options.defaultPayer || "家庭账户"}`,
    "- 文件内已有“来源”或“承担人”列时，优先使用文件值",
    "- 不计收支、交易关闭、支付失败、已取消记录会自动跳过",
  ];
}

function summarizeBillClassificationReport(report = {}) {
  return [
    `- 自动分类：${report.autoCategorized || 0} 条`,
    `- 记忆规则命中：${report.memoryMatched || 0} 条`,
    `- 待确认分类：${report.needsReview || 0} 条`,
    `- 未分类：${report.uncategorized || 0} 条`,
  ];
}

function summarizeBillDuplicateReport(report = {}) {
  const existing = report.existingDuplicates || 0;
  const inFile = report.fileDuplicates || 0;
  if (!existing && !inFile) return ["- 未发现重复账单"];
  return [`- 与已有数据重复：${existing} 条`, `- 文件内部重复：${inFile} 条`];
}

function summarizeErrors(errors = []) {
  if (!errors.length) return ["- 未发现格式错误"];
  return [
    ...errors.slice(0, 12).map((error) => `- ${error}`),
    errors.length > 12 ? `- 另有 ${errors.length - 12} 条错误未展示` : "",
  ].filter(Boolean);
}

function buildImportReport(grouped, errors, sheetReports, contactReport, billReport = { duplicates: 0, imported: grouped.bills.length }, options = {}) {
  const favorWarnings = buildFavorImportWarnings(grouped.favors || []);
  return [
    "导入校验报告",
    "",
    "导入选择：",
    ...summarizeImportOptions(options),
    "",
    "结果汇总：",
    `生活收支：${billReport.imported} 条`,
    billReport.duplicates ? `重复账单：跳过 ${billReport.duplicates} 条` : "重复账单：未发现",
    `关系人：${grouped.contacts.length} 条`,
    `人情往来：${grouped.favors.length} 条`,
    `订阅项目：${grouped.subscriptions.length} 条`,
    "",
    "生活收支来源：",
    ...summarizeImportedBills(grouped.bills, "source"),
    "",
    "生活收支归属：",
    ...summarizeImportedBills(grouped.bills, "payer"),
    "",
    "生活收支月份：",
    ...summarizeBillMonths(grouped.bills),
    "",
    "分类识别：",
    ...summarizeBillClassificationReport(billReport.classification || {}),
    "",
    "工作表识别：",
    ...sheetReports.map((item) => `- ${item.sheetName}：${item.typeLabel}，读取 ${item.rowCount} 行`),
    "",
    "人物匹配：",
    `- 复用已有人物：${contactReport.reused} 人`,
    `- 新增人物：${contactReport.created} 人`,
    `- 由关系人表跳过重复：${contactReport.skippedContacts} 人`,
    errors.length ? "" : "- 未发现格式错误",
    "",
    "人情往来校验：",
    ...(favorWarnings.length ? favorWarnings.map((item) => `- ${item}`) : ["- 未发现明显人情数据风险"]),
    "",
    "失败 / 跳过明细：",
    ...summarizeErrors(errors),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function createBillExcelController(app, renderer) {
  function ensureXlsx() {
    const xlsx = getXlsx();
    if (!xlsx) {
      window.alert("Excel 工具尚未加载完成，请刷新页面后再试。");
      return null;
    }
    return xlsx;
  }

  function downloadTemplate() {
    const xlsx = ensureXlsx();
    if (!xlsx) return;

    const workbook = xlsx.utils.book_new();
    appendSheet(
      xlsx,
      workbook,
      [
        {
          日期: todayText(),
          标题: "示例账单",
          类型: "支出",
          金额: 88,
          分类: "工具",
          来源: "手动",
          承担人: "家庭账户",
          家庭成员: "家庭共同",
          固定支出: "",
          还款日: "",
          剩余期数: "",
          交易单号: "",
          付款方式: "",
          关联项目: "个人工作台升级",
          标签: "网站,工具",
          备注: "这里填写账单说明",
        },
      ],
      "生活收支",
      BILL_HEADERS,
    );
    appendSheet(
      xlsx,
      workbook,
      [{ 日期: todayText(), 关系人: "张三", 关系: "朋友", 事件类型: "婚礼", 方向: "送礼", 金额: 600, 礼品: "红包", 关联项目: "", 备注: "示例人情往来" }],
      "人情往来",
      FAVOR_EVENT_HEADERS,
    );
    appendSheet(xlsx, workbook, [{ 姓名: "张三", 关系: "朋友", 电话: "", 备注: "", 创建日期: todayText() }], "关系人", FAVOR_CONTACT_HEADERS);
    appendSheet(
      xlsx,
      workbook,
      [
        {
          名称: "示例订阅",
          分类: "工具",
          金额: 30,
          周期: "monthly",
          下次到期: todayText(),
          自动续费: "是",
          状态: "active",
          月均成本: 30,
          年化成本: 360,
          使用频率: "high",
          必要性: "essential",
          满意度: 5,
          最近使用: todayText(),
          最近记账: "",
          最近续费: "",
          取消建议: "",
          建议原因: "",
          关联项目: "",
          备注: "示例订阅项目",
        },
      ],
      "订阅项目",
      SUBSCRIPTION_HEADERS,
    );
    xlsx.writeFile(workbook, "财务数据导入模板.xlsx");
  }

  function exportFinanceWorkbook() {
    const xlsx = ensureXlsx();
    if (!xlsx) return;

    const data = app.store.getData();
    const contacts = data.contacts || [];
    const workbook = xlsx.utils.book_new();
    const billRows = (data.bills || []).map(billToExcelRow);
    const eventRows = (data.favorEvents || []).map((event) => favorEventToExcelRow(event, contacts.find((item) => item.id === event.contactId)));
    const contactRows = contacts.map(contactToExcelRow);
    const subscriptionRows = app.store.getSubscriptionsOverview().items.map(subscriptionToExcelRow);

    appendSheet(xlsx, workbook, billRows, "生活收支", BILL_HEADERS);
    appendSheet(xlsx, workbook, eventRows, "人情往来", FAVOR_EVENT_HEADERS);
    appendSheet(xlsx, workbook, contactRows, "关系人", FAVOR_CONTACT_HEADERS);
    appendSheet(xlsx, workbook, subscriptionRows, "订阅项目", SUBSCRIPTION_HEADERS);
    xlsx.writeFile(workbook, `财务数据导出-${todayText()}.xlsx`);
  }

  async function importFile(file, options = {}) {
    const xlsx = ensureXlsx();
    if (!xlsx || !file) return;

    try {
      const fileName = String(file.name || "").toLowerCase();
      const isSupportedFile = [".xlsx", ".xls", ".csv"].some((suffix) => fileName.endsWith(suffix));
      if (!isSupportedFile) {
        window.alert("请选择 Excel 或 CSV 文件：支持 .xlsx、.xls、.csv。");
        return;
      }

      const buffer = await file.arrayBuffer();
      const isCsv = fileName.endsWith(".csv");
      const workbook = isCsv
        ? xlsx.read(decodeCsvBuffer(buffer), { type: "string", cellDates: true })
        : xlsx.read(buffer, { type: "array", cellDates: true });
      const grouped = { bills: [], contacts: [], favors: [], subscriptions: [] };
      const errors = [];
      const sheetReports = [];
      const typeLabels = { bills: "生活收支", contacts: "关系人", favors: "人情往来", subscriptions: "订阅项目" };

      workbook.SheetNames.forEach((sheetName) => {
        const rows = rowsFromSheet(xlsx, workbook, sheetName);
        if (!rows.length) return;

        const type = classifySheet(sheetName, rows);
        sheetReports.push({ sheetName, typeLabel: typeLabels[type] || "未识别", rowCount: rows.length });
        if (type === "bills") {
          const parsed = parseBillRows(rows, xlsx, `${sheetName} ${file.name || ""}`, options);
          grouped.bills.push(...parsed.valid);
          errors.push(...parsed.errors);
        } else if (type === "contacts") {
          grouped.contacts.push(...parseContactRows(rows, xlsx));
        } else if (type === "favors") {
          const parsed = parseFavorRows(rows, xlsx);
          grouped.favors.push(...parsed.valid);
          errors.push(...parsed.errors);
        } else if (type === "subscriptions") {
          const parsed = parseSubscriptionRows(rows, xlsx);
          grouped.subscriptions.push(...parsed.valid);
          errors.push(...parsed.errors);
        }
      });

      const total = grouped.bills.length + grouped.contacts.length + grouped.favors.length + grouped.subscriptions.length;
      if (!total) {
        window.alert(`没有识别到可导入的数据。\n${errors.slice(0, 8).join("\n")}`);
        return;
      }

      const billImport = filterDuplicateBills(grouped.bills, app.store.getData().bills || []);
      grouped.bills = billImport.unique;

      const confirmed = window.confirm(
        [
          "准备导入财务数据：",
          `本次导入来源：${options.defaultSource || "自动识别"}`,
          `本次导入归属：${options.defaultPayer || "家庭账户"}`,
          `导入模式：${options.importMode === "rules" ? "规则导入" : "原始账单"}`,
          `生活收支 ${grouped.bills.length} 条`,
          billImport.duplicates.length ? `重复账单将跳过 ${billImport.duplicates.length} 条` : "未发现重复账单",
          `关系人 ${grouped.contacts.length} 条`,
          `人情往来 ${grouped.favors.length} 条`,
          `订阅项目 ${grouped.subscriptions.length} 条`,
          `涉及月份 ${new Set(grouped.bills.map((bill) => String(bill.date || "").slice(0, 7)).filter(Boolean)).size} 个`,
          errors.length ? `另有 ${errors.length} 条记录会被跳过。` : "未发现格式错误。",
          "确认继续导入吗？",
        ].join("\n"),
      );
      if (!confirmed) return;

      const importedBillReport = app.store.importBills(grouped.bills, { importMode: options.importMode || "raw" });
      const contactMap = new Map();
      const nameMap = new Map();
      const contactReport = { reused: 0, created: 0, skippedContacts: 0 };
      const existingContacts = app.store.getData().contacts || [];
      existingContacts.forEach((contact) => addContactToIndexes(contact, contactMap, nameMap));

      grouped.contacts.forEach((contact) => {
        const contactKey = normalizePersonKey(contact.name, contact.relationType, contact.phone);
        if (!contactKey || contactMap.has(contactKey)) {
          contactReport.skippedContacts += 1;
          return;
        }
        const id = app.store.addContact(contact);
        if (id) {
          contactReport.created += 1;
          addContactToIndexes({ ...contact, id }, contactMap, nameMap);
        }
      });

      grouped.favors.forEach((item) => {
        let contactId = resolveContactId(item, contactMap, nameMap);
        if (contactId) {
          contactReport.reused += 1;
        } else {
          contactId = app.store.addContact({ name: item.contactName, relationType: item.relationType, phone: "", note: "" });
          if (contactId) {
            contactReport.created += 1;
            addContactToIndexes({ id: contactId, name: item.contactName, relationType: item.relationType, phone: "" }, contactMap, nameMap);
          }
        }
        app.store.addFavorEvent({ ...item, contactId, syncBill: false });
      });

      grouped.subscriptions.forEach((item) => app.store.addSubscription(item));
      const importedMonths = [...new Set(grouped.bills.map((bill) => String(bill.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
      app.store.saveBillImportReport?.({
        source: options.defaultSource || "自动识别",
        payer: options.defaultPayer || "家庭账户",
        mode: options.importMode === "rules" ? "规则导入" : "原始账单",
        imported: importedBillReport?.count ?? grouped.bills.length,
        skipped: billImport.duplicates.length,
        existingDuplicates: billImport.existingDuplicates.length,
        fileDuplicates: billImport.fileDuplicates.length,
        autoCategorized: importedBillReport?.autoCategorized || 0,
        memoryMatched: importedBillReport?.memoryMatched || 0,
        needsReview: importedBillReport?.needsReview || 0,
        uncategorized: importedBillReport?.uncategorized || 0,
        errors: errors.length,
        monthCount: importedMonths.length,
        contactCount: grouped.contacts.length,
        favorCount: grouped.favors.length,
        subscriptionCount: grouped.subscriptions.length,
        months: importedMonths,
        sheetReports,
        errorSamples: errors,
        duplicateSamples: [
          ...billImport.existingDuplicatePairs.map((pair) => ({
            reason: "与已有数据重复",
            imported: {
              date: pair.imported?.date || "",
              title: pair.imported?.title || "",
              amount: Number(pair.imported?.amount || 0),
              source: pair.imported?.source || "",
            },
            existing: {
              date: pair.existing?.date || "",
              title: pair.existing?.title || "",
              amount: Number(pair.existing?.amount || 0),
              source: pair.existing?.source || "",
            },
          })),
          ...billImport.fileDuplicatePairs.map((pair) => ({
            reason: "文件内部重复",
            imported: {
              date: pair.imported?.date || "",
              title: pair.imported?.title || "",
              amount: Number(pair.imported?.amount || 0),
              source: pair.imported?.source || "",
            },
            existing: {
              date: pair.existing?.date || "",
              title: pair.existing?.title || "",
              amount: Number(pair.existing?.amount || 0),
              source: pair.existing?.source || "",
            },
          })),
        ],
      });
      if (grouped.bills.length) {
        app.ui.activePage = "bills";
        app.ui.filters = {
          ...(app.ui.filters || {}),
          billMonth: importedMonths[0] || "",
          billTimelineScope: "month",
        };
      }
      renderer.render();
      if (grouped.bills.length) {
        requestAnimationFrame(() => {
          document.querySelector("#billLedgerModal")?.showModal();
        });
      }
      window.alert(grouped.bills.length ? "导入完成，已打开完整流水，请复核分类与规则。" : "导入完成，已生成校验结果。");
    } catch (error) {
      window.alert(`导入失败：${error instanceof Error ? error.message : "文件无法解析"}`);
    }
  }

  return {
    downloadTemplate,
    exportFinanceWorkbook,
    importFile,
  };
}
