// 自由生图页：文生图，1-4 张，每张 1 积分。生成后更新顶栏余额。

import { mountLayout, setCredits } from "/shared/layout.js";
import { apiGet, apiPost } from "/shared/api.js";
import { createLocalState } from "/shared/persistence.js";

let loading = false;
let hasImageConfig = false;
let results = [];
const els = {};
const storage = createLocalState("imageStudio:playground:v1");

function readSavedState() {
  const saved = storage.load(null);
  return saved && typeof saved === "object" ? saved : null;
}

function saveState() {
  storage.save({
    prompt: els.prompt?.value || "",
    count: els.count ? els.count.value : "1",
    background: els.background ? els.background.value : "",
    system: els.system?.value || "",
    results,
  });
}

function applySavedState() {
  const saved = readSavedState();
  if (!saved) return;
  if (typeof saved.prompt === "string") els.prompt.value = saved.prompt;
  if (typeof saved.count === "string") els.count.value = saved.count;
  if (typeof saved.background === "string") els.background.value = saved.background;
  if (typeof saved.system === "string") els.system.value = saved.system;
  if (Array.isArray(saved.results)) results = saved.results;
}

function setMsg(text, kind = "") {
  els.msg.textContent = text || "";
  els.msg.className = `msg ${kind}`;
}

function renderState() {
  els.generateBtn.disabled = !hasImageConfig || loading;
  els.generateBtn.innerHTML = loading ? `<span class="spinner"></span>生成中…` : "生成图片";
  els.configHint.textContent = hasImageConfig
    ? ""
    : "尚未配置生图 API Key，请先到「配置中心」保存。";
  els.configHint.style.color = hasImageConfig ? "var(--ink-mute)" : "var(--warn)";
}

function renderResults() {
  if (loading) {
    els.results.innerHTML = `<div class="pg-loading"><span class="spinner"></span>正在生成…</div>`;
    return;
  }
  if (!results.length) {
    els.results.innerHTML = `<div class="empty">等待生成</div>`;
    return;
  }
  els.results.innerHTML = "";
  results.forEach((image, index) => {
    const item = document.createElement("div");
    item.className = "pg-item";
    item.innerHTML = `
      <img src="${image.url}?t=${encodeURIComponent(image.createdAt || "")}" alt="结果 ${index + 1}" loading="lazy" />
      <div class="pg-item-bar">
        <span class="badge ok">结果 ${index + 1}</span>
        <button class="btn sm" type="button">下载</button>
      </div>`;
    item.querySelector("img").addEventListener("click", () => window.open(image.url, "_blank", "noopener"));
    item.querySelector("button").addEventListener("click", () => {
      location.href = image.downloadUrl;
    });
    els.results.appendChild(item);
  });
}

async function generate(e) {
  e.preventDefault();
  const prompt = els.prompt.value.trim();
  if (!prompt) {
    setMsg("提示词不能为空", "error");
    return;
  }
  loading = true;
  setMsg("");
  renderState();
  renderResults();
  try {
    const data = await apiPost("/api/playground/images", {
      mode: "generate",
      prompt,
      count: Number(els.count.value),
      background: els.background.value,
      system: els.system.value.trim(),
    });
    results = data.images || [];
    saveState();
    if (typeof data.credits === "number") {
      setCredits(data.credits);
    }
    setMsg(`已生成 ${results.length} 张图片`, "success");
  } catch (err) {
    setMsg(err.message, "error");
  } finally {
    loading = false;
    renderState();
    renderResults();
  }
}

async function main() {
  const ctx = await mountLayout({ active: "playground", title: "自由生图", crumb: "TOOLS" });
  if (!ctx) {
    return;
  }
  Object.assign(els, {
    form: document.getElementById("pgForm"),
    prompt: document.getElementById("prompt"),
    count: document.getElementById("count"),
    background: document.getElementById("background"),
    system: document.getElementById("system"),
    msg: document.getElementById("msg"),
    generateBtn: document.getElementById("generateBtn"),
    configHint: document.getElementById("configHint"),
    results: document.getElementById("results"),
  });
  els.form.addEventListener("submit", generate);
  [els.prompt, els.count, els.background, els.system].forEach((el) => {
    el.addEventListener("input", saveState);
    el.addEventListener("change", saveState);
  });
  applySavedState();

  try {
    const cfg = await apiGet("/api/image-config");
    hasImageConfig = Boolean(cfg.config?.uploaded);
  } catch {
    hasImageConfig = false;
  }
  renderState();
  renderResults();
}

main();
