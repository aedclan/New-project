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
const authEmailFrom = String(process.env.AUTH_EMAIL_FROM || process.env.SUBSCRIPTION_EMAIL_FROM || "").trim();
const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
const publicSiteUrl = String(process.env.PUBLIC_SITE_URL || process.env.PERSONAL_HUB_DOMAIN || "http://127.0.0.1:5173").replace(/\/+$/, "");
const emailVerificationMaxAgeSeconds = Number(process.env.AUTH_EMAIL_VERIFICATION_MAX_AGE || 60 * 60 * 24);
const passwordResetMaxAgeSeconds = Number(process.env.AUTH_PASSWORD_RESET_MAX_AGE || 60 * 60);

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

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function validatePassword(password) {
  return String(password || "").length >= 8;
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
      email_verified INTEGER NOT NULL DEFAULT 1,
      email_verified_at TEXT,
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
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  if (!userColumns.includes("email")) db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  if (!userColumns.includes("email_verified")) db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1");
  if (!userColumns.includes("email_verified_at")) db.exec("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
  if (!userColumns.includes("disabled")) db.exec("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL AND email != ''");

  db
    .prepare("SELECT id, username FROM users WHERE email IS NULL OR email = ''")
    .all()
    .filter((user) => validateEmail(user.username))
    .forEach((user) => {
      db.prepare("UPDATE users SET email = ? WHERE id = ?").run(normalizeEmail(user.username), user.id);
    });

  if (adminUsername && adminPassword) {
    const adminEmail = validateEmail(adminUsername) ? normalizeEmail(adminUsername) : null;
    const existing = db.prepare("SELECT id FROM users WHERE username = ? OR email = ?").get(adminUsername, adminEmail || "");
    const now = new Date().toISOString();
    if (!existing) {
      db.prepare("INSERT INTO users (username, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, 'admin', ?, ?)").run(
        adminEmail || adminUsername,
        adminEmail,
        hashPassword(adminPassword),
        now,
        now,
      );
    } else if (process.env.PERSONAL_HUB_ADMIN_RESET === "true") {
      db.prepare("UPDATE users SET password_hash = ?, email = COALESCE(email, ?), updated_at = ? WHERE id = ?").run(
        hashPassword(adminPassword),
        adminEmail,
        now,
        existing.id,
      );
    }
  }

  if (shouldCreate && !adminUsername) {
    console.log("认证数据库已创建，但还没有管理员账号。请设置 PERSONAL_HUB_ADMIN_USERNAME 和 PERSONAL_HUB_ADMIN_PASSWORD。");
  }

  return db;
}

function requireAuthEmailConfig() {
  return Boolean(resendApiKey && authEmailFrom && publicSiteUrl);
}

async function sendAuthEmail({ to, subject, html }) {
  if (!requireAuthEmailConfig()) {
    throw new Error("认证邮件服务未配置，请设置 RESEND_API_KEY、AUTH_EMAIL_FROM 和 PUBLIC_SITE_URL。");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: authEmailFrom, to, subject, html }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "认证邮件发送失败。");
  return result;
}

async function createAndSendVerificationEmail(user) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + emailVerificationMaxAgeSeconds * 1000).toISOString();
  getDb().prepare("DELETE FROM email_verification_tokens WHERE user_id = ? OR expires_at <= ? OR used_at IS NOT NULL").run(user.id, now.toISOString());
  getDb().prepare("INSERT INTO email_verification_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    user.id,
    expiresAt,
    now.toISOString(),
  );
  const verifyUrl = `${publicSiteUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await sendAuthEmail({
    to: user.email,
    subject: "验证你的 Personal Hub 邮箱",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#111827;">
        <h2>验证邮箱</h2>
        <p>请点击下面的链接完成 Personal Hub 邮箱验证：</p>
        <p><a href="${verifyUrl}" style="color:#2563eb;">${verifyUrl}</a></p>
        <p>链接有效期为 ${Math.round(emailVerificationMaxAgeSeconds / 3600)} 小时。</p>
      </div>
    `,
  });
}

