import { escapeHtml, excerptText, formatCurrency } from "../core/utils.js";

const typeLabels = {
  tasks: "事项",
  bills: "账单",
  notes: "笔记",
  collections: "项目集",
};

export function emptyState(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

export function statCard(label, value, hint) {
  return `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </article>
  `;
}

export function contentCard(item, type, coverLabel) {
  const tags = (item.tags || [])
    .slice(0, 3)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");

  return `
    <article class="content-card" data-open="${escapeHtml(type)}:${escapeHtml(item.id)}" tabindex="0">
      <div class="cover">${escapeHtml(item.category || item.status || coverLabel || "内容")}</div>
      <div>
        <h3>${escapeHtml(item.title || item.name || "未命名")}</h3>
        <p>${escapeHtml(item.description || item.note || "暂无说明")}</p>
      </div>
      <div class="meta-row">
        ${item.isFavorite ? '<span class="tag">重点</span>' : ""}
        <span>${escapeHtml(item.updatedAt || item.date || "")}</span>
      </div>
      <div class="tag-row">${tags}</div>
    </article>
  `;
}

export function taskRow(task) {
  const statusClass = task.status === "已完成" ? "done" : task.status === "进行中" ? "progress" : "";
  return `
    <article class="task-row" data-open="tasks:${escapeHtml(task.id)}">
      <button class="task-check ${task.status === "已完成" ? "done" : ""}" data-complete="${escapeHtml(task.id)}" type="button" title="标记完成" aria-label="标记完成"></button>
      <div>
        <strong>${escapeHtml(task.title)}</strong>
        <p>${escapeHtml(task.description || "暂无说明")}</p>
        <div class="meta-row">
          <span>${escapeHtml(task.priority || "中")} 优先级</span>
          <span>截止 ${escapeHtml(task.dueDate || "未设置")}</span>
          ${(task.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
        </div>
      </div>
      <span class="status ${statusClass}">${escapeHtml(task.status || "待处理")}</span>
    </article>
  `;
}

export function noteRow(note) {
  const noteTypeLabel =
    note.noteType === "idea" ? "灵感" : note.noteType === "link" ? "链接" : note.noteType === "summary" ? "回顾" : "笔记";
  const summary = note.description || excerptText(note.content || "", 88) || "暂无说明";
  return `
    <article class="note-row" data-open="notes:${escapeHtml(note.id)}">
      <div class="meta-row">
        ${note.pinned ? '<span class="tag">置顶</span>' : ""}
        <span>${escapeHtml(note.category || "笔记")}</span>
        <span class="tag">${escapeHtml(noteTypeLabel)}</span>
        <span>${escapeHtml(note.updatedAt || "")}</span>
      </div>
      <strong>${escapeHtml(note.title)}</strong>
      <p>${escapeHtml(summary)}</p>
      <div class="tag-row">${(note.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    </article>
  `;
}

export function billRow(bill) {
  const isIncome = bill.type === "收入";
  const moneyClass = isIncome ? "income" : "expense";
  const fixedExpense = bill.fixedExpenseType || "";
  return `
    <tr data-open="bills:${escapeHtml(bill.id)}">
      <td>${escapeHtml(bill.date || "")}</td>
      <td>${escapeHtml(bill.title)}</td>
      <td>${escapeHtml(bill.category || "未分类")}</td>
      <td>${escapeHtml(bill.type || "支出")}</td>
      <td>${escapeHtml(bill.payer || "未指定")}</td>
      <td>${escapeHtml(bill.source || "手动")}</td>
      <td>${fixedExpense ? `<span class="tag">${escapeHtml(fixedExpense)}</span>` : '<span class="muted-text">普通</span>'}</td>
      <td class="money ${moneyClass}">${isIncome ? "+" : "-"}${formatCurrency(bill.amount)}</td>
    </tr>
  `;
}

export function categoryBars(items) {
  const totals = items.reduce((map, item) => {
    map[item.category] = (map[item.category] || 0) + Number(item.amount || 0);
    return map;
  }, {});

  const max = Math.max(...Object.values(totals), 1);
  const rows = Object.entries(totals)
    .map(([label, value]) => {
      const width = Math.round((value / max) * 100);
      return `
        <div class="bar-row">
          <span>${escapeHtml(label)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
          <strong>${formatCurrency(value)}</strong>
        </div>
      `;
    })
    .join("");

  return `<div class="chart-bars">${rows || emptyState("暂无分类统计")}</div>`;
}

export function searchResultCard(item) {
  return `
    <article class="search-result-card" data-open="${escapeHtml(item.entryType)}:${escapeHtml(item.id)}">
      <div class="meta-row">
        <span class="tag">${escapeHtml(typeLabels[item.entryType] || "内容")}</span>
        ${item.isFavorite ? '<span class="tag">重点</span>' : ""}
        <span>${escapeHtml(item.updatedAt || item.date || "")}</span>
      </div>
      <strong>${escapeHtml(item.title || item.name || "未命名")}</strong>
      <p>${escapeHtml(item.description || item.note || "暂无说明")}</p>
      <div class="tag-row">
        ${(item.tags || []).slice(0, 4).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    </article>
  `;
}

export function recentViewRow(item) {
  return `
    <article class="recent-view-row" data-open="${escapeHtml(item.type)}:${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(typeLabels[item.type] || item.type)}</p>
      </div>
      <span>${escapeHtml(item.viewedAt || "")}</span>
    </article>
  `;
}

export function budgetProgressCard(label, spent, limit) {
  const safeLimit = Math.max(Number(limit || 0), 1);
  const percent = Math.min(Math.round((Number(spent || 0) / safeLimit) * 100), 100);
  return `
    <article class="budget-card">
      <div class="meta-row">
        <strong>${escapeHtml(label)}</strong>
        <span>${formatCurrency(spent)} / ${formatCurrency(limit)}</span>
      </div>
      <div class="bar-track"><span class="bar-fill" style="width:${percent}%"></span></div>
      <small>${percent}% 已使用</small>
    </article>
  `;
}

export function contactCard(contact, stats) {
  return `
    <article class="content-card">
      <div class="cover">${escapeHtml(contact.relationType || "关系人")}</div>
      <div>
        <h3>${escapeHtml(contact.name)}</h3>
        <p>${escapeHtml(contact.note || "暂无备注")}</p>
      </div>
      <div class="meta-row">
        ${contact.isImportant ? '<span class="tag">重点关系</span>' : ""}
        <span>${escapeHtml(contact.relationType || "其他")}</span>
      </div>
      <div class="tag-row">
        <span class="tag">收到 ${formatCurrency(stats.received)}</span>
        <span class="tag">给出 ${formatCurrency(stats.given)}</span>
        <span class="tag">差额 ${formatCurrency(stats.balance)}</span>
      </div>
    </article>
  `;
}

export function favorEventRow(event, contactName) {
  const directionLabel = event.direction === "received" ? "收到" : "给出";
  return `
    <article class="search-result-card">
      <div class="meta-row">
        <span class="tag">${escapeHtml(event.eventType || "往来")}</span>
        <span>${escapeHtml(directionLabel)}</span>
        <span>${escapeHtml(event.date || "")}</span>
      </div>
      <strong>${escapeHtml(event.title)}</strong>
      <p>${escapeHtml(contactName)} · ${formatCurrency(event.amount)}${event.giftName ? ` · ${escapeHtml(event.giftName)}` : ""}</p>
      <div class="tag-row">
        ${event.method ? `<span class="tag">${escapeHtml(event.method)}</span>` : ""}
        ${event.linkedBillId ? '<span class="tag">已同步账单</span>' : ""}
        ${event.isReturned ? '<span class="tag">已回礼</span>' : ""}
      </div>
    </article>
  `;
}

export function pendingFavorCard(item) {
  const levelLabel =
    item.level === "key"
      ? "重点提醒"
      : item.level === "attention"
        ? "建议尽快处理"
        : item.level === "balanced"
          ? "关系平衡"
          : "待安排";
  return `
    <article class="search-result-card">
      <div class="meta-row">
        <span class="tag">${escapeHtml(item.event.eventType || "往来")}</span>
        <span>${escapeHtml(item.event.date || "")}</span>
        <span>${escapeHtml(levelLabel)}</span>
      </div>
      <strong>${escapeHtml(item.contact?.name || "未关联")}</strong>
      <p>收到 ${formatCurrency(item.event.amount)}，建议回礼 ${formatCurrency(item.suggestedAmount)}</p>
      <div class="tag-row">
        <span class="tag">${escapeHtml(item.reason)}</span>
        <span class="tag">当前差额 ${formatCurrency(item.balance)}</span>
      </div>
      <div class="topbar-actions">
        <button class="ghost-button" data-mark-return="${escapeHtml(item.event.id)}" type="button">标记已回礼</button>
      </div>
    </article>
  `;
}

export function subscriptionCard(item) {
  const renewalLabel =
    item.daysUntilRenewal === null
      ? "未设置到期"
      : item.daysUntilRenewal < 0
        ? `已过期 ${Math.abs(item.daysUntilRenewal)} 天`
        : item.daysUntilRenewal === 0
          ? "今天到期"
          : `${item.daysUntilRenewal} 天后到期`;
  const cycleLabel =
    item.cycle === "yearly" ? "年付" : item.cycle === "quarterly" ? "季付" : item.cycle === "monthly" ? "月付" : "自定义";
  const advice = item.advice || { label: "继续观察", reason: "等待更多使用记录", level: "normal" };
  const usageLabels = { high: "高频", occasional: "偶尔", rare: "少用", unknown: "未记录" };
  const necessityLabels = { essential: "必需", replaceable: "可替代", optional: "可取消", unknown: "未判断" };
  const statusLabels = { active: "使用中", paused: "已暂停", cancelled: "已取消" };

  return `
    <article class="content-card subscription-card subscription-info-card subscription-card--${escapeHtml(item.level || "normal")}">
      <div class="subscription-info-card__top">
        <span>${escapeHtml(item.category || "订阅")}</span>
        <strong>${escapeHtml(item.reminderLabel || renewalLabel)}</strong>
      </div>
      <div class="subscription-info-card__main">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.note || "暂无订阅备注")}</p>
        </div>
        <div class="subscription-info-card__price">
          <strong>${formatCurrency(item.amount)}</strong>
          <span>月均 ${formatCurrency(item.monthlyCost || item.amount)}</span>
        </div>
      </div>
      <div class="subscription-info-card__chips">
        <span>${escapeHtml(cycleLabel)}</span>
        <span>${item.autoRenew ? "自动续费" : "手动续费"}</span>
        <span>${escapeHtml(statusLabels[item.status] || item.status || "使用中")}</span>
        ${item.websiteUrl ? `<span>网址 ${escapeHtml(item.websiteUrl)}</span>` : ""}
        ${item.accountName ? `<span>账号 ${escapeHtml(item.accountName)}</span>` : ""}
        ${item.accountPassword ? "<span>密码已保存</span>" : ""}
        <span>年化 ${formatCurrency(item.annualCost || 0)}</span>
        <span>到期 ${escapeHtml(item.nextRenewalDate || "未设置")}</span>
        <span>${escapeHtml(usageLabels[item.usageFrequency] || usageLabels.unknown)}</span>
        <span>${escapeHtml(necessityLabels[item.necessity] || necessityLabels.unknown)}</span>
        ${item.satisfaction ? `<span>满意 ${escapeHtml(String(item.satisfaction))}/5</span>` : ""}
        ${item.nextReviewDate ? `<span>复盘 ${escapeHtml(item.nextReviewDate)}</span>` : ""}
        ${item.lastBillDate ? `<span>已记账 ${escapeHtml(item.lastBillDate)}</span>` : ""}
        ${item.lastRenewedAt ? `<span>已续费 ${escapeHtml(item.lastRenewedAt)}</span>` : ""}
        ${item.lastReviewedAt ? `<span>已复盘 ${escapeHtml(item.lastReviewedAt)}</span>` : ""}
      </div>
      <div class="subscription-info-card__advice">
        <div>
          <strong>${escapeHtml(advice.label)}</strong>
          <span>${escapeHtml(advice.reason)}</span>
        </div>
        ${
          item.review?.reasons?.length
            ? `<div>
          <strong>${escapeHtml(item.review.label)}</strong>
          <span>${escapeHtml(item.review.reasons.join(" / "))}</span>
        </div>`
            : ""
        }
      </div>
      <div class="subscription-info-card__actions">
        <button class="ghost-button" data-subscription-bill="${escapeHtml(item.id)}" type="button">生成账单</button>
        <button class="primary-button" data-subscription-renew="${escapeHtml(item.id)}" type="button">确认续费</button>
        <button class="ghost-button" data-subscription-review="${escapeHtml(item.id)}" type="button">复盘</button>
        ${
          item.status === "paused"
            ? `<button class="ghost-button" data-subscription-status="${escapeHtml(item.id)}:active" type="button">恢复</button>`
            : `<button class="ghost-button" data-subscription-status="${escapeHtml(item.id)}:paused" type="button">暂停</button>`
        }
        ${
          item.status === "cancelled"
            ? ""
            : `<button class="ghost-button" data-subscription-status="${escapeHtml(item.id)}:cancelled" type="button">取消</button>`
        }
      </div>
    </article>
  `;
}
