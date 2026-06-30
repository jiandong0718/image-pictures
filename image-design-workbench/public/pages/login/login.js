// 登录 / 注册页。根据 URL（/login 或 /register）决定初始模式，可在页内切换。

import { apiPost, fetchMe } from "/shared/api.js";

let mode = location.pathname === "/register" ? "register" : "login";

const els = {
  label: document.getElementById("formLabel"),
  title: document.getElementById("formTitle"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  msg: document.getElementById("authMsg"),
  submit: document.getElementById("submitBtn"),
  switchHint: document.getElementById("switchHint"),
  switchMode: document.getElementById("switchMode"),
  form: document.getElementById("authForm"),
};

function redirectTarget() {
  const params = new URLSearchParams(location.search);
  const redirect = params.get("redirect");
  return redirect && redirect.startsWith("/") ? redirect : "/studio/hat";
}

function renderMode() {
  const isLogin = mode === "login";
  els.label.textContent = isLogin ? "账户登录" : "创建账户";
  els.title.textContent = isLogin ? "欢迎回来" : "注册新账户";
  els.submit.textContent = isLogin ? "登录" : "注册并登录";
  els.password.autocomplete = isLogin ? "current-password" : "new-password";
  els.switchHint.textContent = isLogin ? "还没有账户？" : "已有账户？";
  els.switchMode.textContent = isLogin ? "立即注册" : "去登录";
  setMsg("");
}

function setMsg(text, kind = "") {
  els.msg.textContent = text || "";
  els.msg.className = `msg ${kind}`;
}

els.switchMode.addEventListener("click", (e) => {
  e.preventDefault();
  mode = mode === "login" ? "register" : "login";
  renderMode();
});

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = els.username.value.trim();
  const password = els.password.value;
  if (!username || !password) {
    setMsg("请输入用户名和密码", "error");
    return;
  }
  els.submit.disabled = true;
  setMsg(mode === "login" ? "登录中…" : "注册中…");
  try {
    const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    await apiPost(path, { username, password });
    location.href = redirectTarget();
  } catch (err) {
    setMsg(err.message, "error");
    els.submit.disabled = false;
  }
});

// 已登录则直接进工作台。
fetchMe().then((user) => {
  if (user) {
    location.href = redirectTarget();
  }
});

renderMode();
