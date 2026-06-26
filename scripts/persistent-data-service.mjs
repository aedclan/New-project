import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dataFilePath = resolve(process.env.PERSONAL_HUB_DATA_FILE || "/app/data/personal-hub-data.json");
const syncToken = String(process.env.PERSONAL_HUB_SYNC_TOKEN || "").trim();

function jsonResponse(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request) {
  if (!syncToken) return false;
  const auth = String(request.headers.authorization || "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerToken = String(request.headers["x-personal-hub-token"] || "").trim();
  return bearer === syncToken || headerToken === syncToken;
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

function readStoredData() {
  if (!existsSync(dataFilePath)) return null;
  return JSON.parse(readFileSync(dataFilePath, "utf8"));
}

function writeStoredData(data) {
  mkdirSync(dirname(dataFilePath), { recursive: true });
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    data,
  };
  const tempPath = `${dataFilePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  renameSync(tempPath, dataFilePath);
  return payload;
}

export async function handlePersistentDataRequest(request, response) {
  const url = new URL(request.url || "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/data/status") {
    jsonResponse(response, 200, {
      ok: true,
      configured: Boolean(syncToken),
      hasData: existsSync(dataFilePath),
      dataFile: dataFilePath,
    });
    return true;
  }

  if (url.pathname !== "/api/data") return false;

  if (!isAuthorized(request)) {
    jsonResponse(response, syncToken ? 401 : 503, {
      ok: false,
      message: syncToken ? "同步密钥不正确。" : "服务器未配置 PERSONAL_HUB_SYNC_TOKEN，暂不能使用服务器同步。",
    });
    return true;
  }

  if (request.method === "GET") {
    const stored = readStoredData();
    jsonResponse(response, 200, {
      ok: true,
      hasData: Boolean(stored),
      savedAt: stored?.savedAt || "",
      data: stored?.data || null,
    });
    return true;
  }

  if (request.method === "PUT") {
    const payload = await readRequestJson(request);
    if (!payload || typeof payload.data !== "object" || Array.isArray(payload.data)) {
      jsonResponse(response, 400, { ok: false, message: "缺少 data 对象。" });
      return true;
    }
    const stored = writeStoredData(payload.data);
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
