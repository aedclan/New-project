import { readFileSync } from "node:fs";
import { sendSubscriptionScanEmails } from "./subscription-email-service.mjs";

function getDaysUntil(dateText) {
  if (!dateText) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateText);
  target.setHours(0, 0, 0, 0);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function normalizeSettings() {
  return {
    emailEnabled: true,
    email: process.env.SUBSCRIPTION_NOTIFY_EMAIL || "",
    leadDays: String(process.env.SUBSCRIPTION_NOTIFY_LEAD_DAYS || "0,1,3,7")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item)),
  };
}

function readSubscriptions() {
  const filePath = process.env.SUBSCRIPTION_DATA_FILE;
  if (!filePath) {
    throw new Error("请设置 SUBSCRIPTION_DATA_FILE，指向导出的 JSON 数据文件。");
  }
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  return data.subscriptions || [];
}

const settings = normalizeSettings();
const subscriptions = readSubscriptions()
  .map((item) => {
    const daysUntilRenewal = getDaysUntil(item.nextRenewalDate);
    return {
      ...item,
      daysUntilRenewal,
      reminderLabel:
        daysUntilRenewal === null
          ? "未设置到期"
          : daysUntilRenewal < 0
            ? `已过期 ${Math.abs(daysUntilRenewal)} 天`
            : daysUntilRenewal === 0
              ? "今天到期"
              : `${daysUntilRenewal} 天后到期`,
    };
  })
  .filter((item) => item.daysUntilRenewal < 0 || settings.leadDays.includes(item.daysUntilRenewal));

const result = await sendSubscriptionScanEmails(settings, subscriptions);
console.log(JSON.stringify(result, null, 2));
