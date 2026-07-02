function sum(items = [], selector = (item) => item.amount) {
  return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

function isIncomeBill(item) {
  return item?.type === "收入";
}

function isExcluded(item) {
  return Boolean(item?.excludeFromAnalysis || item?.analysisExcluded);
}

function getMonthBills(data, month) {
  return (data.bills || []).filter((item) => String(item.date || "").startsWith(month) && !isExcluded(item));
}

function getCategoryTotals(bills = []) {
  return Object.entries(
    bills
      .filter((item) => !isIncomeBill(item))
      .reduce((map, item) => {
        const category = item.category || "未分类";
        map[category] = (map[category] || 0) + Number(item.amount || 0);
        return map;
      }, {}),
  )
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount);
}

function getLatestReport(data, month) {
  return (data.notes || [])
    .filter((item) => item.noteType === "summary" && (item.billReportMonth === month || String(item.title || "").includes(month)))
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))[0];
}

function inferDataQuality(monthBills, report) {
  const expenseBills = monthBills.filter((item) => !isIncomeBill(item));
  const unclassified = expenseBills.filter((item) => !item.category || item.category === "未分类" || item.classification?.needsReview).length;
  const income = sum(monthBills.filter(isIncomeBill));
  const expense = sum(expenseBills);
  const score = report?.billReportSummary?.qualityScore ?? Math.max(0, 100 - (income <= 0 && expense > 0 ? 24 : 0) - Math.min(22, unclassified * 4));
  return {
    score,
    confidence: report?.billReportSummary?.qualityConfidence || (score >= 86 ? "高" : score >= 70 ? "中" : "低"),
    primaryAction: unclassified ? `先补齐 ${unclassified} 笔未分类流水。` : income <= 0 && expense > 0 ? "先补录本月收入。" : "保持分类和预算记录完整。",
  };
}

function getFutureCommitments(data, month) {
  const [year, monthValue] = String(month || "").split("-").map(Number);
  const base = year && monthValue ? new Date(year, monthValue - 1, 1) : new Date();
  const start = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-01`;
  const endDate = new Date(base.getFullYear(), base.getMonth() + 3, 0);
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  const plans = ((data.budgets || {}).futurePlans || [])
    .filter((item) => item.status !== "取消")
    .filter((item) => String(item.date || "").slice(0, 10) >= start && String(item.date || "").slice(0, 10) <= end)
    .map((item) => ({ title: item.title || "未来计划", amount: Number(item.amount || 0), date: item.date, type: item.planType || "计划" }));
  const subscriptions = (data.subscriptions || [])
    .filter((item) => String(item.nextRenewalDate || "").slice(0, 10) >= start && String(item.nextRenewalDate || "").slice(0, 10) <= end)
    .map((item) => ({ title: item.name || "订阅续费", amount: Number(item.monthlyCost || item.amount || 0), date: item.nextRenewalDate, type: "订阅" }));
  return [...plans, ...subscriptions].sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));
}

function sanitizeBillTitle(value) {
  return String(value || "")
    .replace(/[0-9]{6,}/g, "***")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "***")
    .replace(/1[3-9]\d{9}/g, "***")
    .trim()
    .slice(0, 40);
}

function buildSanitizedTransactions(monthBills = []) {
  return monthBills
    .slice()
    .sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")))
    .slice(0, 120)
    .map((item) => ({
      date: String(item.date || "").slice(0, 10),
      type: item.type || "支出",
      amount: Number(item.amount || 0),
      category: item.category || "未分类",
      title: sanitizeBillTitle(item.title || item.description || item.category || "未命名流水"),
      source: item.source || "未知",
      tags: (item.tags || []).slice(0, 5).map((tag) => sanitizeBillTitle(tag)).filter(Boolean),
    }));
}

export function buildFinanceAiSummary(data, month, options = {}) {
  const targetMonth = String(month || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const monthBills = getMonthBills(data, targetMonth);
  const income = sum(monthBills.filter(isIncomeBill));
  const expenseBills = monthBills.filter((item) => !isIncomeBill(item));
  const expense = sum(expenseBills);
  const report = getLatestReport(data, targetMonth);
  const forecast = report?.billReportSummary?.forecast || {};
  const scenarios = forecast.scenarios || [];
  const pressureScenario = scenarios.find((item) => item.key === "pressure") || {};
  const riskScenario = scenarios.find((item) => item.key === "risk") || {};
  const futureCommitments = getFutureCommitments(data, targetMonth);
  const includeTransactions = Boolean(options.includeTransactions);
  return {
    month: targetMonth,
    privacyScope: includeTransactions ? "aggregated-with-sanitized-transactions" : "aggregated-only",
    current: {
      income,
      expense,
      balance: income - expense,
      budgetUsedRate: report?.billReportSummary?.budgetUsedRate,
    },
    topCategories: getCategoryTotals(monthBills).slice(0, 8),
    dataQuality: inferDataQuality(monthBills, report),
    subscriptions: (data.subscriptions || []).map((item) => ({
      name: item.name,
      amount: Number(item.monthlyCost || item.amount || 0),
      category: item.category,
      autoRenew: Boolean(item.autoRenew),
      necessity: item.necessity,
      usageFrequency: item.usageFrequency,
      nextRenewalDate: item.nextRenewalDate,
    })).slice(0, 20),
    futureCommitments: futureCommitments.slice(0, 20),
    transactions: includeTransactions ? buildSanitizedTransactions(monthBills) : [],
    transactionMeta: {
      included: includeTransactions,
      count: includeTransactions ? Math.min(monthBills.length, 120) : 0,
      totalAvailable: monthBills.length,
      sanitized: includeTransactions,
      omittedFields: ["payer", "familyMember", "description", "rawImportText", "account", "phone", "email"],
    },
    forecast: {
      level: forecast.level,
      confidence: forecast.confidence,
      incomeLow: forecast.predictionRange?.income?.low,
      incomeHigh: forecast.predictionRange?.income?.high,
      expenseMid: forecast.nextMonthExpense,
      expenseHigh: forecast.predictionRange?.expense?.high,
      balanceLow: forecast.predictionRange?.balance?.low,
      balanceHigh: forecast.predictionRange?.balance?.high,
      riskLine: forecast.predictionRange?.riskLine,
      pressureScenarioBalance: pressureScenario.balance,
      riskScenarioBalance: riskScenario.balance,
      expenseBreakdown: forecast.expenseBreakdown,
    },
  };
}

async function postFinanceAi(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || "大模型请求失败。");
  }
  return data;
}

export function requestFinanceAiAnalysis(summary) {
  return postFinanceAi("/api/ai/finance-analysis", { summary });
}

export function requestFinanceQuestion(question, summary) {
  return postFinanceAi("/api/ai/finance-qa", { question, summary });
}
