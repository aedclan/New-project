import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { getCurrentUser, handleAuthRequest } from "./auth-service.mjs";
import { handlePersistentDataRequest } from "./persistent-data-service.mjs";
import { startScheduledBackups } from "./scheduled-backup-service.mjs";
import { sendSubscriptionScanEmails, sendSubscriptionTestEmail } from "./subscription-email-service.mjs";

const root = resolve(process.cwd());
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};


const coverUploadDir = resolve(join(root, "assets", "login-covers"));
const coverUploadMaxBytes = 8 * 1024 * 1024;
const coverUploadTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function isLocalRequest(request) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress);
}

function canManageAuthCovers(request) {
  const user = getCurrentUser(request);
  return isLocalRequest(request) || user?.role === "admin";
}

function readRequestBuffer(request, maxBytes = coverUploadMaxBytes) {
  return new Promise((resolveBuffer, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("文件不能超过 8MB。"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function readJsonBody(request) {
  return readRequestBuffer(request, 1024 * 1024).then((buffer) => (buffer.length ? JSON.parse(buffer.toString("utf8")) : {}));
}

function normalizeCoverFilename(value) {
  const filename = String(value || "").trim().replace(/\\/g, "/").split("/").pop();
  if (!filename || filename.startsWith(".")) return "";
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return "";
  const ext = extname(filename).toLowerCase();
  return coverUploadTypes[ext] ? filename : "";
}

function resolveCoverFile(filename) {
  const safeFilename = normalizeCoverFilename(filename);
  if (!safeFilename) return null;
  const filePath = resolve(join(coverUploadDir, safeFilename));
  return filePath.startsWith(coverUploadDir) ? { filename: safeFilename, filePath } : null;
}

function parseMultipartFile(buffer, contentType) {
  const boundaryMatch = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) return null;

  const delimiter = "--" + boundary;
  const parts = buffer.toString("latin1").split(delimiter);
  for (const part of parts) {
    if (!part.includes("Content-Disposition") || !part.includes("filename=")) continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const header = part.slice(0, headerEnd);
    let content = part.slice(headerEnd + 4);
    if (content.endsWith("\r\n")) content = content.slice(0, -2);
    if (content.endsWith("--")) content = content.slice(0, -2);
    if (content.endsWith("\r\n")) content = content.slice(0, -2);
    return {
      filename: header.match(/filename="([^"]*)"/i)?.[1] || "",
      mimeType: header.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() || "",
      data: Buffer.from(content, "latin1"),
    };
  }
  return null;
}

function listAuthCoverFiles() {
  if (!existsSync(coverUploadDir)) return [];
  return readdirSync(coverUploadDir)
    .map((filename) => resolveCoverFile(filename))
    .filter(Boolean)
    .filter(({ filePath }) => existsSync(filePath) && statSync(filePath).isFile())
    .map(({ filename, filePath }) => {
      const stats = statSync(filePath);
      return {
        filename,
        path: "/assets/login-covers/" + filename,
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function handleAuthCoverRequest(request, response) {
  if (!request.url?.startsWith("/api/auth-cover")) return false;
  if (!canManageAuthCovers(request)) {
    sendJson(response, 403, { ok: false, message: "只有管理员可以管理登录封面。" });
    return true;
  }

  try {
    if (request.method === "GET" && request.url.startsWith("/api/auth-cover/files")) {
      sendJson(response, 200, { ok: true, files: listAuthCoverFiles() });
      return true;
    }

    if (request.method === "POST" && request.url.startsWith("/api/auth-cover/upload")) {
      const upload = parseMultipartFile(await readRequestBuffer(request), request.headers["content-type"]);
      const originalExt = extname(upload?.filename || "").toLowerCase();
      const ext = originalExt === ".jpeg" ? ".jpg" : originalExt;
      if (!upload?.data?.length || !coverUploadTypes[ext]) {
        sendJson(response, 400, { ok: false, message: "仅支持 jpg、png、gif、webp 图片。" });
        return true;
      }
      if (upload.mimeType && !Object.values(coverUploadTypes).includes(upload.mimeType)) {
        sendJson(response, 400, { ok: false, message: "图片类型不受支持。" });
        return true;
      }
      mkdirSync(coverUploadDir, { recursive: true });
      const filename = "cover-" + Date.now() + "-" + randomBytes(3).toString("hex") + ext;
      const filePath = resolve(join(coverUploadDir, filename));
      writeFileSync(filePath, upload.data);
      sendJson(response, 200, { ok: true, file: { filename, path: "/assets/login-covers/" + filename, size: upload.data.length } });
      return true;
    }

    if (request.method === "PATCH" && request.url.startsWith("/api/auth-cover/rename")) {
      const payload = await readJsonBody(request);
      const source = resolveCoverFile(payload.from);
      const targetName = normalizeCoverFilename(payload.to);
      const target = resolveCoverFile(targetName);
      if (!source || !target || !existsSync(source.filePath)) {
        sendJson(response, 400, { ok: false, message: "文件名不合法或原文件不存在。" });
        return true;
      }
      if (existsSync(target.filePath)) {
        sendJson(response, 409, { ok: false, message: "目标文件名已存在。" });
        return true;
      }
      renameSync(source.filePath, target.filePath);
      sendJson(response, 200, { ok: true, file: { filename: target.filename, path: "/assets/login-covers/" + target.filename } });
      return true;
    }

    if (request.method === "DELETE" && request.url.startsWith("/api/auth-cover/file")) {
      const requestUrl = new URL(request.url, "http://localhost");
      const target = resolveCoverFile(requestUrl.searchParams.get("filename"));
      if (!target || !existsSync(target.filePath)) {
        sendJson(response, 404, { ok: false, message: "文件不存在。" });
        return true;
      }
      unlinkSync(target.filePath);
      sendJson(response, 200, { ok: true });
      return true;
    }
  } catch (error) {
    sendJson(response, 400, { ok: false, message: error.message || "封面资源操作失败。" });
    return true;
  }

  sendJson(response, 404, { ok: false, message: "接口不存在。" });
  return true;
}

function resolveRequestPath(url) {
  let cleanPath = "/";
  try {
    const requestUrl = String(url || "/").replace(/^\/{2,}/, "/");
    cleanPath = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  } catch {
    return null;
  }

  const requested = cleanPath === "/" ? "/index.html" : cleanPath;
  const filePath = normalize(join(root, requested));

  if (!filePath.startsWith(root)) {
    return null;
  }

  if (!existsSync(filePath)) {
    return null;
  }

  const stats = statSync(filePath);
  if (stats.isDirectory()) {
    const indexPath = join(filePath, "index.html");
    return existsSync(indexPath) ? indexPath : null;
  }

  return filePath;
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, service: "personal-hub" }));
    return;
  }

  handleAuthRequest(request, response)
    .then((handled) => {
      if (handled) return true;
      return handleAuthCoverRequest(request, response);
    })
    .then((handled) => {
      if (handled) return true;
      return handlePersistentDataRequest(request, response);
    })
    .then((handled) => {
      if (!handled) serveStaticFile(request, response);
    })
    .catch((error) => {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, message: error.message || "服务器数据服务异常" }));
    });
});

function serveStaticFile(request, response) {
  if (response.writableEnded) return;

  if (request.method === "POST" && request.url?.startsWith("/api/subscription-email/")) {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", async () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const result = request.url.includes("/test")
          ? await sendSubscriptionTestEmail(payload.settings)
          : await sendSubscriptionScanEmails(payload.settings, payload.subscriptions || []);
        response.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, message: error.message || "邮件服务异常" }));
      }
    });
    return;
  }

  const filePath = resolveRequestPath(request.url || "/");

  if (!filePath) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const type = mimeTypes[extname(filePath)] || "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(response);
}

server.listen(port, host, () => {
  console.log(`Personal Content Hub is running at http://${host}:${port}`);
  startScheduledBackups();
});

