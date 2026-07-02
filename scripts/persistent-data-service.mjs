import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getCurrentUser } from "./auth-service.mjs";

const dataFilePath = resolve(process.env.PERSONAL_HUB_DATA_FILE || "/app/data/personal-hub-data.json");
const dataEventClients = new Map();

function jsonResponse(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request) {
  return Boolean(getCurrentUser(request));
}

function readRequestJson(request) {
  return new Promise((resolveJson, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        request.destroy();
        reject(new Error("请求数据过大"));
      }
    });
    request.on("end", () => {
      try {
        resolveJson(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON 格式不正确"));
      }
    });
    request.on("error", reject);
  });
}

function userDataFilePath(user) {
  return resolve(join(dirname(dataFilePath), "users", `user-${user.id}.json`));
}

function dataEventKey(user) {
  return user ? `user:${user.id}` : "";
}

function resolveRequestDataFile(request) {
  const user = getCurrentUser(request);
  if (!user) return { user: null, filePath: dataFilePath, legacyFilePath: "" };
  return {
    user,
    filePath: userDataFilePath(user),
    legacyFilePath: user.role === "admin" ? dataFilePath : "",
  };
}

function readStoredData(filePath, legacyFilePath = "") {
  const targetPath = existsSync(filePath) ? filePath : legacyFilePath && existsSync(legacyFilePath) ? legacyFilePath : "";
  if (!targetPath) return null;
  return JSON.parse(readFileSync(targetPath, "utf8").replace(/^\uFEFF/, ""));
}

function writeStoredData(data, filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    data,
  };
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  renameSync(tempPath, filePath);
  return payload;
}

function addDataEventClient(user, response) {
  const key = dataEventKey(user);
  if (!key) return false;
  if (!dataEventClients.has(key)) dataEventClients.set(key, new Set());
  const clients = dataEventClients.get(key);
  clients.add(response);
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write(`event: ready\ndata: ${JSON.stringify({ ok: true, user: { id: user.id, username: user.username, role: user.role } })}\n\n`);
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(": ping\n\n");
  }, 25000);
  response.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(response);
    if (clients.size === 0) dataEventClients.delete(key);
  });
  return true;
}

function notifyDataChanged(user, payload) {
  const key = dataEventKey(user);
  if (!key || !dataEventClients.has(key)) return;
  const message = `event: data-updated\ndata: ${JSON.stringify({
    ok: true,
    savedAt: payload.savedAt,
    user: { id: user.id, username: user.username, role: user.role },
  })}\n\n`;
  dataEventClients.get(key).forEach((client) => {
    if (!client.writableEnded) client.write(message);
  });
}

export async function handlePersistentDataRequest(request, response) {
  const url = new URL(request.url || "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/data/events") {
    const user = getCurrentUser(request);
    if (!user) {
      jsonResponse(response, 401, { ok: false, message: "请先登录服务器账号。" });
      return true;
    }
    addDataEventClient(user, response);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/data/status") {
    const { user, filePath, legacyFilePath } = resolveRequestDataFile(request);
    const authenticated = Boolean(user);
    jsonResponse(response, 200, {
      ok: true,
      configured: authenticated,
      authenticated,
      hasData: existsSync(filePath) || Boolean(legacyFilePath && existsSync(legacyFilePath)),
      dataFile: filePath,
      user: user ? { id: user.id, username: user.username, role: user.role } : null,
    });
    return true;
  }

  if (url.pathname !== "/api/data") return false;

  if (!isAuthorized(request)) {
    jsonResponse(response, 401, {
      ok: false,
      message: "请先登录服务器账号后再使用账号同步。",
    });
    return true;
  }

  if (request.method === "GET") {
    const { filePath, legacyFilePath } = resolveRequestDataFile(request);
    const stored = readStoredData(filePath, legacyFilePath);
    jsonResponse(response, 200, {
      ok: true,
      hasData: Boolean(stored),
      savedAt: stored?.savedAt || "",
      data: stored?.data || null,
    });
    return true;
  }

  if (request.method === "PUT") {
    const { user, filePath } = resolveRequestDataFile(request);
    const payload = await readRequestJson(request);
    if (!payload || typeof payload.data !== "object" || Array.isArray(payload.data)) {
      jsonResponse(response, 400, { ok: false, message: "缺少 data 对象。" });
      return true;
    }
    const stored = writeStoredData(payload.data, filePath);
    notifyDataChanged(user, stored);
    jsonResponse(response, 200, {
      ok: true,
      savedAt: stored.savedAt,
      message: "服务器数据已保存。",
    });
    return true;
  }

  jsonResponse(response, 405, { ok: false, message: "方法不支持。" });
  return true;
}
