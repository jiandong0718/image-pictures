// 自由生图页（赛博画布布局）：中间画布（提示词 + 结果网格），右侧控制面板
// （张数 / 分辨率 / 输出比例(+自定义) / 背景 / 附加要求 / 开始生成）。文生图，每张 1 积分。

import { mountLayout, setCredits } from "/shared/layout.js";
import { apiGet, apiPost, downloadFile } from "/shared/api.js";
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
let nodes = []; // 可选生图节点（脱敏：id + 展示名）
let endpointId = ""; // 选中的节点 id；空=自动（按调度）
let pendingCount = 0; // 本批要生成的总张数（生成中摆几个占位骨架）
let lightboxIndex = -1; // 灯箱当前看的第几张；-1=未打开
let pendingTask = null; // 进行中的任务 id：切走页面也持久化，回来续查把图捞回

async function downloadImage(image) {
  if (!image?.downloadUrl) return;
  setMsg("");
  try {
    await downloadFile(image.downloadUrl, image.filename || "image.png");
  } catch (err) {
    setMsg(`下载失败：${err.message}`, "error");
  }
}

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
  if (typeof saved.pendingCount === "number") pendingCount = saved.pendingCount;
  if (typeof saved.endpointId === "string") endpointId = saved.endpointId;
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
    pendingCount,
    endpointId,
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

// 生图节点选择（下拉，放背景下面）：仅本页有。≥2 个节点才显示（1 个时没得选）。空=随机(按调度)。
function renderNodes() {
  if (!nodes.length || nodes.length < 2) {
    els.nodeField.hidden = true;
    return;
  }
  els.nodeField.hidden = false;
  const opts = [`<option value="">随机</option>`].concat(
    nodes.map((n) => `<option value="${String(n.id)}">${escapeHtml(n.name)}</option>`),
  );
  els.nodeSelect.innerHTML = opts.join("");
  els.nodeSelect.value = endpointId;
}

function escapeHtml(text) {
  return String(text == null ? "" : text).replace(/[&<>"]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
  ));
}

function renderState() {
  const hasPrompt = els.prompt.value.trim().length > 0;
  els.generateBtn.disabled = !hasImageConfig || loading || !hasPrompt;
  els.generateBtn.innerHTML = loading ? `<span class="spinner"></span>生成中…` : "开始生成";
  els.configHint.textContent = hasImageConfig ? "" : "尚未配置生图 API Key，请先到「配置中心」保存。";
  els.configHint.style.color = hasImageConfig ? "var(--ink-mute)" : "var(--warn)";
  els.canvasBadge.textContent = loading
    ? `已完成 ${results.length}/${pendingCount || count}`
    : `${results.length} 张结果`;
}

const enc = (v) => encodeURIComponent(v == null ? "" : v);

