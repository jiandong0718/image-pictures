// 提示词提取页：上传图片 → 调用 /api/prompts/extract → 展示并可复制。

import { mountLayout } from "/shared/layout.js";
import { apiGet, apiUpload } from "/shared/api.js";
import { getDbRecord, putDbRecord } from "/shared/persistence.js";

let file = null;
let previewUrl = "";
let loading = false;
let hasPromptConfig = false;

const els = {};
const DRAFT_KEY = "imageStudio:prompt:v1";

function setMsg(text, kind = "") {
  els.msg.textContent = text || "";
  els.msg.className = `msg ${kind}`;
}

function renderState() {
  els.extractBtn.disabled = !hasPromptConfig || !file || loading;
  els.copyBtn.disabled = loading || !els.output.value.trim();
  els.configHint.textContent = hasPromptConfig
    ? ""
    : "尚未配置提示词提取 API，请先到「配置中心」保存提示词 API 配置。";
  els.configHint.style.color = hasPromptConfig ? "var(--ink-mute)" : "var(--warn)";
}

function showPreview() {
  if (loading) {
    els.preview.innerHTML = `<div class="empty"><span class="spinner"></span>提取中…</div>`;
    return;
  }
  if (previewUrl) {
    els.preview.innerHTML = "";
    const img = document.createElement("img");
    img.src = previewUrl;
    img.alt = "参考图";
    els.preview.appendChild(img);
    return;
  }
  els.preview.innerHTML = `<div class="empty">点击或拖拽上传图片<br /><span class="mono" style="font-size: 11px">PNG / JPG / WEBP / GIF · ≤20MB</span></div>`;
}

function saveDraft() {
  putDbRecord(DRAFT_KEY, {
    file,
    output: els.output?.value || "",
    fileMeta: els.fileMeta?.textContent || "",
  }).catch(() => {});
}

async function restoreDraft() {
  const draft = await getDbRecord(DRAFT_KEY).catch(() => null);
  if (!draft || typeof draft !== "object") {
    return;
  }
  if (draft.file instanceof Blob) {
    file = draft.file;
    previewUrl = URL.createObjectURL(file);
    els.fileMeta.textContent = draft.fileMeta || `${file.name || "已保存图片"} · ${(file.size / 1024 / 1024).toFixed(2)}MB`;
  }
  if (typeof draft.output === "string") {
    els.output.value = draft.output;
  }
  showPreview();
  renderState();
}

function selectFile(f) {
  if (!f) {
    return;
  }
  if (!f.type.startsWith("image/")) {
    setMsg("请选择图片文件", "error");
    return;
  }
  if (f.size > 20 * 1024 * 1024) {
    setMsg("图片不能超过 20MB", "error");
    return;
  }
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }
  file = f;
  previewUrl = URL.createObjectURL(f);
  els.output.value = "";
  els.fileMeta.textContent = `${f.name} · ${(f.size / 1024 / 1024).toFixed(2)}MB`;
  setMsg("图片已就绪，可以提取", "success");
  saveDraft();
  showPreview();
  renderState();
}

async function extract() {
  if (!file) {
    return;
  }
  loading = true;
  setMsg("");
  showPreview();
  renderState();
  try {
    const fd = new FormData();
    fd.append("image", file);
    const data = await apiUpload("/api/prompts/extract", fd);
    els.output.value = data.prompt || "";
    saveDraft();
    setMsg("提示词已提取", "success");
  } catch (err) {
    setMsg(err.message, "error");
  } finally {
    loading = false;
    showPreview();
    renderState();
  }
}

async function copy() {
  const text = els.output.value.trim();
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setMsg("已复制", "success");
  } catch {
    els.output.select();
    setMsg("复制失败，请手动复制", "error");
  }
}

async function main() {
  const ctx = await mountLayout({ active: "prompt", title: "提示词提取", crumb: "TOOLS" });
  if (!ctx) {
    return;
  }
  Object.assign(els, {
    uploadZone: document.getElementById("uploadZone"),
    preview: document.getElementById("preview"),
    fileInput: document.getElementById("fileInput"),
    selectBtn: document.getElementById("selectBtn"),
    fileMeta: document.getElementById("fileMeta"),
    output: document.getElementById("output"),
    msg: document.getElementById("msg"),
    extractBtn: document.getElementById("extractBtn"),
    copyBtn: document.getElementById("copyBtn"),
    configHint: document.getElementById("configHint"),
  });

  els.selectBtn.addEventListener("click", () => els.fileInput.click());
  els.uploadZone.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (e) => {
    selectFile(e.target.files?.[0]);
    e.target.value = "";
  });
  els.uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.uploadZone.classList.add("dragging");
  });
  els.uploadZone.addEventListener("dragleave", () => els.uploadZone.classList.remove("dragging"));
  els.uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.uploadZone.classList.remove("dragging");
    selectFile(e.dataTransfer.files?.[0]);
  });
  els.extractBtn.addEventListener("click", extract);
  els.copyBtn.addEventListener("click", copy);
  els.output.addEventListener("input", saveDraft);

  try {
    const cfg = await apiGet("/api/prompt-config");
    hasPromptConfig = Boolean(cfg.config?.uploaded);
  } catch {
    hasPromptConfig = false;
  }
  await restoreDraft();
  renderState();
}

main();
