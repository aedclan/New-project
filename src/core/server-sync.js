import { SERVER_SYNC_AUTO_KEY, SERVER_SYNC_LAST_PUSH_KEY, SERVER_SYNC_TOKEN_KEY } from "../config/constants.js";

function getStoredToken() {
  return localStorage.getItem(SERVER_SYNC_TOKEN_KEY) || "";
}

function saveStoredToken(token) {
  const value = String(token || "").trim();
  if (value) {
    localStorage.setItem(SERVER_SYNC_TOKEN_KEY, value);
  } else {
    localStorage.removeItem(SERVER_SYNC_TOKEN_KEY);
  }
  return value;
}

async function readJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `请求失败：${response.status}`);
  }
  return payload;
}

function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    "X-Personal-Hub-Token": token,
  };
}

const collectionKeys = ["tasks", "bills", "notes", "collections", "subscriptions", "contacts", "favorEvents", "bookmarks"];
const collectionLabels = {
  tasks: "事项",
  bills: "生活收支",
  notes: "笔记",
  collections: "项目集",
  subscriptions: "订阅",
  contacts: "人物",
  favorEvents: "人情往来",
  bookmarks: "收藏",
};

function itemTimestamp(item) {
  const value = item?.updatedAt || item?.createdAt || item?.date || item?.dueDate || "";
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function mergeCollection(localItems = [], serverItems = []) {
  const merged = new Map();
  [...serverItems, ...localItems].forEach((item) => {
    if (!item || typeof item !== "object") return;
    const key = item.id || JSON.stringify(item);
    const existing = merged.get(key);
    if (!existing || itemTimestamp(item) >= itemTimestamp(existing)) {
      merged.set(key, { ...existing, ...item });
    }
  });
  return [...merged.values()].sort((left, right) => itemTimestamp(right) - itemTimestamp(left));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function describeItem(item = {}) {
  return (
    item.title ||
    item.name ||
    item.description ||
    item.merchant ||
    item.category ||
    item.eventType ||
    item.giftName ||
    item.url ||
    item.id ||
    "未命名记录"
  );
}

function buildCollectionMergeReport(key, localItems = [], serverItems = []) {
  const localMap = new Map((localItems || []).filter(Boolean).map((item) => [item.id || stableStringify(item), item]));
  const serverMap = new Map((serverItems || []).filter(Boolean).map((item) => [item.id || stableStringify(item), item]));
  const ids = new Set([...localMap.keys(), ...serverMap.keys()]);
  const localOnly = [];
  const serverOnly = [];
  const conflicts = [];
  let same = 0;

  ids.forEach((id) => {
    const localItem = localMap.get(id);
    const serverItem = serverMap.get(id);
    if (localItem && !serverItem) {
      localOnly.push(localItem);
      return;
    }
    if (!localItem && serverItem) {
      serverOnly.push(serverItem);
      return;
    }
    if (stableStringify(localItem) === stableStringify(serverItem)) {
      same += 1;
      return;
    }
    const localTime = itemTimestamp(localItem);
    const serverTime = itemTimestamp(serverItem);
    conflicts.push({
      id,
      title: describeItem(localItem || serverItem),
      localUpdatedAt: localItem?.updatedAt || localItem?.createdAt || localItem?.date || localItem?.dueDate || "",
      serverUpdatedAt: serverItem?.updatedAt || serverItem?.createdAt || serverItem?.date || serverItem?.dueDate || "",
      winner: localTime >= serverTime ? "local" : "server",
    });
  });

  return {
    key,
    label: collectionLabels[key] || key,
    localCount: localItems.length,
    serverCount: serverItems.length,
    localOnlyCount: localOnly.length,
    serverOnlyCount: serverOnly.length,
    conflictCount: conflicts.length,
    sameCount: same,
    localOnlyPreview: localOnly.slice(0, 5).map(describeItem),
    serverOnlyPreview: serverOnly.slice(0, 5).map(describeItem),
    conflicts: conflicts.slice(0, 8),
  };
}

export function summarizeHubData(data = {}) {
  return {
    tasks: (data.tasks || []).length,
    bills: (data.bills || []).length,
    notes: (data.notes || []).length,
    collections: (data.collections || []).length,
    subscriptions: (data.subscriptions || []).length,
    contacts: (data.contacts || []).length,
    favorEvents: (data.favorEvents || []).length,
    bookmarks: (data.bookmarks || []).length,
  };
}

export function formatHubDataSummary(summary = {}) {
  return [
    `事项 ${summary.tasks || 0}`,
    `账单 ${summary.bills || 0}`,
    `笔记 ${summary.notes || 0}`,
    `订阅 ${summary.subscriptions || 0}`,
    `人物 ${summary.contacts || 0}`,
    `人情 ${summary.favorEvents || 0}`,
    `收藏 ${summary.bookmarks || 0}`,
  ].join(" / ");
}

export function mergeHubData(localData = {}, serverData = {}) {
  const merged = {
    ...serverData,
    ...localData,
    budgets: { ...(serverData.budgets || {}), ...(localData.budgets || {}) },
  };
  collectionKeys.forEach((key) => {
    merged[key] = mergeCollection(localData[key] || [], serverData[key] || []);
  });
  return merged;
}

export function buildHubDataMergeReport(localData = {}, serverData = {}) {
  const collections = collectionKeys.map((key) => buildCollectionMergeReport(key, localData[key] || [], serverData[key] || []));
  const totals = collections.reduce(
    (summary, item) => ({
      localOnlyCount: summary.localOnlyCount + item.localOnlyCount,
      serverOnlyCount: summary.serverOnlyCount + item.serverOnlyCount,
      conflictCount: summary.conflictCount + item.conflictCount,
      sameCount: summary.sameCount + item.sameCount,
    }),
    { localOnlyCount: 0, serverOnlyCount: 0, conflictCount: 0, sameCount: 0 },
  );
  return {
    totals,
    collections,
    hasDifference: totals.localOnlyCount > 0 || totals.serverOnlyCount > 0 || totals.conflictCount > 0,
  };
}

export function loadServerSyncState() {
  const token = getStoredToken();
  return {
    hasToken: Boolean(token),
    maskedToken: token ? `${token.slice(0, 4)}${"*".repeat(Math.max(token.length - 4, 4))}` : "",
    autoEnabled: localStorage.getItem(SERVER_SYNC_AUTO_KEY) === "true",
    lastPushedAt: localStorage.getItem(SERVER_SYNC_LAST_PUSH_KEY) || "",
  };
}

export function saveServerSyncAutoEnabled(enabled) {
  localStorage.setItem(SERVER_SYNC_AUTO_KEY, enabled ? "true" : "false");
}

export async function checkServerSyncStatus() {
  const response = await fetch("/api/data/status", { headers: { Accept: "application/json" } });
  return readJsonResponse(response);
}

export async function pushServerData(data, token) {
  const savedToken = saveStoredToken(String(token || "").trim() || getStoredToken());
  if (!savedToken) throw new Error("请先输入服务器同步密钥。");
  const response = await fetch("/api/data", {
    method: "PUT",
    headers: authHeaders(savedToken),
    body: JSON.stringify({ data }),
  });
  const result = await readJsonResponse(response);
  localStorage.setItem(SERVER_SYNC_LAST_PUSH_KEY, result.savedAt || new Date().toISOString());
  return result;
}

export async function pullServerData(token) {
  const savedToken = saveStoredToken(String(token || "").trim() || getStoredToken());
  if (!savedToken) throw new Error("请先输入服务器同步密钥。");
  const response = await fetch("/api/data", {
    headers: authHeaders(savedToken),
  });
  return readJsonResponse(response);
}
