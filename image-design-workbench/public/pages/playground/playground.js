// 自由生图页（赛博画布布局）：中间画布（提示词 + 结果网格），右侧控制面板
// （张数 / 分辨率 / 输出比例(+自定义) / 背景 / 附加要求 / 开始生成）。文生图，每张 1 积分。

import { mountLayout, setCredits } from "/shared/layout.js";
import { apiGet, apiPost, pollTask } from "/shared/api.js";
import { createLocalState } from "/shared/persistence.js";

const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const RATIO_PRESETS = { "1:1": [1, 1], "3:4": [3, 4], "4:3": [4, 3], "16:9": [16, 9], "9:16": [9, 16] };
const RES = { "1k": 1024, "2k": 2048, "4k": 4096 };
const COUNTS = [1, 2, 3, 4];
const MIN_PX = 256;
const MAX_PX = 4096;

function clampPx(v) {
  const n = Math.round(Number(v) || 0);
  return Math.min(MAX_PX, Math.max(MIN_PX, n || 1024));
}
function gcd(a, b) {
  return b ? gcd(b, a % b) : a || 1;
}

const storage = createLocalState("imageStudio:playground:v2");
const els = {};
let count = 1;
let currentRes = "1k";
let currentRatio = "1:1";
let background = "";
let results = [];
let loading = false;
let hasImageConfig = false;
let pendingTask = null; // 进行中的任务 id：切走页面也持久化，回来续查把图捞回

function buildImageSpec() {
  if (currentRatio === "custom") {
    const w = clampPx(els.customW.value);
    const h = clampPx(els.customH.value);
    const size = Math.max(w, h);
    const g = gcd(w, h);
    let rw = Math.round(w / g);
    let rh = Math.round(h / g);
    const m = Math.max(rw, rh);
    if (m > 99) {
      const s = m / 99;
      rw = Math.max(1, Math.round(rw / s));
      rh = Math.max(1, Math.round(rh / s));
    }
    let width = size, height = size;
    if (rw > rh) height = Math.round((size * rh) / rw);
    else if (rh > rw) width = Math.round((size * rw) / rh);
    return {
      sizeMode: "custom", sizePreset: "1k", customSize: size,
      ratioPreset: "custom", customRatioWidth: rw, customRatioHeight: rh,
      width, height, ratio: `${rw}:${rh}`, requestSize: `${width}x${height}`,
    };
  }
  const size = RES[currentRes] || 1024;
  const [rw, rh] = RATIO_PRESETS[currentRatio] || [1, 1];
  let width = size, height = size;
  if (rw > rh) height = Math.round((size * rh) / rw);
  else if (rh > rw) width = Math.round((size * rw) / rh);
  return {
    sizeMode: "preset", sizePreset: currentRes, customSize: size,
    ratioPreset: currentRatio, customRatioWidth: rw, customRatioHeight: rh,
    width, height, ratio: `${rw}:${rh}`, requestSize: `${width}x${height}`,
  };
}

function loadSaved() {
  const saved = storage.load(null);
  if (!saved || typeof saved !== "object") return;
  if (typeof saved.prompt === "string") els.prompt.value = saved.prompt;
  if (typeof saved.system === "string") els.system.value = saved.system;
  if (COUNTS.includes(Number(saved.count))) count = Number(saved.count);
  if (RES[saved.res]) currentRes = saved.res;
  if (RATIO_PRESETS[saved.ratio] || saved.ratio === "custom") currentRatio = saved.ratio;
  if (typeof saved.background === "string") background = saved.background;
  if (saved.customW) els.customW.value = clampPx(saved.customW);
  if (saved.customH) els.customH.value = clampPx(saved.customH);
  if (Array.isArray(saved.results)) results = saved.results;
  if (typeof saved.pendingTask === "string") pendingTask = saved.pendingTask;
  els.background.value = background;
}

function save() {
  storage.save({
    prompt: els.prompt.value,
    system: els.system.value,
    count,
    res: currentRes,
    ratio: currentRatio,
    background: els.background.value,
    customW: els.customW.value,
    customH: els.customH.value,
    results,
    pendingTask,
  });
}

function setMsg(text, kind = "") {
  els.msg.textContent = text || "";
  els.msg.className = `msg ${kind}`;
}

function chipRow(container, items, current, onPick, labelFn = (x) => x) {
  container.innerHTML = "";
  items.forEach((v) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `pg-chip${v === current ? " active" : ""}`;
    btn.textContent = labelFn(v);
    btn.addEventListener("click", () => onPick(v));
    container.appendChild(btn);
  });
}