async function createAndSendPasswordResetEmail(user) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + passwordResetMaxAgeSeconds * 1000).toISOString();
  getDb().prepare("DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at <= ? OR used_at IS NOT NULL").run(user.id, now.toISOString());
  getDb().prepare("INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    user.id,
    expiresAt,
    now.toISOString(),
  );
  const resetUrl = `${publicSiteUrl}/api/auth/reset-password?token=${encodeURIComponent(token)}`;
  await sendAuthEmail({
    to: user.email,
    subject: "重置你的 Personal Hub 密码",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#111827;">
        <h2>重置密码</h2>
        <p>请点击下面的链接重置 Personal Hub 登录密码：</p>
        <p><a href="${resetUrl}" style="color:#2563eb;">${resetUrl}</a></p>
        <p>链接有效期为 ${Math.round(passwordResetMaxAgeSeconds / 60)} 分钟。如果不是你本人操作，可以忽略这封邮件。</p>
      </div>
    `,
  });
}

function passwordResetHtml(token, message = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>重置密码 - Personal Hub</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7fb; color: #111827; }
    main { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 24px; box-shadow: 0 20px 60px rgba(15, 23, 42, .08); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { color: #64748b; line-height: 1.6; }
    label { display: grid; gap: 8px; margin: 16px 0; font-weight: 700; }
    input { min-height: 42px; border: 1px solid #d1d5db; border-radius: 10px; padding: 0 12px; font: inherit; }
    button { width: 100%; min-height: 44px; border: 0; border-radius: 10px; background: #111827; color: #fff; font-weight: 800; cursor: pointer; }
    .message { margin-top: 12px; color: #2563eb; }
    .error { color: #dc2626; }
  </style>
</head>
<body>
  <main>
    <h1>重置密码</h1>
    <p>请输入新密码。提交成功后，请回到 Personal Hub 重新登录。</p>
    <form id="resetForm">
      <input name="token" type="hidden" value="${token.replaceAll('"', "&quot;")}" />
      <label>新密码<input name="password" type="password" autocomplete="new-password" required minlength="8" /></label>
      <label>确认密码<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" /></label>
      <button type="submit">确认重置</button>
    </form>
    <p class="message" id="message">${message}</p>
  </main>
  <script>
    document.querySelector("#resetForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const message = document.querySelector("#message");
      message.className = "message";
      message.textContent = "正在提交...";
      try {
        const response = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: form.get("token"),
            password: form.get("password"),
            confirmPassword: form.get("confirmPassword"),
          }),
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.message || "重置失败。");
        message.textContent = payload.message || "密码已重置，请回到网站登录。";
        event.currentTarget.reset();
      } catch (error) {
        message.className = "message error";
        message.textContent = error.message || "重置失败。";
      }
    });
  </script>
</body>
</html>`;
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
      `SELECT users.id, users.username, users.email, users.role, users.email_verified AS emailVerified
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
  return user
    ? {
        id: user.id,
        username: user.username,
        email: user.email || "",
        role: user.role,
        disabled: Boolean(user.disabled),
        emailVerified: Boolean(user.emailVerified ?? user.email_verified ?? true),
      }
    : null;
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
        `SELECT id, username, email, role, email_verified AS emailVerified, email_verified_at AS emailVerifiedAt, disabled, created_at AS createdAt, updated_at AS updatedAt
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

  const userActionMatch = url.pathname.match(/^\/api\/auth\/users\/(\d+)\/(status|password|email|verify-email|resend-verification|migrate)$/);
  if (request.method === "POST" && userActionMatch) {
    const admin = requireAdmin(request, response);
    if (!admin) return true;
    const userId = Number(userActionMatch[1]);
    const action = userActionMatch[2];
    const target = getDb().prepare("SELECT id, username, email, role, email_verified AS emailVerified, disabled FROM users WHERE id = ?").get(userId);
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

    if (action === "email") {
      const email = normalizeEmail(payload.email);
      if (!validateEmail(email)) {
        jsonResponse(response, 400, { ok: false, message: "请填写有效邮箱。" });
        return true;
      }
      const existing = getDb().prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, userId);
      if (existing) {
        jsonResponse(response, 409, { ok: false, message: "该邮箱已被其他用户使用。" });
        return true;
      }
      getDb()
        .prepare("UPDATE users SET email = ?, username = CASE WHEN username = '' OR username IS NULL THEN ? ELSE username END, email_verified = 0, email_verified_at = NULL, updated_at = ? WHERE id = ?")
        .run(email, email, now, userId);
      getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
      jsonResponse(response, 200, { ok: true, message: "邮箱已更新，该用户需要重新验证邮箱并登录。" });
      return true;
    }

    if (action === "verify-email") {
      if (!target.email) {
        jsonResponse(response, 400, { ok: false, message: "该用户还没有绑定邮箱。" });
        return true;
      }
      getDb().prepare("UPDATE users SET email_verified = 1, email_verified_at = ?, updated_at = ? WHERE id = ?").run(now, now, userId);
      getDb().prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);
      jsonResponse(response, 200, { ok: true, message: "邮箱已标记为已验证。" });
      return true;
    }

    if (action === "resend-verification") {
      if (!target.email) {
        jsonResponse(response, 400, { ok: false, message: "该用户还没有绑定邮箱。" });
        return true;
      }
      await createAndSendVerificationEmail({ id: target.id, email: target.email });
      jsonResponse(response, 200, { ok: true, message: "验证邮件已发送。" });
      return true;
    }

    if (action === "migrate") {
      const source = String(payload.source || "legacy");
      const overwrite = Boolean(payload.overwrite);
      if (source !== "legacy") {
        jsonResponse(response, 400, { ok: false, message: "暂不支持该迁移来源。" });
        return true;
      }
      if (!existsSync(dataFilePath)) {
        jsonResponse(response, 404, { ok: false, message: "未找到旧全局数据文件。" });
        return true;
      }
      const targetPath = userDataFilePath(userId);
      if (existsSync(targetPath) && !overwrite) {
        jsonResponse(response, 409, { ok: false, message: "目标用户已有数据，请确认覆盖后再迁移。" });
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
        message: "旧全局数据已迁移到指定用户。",
      });
      return true;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    if (!registrationEnabled) {
      jsonResponse(response, 403, { ok: false, configured: hasUsers(), registrationEnabled: false, message: "服务器未开启邮箱注册。" });
      return true;
    }

    const payload = await readRequestJson(request);
    const email = normalizeEmail(payload.email);
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
    const existing = database.prepare("SELECT id FROM users WHERE email = ? OR username = ?").get(email, email);
    if (existing) {
      jsonResponse(response, 409, { ok: false, message: "该邮箱已注册，请直接登录。" });
      return true;
    }

    const now = new Date().toISOString();
    if (!requireAuthEmailConfig()) {
      jsonResponse(response, 503, { ok: false, message: "认证邮件服务未配置，暂不能开放邮箱注册。" });
      return true;
    }

    const result = database.prepare("INSERT INTO users (username, email, password_hash, role, email_verified, created_at, updated_at) VALUES (?, ?, ?, 'user', 0, ?, ?)").run(
      email,
      email,
      hashPassword(password),
      now,
      now,
    );
    const user = database.prepare("SELECT id, username, email, role, email_verified AS emailVerified FROM users WHERE id = ?").get(result.lastInsertRowid);
    await createAndSendVerificationEmail(user);
    jsonResponse(response, 201, {
      ok: true,
      configured: true,
      authenticated: false,
      verificationRequired: true,
      user: publicUser(user),
      message: "注册成功，请前往邮箱完成验证后再登录。",
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/resend-verification") {
    const payload = await readRequestJson(request);
    const email = normalizeEmail(payload.email || payload.username);
    if (!validateEmail(email)) {
      jsonResponse(response, 400, { ok: false, message: "请填写有效邮箱。" });
      return true;
    }
    const user = getDb().prepare("SELECT id, username, email, role, email_verified AS emailVerified, disabled FROM users WHERE email = ?").get(email);
    if (!user) {
      jsonResponse(response, 404, { ok: false, message: "未找到该邮箱账号。" });
      return true;
    }
    if (user.emailVerified) {
      jsonResponse(response, 200, { ok: true, message: "该邮箱已经验证，可以直接登录。" });
      return true;
    }
    await createAndSendVerificationEmail(user);
    jsonResponse(response, 200, { ok: true, message: "验证邮件已重新发送。" });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/request-password-reset") {
    const payload = await readRequestJson(request);
    const email = normalizeEmail(payload.email || payload.username);
    if (!validateEmail(email)) {
      jsonResponse(response, 400, { ok: false, message: "请填写有效邮箱。" });
      return true;
    }
    const user = getDb()
      .prepare("SELECT id, username, email, role, email_verified AS emailVerified, disabled FROM users WHERE email = ?")
      .get(email);
    if (user && !user.disabled && user.email && user.emailVerified) {
      await createAndSendPasswordResetEmail(user);
    }
    jsonResponse(response, 200, { ok: true, message: "如果该邮箱已注册且验证通过，系统会发送密码重置邮件。" });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/reset-password") {
    const token = String(url.searchParams.get("token") || "");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(passwordResetHtml(token));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/reset-password") {
    const payload = await readRequestJson(request);
    const token = String(payload.token || "");
    const password = String(payload.password || "");
    const confirmPassword = String(payload.confirmPassword || "");
    if (!validatePassword(password)) {
      jsonResponse(response, 400, { ok: false, message: "密码至少需要 8 位。" });
      return true;
    }
    if (password !== confirmPassword) {
      jsonResponse(response, 400, { ok: false, message: "两次输入的密码不一致。" });
      return true;
    }
    const tokenHash = hashToken(token);
    const now = new Date().toISOString();
    const record = getDb()
      .prepare(
        `SELECT password_reset_tokens.user_id AS userId
         FROM password_reset_tokens
         JOIN users ON users.id = password_reset_tokens.user_id
         WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL AND users.disabled = 0`,
      )
      .get(tokenHash, now);
    if (!record) {
      jsonResponse(response, 400, { ok: false, message: "重置链接无效或已过期，请重新申请。" });
      return true;
    }
    getDb().prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(password), now, record.userId);
    getDb().prepare("UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?").run(now, tokenHash);
    getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(record.userId);
    jsonResponse(response, 200, { ok: true, message: "密码已重置，请回到网站重新登录。" });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/change-password") {
    const currentUser = getCurrentUser(request);
    if (!currentUser) {
      jsonResponse(response, 401, { ok: false, message: "请先登录。" });
      return true;
    }
    const payload = await readRequestJson(request);
    const oldPassword = String(payload.oldPassword || "");
    const newPassword = String(payload.newPassword || "");
    const confirmPassword = String(payload.confirmPassword || "");
    if (!validatePassword(newPassword)) {
      jsonResponse(response, 400, { ok: false, message: "新密码至少需要 8 位。" });
      return true;
    }
    if (newPassword !== confirmPassword) {
      jsonResponse(response, 400, { ok: false, message: "两次输入的新密码不一致。" });
      return true;
    }
    const user = getDb().prepare("SELECT id, password_hash FROM users WHERE id = ?").get(currentUser.id);
    if (!user || !verifyPassword(oldPassword, user.password_hash)) {
      jsonResponse(response, 403, { ok: false, message: "当前密码不正确。" });
      return true;
    }
    const now = new Date().toISOString();
    getDb().prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(newPassword), now, currentUser.id);
    getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(currentUser.id);
    jsonResponse(response, 200, { ok: true, message: "密码已修改，请重新登录。" }, { "Set-Cookie": sessionCookie("", 0) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/verify-email") {
    const token = String(url.searchParams.get("token") || "");
    const tokenHash = hashToken(token);
    const now = new Date().toISOString();
    const record = getDb()
      .prepare(
        `SELECT email_verification_tokens.user_id AS userId, users.email
         FROM email_verification_tokens
         JOIN users ON users.id = email_verification_tokens.user_id
         WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL`,
      )
      .get(tokenHash, now);
    if (!record) {
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1>邮箱验证失败</h1><p>验证链接无效或已过期，请回到网站重新发送验证邮件。</p>");
      return true;
    }
    getDb().prepare("UPDATE users SET email_verified = 1, email_verified_at = ?, updated_at = ? WHERE id = ?").run(now, now, record.userId);
    getDb().prepare("UPDATE email_verification_tokens SET used_at = ? WHERE token_hash = ?").run(now, tokenHash);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<h1>邮箱验证成功</h1><p>你现在可以回到 Personal Hub 使用邮箱登录。</p>");
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
      .prepare("SELECT id, username, email, role, password_hash, email_verified AS emailVerified, disabled FROM users WHERE email = ? OR username = ?")
      .get(normalizedEmail, identity);
    if (!user || !verifyPassword(password, user.password_hash)) {
      jsonResponse(response, 401, { ok: false, configured: true, message: "邮箱或密码不正确。" });
      return true;
    }
    if (user.disabled) {
      jsonResponse(response, 403, { ok: false, configured: true, message: "账号已被禁用，请联系管理员。" });
      return true;
    }
    if (!user.email && user.role !== "admin") {
      jsonResponse(response, 403, { ok: false, configured: true, code: "EMAIL_REQUIRED", message: "该旧账号尚未绑定邮箱，请联系管理员补充邮箱。" });
      return true;
    }
    if (user.email && user.role !== "admin" && !user.emailVerified) {
      jsonResponse(response, 403, { ok: false, configured: true, code: "EMAIL_NOT_VERIFIED", message: "邮箱尚未验证，请先前往邮箱完成验证。" });
      return true;
    }

    const token = createSession(user);
    jsonResponse(response, 200, { ok: true, configured: true, authenticated: true, user: publicUser(user) }, { "Set-Cookie": sessionCookie(token) });
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