// 纵向画廊：N 张从上到下依次排列；生成中未完成的位置摆骨架+进度条（谁先好谁先点亮）。
function renderStage() {
  if (!loading && !results.length) {
    const ideas = ["极简产品摄影，纯色背景，柔和影棚光", "高级质感材质特写，微距，细节锐利", "自然光生活场景，氛围感，浅景深", "俯拍平铺构图，大量留白，杂志风"];
    els.stage.innerHTML = `
      <div class="stage-empty">
        <div class="stage-empty-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.4L18 9l-4.2 1.6L12 15l-1.8-4.4L6 9l4.2-1.6z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/></svg></div>
        <div class="stage-empty-title">描述你想要的画面，开始生成</div>
        <div class="stage-empty-sub">在上方输入提示词，或点选一个灵感快速开始</div>
        <div class="stage-empty-ideas">${ideas.map((s) => `<button class="stage-idea" type="button" data-idea="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("")}</div>
      </div>`;
    els.stage.querySelectorAll("[data-idea]").forEach((b) => {
      b.addEventListener("click", () => {
        els.prompt.value = b.dataset.idea;
        els.prompt.dispatchEvent(new Event("input", { bubbles: true }));
        els.prompt.focus();
        renderState();
      });
    });
    return;
  }
  const total = loading ? Math.max(pendingCount || count, results.length) : results.length;
  els.stage.innerHTML = `<div class="pg-gallery" id="gallery"></div>`;
  const gallery = document.getElementById("gallery");
  for (let i = 0; i < total; i += 1) {
    const image = results[i];
    const item = document.createElement("div");
    item.className = "pg-shot";
    if (image) {
      item.innerHTML = `
        <div class="pg-shot-media">
          <img src="${image.url}?t=${enc(image.createdAt || "")}" alt="结果 ${i + 1}" loading="lazy" />
        </div>
        <div class="pg-shot-bar">
          <span class="badge ok">结果 ${i + 1}</span>
          <button class="btn sm" type="button">下载</button>
        </div>`;
      const idx = i;
      item.querySelector("img").addEventListener("click", () => openLightbox(idx));
      item.querySelector("button").addEventListener("click", () => downloadImage(image));
    } else {
      item.innerHTML = `
        <div class="pg-shot-media pg-shot-skeleton">
          <span class="spinner"></span>
          <div class="progress"></div>
          <span class="pg-shot-hint">生成中…</span>
        </div>`;
    }
    gallery.appendChild(item);
  }
}

// ---------- 灯箱（点击放大，↑↓/滑动切换）----------
function openLightbox(i) {
  if (i < 0 || i >= results.length) return;
  lightboxIndex = i;
  renderLightbox();
}

function closeLightbox() {
  lightboxIndex = -1;
  document.getElementById("pgLightbox")?.remove();
  document.removeEventListener("keydown", onLightboxKey);
}

function lightboxNav(delta) {
  const next = lightboxIndex + delta;
  if (next < 0 || next >= results.length) return;
  lightboxIndex = next;
  renderLightbox();
}

function onLightboxKey(e) {
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); lightboxNav(-1); }
  else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); lightboxNav(1); }
}

function renderLightbox() {
  const image = results[lightboxIndex];
  if (!image) return closeLightbox();
  let el = document.getElementById("pgLightbox");
  if (!el) {
    el = document.createElement("div");
    el.id = "pgLightbox";
    el.className = "pg-lightbox";
    document.body.appendChild(el);
    document.addEventListener("keydown", onLightboxKey);
  }
  const n = results.length;
  el.innerHTML = `
    <div class="pg-lb-backdrop"></div>
    <button class="pg-lb-close" type="button" aria-label="关闭">✕</button>
    <button class="pg-lb-nav up" type="button" aria-label="上一张"${lightboxIndex === 0 ? " disabled" : ""}>↑</button>
    <div class="pg-lb-stage"><img class="pg-lb-img" src="${image.url}?t=${enc(image.createdAt || "")}" alt="结果 ${lightboxIndex + 1}" /></div>
    <button class="pg-lb-nav down" type="button" aria-label="下一张"${lightboxIndex === n - 1 ? " disabled" : ""}>↓</button>
    <div class="pg-lb-bar">
      <span class="pg-lb-count mono">${lightboxIndex + 1} / ${n}</span>
      <button class="btn sm" type="button" id="pgLbDownload">下载</button>
    </div>`;
  el.querySelector(".pg-lb-backdrop").addEventListener("click", closeLightbox);
  el.querySelector(".pg-lb-close").addEventListener("click", closeLightbox);
  el.querySelector(".pg-lb-nav.up").addEventListener("click", () => lightboxNav(-1));
  el.querySelector(".pg-lb-nav.down").addEventListener("click", () => lightboxNav(1));
  el.querySelector("#pgLbDownload").addEventListener("click", () => downloadImage(image));
  // 竖向滑动切换
  let startY = null;
  el.querySelector(".pg-lb-stage").addEventListener("touchstart", (ev) => { startY = ev.touches[0].clientY; }, { passive: true });
  el.querySelector(".pg-lb-stage").addEventListener("touchend", (ev) => {
    if (startY == null) return;
    const dy = ev.changedTouches[0].clientY - startY;
    if (Math.abs(dy) > 40) lightboxNav(dy < 0 ? 1 : -1);
    startY = null;
  });
}

// 渐进轮询：先摆 N 个骨架，partial 里每到一张就点亮一张；done 时以最终结果为准。
async function awaitTask(taskId) {
  const deadline = Date.now() + 5 * 60 * 1000;
  try {
    while (true) {
      const data = await apiGet(`/api/tasks/${enc(taskId)}`);
      if (data.partial) {
        if (typeof data.partial.total === "number" && data.partial.total > 0) pendingCount = data.partial.total;
        const imgs = Array.isArray(data.partial.images) ? data.partial.images : [];
        if (imgs.length > results.length) {
          results = imgs;
          renderState();
          renderStage();
          if (lightboxIndex >= 0) renderLightbox(); // 灯箱开着时同步计数
        }
      }
      if (data.status === "done") {
        results = data.result?.images || results;
        if (typeof data.result?.credits === "number") setCredits(data.result.credits);
        setMsg(`已生成 ${results.length} 张图片`, "success");
        break;
      }
      if (data.status === "error") throw new Error(data.error || "生成失败");
      if (Date.now() > deadline) throw new Error("生成超时，请稍后重试");
      await new Promise((r) => setTimeout(r, 1500));
    }
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
  results = [];          // 清空上一批，立刻摆 N 个占位骨架
  pendingCount = count;
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
      endpointId,
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
    nodeField: document.getElementById("nodeField"),
    nodeSelect: document.getElementById("nodeSelect"),
  });

  loadSaved();
  renderCounts();
  renderRes();
  renderRatios();

  els.prompt.addEventListener("input", () => { save(); renderState(); });
  els.system.addEventListener("input", save);
  els.background.addEventListener("change", save);
  els.nodeSelect.addEventListener("change", () => { endpointId = els.nodeSelect.value; save(); });
  [els.customW, els.customH].forEach((el) => el.addEventListener("input", save));
  els.generateBtn.addEventListener("click", generate);

  try {
    const cfg = await apiGet("/api/image-config");
    hasImageConfig = Boolean(cfg.config?.uploaded);
    nodes = Array.isArray(cfg.nodes) ? cfg.nodes : [];
    // 选中的节点若已被删/停用，回退到自动。
    if (endpointId && !nodes.some((n) => String(n.id) === endpointId)) {
      endpointId = "";
      save();
    }
  } catch {
    hasImageConfig = false;
  }
  renderNodes();
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
