import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbFilePath = resolve(process.env.PERSONAL_HUB_AUTH_DB_FILE || "/app/data/personal-hub.sqlite");
const dataFilePath = resolve(process.env.PERSONAL_HUB_DATA_FILE || "/app/data/personal-hub-data.json");
const adminUsername = String(process.env.PERSONAL_HUB_ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.PERSONAL_HUB_ADMIN_PASSWORD || "");
const sessionMaxAgeSeconds = Number(process.env.PERSONAL_HUB_SESSION_MAX_AGE || 60 * 60 * 24 * 7);
const registrationEnabled = process.env.PERSONAL_HUB_REGISTRATION_ENABLED === "true";
const registrationCode = String(process.env.PERSONAL_HUB_REGISTRATION_CODE || "").trim();

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
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      disabled INTEGER NOT NULL DEFAULT 0,
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

  const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  if (!userColumns.includes("email")) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  }
  if (!userColumns.includes("disabled")) {
    db.exec("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL AND email != ''");
  db
    .prepare("SELECT id, username FROM users WHERE email IS NULL OR email = ''")
    .all()
    .filter((user) => validateEmail(user.username))
    .forEach((user) => {
      db.prepare("UPDATE users SET email = ? WHERE id = ?").run(normalizeEmail(user.username), user.id);
    });

  if (adminUsername && adminPassword) {
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(adminUsername);
    const now = new Date().toISOString();
    const adminEmail = validateEmail(adminUsername) ? normalizeEmail(adminUsername) : null;
    if (!existing) {
      db.prepare("INSERT INTO users (username, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, 'admin', ?, ?)").run(
        adminUsername,
        adminEmail,
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

export function getCurrentUser(request) {
  const token = parseCookies(request.headers.cookie || "").personal_hub_session;
  if (!token) return null;
  const database = getDb();
  cleanupExpiredSessions(database);
  return database
    .prepare(
      `SELECT users.id, users.username, users.email, users.role
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.disabled = 0`,
    )
    .get(hashToken(token), new Date().toISOString());
}

function hasUsers() {
  return Number(getDb().prepare("SELECT COUNT(*) AS count FROM users").get().count || 0) > 0;
}

function publicUser(user) {
  return user ? { id: user.id, username: user.username, email: user.email || "", role: user.role, disabled: Boolean(user.disabled) } : null;
}

function requireAdmin(request, response) {
  const user = getCurrentUser(request);
  if (!user) {
    jsonResponse(response, 401, { ok: false, message: "请先登录管理员账号。" });
    return null;
  }
  if (user.role !== "admin") {
    jsonResponse(response, 403, { ok: false, message: "只有管理员可以管理用户。" });
    return null;
  }
  return user;
}

function dataStatusForUser(userId, role) {
  const userFile = resolve(join(dirname(dataFilePath), "users", `user-${userId}.json`));
  const legacy = role === "admin" && existsSync(dataFilePath) && !existsSync(userFile);
  const target = existsSync(userFile) ? userFile : legacy ? dataFilePath : "";
  return {
    hasData: Boolean(target),
    dataFile: target || userFile,
    dataBytes: target ? statSync(target).size : 0,
    legacy,
  };
}

function legacyDataStatus() {
  return {
    hasData: existsSync(dataFilePath),
    dataFile: dataFilePath,
    dataBytes: existsSync(dataFilePath) ? statSync(dataFilePath).size : 0,
  };
}

function userDataFilePath(userId) {
  return resolve(join(dirname(dataFilePath), "users", `user-${userId}.json`));
}

function validateUsername(username) {
  return /^[a-zA-Z0-9_.@-]{3,32}$/.test(username);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function validatePassword(password) {
  return String(password || "").length >= 8;
}

function createSession(user) {
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
  return token;
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
      registrationEnabled,
      registrationCodeRequired: Boolean(registrationCode),
      authenticated: Boolean(user),
      user: publicUser(user),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/users") {
    const admin = requireAdmin(request, response);
    if (!admin) return true;
    const users = getDb()
      .prepare(
        `SELECT id, username, email, role, disabled, created_at AS createdAt, updated_at AS updatedAt
         FROM users
         ORDER BY role = 'admin' DESC, created_at ASC`,
      )
      .all()
      .map((user) => ({
        ...publicUser(user),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        data: dataStatusForUser(user.id, user.role),
        isCurrent: user.id === admin.id,
      }));
    jsonResponse(response, 200, { ok: true, users, legacyData: legacyDataStatus() });
    return true;
  }

  const userActionMatch = url.pathname.match(/^\/api\/auth\/users\/(\d+)\/(status|password|migrate)$/);
  if (request.method === "POST" && userActionMatch) {
    const admin = requireAdmin(request, response);
    if (!admin) return true;
    const userId = Number(userActionMatch[1]);
    const action = userActionMatch[2];
    const target = getDb().prepare("SELECT id, username, email, role, disabled FROM users WHERE id = ?").get(userId);
    if (!target) {
      jsonResponse(response, 404, { ok: false, message: "用户不存在。" });
      return true;
    }
    const payload = await readRequestJson(request);
    const now = new Date().toISOString();

    if (action === "status") {
      const disabled = Boolean(payload.disabled);
      if (target.id === admin.id && disabled) {
        jsonResponse(response, 400, { ok: false, message: "不能禁用当前登录的管理员账号。" });
        return true;
      }
      getDb().prepare("UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?").run(disabled ? 1 : 0, now, userId);
      if (disabled) getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
      jsonResponse(response, 200, { ok: true, user: publicUser({ ...target, disabled }) });
      return true;
    }

    if (action === "password") {
      const password = String(payload.password || "");
      if (!validatePassword(password)) {
        jsonResponse(response, 400, { ok: false, message: "密码至少需要 8 位。" });
        return true;
      }
      getDb().prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(password), now, userId);
      getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
      jsonResponse(response, 200, { ok: true });
      return true;
    }
    if (action === "migrate") {
      const source = String(payload.source || "legacy");
      const overwrite = Boolean(payload.overwrite);
      if (source !== "legacy") {
        jsonResponse(response, 400, { ok: false, message: "Migration source is not supported." });
        return true;
      }
      if (!existsSync(dataFilePath)) {
        jsonResponse(response, 404, { ok: false, message: "Legacy global data file was not found." });
        return true;
      }
      const targetPath = userDataFilePath(userId);
      if (existsSync(targetPath) && !overwrite) {
        jsonResponse(response, 409, { ok: false, message: "Target user already has data. Confirm overwrite before migration." });
        return true;
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(dataFilePath, targetPath);
      getDb().prepare("UPDATE users SET updated_at = ? WHERE id = ?").run(now, userId);
      jsonResponse(response, 200, {
        ok: true,
        user: publicUser({ ...target, disabled: Boolean(target.disabled) }),
        data: dataStatusForUser(userId, target.role),
        legacyData: legacyDataStatus(),
        message: "Legacy global data has been migrated to the selected user.",
      });
      return true;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    if (!registrationEnabled) {
      jsonResponse(response, 403, { ok: false, configured: hasUsers(), registrationEnabled: false, message: "服务器未开启账号注册。" });
      return true;
    }

    const payload = await readRequestJson(request);
    const email = normalizeEmail(payload.email || payload.username);
    const password = String(payload.password || "");
    const confirmPassword = String(payload.confirmPassword || "");
    const code = String(payload.registrationCode || "").trim();

    if (!validateEmail(email)) {
      jsonResponse(response, 400, { ok: false, message: "请使用有效邮箱注册。" });
      return true;
    }
    if (!validatePassword(password)) {
      jsonResponse(response, 400, { ok: false, message: "密码至少需要 8 位。" });
      return true;
    }
    if (password !== confirmPassword) {
      jsonResponse(response, 400, { ok: false, message: "两次输入的密码不一致。" });
      return true;
    }
    if (registrationCode && code !== registrationCode) {
      jsonResponse(response, 403, { ok: false, message: "注册码不正确。" });
      return true;
    }

    const database = getDb();
    const existing = database.prepare("SELECT id FROM users WHERE username = ? OR email = ?").get(email, email);
    if (existing) {
      jsonResponse(response, 409, { ok: false, message: "该邮箱已注册，请直接登录。" });
      return true;
    }

    const now = new Date().toISOString();
    const result = database.prepare("INSERT INTO users (username, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, 'user', ?, ?)").run(
      email,
      email,
      hashPassword(password),
      now,
      now,
    );
    const user = database.prepare("SELECT id, username, email, role FROM users WHERE id = ?").get(result.lastInsertRowid);
    const token = createSession(user);
    jsonResponse(
      response,
      201,
      { ok: true, configured: true, authenticated: true, user: publicUser(user) },
      { "Set-Cookie": sessionCookie(token) },
    );
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    if (!hasUsers()) {
      jsonResponse(response, 503, { ok: false, configured: false, message: "服务器未配置管理员账号。" });
      return true;
    }
    const payload = await readRequestJson(request);
    const identity = String(payload.email || payload.username || "").trim();
    const normalizedEmail = normalizeEmail(identity);
    const password = String(payload.password || "");
    const user = getDb()
      .prepare("SELECT id, username, email, role, password_hash, disabled FROM users WHERE username = ? OR username = ? OR email = ?")
      .get(identity, normalizedEmail, normalizedEmail);
    if (!user || !verifyPassword(password, user.password_hash)) {
      jsonResponse(response, 401, { ok: false, configured: true, message: "账号或密码不正确。" });
      return true;
    }
    if (user.disabled) {
      jsonResponse(response, 403, { ok: false, configured: true, message: "账号已被禁用，请联系管理员。" });
      return true;
    }

    const token = createSession(user);
    jsonResponse(
      response,
      200,
      { ok: true, configured: true, authenticated: true, user: publicUser(user) },
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
