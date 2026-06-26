import { AUTH_SESSION_KEY, DEMO_USER } from "../config/auth.js";
import { checkServerSession, loginServer, logoutServer, registerServer } from "./server-auth.js";

export function createAuthController(elements) {
  const authModal = document.querySelector("#authModal");
  const authForm = authModal.querySelector("#authForm");
  const authButton = document.querySelector("#authButton");
  const authHint = authForm.querySelector(".hint");
  const authModeSwitch = authModal.querySelector("#authModeSwitch");
  const authRegisterFields = [...authModal.querySelectorAll(".auth-register-field")];
  const authSubmitButton = authModal.querySelector("#authSubmitButton");
  const authTitle = authModal.querySelector("#authTitle");
  const authEyebrow = authModal.querySelector("#authEyebrow");

  const state = {
    isAuthenticated: localStorage.getItem(AUTH_SESSION_KEY) === "true",
    serverConfigured: false,
    registrationEnabled: false,
    registrationCodeRequired: false,
    formMode: "login",
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
        ? "当前已通过服务器账号登录，数据会按账号隔离，并可同步到服务器。"
        : "保存后会写入本地浏览器存储。"
      : "当前为浏览模式，登录后才可以新增、编辑和删除信息。";
  }

  function setFormMode(mode) {
    state.formMode = mode === "register" ? "register" : "login";
    authModeSwitch?.querySelectorAll("[data-auth-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.authMode === state.formMode);
    });
    authRegisterFields.forEach((field) => {
      const input = field.querySelector("input");
      field.hidden = state.formMode !== "register";
      input?.toggleAttribute("required", state.formMode === "register" && input.name === "confirmPassword");
    });
    if (authSubmitButton) authSubmitButton.textContent = state.formMode === "register" ? "注册" : "登录";
    if (authTitle) authTitle.textContent = state.formMode === "register" ? "创建账号" : "账号访问";
    if (authEyebrow) authEyebrow.textContent = state.formMode === "register" ? "注册" : "登录";
  }

  function updateHint() {
    if (state.formMode === "register") {
      authHint.textContent = state.serverConfigured
        ? state.registrationCodeRequired
          ? "注册需要输入服务器配置的邀请码。"
          : "创建服务器账号后，可以按账号隔离数据并跨设备同步。"
        : "本地演示模式不能创建真实账号，需要在 VPS 开启注册后使用。";
      return;
    }
    authHint.textContent = state.serverConfigured ? "使用服务器账号登录后，可编辑并跨设备同步数据。" : "本地演示账号：admin / hub2026。";
  }

  function openLogin(mode = "login") {
    authForm.reset();
    setFormMode(mode);
    updateHint();
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
      state.registrationEnabled = Boolean(session.registrationEnabled);
      state.registrationCodeRequired = Boolean(session.registrationCodeRequired);
      setFormMode(state.formMode);
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
      state.registrationEnabled = false;
      state.registrationCodeRequired = false;
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

  authModeSwitch?.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-auth-mode]");
    if (!modeButton) return;
    setFormMode(modeButton.dataset.authMode);
    updateHint();
  });

  authForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();

    const formData = new FormData(authForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    const registrationCode = String(formData.get("registrationCode") || "").trim();

    if (state.formMode === "register") {
      if (!state.serverConfigured) {
        authHint.textContent = "当前是本地演示登录，不能创建真实账号。请先配置并启动服务器账号系统。";
        return;
      }
      if (!state.registrationEnabled) {
        authHint.textContent = "服务器未开启账号注册。请在 VPS 的 .env 中设置 PERSONAL_HUB_REGISTRATION_ENABLED=true。";
        return;
      }
      try {
        const result = await registerServer(username, password, confirmPassword, registrationCode);
        state.isAuthenticated = true;
        state.authMode = "server";
        state.user = result.user || null;
        localStorage.setItem(AUTH_SESSION_KEY, "true");
        authModal.close();
        renderAuthState();
        notifyServerLogin();
        return;
      } catch (error) {
        authHint.textContent = error.message || "注册失败。";
        return;
      }
    }

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

  setFormMode("login");
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
