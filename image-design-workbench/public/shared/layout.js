// 共享布局：渲染侧边栏 + 顶栏（含当前用户、积分余额、登出）。
// 各页面只负责自己的内容区；导航结构集中在这里，保证多页一致。

import { fetchMe, logout } from "./api.js";

const NAV = [
  { group: "工作台" },
  { href: "/studio/hat", label: "商品衍生图", key: "studio-hat" },
  { href: "/studio/bag", label: "商品微调图", key: "studio-bag" },
  { href: "/studio/3d", label: "3D 转平面", key: "studio-3d" },
  { group: "工具" },
  { href: "/prompt", label: "提示词提取", key: "prompt" },
  { href: "/playground", label: "自由生图", key: "playground" },
  { href: "/full-playground", label: "绘图聚集地", key: "full-playground" },
  { group: "账户" },
  { href: "/config", label: "配置中心", key: "config" },
  { href: "/account", label: "我的积分", key: "account" },
];

const ADMIN_NAV = { href: "/admin", label: "充值管理", key: "admin" };

// 主题切换：tech(深色科技) / xianxia(仙侠)。data-theme 由 theme-init.js 在渲染前同步应用。
const THEME_LABELS = { tech: "科技", xianxia: "仙侠" };

function currentTheme() {
  return document.documentElement.dataset.theme === "xianxia" ? "xianxia" : "tech";
}

function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  try {
    localStorage.setItem("imageStudioTheme", name);
  } catch (e) {
    /* localStorage 不可用时仅当次生效 */
  }
}

function toggleTheme(btn) {
  const next = currentTheme() === "xianxia" ? "tech" : "xianxia";
  applyTheme(next);
  if (btn) btn.textContent = `${THEME_LABELS[next]}风`;
}

export async function mountLayout({ active, title, crumb }) {
  const me = await fetchMe();
  if (!me) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    location.href = `/login?redirect=${redirect}`;
    return null;
  }

  const navItems = [...NAV];
  if (me.role === "admin") {
    navItems.push({ group: "管理" }, ADMIN_NAV);
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

  // 把页面原有内容搬进 content 容器。
  const existing = document.getElementById("page");
  document.body.innerHTML = "";
  document.body.appendChild(shell);
  if (existing) {
    shell.querySelector("#pageContent").appendChild(existing);
  }

  shell.querySelector("#layoutLogout").addEventListener("click", () => logout());
  const themeBtn = shell.querySelector("#layoutTheme");
  themeBtn.addEventListener("click", () => toggleTheme(themeBtn));

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
