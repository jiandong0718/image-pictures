// 绘图聚集地：嵌入 vendor 的完整 React 工具。本页仅负责布局外壳。

import { mountLayout } from "/shared/layout.js";

function currentTheme() {
  return document.documentElement.dataset.theme === "xianxia" ? "xianxia" : "tech";
}

function sendThemeToFrame() {
  const frame = document.querySelector(".embed-card iframe");
  frame?.contentWindow?.postMessage(
    { type: "image-workbench:theme-changed", theme: currentTheme() },
    window.location.origin,
  );
}

mountLayout({ active: "full-playground", title: "绘图聚集地", crumb: "TOOLS" }).then((ctx) => {
  if (!ctx) return;
  const frame = document.querySelector(".embed-card iframe");
  frame?.addEventListener("load", sendThemeToFrame);
  sendThemeToFrame();
});
