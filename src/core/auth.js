import { AUTH_SESSION_KEY, DEMO_USER } from "../config/auth.js";
import { checkServerSession, loginServer, logoutServer } from "./server-auth.js";

export function createAuthController(elements) {
  const authModal = document.querySelector("#authModal");
  const authForm = document.querySelector("#authForm");
  const authButton = document.querySelector("#authButton");
  const authHint = authForm.querySelector(".hint");

  const state = {
    isAuthenticated: localStorage.getItem(AUTH_SESSION_KEY) === "true",
    serverConfigured: false,
    authMode: "local",
    user: null,
    sessionChecked: false,
  };

  function notifyServerLogin() {
    window.dispatchEvent(new CustomEvent("personalHub:serverLogin", { detail: { user: state.user } }));
  }

  function renderAuthState() {
    document.body.classList.toggle("is-locked", !state.isAuthenticated);
    authButton.textContent = state.isAuthenticated ? "退出" : "登录";
    elements.modal.querySelector("#entryFormHint").textContent = state.isAuthenticated
      ? state.authMode === "server"
        ? "当前已通过服务器登录，编辑数据仍会先写入浏览器，后续可在设置页同步到服务器。"
        : "保存后会写入本地浏览器存储。"
      : "当前为浏览模式，登录后才可以新增、编辑和删除信息。";
  }

  function openLogin() {
    authForm.reset();
    authHint.textContent = state.serverConfigured
      ? "请输入 VPS 服务器管理员账号。"
      : "服务器管理员账号未配置，本地开发可暂用原型账号：admin / hub2026。";
    authModal.showModal();
  }

  async function logout() {
    if (state.authMode === "server") {
      await logoutServer().catch(() => {});
    }
    state.isAuthenticated = false;
    state.user = null;
    state.authMode = "local";
    localStorage.removeItem(AUTH_SESSION_KEY);
    renderAuthState();
  }

  function requireAuth() {
    if (state.isAuthenticated) return true;
    openLogin();
    return false;
  }

  async function refreshServerSession(options = {}) {
    const wasAuthenticated = state.isAuthenticated;
    try {
      const session = await checkServerSession();
      state.serverConfigured = Boolean(session.configured);
      if (session.configured) {
        state.authMode = "server";
        const wasServerAuthenticated = Boolean(state.isAuthenticated && state.user);
        state.isAuthenticated = Boolean(session.authenticated);
        state.user = session.user || null;
        if (state.isAuthenticated) {
          localStorage.setItem(AUTH_SESSION_KEY, "true");
          if (!wasServerAuthenticated && !options.silent) notifyServerLogin();
        } else {
          localStorage.removeItem(AUTH_SESSION_KEY);
        }
      }
    } catch {
      state.serverConfigured = false;
    }
    if (state.sessionChecked && wasAuthenticated && state.serverConfigured && !state.isAuthenticated && !options.silent) {
      window.alert("登录状态已过期，请重新登录后再编辑或同步数据。");
      openLogin();
    }
    state.sessionChecked = true;
    renderAuthState();
    return state.isAuthenticated;
  }

  async function ensureAuth() {
    if (!requireAuth()) return false;
    if (state.serverConfigured || state.authMode === "server") {
      const isSessionValid = await refreshServerSession();
      if (!isSessionValid) {
        openLogin();
        return false;
      }
    }
    return true;
  }

  authButton.addEventListener("click", async () => {
    if (state.isAuthenticated) {
      await logout();
      return;
    }
    openLogin();
  });

  authForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();

    const formData = new FormData(authForm);
    const username = String(formData.get("username") || "");
    const password = String(formData.get("password") || "");

    if (state.serverConfigured) {
      try {
        const result = await loginServer(username, password);
        state.isAuthenticated = true;
        state.authMode = "server";
        state.user = result.user || null;
        localStorage.setItem(AUTH_SESSION_KEY, "true");
        authModal.close();
        renderAuthState();
        notifyServerLogin();
        return;
      } catch (error) {
        authHint.textContent = error.message || "服务器登录失败。";
        return;
      }
    }

    if (username !== DEMO_USER.username || password !== DEMO_USER.password) {
      authHint.textContent = "账号或密码不正确。本地原型账号：admin / hub2026。";
      return;
    }

    state.isAuthenticated = true;
    state.authMode = "local";
    state.user = { username };
    localStorage.setItem(AUTH_SESSION_KEY, "true");
    authModal.close();
    renderAuthState();
  });

  renderAuthState();
  refreshServerSession({ silent: true });

  window.addEventListener("focus", () => {
    if (state.serverConfigured || state.authMode === "server") {
      refreshServerSession({ silent: true });
    }
  });

  return {
    get isAuthenticated() {
      return state.isAuthenticated;
    },
    get isServerAuthenticated() {
      return state.isAuthenticated && state.authMode === "server";
    },
    requireAuth,
    ensureAuth,
    refreshServerSession,
  };
}
