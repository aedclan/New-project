import { AUTH_SESSION_KEY, DEMO_USER } from "../config/auth.js";
import { checkServerSession, loginServer, logoutServer, registerServer, requestPasswordReset, resendVerificationEmail, sendRegisterEmailCode } from "./server-auth.js";

export function createAuthController(elements) {
  const AUTH_FORM_MODE_KEY = "personal-hub-auth-form-mode";
  const authModal = document.querySelector("#authModal");
  const authForm = authModal.querySelector("#authForm");
  const authButton = document.querySelector("#authButton");
  const authHint = authForm.querySelector(".hint");
  const authModeSwitch = authModal.querySelector("#authModeSwitch");
  const authRegisterFields = [...authModal.querySelectorAll(".auth-register-field")];
  const authSubmitButton = authModal.querySelector("#authSubmitButton");
  const authTitle = authModal.querySelector("#authTitle");
  const authEyebrow = authModal.querySelector("#authEyebrow");
  const authIdentityInput = authForm.elements.email || authForm.elements.username;
  const sendRegisterCodeButton = authModal.querySelector("[data-send-register-code]");
  let registerCodeTimer = null;
  const isLocalDemoHost = ["localhost", "127.0.0.1", "::1", ""].includes(window.location.hostname);
  const savedFormMode = sessionStorage.getItem(AUTH_FORM_MODE_KEY);

  const state = {
    isAuthenticated: localStorage.getItem(AUTH_SESSION_KEY) === "true",
    serverConfigured: false,
    registrationEnabled: false,
    registrationCodeRequired: false,
    formMode: savedFormMode === "register" ? "register" : "login",
    authMode: "local",
    user: localStorage.getItem(AUTH_SESSION_KEY) === "true" ? { username: DEMO_USER.username } : null,
    sessionChecked: false,
  };

  function notifyServerLogin() {
    window.dispatchEvent(new CustomEvent("personalHub:serverLogin", { detail: { user: state.user } }));
  }

  function notifyServerLogout() {
    window.dispatchEvent(new CustomEvent("personalHub:serverLogout"));
  }

  function renderAuthState() {
    document.body.classList.toggle("is-locked", !state.isAuthenticated);
    document.body.classList.toggle("auth-gate-active", !state.isAuthenticated);
    authButton.textContent = state.isAuthenticated ? "退出" : "登录";
    const accountName = state.isAuthenticated ? state.user?.email || state.user?.username || DEMO_USER.username : "未登录";
    const accountStatus = state.isAuthenticated
      ? state.authMode === "server"
        ? `${state.user?.role || "user"} · 服务器实时同步`
        : "local · 本地演示账号"
      : "浏览模式";
    if (elements.sidebarAccountName) elements.sidebarAccountName.textContent = accountName;
    if (elements.sidebarAccountStatus) elements.sidebarAccountStatus.textContent = accountStatus;
    elements.modal.querySelector("#entryFormHint").textContent = state.isAuthenticated
      ? state.authMode === "server"
        ? "当前已通过服务器邮箱账号登录，数据会按账号隔离，并可同步到服务器。"
        : "保存后会写入本地浏览器存储。"
      : "当前为浏览模式，登录后才可以新增、编辑和删除信息。";
  }

  function setFormMode(mode) {
    state.formMode = mode === "register" ? "register" : "login";
    sessionStorage.setItem(AUTH_FORM_MODE_KEY, state.formMode);
    authModeSwitch?.querySelectorAll("[data-auth-mode]").forEach((button) => {
      button.textContent = button.dataset.authMode === "register" ? "注册" : "登录";
      button.classList.toggle("is-active", button.dataset.authMode === state.formMode);
    });
    authRegisterFields.forEach((field) => {
      const input = field.querySelector("input");
      field.hidden = state.formMode !== "register";
      input?.toggleAttribute("required", state.formMode === "register" && ["confirmPassword", "emailCode"].includes(input.name));
    });
    if (authIdentityInput) {
      authIdentityInput.type = state.formMode === "register" ? "email" : "text";
      authIdentityInput.autocomplete = state.formMode === "register" ? "email" : "username";
      authIdentityInput.placeholder = state.formMode === "register" ? "name@example.com" : "邮箱或 admin";
    }
    if (authSubmitButton) authSubmitButton.textContent = state.formMode === "register" ? "注册" : "登录";
    if (authTitle) authTitle.textContent = state.formMode === "register" ? "邮箱注册" : "邮箱登录";
    if (authEyebrow) authEyebrow.textContent = state.formMode === "register" ? "注册" : "登录";
  }

  function updateHint() {
    if (state.formMode === "register") {
      authHint.textContent = state.serverConfigured
        ? state.registrationCodeRequired
          ? "注册需要输入服务器配置的邀请码。"
          : "邮箱账号会按账号隔离数据，并支持跨设备同步。"
        : "本地演示模式不能创建真实账号，需要在 VPS 开启注册后使用。";
      return;
    }
    authHint.textContent = state.serverConfigured ? "使用邮箱登录后，可编辑并跨设备同步数据。" : "本地演示账号：admin / hub2026。";
  }

  function startRegisterCodeCountdown(seconds = 60) {
    if (!sendRegisterCodeButton) return;
    window.clearInterval(registerCodeTimer);
    let remaining = Math.max(1, Number(seconds) || 60);
    sendRegisterCodeButton.disabled = true;
    sendRegisterCodeButton.textContent = `${remaining} 秒后重发`;
    registerCodeTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(registerCodeTimer);
        sendRegisterCodeButton.disabled = false;
        sendRegisterCodeButton.textContent = "发送验证码";
        return;
      }
      sendRegisterCodeButton.textContent = `${remaining} 秒后重发`;
    }, 1000);
  }

  function openLogin(mode = state.formMode) {
    authForm.reset();
    setFormMode(mode);
    updateHint();
    if (!authModal.open) authModal.showModal();
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
    notifyServerLogout();
    openLogin("login");
  }

  function requireAuth() {
    if (state.isAuthenticated) return true;
    openLogin("login");
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
    if (!state.isAuthenticated) openLogin();
    return state.isAuthenticated;
  }

  async function ensureAuth() {
    if (!requireAuth()) return false;
    if (state.authMode === "server") {
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
    openLogin("login");
  });

  authModeSwitch?.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-auth-mode]");
    if (!modeButton) return;
    setFormMode(modeButton.dataset.authMode);
    updateHint();
  });

  authForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") {
      if (!state.isAuthenticated) {
        event.preventDefault();
        authHint.textContent = "请先登录或注册账号，登录后才能进入工作台。";
      }
      return;
    }
    event.preventDefault();

    const formData = new FormData(authForm);
    const identity = String(formData.get("email") || formData.get("username") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    const registrationCode = String(formData.get("registrationCode") || "").trim();
    const emailCode = String(formData.get("emailCode") || "").trim();

    if (state.formMode === "register") {
      if (!state.serverConfigured) {
        authHint.textContent = "当前是本地演示登录，不能创建真实账号。请先配置并启动服务器账号系统。";
        return;
      }
      if (!state.registrationEnabled) {
        authHint.textContent = "服务器未开启账号注册。请在 VPS 的 .env 中设置 PERSONAL_HUB_REGISTRATION_ENABLED=true。";
        return;
      }
      if (!identity.includes("@")) {
        authHint.textContent = "注册必须使用邮箱地址。";
        return;
      }
      try {
        const result = await registerServer(identity, password, confirmPassword, registrationCode, emailCode);
        if (result.authenticated) {
          state.isAuthenticated = true;
          state.authMode = "server";
          state.user = result.user || null;
          localStorage.setItem(AUTH_SESSION_KEY, "true");
          authModal.close();
          renderAuthState();
          notifyServerLogin();
          return;
        }
        authHint.textContent = result.message || "注册成功，请登录。";
        setFormMode("login");
        return;
      } catch (error) {
        authHint.textContent = error.message || "注册失败。";
        return;
      }
    }

    if (isLocalDemoHost && identity === DEMO_USER.username && password === DEMO_USER.password) {
      state.isAuthenticated = true;
      state.authMode = "local";
      state.user = { username: identity };
      localStorage.setItem(AUTH_SESSION_KEY, "true");
      authModal.close();
      renderAuthState();
      return;
    }

    if (state.serverConfigured) {
      try {
        const result = await loginServer(identity, password);
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
        if (error.payload?.code === "EMAIL_NOT_VERIFIED") {
          authHint.innerHTML = `${error.message || "邮箱尚未验证。"} <button class="text-link-button" data-resend-verification type="button">重新发送验证邮件</button>`;
        }
        return;
      }
    }

    if (identity !== DEMO_USER.username || password !== DEMO_USER.password) {
      authHint.textContent = "邮箱或密码不正确。本地原型账号：admin / hub2026。";
      return;
    }

    state.isAuthenticated = true;
    state.authMode = "local";
    state.user = { username: identity };
    localStorage.setItem(AUTH_SESSION_KEY, "true");
    authModal.close();
    renderAuthState();
  });

  authForm.addEventListener("click", async (event) => {
    const sendCodeButton = event.target.closest("[data-send-register-code]");
    if (sendCodeButton) {
      event.preventDefault();
      const formData = new FormData(authForm);
      const email = String(formData.get("email") || formData.get("username") || "").trim().toLowerCase();
      if (!state.serverConfigured) {
        authHint.textContent = "当前服务器账号系统未配置，不能发送验证码。";
        return;
      }
      if (!state.registrationEnabled) {
        authHint.textContent = "服务器未开启账号注册。请在 VPS 的 .env 中设置 PERSONAL_HUB_REGISTRATION_ENABLED=true。";
        return;
      }
      if (!email.includes("@")) {
        authHint.textContent = "请先填写有效邮箱，再发送验证码。";
        return;
      }
      try {
        sendCodeButton.disabled = true;
        sendCodeButton.textContent = "发送中...";
        const result = await sendRegisterEmailCode(email);
        authHint.textContent = result.message || "验证码已发送，请检查邮箱。";
        startRegisterCodeCountdown(result.cooldownSeconds || 60);
      } catch (error) {
        sendCodeButton.disabled = false;
        sendCodeButton.textContent = "发送验证码";
        authHint.textContent = error.message || "验证码发送失败。";
      }
      return;
    }

    const resetButton = event.target.closest("[data-request-password-reset]");
    if (resetButton) {
      event.preventDefault();
      const formData = new FormData(authForm);
      const email = String(formData.get("email") || formData.get("username") || "").trim().toLowerCase();
      if (!email) {
        authHint.textContent = "请先填写邮箱。";
        return;
      }
      try {
        const result = await requestPasswordReset(email);
        authHint.textContent = result.message || "如果邮箱已注册，系统会发送密码重置邮件。";
      } catch (error) {
        authHint.textContent = error.message || "密码重置邮件发送失败。";
      }
      return;
    }

    const resendButton = event.target.closest("[data-resend-verification]");
    if (!resendButton) return;
    event.preventDefault();
    const formData = new FormData(authForm);
    const email = String(formData.get("email") || formData.get("username") || "").trim().toLowerCase();
    if (!email) {
      authHint.textContent = "请先填写邮箱。";
      return;
    }
    try {
      const result = await resendVerificationEmail(email);
      authHint.textContent = result.message || "验证邮件已重新发送。";
    } catch (error) {
      authHint.textContent = error.message || "验证邮件发送失败。";
    }
  });

  authModal.addEventListener("cancel", (event) => {
    if (state.isAuthenticated) return;
    event.preventDefault();
    authHint.textContent = "请先登录或注册账号，登录后才能进入工作台。";
  });

  setFormMode("login");
  renderAuthState();
  if (!state.isAuthenticated) window.setTimeout(() => openLogin(), 0);

  window.addEventListener("focus", () => {
    if (state.authMode === "server") {
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
    get user() {
      return state.user ? { ...state.user } : null;
    },
    get authMode() {
      return state.authMode;
    },
    get isAdmin() {
      if (!state.isAuthenticated) return false;
      if (state.authMode === "server") return state.user?.role === "admin";
      return state.authMode === "local" && (state.user?.username || DEMO_USER.username) === DEMO_USER.username;
    },
    requireAuth,
    ensureAuth,
    refreshServerSession,
    openLogin,
  };
}
