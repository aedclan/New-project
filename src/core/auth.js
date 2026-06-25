import { AUTH_SESSION_KEY, DEMO_USER } from "../config/auth.js";

export function createAuthController(elements) {
  const authModal = document.querySelector("#authModal");
  const authForm = document.querySelector("#authForm");
  const authButton = document.querySelector("#authButton");
  const authHint = authForm.querySelector(".hint");

  const state = {
    isAuthenticated: localStorage.getItem(AUTH_SESSION_KEY) === "true",
  };

  function renderAuthState() {
    document.body.classList.toggle("is-locked", !state.isAuthenticated);
    authButton.textContent = state.isAuthenticated ? "退出" : "登录";
    elements.modal.querySelector("#entryFormHint").textContent = state.isAuthenticated
      ? "保存后会写入本地浏览器存储。"
      : "当前为浏览模式，登录后才可以新增、编辑和删除信息。";
  }

  function openLogin() {
    authForm.reset();
    authHint.textContent = "本地原型账号：admin / hub2026。正式版会升级为真实登录系统。";
    authModal.showModal();
  }

  function logout() {
    state.isAuthenticated = false;
    localStorage.removeItem(AUTH_SESSION_KEY);
    renderAuthState();
  }

  function requireAuth() {
    if (state.isAuthenticated) return true;
    openLogin();
    return false;
  }

  authButton.addEventListener("click", () => {
    if (state.isAuthenticated) {
      logout();
      return;
    }
    openLogin();
  });

  authForm.addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();

    const formData = new FormData(authForm);
    const username = String(formData.get("username") || "");
    const password = String(formData.get("password") || "");

    if (username !== DEMO_USER.username || password !== DEMO_USER.password) {
      authHint.textContent = "账号或密码不正确。本地原型账号：admin / hub2026。";
      return;
    }

    state.isAuthenticated = true;
    localStorage.setItem(AUTH_SESSION_KEY, "true");
    authModal.close();
    renderAuthState();
  });

  renderAuthState();

  return {
    get isAuthenticated() {
      return state.isAuthenticated;
    },
    requireAuth,
  };
}
