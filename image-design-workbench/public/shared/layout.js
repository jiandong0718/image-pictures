// 共享布局：渲染侧边栏 + 顶栏（含当前用户、积分余额、登出）。
// 各页面只负责自己的内容区；导航结构集中在这里，保证多页一致。

import { fetchMe, logout } from "./api.js";

const NAV = [
  { group: "工具" },
  { href: "/playground", label: "自由生图", key: "playground" },
  { href: "/full-playground", label: "绘图聚集地", key: "full-playground" },
  { href: "/prompt", label: "提示词提取", key: "prompt" },
  { group: "工作台" },
  { href: "/studio/hat", label: "商品衍生图", key: "studio-hat" },
  { href: "/studio/bag", label: "商品微调图", key: "studio-bag" },
  { href: "/studio/3d", label: "3D 转平面", key: "studio-3d" },
  { group: "账户" },
  { href: "/account", label: "我的积分", key: "account" },
];

// 仅管理员可见：配置中心（生图端点/提示词）+ 充值管理。
const ADMIN_NAV = [
  { group: "管理" },
  { href: "/config", label: "配置中心", key: "config" },
  { href: "/admin", label: "充值管理", key: "admin" },
];

// 主题切换：tech(深色科技) / xianxia(仙侠)。data-theme 由 theme-init.js 在渲染前同步应用。
const THEME_LABELS = { tech: "科技", xianxia: "仙侠" };

function currentTheme() {
  return document.documentElement.dataset.theme === "xianxia" ? "xianxia" : "tech";
}

function broadcastTheme() {
  document.querySelectorAll("iframe").forEach((frame) => {
    try {
      frame.contentWindow?.postMessage(
        { type: "image-workbench:theme-changed", theme: currentTheme() },
        window.location.origin,
      );
    } catch {
      /* 跨域或 iframe 未就绪时忽略 */
    }
  });
}

function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  try {
    localStorage.setItem("imageStudioTheme", name);
  } catch (e) {
    /* localStorage 不可用时仅当次生效 */
  }
  broadcastTheme();
}

function toggleTheme(btn) {
  const next = currentTheme() === "xianxia" ? "tech" : "xianxia";
  applyTheme(next);
  if (btn) btn.textContent = `${THEME_LABELS[next]}风`;
}

// 缓存当前用户（非敏感：仅用于即时渲染菜单/顶栏；真正的权限由服务端 cookie + 路由/接口守卫强制）。
const ME_KEY = "imageStudio:me";

function readCachedMe() {
  try {
    const raw = localStorage.getItem(ME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cacheMe(me) {
  try {
    localStorage.setItem(
      ME_KEY,
      JSON.stringify({ id: me.id, username: me.username, role: me.role, credits: me.credits }),
    );
  } catch {
    /* localStorage 不可用时忽略，退回每次 fetchMe */
  }
}

function loginRedirect() {
  const redirect = encodeURIComponent(location.pathname + location.search);
  location.href = `/login?redirect=${redirect}`;
}

// 切换菜单是整页刷新：先用本地缓存的用户信息同步渲染骨架（侧栏/顶栏立即出现，不等网络），
// 再后台校验会话 + 刷新余额/角色。这样导航不再卡在 fetchMe 的网络往返上。
export async function mountLayout(opts) {
  let me = readCachedMe();
  if (!me) {
    me = await fetchMe();
    if (!me) {
      loginRedirect();
      return null;
    }
    cacheMe(me);
  }

  const ctx = renderShell(me, opts);

  // 后台校验：会话失效则跳登录；余额/角色变化则更新（角色变了重载以刷新菜单）。
  fetchMe()
    .then((fresh) => {
      if (!fresh) {
        try {
          localStorage.removeItem(ME_KEY);
        } catch {
          /* 忽略 */
        }
        loginRedirect();
        return;
      }
      cacheMe(fresh);
      setCredits(fresh.credits);
      if (fresh.role !== me.role) {
        location.reload();
      }
    })
    .catch(() => {
      /* 网络抖动不打断已渲染页面 */
    });

  return ctx;
}

function renderShell(me, { active, title, crumb }) {
  const navItems = [...NAV];
  if (me.role === "admin") {
    navItems.push(...ADMIN_NAV);
  }

  const navHtml = navItems
    .map((item) => {
      if (item.group) {
        return `<p class="nav-group">${item.group}</p>`;
      }
      const isActive = item.key === active;
      return `<a class="nav-link${isActive ? " active" : ""}" href="${item.href}"><span class="dot"></span>${item.label}</a>`;
    })
    .join("");

  const shell = document.createElement("div");
  shell.className = "shell";
  shell.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"></div>
        <div>
          <div class="brand-name">图像设计工作台</div>
          <div class="brand-sub">Image Studio</div>
        </div>
      </div>
      <nav class="nav">${navHtml}</nav>
      <div class="nav-spacer"></div>
      <div class="nav-foot">1 积分 = 1 元 = 1 张图</div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="topbar-title">
          <span class="crumb">${crumb || ""}</span>
          <h1>${title || ""}</h1>
        </div>
        <div class="topbar-right">
          <span class="credit-pill" id="layoutCredits">
            <span>积分</span><span class="num" data-credits>${me.credits}</span>
          </span>
          <span class="user-chip">
            <span class="user-avatar">${(me.username || "?").slice(0, 1).toUpperCase()}</span>
            <span>${me.username}</span>
          </span>
          <button class="btn sm ghost" id="layoutTheme" type="button" title="切换主题">${THEME_LABELS[currentTheme()]}风</button>
          <button class="btn sm ghost" id="layoutLogout" type="button">登出</button>
        </div>
      </header>
      <div class="content" id="pageContent"></div>
    </div>
  `;

  // 把页面原有内容搬进 content 容器。#page 默认被 CSS 隐藏（避免挂载前
  // 内容以裸样式闪现在左上角），搬进骨架后再显示，消除“先中间后边缘”的跳动。
  const existing = document.getElementById("page");
  document.body.innerHTML = "";
  document.body.appendChild(shell);
  if (existing) {
    shell.querySelector("#pageContent").appendChild(existing);
    existing.style.visibility = "visible";
  }

  shell.querySelector("#layoutLogout").addEventListener("click", () => logout());
  const themeBtn = shell.querySelector("#layoutTheme");
  themeBtn.addEventListener("click", () => toggleTheme(themeBtn));
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === "image-workbench:request-theme") {
      event.source?.postMessage(
        { type: "image-workbench:theme-changed", theme: currentTheme() },
        event.origin,
      );
    }
    if (event.data?.type === "image-workbench:credits-changed") {
      setCredits(event.data.credits);
    }
  });
  requestAnimationFrame(broadcastTheme);

  return { me, setCredits };
}

// 供页面在生图后更新顶栏余额。
export function setCredits(value) {
  if (typeof value !== "number") {
    return;
  }
  document.querySelectorAll("[data-credits]").forEach((el) => {
    el.textContent = String(value);
  });
}
