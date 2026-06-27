async function readJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || `请求失败：${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function checkServerSession() {
  const response = await fetch("/api/auth/session", {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  return readJsonResponse(response);
}

export async function loginServer(email, password) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email, username: email, password }),
  });
  return readJsonResponse(response);
}

export async function registerServer(email, password, confirmPassword, registrationCode) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email, password, confirmPassword, registrationCode }),
  });
  return readJsonResponse(response);
}

export async function resendVerificationEmail(email) {
  const response = await fetch("/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email }),
  });
  return readJsonResponse(response);
}

export async function requestPasswordReset(email) {
  const response = await fetch("/api/auth/request-password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email }),
  });
  return readJsonResponse(response);
}

export async function changeServerPassword(oldPassword, newPassword, confirmPassword) {
  const response = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
  });
  return readJsonResponse(response);
}

export async function logoutServer() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  return readJsonResponse(response);
}

export async function listServerUsers() {
  const response = await fetch("/api/auth/users", {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  return readJsonResponse(response);
}

export async function updateServerUserStatus(userId, disabled) {
  const response = await fetch(`/api/auth/users/${encodeURIComponent(userId)}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ disabled }),
  });
  return readJsonResponse(response);
}

export async function resetServerUserPassword(userId, password) {
  const response = await fetch(`/api/auth/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ password }),
  });
  return readJsonResponse(response);
}

export async function updateServerUserEmail(userId, email) {
  const response = await fetch(`/api/auth/users/${encodeURIComponent(userId)}/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email }),
  });
  return readJsonResponse(response);
}

export async function verifyServerUserEmail(userId) {
  const response = await fetch(`/api/auth/users/${encodeURIComponent(userId)}/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({}),
  });
  return readJsonResponse(response);
}

export async function resendServerUserVerification(userId) {
  const response = await fetch(`/api/auth/users/${encodeURIComponent(userId)}/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({}),
  });
  return readJsonResponse(response);
}

export async function migrateServerUserData(userId, options = {}) {
  const response = await fetch(`/api/auth/users/${encodeURIComponent(userId)}/migrate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(options),
  });
  return readJsonResponse(response);
}
