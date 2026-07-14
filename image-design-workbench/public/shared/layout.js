
// 共享布局：渲染侧边栏 + 顶栏（含当前用户、积分余额、登出）。
// 各页面只负责自己的内容区；导航结构集中在这里，保证多页一致。

import { fetchMe, logout } from "./api.js";

// 导航图标（线性 SVG，颜色继承 currentColor，自动跟随各主题 --accent）。
const ICONS = {
  "playground": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3l1.8 4.4L18 9l-4.2 1.6L12 15l-1.8-4.4L6 9l4.2-1.6z\"/><path d=\"M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z\"/></svg>",
  "video": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z\"/><path d=\"M22 8.5 16 12l6 3.5z\"/></svg>",
  "retouch": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 21 20 7\"/><path d=\"M15 5l4 4\"/><path d=\"M9.5 4.2l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5L7.4 6.3l1.5-.6z\"/></svg>",
  "full-playground": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 3h7v7H3z\"/><path d=\"M14 3h7v7h-7z\"/><path d=\"M14 14h7v7h-7z\"/><path d=\"M3 14h7v7H3z\"/></svg>",
  "prompt": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 6h16\"/><path d=\"M4 12h9\"/><path d=\"M4 18h6\"/><path d=\"M15 16l2 2 4-4\"/></svg>",
  "studio-hat": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 2 2 7l10 5 10-5z\"/><path d=\"M2 12l10 5 10-5\"/><path d=\"M2 17l10 5 10-5\"/></svg>",
  "studio-bag": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 21v-6\"/><path d=\"M4 10V3\"/><path d=\"M12 21v-8\"/><path d=\"M12 9V3\"/><path d=\"M20 21v-4\"/><path d=\"M20 13V3\"/><path d=\"M1 15h6\"/><path d=\"M9 9h6\"/><path d=\"M17 17h6\"/></svg>",
  "studio-3d": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 8 12 3 3 8v8l9 5 9-5z\"/><path d=\"M3 8l9 5 9-5\"/><path d=\"M12 13v8\"/></svg>",
  "account": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z\"/><path d=\"M12 8v8\"/><path d=\"M14.5 9.6C14 8.6 13 8.2 12 8.2s-2 .6-2 1.6c0 2.3 4 1.4 4 3.6 0 1-1 1.6-2 1.6s-2-.4-2.5-1.4\"/></svg>",
  "my-images": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 4h14v12H3z\"/><path d=\"M3 12l4-4 3 3 4-4 3 3\"/><path d=\"M21 8v12H7\"/></svg>",
  "user-center": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z\"/><path d=\"M4.5 21c0-4 3.4-6 7.5-6s7.5 2 7.5 6\"/></svg>",
  "contact": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 6h20v12H2z\"/><path d=\"M2 10h20\"/><path d=\"M6 15h4\"/></svg>",
  "config": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z\"/><path d=\"M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.07-.32.1-.66.1-1z\"/></svg>",
  "admin": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z\"/><path d=\"M9 12l2 2 4-4\"/></svg>",
};

const NAV = [
  { group: "工具" },
  { href: "/playground", label: "自由生图", key: "playground" },
  { href: "/video", label: "AI 生视频", key: "video" },
  { href: "/retouch", label: "AI 修图", key: "retouch" },
  { href: "/full-playground", label: "绘图聚集地", key: "full-playground" },
  { href: "/prompt", label: "提示词提取", key: "prompt" },
  { group: "工作台" },
  { href: "/studio/hat", label: "商品衍生图", key: "studio-hat" },
  { href: "/studio/bag", label: "商品微调图", key: "studio-bag" },
  { href: "/studio/3d", label: "3D 转平面", key: "studio-3d" },
  { group: "账户" },
  { href: "/account", label: "我的积分", key: "account" },
  { href: "/my-images", label: "我的图库", key: "my-images" },
  { href: "/user-center", label: "用户中心", key: "user-center" },
  { href: "/contact", label: "联系充值", key: "contact" },
];