function renderCounts() {
  chipRow(els.counts, COUNTS, count, (v) => { count = v; renderCounts(); save(); renderState(); }, (v) => `${v} 张`);
}
function renderRes() {
  chipRow(els.resChips, Object.keys(RES), currentRes, (v) => { currentRes = v; renderRes(); save(); }, (v) => v.toUpperCase());
}
function renderRatios() {
  chipRow(els.ratios, [...RATIOS, "custom"], currentRatio, (v) => {
    currentRatio = v;
    renderRatios();
    save();
  }, (v) => (v === "custom" ? "自定义" : v));
  els.customSize.hidden = currentRatio !== "custom";
}

function renderState() {
  const hasPrompt = els.prompt.value.trim().length > 0;
  els.generateBtn.disabled = !hasImageConfig || loading || !hasPrompt;
  els.generateBtn.innerHTML = loading ? `<span class="spinner"></span>生成中…` : "开始生成";
  els.configHint.textContent = hasImageConfig ? "" : "尚未配置生图 API Key，请先到「配置中心」保存。";
  els.configHint.style.color = hasImageConfig ? "var(--ink-mute)" : "var(--warn)";
  els.canvasBadge.textContent = `${results.length} 张结果`;
}

function renderStage() {
  if (loading) {
    els.stage.innerHTML = `<div class="pg-loading">正在生成…<div class="progress"></div></div>`;
    return;
  }
  if (!results.length) {
    els.stage.innerHTML = `<div class="empty">输入提示词，点击右侧「开始生成」</div>`;
    return;
  }
  els.stage.innerHTML = `<div class="pg-results" id="results"></div>`;
  const grid = document.getElementById("results");
  results.forEach((image, i) => {
    const item = document.createElement("div");
    item.className = "pg-item";
    item.innerHTML = `
      <img src="${image.url}?t=${encodeURIComponent(image.createdAt || "")}" alt="结果 ${i + 1}" loading="lazy" />
      <div class="pg-item-bar">
        <span class="badge ok">结果 ${i + 1}</span>
        <button class="btn sm" type="button">下载</button>
      </div>`;
    item.querySelector("img").addEventListener("click", () => window.open(image.url, "_blank", "noopener"));
    item.querySelector("button").addEventListener("click", () => { location.href = image.downloadUrl; });
    grid.appendChild(item);
  });
}

// 轮询任务并落地结果。切走页面时轮询会中断，但 pendingTask 已持久化，回来会 resume。
async function awaitTask(taskId) {
  try {
    const done = await pollTask(taskId);
    results = done.images || [];
    if (typeof done.credits === "number") setCredits(done.credits);
    setMsg(`已生成 ${results.length} 张图片`, "success");
  } catch (err) {
    setMsg(err.message, "error");
  } finally {
    pendingTask = null;
    loading = false;
    save();
    renderState();
    renderStage();
  }
}

async function generate() {
  const prompt = els.prompt.value.trim();
  if (!prompt) return setMsg("提示词不能为空", "error");
  loading = true;
  setMsg("");
  renderState();
  renderStage();
  let taskId;
  try {
    ({ taskId } = await apiPost("/api/playground/images", {
      mode: "generate",
      prompt,
      count,
      background: els.background.value,
      system: els.system.value.trim(),
      imageSpec: buildImageSpec(),
    }));
  } catch (err) {
    loading = false;
    setMsg(err.message, "error");
    renderState();
    renderStage();
    return;
  }
  pendingTask = taskId;
  save();
  await awaitTask(taskId);
}

async function main() {
  const ctx = await mountLayout({ active: "playground", title: "自由生图", crumb: "TOOLS" });
  if (!ctx) return;
  Object.assign(els, {
    prompt: document.getElementById("prompt"),
    system: document.getElementById("system"),
    counts: document.getElementById("counts"),
    resChips: document.getElementById("resChips"),
    ratios: document.getElementById("ratios"),
    customSize: document.getElementById("customSize"),
    customW: document.getElementById("customW"),
    customH: document.getElementById("customH"),
    background: document.getElementById("background"),
    stage: document.getElementById("stage"),
    msg: document.getElementById("msg"),
    generateBtn: document.getElementById("generateBtn"),
    configHint: document.getElementById("configHint"),
    canvasBadge: document.getElementById("canvasBadge"),
  });

  loadSaved();
  renderCounts();
  renderRes();
  renderRatios();

  els.prompt.addEventListener("input", () => { save(); renderState(); });
  els.system.addEventListener("input", save);
  els.background.addEventListener("change", save);
  [els.customW, els.customH].forEach((el) => el.addEventListener("input", save));
  els.generateBtn.addEventListener("click", generate);

  try {
    const cfg = await apiGet("/api/image-config");
    hasImageConfig = Boolean(cfg.config?.uploaded);
  } catch {
    hasImageConfig = false;
  }
  renderState();
  renderStage();

  // 若离开前还有生成任务没轮询完，回来续上把图捞回（避免扣了费图却丢了）。
  if (pendingTask) {
    loading = true;
    renderState();
    renderStage();
    awaitTask(pendingTask);
  }
}

main();
