// 配置中心：生图 API Key、提示词提取 API、重置缓存。三块互相独立。

import { mountLayout } from "/shared/layout.js";
import { apiGet, apiPost } from "/shared/api.js";
import { createLocalState } from "/shared/persistence.js";

const els = {};
const storage = createLocalState("imageStudio:config:v1");

function badge(el, uploaded) {
  el.className = uploaded ? "badge ok" : "badge";
  el.textContent = uploaded ? "已配置" : "未配置";
}

function setMsg(el, text, kind = "") {
  el.textContent = text || "";
  el.className = `msg ${kind}`;
}

async function loadStatus() {
  const draft = storage.load({});
  if (draft && typeof draft === "object") {
    if (typeof draft.promptUrl === "string") {
      els.promptUrl.value = draft.promptUrl;
    }
    if (typeof draft.promptModel === "string") {
      els.promptModel.value = draft.promptModel;
    }
  }
  try {
    const [img, prompt] = await Promise.all([apiGet("/api/image-config"), apiGet("/api/prompt-config")]);
    badge(els.imageStatus, img.config?.uploaded);
    badge(els.promptStatus, prompt.config?.uploaded);
    if (prompt.config?.apiBase) {
      els.promptUrl.value = prompt.config.apiBase;
    }
    els.promptModel.value = prompt.config?.model || "gpt-4o-mini";
  } catch (err) {
    setMsg(els.imageMsg, err.message, "error");
  }
}

function saveDraft() {
  storage.save({
    promptUrl: els.promptUrl.value.trim(),
    promptModel: els.promptModel.value.trim(),
  });
}

async function saveImage(e) {
  e.preventDefault();
  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    setMsg(els.imageMsg, "API Key 不能为空", "error");
    return;
  }
  els.saveImage.disabled = true;
  setMsg(els.imageMsg, "保存中…");
  try {
    const data = await apiPost("/api/image-config", { apiKey });
    badge(els.imageStatus, data.config?.uploaded);
    els.apiKey.value = "";
    setMsg(els.imageMsg, "生图配置已生效", "success");
  } catch (err) {
    setMsg(els.imageMsg, err.message, "error");
  } finally {
    els.saveImage.disabled = false;
  }
}

async function savePrompt(e) {
  e.preventDefault();
  const apiBase = els.promptUrl.value.trim();
  const apiKey = els.promptKey.value.trim();
  const model = els.promptModel.value.trim() || "gpt-4o-mini";
  if (!apiBase) {
    setMsg(els.promptMsg, "提示词 API URL 不能为空", "error");
    return;
  }
  if (!apiKey) {
    setMsg(els.promptMsg, "提示词 API Key 不能为空", "error");
    return;
  }
  els.savePrompt.disabled = true;
  setMsg(els.promptMsg, "保存中…");
  try {
    const data = await apiPost("/api/prompt-config", { apiBase, apiKey, model });
    badge(els.promptStatus, data.config?.uploaded);
    els.promptModel.value = data.config?.model || model;
    els.promptKey.value = "";
    saveDraft();
    setMsg(els.promptMsg, "提示词配置已生效", "success");
  } catch (err) {
    setMsg(els.promptMsg, err.message, "error");
  } finally {
    els.savePrompt.disabled = false;
  }
}

async function resetCache() {
  if (!window.confirm("这会删除所有已生成图片文件，套图编号从 001 重新开始。继续吗？")) {
    return;
  }
  els.resetCache.disabled = true;
  setMsg(els.resetMsg, "重置中…");
  try {
    const data = await apiPost("/api/image-sets/reset", {});
    setMsg(els.resetMsg, `缓存已清理，当前文件夹：${data.imageSet.folderName}`, "success");
  } catch (err) {
    setMsg(els.resetMsg, err.message, "error");
  } finally {
    els.resetCache.disabled = false;
  }
}

async function main() {
  const ctx = await mountLayout({ active: "config", title: "配置中心", crumb: "SETTINGS" });
  if (!ctx) {
    return;
  }
  Object.assign(els, {
    imageForm: document.getElementById("imageForm"),
    promptForm: document.getElementById("promptForm"),
    imageStatus: document.getElementById("imageStatus"),
    promptStatus: document.getElementById("promptStatus"),
    apiKey: document.getElementById("apiKey"),
    promptUrl: document.getElementById("promptUrl"),
    promptKey: document.getElementById("promptKey"),
    promptModel: document.getElementById("promptModel"),
    imageMsg: document.getElementById("imageMsg"),
    promptMsg: document.getElementById("promptMsg"),
    resetMsg: document.getElementById("resetMsg"),
    saveImage: document.getElementById("saveImage"),
    savePrompt: document.getElementById("savePrompt"),
    resetCache: document.getElementById("resetCache"),
  });
  els.imageForm.addEventListener("submit", saveImage);
  els.promptForm.addEventListener("submit", savePrompt);
  els.resetCache.addEventListener("click", resetCache);
  els.promptUrl.addEventListener("input", saveDraft);
  els.promptModel.addEventListener("input", saveDraft);
  await loadStatus();
}

main();