// 仅管理员可见：配置中心（生图端点/提示词）+ 充值管理。
const ADMIN_NAV = [
  { group: "管理" },
  { href: "/config", label: "配置中心", key: "config" },
  { href: "/admin", label: "充值管理", key: "admin" },
];

// 主题切换：tech(深色科技) / xianxia(仙侠) / mystic(玄幻)。点按钮按此顺序循环。
// data-theme 由 theme-init.js 在渲染前同步应用。
const THEME_LABELS = { tech: "科技", xianxia: "仙侠", mystic: "玄幻" };
const THEME_ORDER = ["tech", "xianxia", "mystic"];

function currentTheme() {
  const theme = document.documentElement.dataset.theme;
  return THEME_ORDER.includes(theme) ? theme : "tech";
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
  const idx = THEME_ORDER.indexOf(currentTheme());
  const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
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
      JSON.stringify({
        id: me.id,
        username: me.username,
        role: me.role,
        credits: me.credits,
        avatarUrl: me.avatarUrl || "",
      }),
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
      return `<a class="nav-link${isActive ? " active" : ""}" href="${item.href}">${ICONS[item.key] || ""}<span>${item.label}</span></a>`;
    })
    .join("");

  const shell = document.createElement("div");
  shell.className = "shell";
  shell.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"></div>
        <div>
          <div class="brand-name">AI 图像设计工作台</div>
          <div class="brand-sub">AI Image Studio</div>
        </div>
      </div>
      <nav class="nav">${navHtml}</nav>
      <div class="nav-spacer"></div>
      <div class="nav-foot">1 积分 = 1 元 = 1 张图</div>
    </aside>
    <div class="nav-overlay" id="navOverlay"></div>
    <div class="main">
      <header class="topbar">
        <button class="nav-toggle" id="navToggle" type="button" aria-label="菜单"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg></button>
        <div class="topbar-title">
          <span class="crumb">${crumb || ""}</span>
          <h1>${title || ""}</h1>
        </div>
        <div class="topbar-right">
          <span class="credit-pill" id="layoutCredits">
            <span>积分</span><span class="num" data-credits>${me.credits}</span>
          </span>
          <div class="user-menu-wrap">
            <button class="user-chip" id="layoutUserChip" type="button">
              <span class="user-avatar">${
                me.avatarUrl
                  ? `<img src="${me.avatarUrl}" alt="" />`
                  : (me.username || "?").slice(0, 1).toUpperCase()
              }</span>
              <span>${me.username}</span>
            </button>
            <div class="user-menu" id="layoutUserMenu">
              <a class="user-menu-item" href="/user-center">用户中心</a>
              <a class="user-menu-item" href="/user-center#pwdForm">修改密码</a>
              <button class="user-menu-item danger" id="layoutLogout" type="button">退出登录</button>
            </div>
          </div>
          <button class="btn sm ghost" id="layoutTheme" type="button" title="切换主题">${THEME_LABELS[currentTheme()]}风</button>
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

  // 移动端抽屉导航：汉堡开合 + 遮罩/选中项点击后收起。
  const navToggle = shell.querySelector("#navToggle");
  const navOverlay = shell.querySelector("#navOverlay");
  const closeNav = () => shell.classList.remove("nav-open");
  navToggle?.addEventListener("click", () => shell.classList.toggle("nav-open"));
  navOverlay?.addEventListener("click", closeNav);
  shell.querySelectorAll(".nav-link").forEach((a) => a.addEventListener("click", closeNav));

  // 用户菜单：鼠标悬停展示/收起（纯 CSS :hover，见 theme.css .user-menu-wrap），不用点击展开。
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

// 供用户中心页在头像上传成功后立即刷新顶栏头像，不用等下次导航。
export function setAvatar(url) {
  const el = document.querySelector(".topbar .user-avatar");
  if (!el) {
    return;
  }
  const me = readCachedMe();
  // 清除时（url 为空）回退到用户名首字母，与初次渲染一致。
  el.innerHTML = url
    ? `<img src="${url}" alt="" />`
    : (me?.username || "?").slice(0, 1).toUpperCase();
  if (me) {
    me.avatarUrl = url;
    cacheMe(me);
  }
}
