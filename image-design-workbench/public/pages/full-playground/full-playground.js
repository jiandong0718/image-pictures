// 绘图聚集地：嵌入 vendor 的完整 React 工具。本页仅负责布局外壳。

import { mountLayout } from "/shared/layout.js";
import { apiGet } from "/shared/api.js";

let selectedModel = "";

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

function sendModelToFrame() {
  if (!selectedModel) return;
  document.querySelector(".embed-card iframe")?.contentWindow?.postMessage(
    { type: "image-workbench:model-changed", model: selectedModel },
    window.location.origin,
  );
}

mountLayout({ active: "full-playground", title: "绘图聚集地", crumb: "TOOLS" }).then(async (ctx) => {
  if (!ctx) return;
  document.body.classList.add("full-playground-shell");
  const frame = document.querySelector(".embed-card iframe");
  frame?.addEventListener("load", () => { sendThemeToFrame(); sendModelToFrame(); });
  window.addEventListener("message", (event) => {
    if (event.origin === window.location.origin && event.source === frame?.contentWindow && event.data?.type === "image-workbench:request-config") {
      sendModelToFrame();
    }
  });
  sendThemeToFrame();
  try {
    const config = await apiGet("/api/image-config");
    const models = Array.isArray(config.models) ? config.models : [];
    if (!models.length) return;
    const select = document.getElementById("workbenchModel");
    select.replaceChildren(...models.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      return option;
    }));
    let saved = "";
    try { saved = localStorage.getItem("imageStudio:fullPlaygroundModel") || ""; } catch { /* 浏览器禁用存储时只保留本页选择。 */ }
    selectedModel = models.includes(saved) ? saved : models[0];
    select.value = selectedModel;
    document.getElementById("modelToolbar").hidden = false;
    select.addEventListener("change", () => {
      selectedModel = select.value;
      try { localStorage.setItem("imageStudio:fullPlaygroundModel", selectedModel); } catch { /* 同上。 */ }
      sendModelToFrame();
    });
    sendModelToFrame();
  } catch {
    // 配置暂不可用时保留嵌入工具原有提示。
  }
});
