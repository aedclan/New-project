import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { handleAuthRequest } from "./auth-service.mjs";
import { handlePersistentDataRequest } from "./persistent-data-service.mjs";
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
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

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
});

