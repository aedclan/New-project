import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbFilePath = resolve(process.env.PERSONAL_HUB_AUTH_DB_FILE || "/app/data/personal-hub.sqlite");
const adminUsername = String(process.env.PERSONAL_HUB_ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.PERSONAL_HUB_ADMIN_PASSWORD || "");
const sessionMaxAgeSeconds = Number(process.env.PERSONAL_HUB_SESSION_MAX_AGE || 60 * 60 * 24 * 7);

let db;

function jsonResponse(response, status, payload, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(payload));
}

function readRequestJson(request) {
  return new Promise((resolveJson, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
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

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHash] = String(storedHash || "").split(":");
  if (!salt || !expectedHash) return false;
  const actualHash = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === actualHash.length && timingSafeEqual(expected, actualHash);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(cookieHeader = "") {
  return String(cookieHeader)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const [key, ...value] = item.split("=");
      cookies[key] = decodeURIComponent(value.join("="));
      return cookies;
    }, {});
}

function sessionCookie(token, maxAge = sessionMaxAgeSeconds) {
  const secure = process.env.PERSONAL_HUB_SECURE_COOKIE === "true" ? "; Secure" : "";
  return `personal_hub_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function getDb() {
  if (db) return db;
  mkdirSync(dirname(dbFilePath), { recursive: true });
  const shouldCreate = !existsSync(dbFilePath);
  db = new DatabaseSync(dbFilePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  if (adminUsername && adminPassword) {
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(adminUsername);
    const now = new Date().toISOString();
    if (!existing) {
      db.prepare("INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'admin', ?, ?)").run(
        adminUsername,
        hashPassword(adminPassword),
        now,
        now,
      );
    } else if (process.env.PERSONAL_HUB_ADMIN_RESET === "true") {
      db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?").run(hashPassword(adminPassword), now, adminUsername);
    }
  }

  if (shouldCreate && !adminUsername) {
    console.log("Auth database created without an admin user. Set PERSONAL_HUB_ADMIN_USERNAME and PERSONAL_HUB_ADMIN_PASSWORD.");
  }

  return db;
}

function cleanupExpiredSessions(database = getDb()) {
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}

function getCurrentUser(request) {
  const token = parseCookies(request.headers.cookie || "").personal_hub_session;
  if (!token) return null;
  const database = getDb();
  cleanupExpiredSessions(database);
  return database
    .prepare(
      `SELECT users.id, users.username, users.role
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(hashToken(token), new Date().toISOString());
}

function hasUsers() {
  return Number(getDb().prepare("SELECT COUNT(*) AS count FROM users").get().count || 0) > 0;
}

export async function handleAuthRequest(request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/auth/")) return false;

  if (request.method === "GET" && url.pathname === "/api/auth/session") {
    const configured = hasUsers();
    const user = configured ? getCurrentUser(request) : null;
    jsonResponse(response, 200, {
      ok: true,
      configured,
      authenticated: Boolean(user),
      user: user ? { username: user.username, role: user.role } : null,
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    if (!hasUsers()) {
      jsonResponse(response, 503, { ok: false, configured: false, message: "服务器未配置管理员账号。" });
      return true;
    }
    const payload = await readRequestJson(request);
    const username = String(payload.username || "").trim();
    const password = String(payload.password || "");
    const user = getDb().prepare("SELECT id, username, role, password_hash FROM users WHERE username = ?").get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      jsonResponse(response, 401, { ok: false, configured: true, message: "账号或密码不正确。" });
      return true;
    }

    cleanupExpiredSessions();
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionMaxAgeSeconds * 1000).toISOString();
    getDb().prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
      hashToken(token),
      user.id,
      expiresAt,
      now.toISOString(),
    );
    jsonResponse(
      response,
      200,
      { ok: true, configured: true, authenticated: true, user: { username: user.username, role: user.role } },
      { "Set-Cookie": sessionCookie(token) },
    );
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookies(request.headers.cookie || "").personal_hub_session;
    if (token) getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    jsonResponse(response, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
    return true;
  }

  jsonResponse(response, 404, { ok: false, message: "认证接口不存在。" });
  return true;
}
