function formatCurrency(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function requireEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.SUBSCRIPTION_EMAIL_FROM;

  if (!apiKey || !from) {
    return {
      ok: false,
      message: "邮件服务未配置。请设置 RESEND_API_KEY 和 SUBSCRIPTION_EMAIL_FROM 环境变量。",
    };
  }

  return { ok: true, apiKey, from };
}

function buildSubscriptionEmailHtml(subscription) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 12px;">订阅到期提醒</h2>
      <p><strong>${subscription.name || "未命名订阅"}</strong> ${subscription.reminderLabel || "需要处理"}。</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 560px;">
        <tr><td style="padding: 6px 0; color:#6b7280;">金额</td><td>${formatCurrency(subscription.amount)}</td></tr>
        <tr><td style="padding: 6px 0; color:#6b7280;">周期</td><td>${subscription.cycle || "monthly"}</td></tr>
        <tr><td style="padding: 6px 0; color:#6b7280;">到期日</td><td>${subscription.nextRenewalDate || "未设置"}</td></tr>
        <tr><td style="padding: 6px 0; color:#6b7280;">续费方式</td><td>${subscription.autoRenew ? "自动续费" : "手动续费"}</td></tr>
        <tr><td style="padding: 6px 0; color:#6b7280;">最近记账</td><td>${subscription.lastBillDate || "未记录"}</td></tr>
        <tr><td style="padding: 6px 0; color:#6b7280;">处理建议</td><td>${subscription.advice?.label || "继续观察"}：${subscription.advice?.reason || ""}</td></tr>
      </table>
      <p style="color:#6b7280;">这封邮件由个人工作台订阅通知发送。</p>
    </div>
  `;
}

async function sendResendEmail({ apiKey, from, to, subject, html }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || "邮件发送失败");
  }

  return result;
}

export async function sendSubscriptionTestEmail(settings) {
  const config = requireEmailConfig();
  if (!config.ok) return config;
  if (!settings?.email) return { ok: false, message: "请先填写接收邮箱。" };

  await sendResendEmail({
    apiKey: config.apiKey,
    from: config.from,
    to: settings.email,
    subject: "订阅通知测试邮件",
    html: "<p>测试邮件发送成功。后续订阅到期提醒会发送到这个邮箱。</p>",
  });

  return { ok: true, sent: 1 };
}

export async function sendSubscriptionScanEmails(settings, subscriptions = []) {
  const config = requireEmailConfig();
  if (!config.ok) return config;
  if (!settings?.email) return { ok: false, message: "请先填写接收邮箱。" };
  if (!settings.emailEnabled) return { ok: false, message: "邮件通知未开启。" };

  let sent = 0;
  for (const subscription of subscriptions) {
    await sendResendEmail({
      apiKey: config.apiKey,
      from: config.from,
      to: settings.email,
      subject: `${subscription.name || "订阅"}：${subscription.reminderLabel || "到期提醒"}`,
      html: buildSubscriptionEmailHtml(subscription),
    });
    sent += 1;
  }

  return { ok: true, sent };
}
