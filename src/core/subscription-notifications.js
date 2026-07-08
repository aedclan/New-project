import { SUBSCRIPTION_NOTIFICATION_LOG_KEY, SUBSCRIPTION_NOTIFICATION_SETTINGS_KEY } from "../config/constants.js";

export const defaultSubscriptionNotificationSettings = {
  siteEnabled: true,
  browserEnabled: false,
  emailEnabled: false,
  email: "",
  leadDays: [0, 1, 3, 7],
  dailyTime: "09:00",
  remindAutoRenew: true,
  remindManualRenew: true,
  remindHighCost: true,
  remindLowValue: true,
};

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function parseLeadDays(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,，\s]+/);
  return [...new Set(source.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item >= 0))]
    .sort((left, right) => left - right);
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "") || fallback;
  } catch {
    return fallback;
  }
}

export function loadSubscriptionNotificationSettings() {
  const saved = loadJson(SUBSCRIPTION_NOTIFICATION_SETTINGS_KEY, {});
  return {
    ...defaultSubscriptionNotificationSettings,
    ...saved,
    leadDays: parseLeadDays(saved.leadDays || defaultSubscriptionNotificationSettings.leadDays),
  };
}

export function saveSubscriptionNotificationSettings(payload) {
  const settings = {
    ...loadSubscriptionNotificationSettings(),
    ...payload,
    leadDays: parseLeadDays(payload.leadDays),
  };
  localStorage.setItem(SUBSCRIPTION_NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export function loadSubscriptionNotificationLog() {
  return loadJson(SUBSCRIPTION_NOTIFICATION_LOG_KEY, {});
}

function saveSubscriptionNotificationLog(log) {
  localStorage.setItem(SUBSCRIPTION_NOTIFICATION_LOG_KEY, JSON.stringify(log));
}

export function groupSubscriptionReminders(items) {
  return {
    expired: items.filter((item) => item.daysUntilRenewal !== null && item.daysUntilRenewal < 0),
    today: items.filter((item) => item.daysUntilRenewal === 0),
    week: items.filter((item) => item.daysUntilRenewal !== null && item.daysUntilRenewal > 0 && item.daysUntilRenewal <= 7),
    month: items.filter((item) => item.daysUntilRenewal !== null && item.daysUntilRenewal > 7 && item.daysUntilRenewal <= 30),
  };
}

export function getSubscriptionReminderSummary(items) {
  const groups = groupSubscriptionReminders(items);
  const total = groups.expired.length + groups.today.length + groups.week.length + groups.month.length;
  const urgent = groups.expired.length + groups.today.length + groups.week.length;
  return {
    total,
    urgent,
    text: total
      ? `订阅提醒 ${total} 项，其中紧急 ${urgent} 项`
      : "暂无 30 天内到期订阅",
    groups,
  };
}

export function getSubscriptionsDueForNotification(items, settings = loadSubscriptionNotificationSettings()) {
  return items.filter((item) => {
    if (item.daysUntilRenewal === null) return false;
    if (item.status === "cancelled") return false;
    if (item.autoRenew && !settings.remindAutoRenew) return false;
    if (!item.autoRenew && !settings.remindManualRenew) return false;
    if (item.daysUntilRenewal < 0) return true;
    if (settings.leadDays.includes(item.daysUntilRenewal)) return true;
    if (settings.remindHighCost && Number(item.monthlyCost || 0) >= 100 && item.daysUntilRenewal <= 7) return true;
    if (settings.remindLowValue && ["danger", "warning"].includes(item.advice?.level) && item.daysUntilRenewal <= 7) return true;
    return false;
  });
}

export function markSubscriptionBrowserNotified(subscriptionId, date = todayText()) {
  const log = loadSubscriptionNotificationLog();
  log.browser = log.browser || {};
  log.browser[subscriptionId] = date;
  saveSubscriptionNotificationLog(log);
}

export function wasSubscriptionBrowserNotifiedToday(subscriptionId, date = todayText()) {
  return loadSubscriptionNotificationLog().browser?.[subscriptionId] === date;
}

export async function requestBrowserNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

export async function runBrowserSubscriptionNotifications(items, settings = loadSubscriptionNotificationSettings()) {
  if (!settings.browserEnabled || !("Notification" in window) || Notification.permission !== "granted") return 0;
  const dueItems = getSubscriptionsDueForNotification(items, settings).filter((item) => !wasSubscriptionBrowserNotifiedToday(item.id));

  dueItems.forEach((item) => {
    const title = item.daysUntilRenewal < 0 ? "订阅已过期" : "订阅到期提醒";
    const body = `${item.name}：${item.reminderLabel}，${item.autoRenew ? "自动续费" : "手动续费"}，${item.advice?.label || "请处理"}`;
    const notification = new Notification(title, { body, tag: `subscription-${item.id}` });
    notification.onclick = () => {
      window.focus();
      window.location.hash = "#subscriptions";
    };
    markSubscriptionBrowserNotified(item.id);
  });

  return dueItems.length;
}

export function buildSubscriptionEmailPreview(items, settings = loadSubscriptionNotificationSettings()) {
  const dueItems = getSubscriptionsDueForNotification(items, settings);
  const lines = dueItems.slice(0, 6).map((item, index) => {
    const cost = Number(item.amount || item.monthlyCost || 0).toFixed(2);
    const action = item.autoRenew ? "确认自动续费是否仍需要" : "手动确认是否续费";
    return `${index + 1}. ${item.name}｜${item.reminderLabel || "到期提醒"}｜金额 ¥${cost}｜${action}`;
  });
  return {
    count: dueItems.length,
    subject: dueItems.length ? `订阅到期提醒：${dueItems.length} 项需要关注` : "订阅到期提醒：暂无需要发送的项目",
    text: lines.length ? lines.join("\n") : "当前通知设置下暂无需要发送的订阅提醒。",
    items: dueItems,
  };
}

export async function postSubscriptionEmail(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.message || "邮件服务请求失败");
  }
  return result;
}
