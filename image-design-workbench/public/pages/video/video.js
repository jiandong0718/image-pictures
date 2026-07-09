// AI 生视频（赛博画布布局）：中间画布（模式切换 + 提示词 + 结果），右侧控制面板（比例/清晰度/时长/高级）。
// 文生视频 + 图生视频，接 Agnes 异步接口：提交拿 taskId，前端轮询 /api/tasks/:id 取 mp4。每条固定扣积分。

import { mountLayout, setCredits } from "/shared/layout.js";
import { apiGet, apiPost, apiUpload, pollTask } from "/shared/api.js";
import { createLocalState } from "/shared/persistence.js";

const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const QUALITIES = ["480p", "720p", "1080p"];
const DURATIONS = ["3s", "5s", "10s", "15s"];

const storage = createLocalState("imageStudio:video:v1");
const els = {};
let mode = "text"; // text | image
let ratio = "16:9";
let quality = "720p";
let duration = "5s";
let sourceImage = null; // { id, url } 图生视频源图
let result = null; // 当前结果视频
let loading = false;
let uploading = false;
let hasVideoConfig = false;
let costPerSecond = 1; // 每秒扣多少积分，来自 /api/video-config
let pendingTask = null;

// 本次消耗 = 选中时长秒数 × 单价（如 10s × 1 = 10 积分）。
function currentCost() {
  return (parseInt(duration, 10) || 5) * costPerSecond;
}

function setMsg(text, kind = "") {
  els.msg.textContent = text || "";
  els.msg.className = `msg ${kind}`;
}

function loadSaved() {
  const saved = storage.load(null);
  if (!saved || typeof saved !== "object") return;
  if (saved.mode === "image" || saved.mode === "text") mode = saved.mode;
  if (RATIOS.includes(saved.ratio)) ratio = saved.ratio;
  if (QUALITIES.includes(saved.quality)) quality = saved.quality;
  if (DURATIONS.includes(saved.duration)) duration = saved.duration;
  if (typeof saved.prompt === "string") els.prompt.value = saved.prompt;
  if (typeof saved.negative === "string") els.negative.value = saved.negative;
  if (saved.sourceImage && saved.sourceImage.id) sourceImage = saved.sourceImage;
  if (saved.result && saved.result.url) result = saved.result;
  if (typeof saved.pendingTask === "string") pendingTask = saved.pendingTask;
}

function save() {
  storage.save({
    mode,
    ratio,
    quality,
    duration,
    prompt: els.prompt.value,
    negative: els.negative.value,
    sourceImage,
    result,
    pendingTask,
  });
}

function chipRow(container, items, current, onPick, labelFn = (x) => x) {
  container.innerHTML = "";
  items.forEach((v) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `vid-chip${v === current ? " active" : ""}`;
    btn.textContent = labelFn(v);
    btn.addEventListener("click", () => onPick(v));
    container.appendChild(btn);
  });
}

function renderChips() {
  chipRow(els.ratios, RATIOS, ratio, (v) => { ratio = v; renderChips(); save(); });
  chipRow(els.qualities, QUALITIES, quality, (v) => { quality = v; renderChips(); save(); }, (v) => v.toUpperCase());
  chipRow(els.durations, DURATIONS, duration, (v) => { duration = v; renderChips(); save(); renderState(); });
}

function renderMode() {
  els.modes.querySelectorAll(".vid-mode").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  els.modeTitle.textContent = mode === "image" ? "图生视频" : "文生视频";
  els.sourceBlock.hidden = mode !== "image";
  renderSource();
}

function renderSource() {
  if (mode !== "image") return;
  if (sourceImage && sourceImage.url) {
    els.sourceInner.innerHTML = `<img class="vid-drop-preview" src="${sourceImage.url}" alt="源图" /><span class="vid-drop-hint">点击更换源图</span>`;
  } else if (uploading) {
    els.sourceInner.innerHTML = `<span class="spinner"></span><span class="vid-drop-hint">上传中…</span>`;
  } else {
    els.sourceInner.innerHTML = `<span class="vid-drop-plus">＋</span><span class="vid-drop-hint">点击上传首帧参考图（PNG / JPG / WEBP）</span>`;
  }
}

function renderState() {
  const hasPrompt = els.prompt.value.trim().length > 0;
  const needSource = mode === "image" && !sourceImage;
  els.generateBtn.disabled = !hasVideoConfig || loading || uploading || !hasPrompt || needSource;
  els.generateBtn.innerHTML = loading
    ? `<span class="spinner"></span>生成中…`
    : `生成视频（${currentCost()} 积分）`;
  if (!hasVideoConfig) {
    els.configHint.textContent = "尚未配置生视频 API Key，请先到「配置中心」保存。";
    els.configHint.style.color = "var(--warn)";
  } else if (needSource) {
    els.configHint.textContent = "图生视频请先上传一张源图。";
    els.configHint.style.color = "var(--ink-mute)";
  } else {
    els.configHint.textContent = "视频异步生成，通常需数十秒到几分钟，请勿关闭页面。";
    els.configHint.style.color = "var(--ink-mute)";
  }
  els.canvasBadge.textContent = loading ? "生成中" : result ? "已完成" : "就绪";
}

function renderStage() {
  if (loading) {
    els.stage.innerHTML = `<div class="vid-loading">正在生成视频…<div class="progress"></div><span class="vid-loading-sub">异步渲染中，通常数十秒到几分钟</span></div>`;
    return;
  }
  if (!result || !result.url) {
    els.stage.innerHTML = `<div class="empty">输入提示词，点击右侧「生成视频」</div>`;
    return;
  }
  const meta = [result.size, result.seconds ? `${result.seconds}s` : ""].filter(Boolean).join(" · ");
  els.stage.innerHTML = `
    <div class="vid-result">
      <video src="${result.url}" controls playsinline preload="metadata"></video>
      <div class="vid-result-bar">
        <span class="badge ok">${meta || "视频"}</span>
        <a class="btn sm" href="${result.downloadUrl}">下载 MP4</a>
      </div>
    </div>`;
}

function renderRecent(items) {
  if (!items || !items.length) {
    els.recentBlock.hidden = true;
    return;
  }
  els.recentBlock.hidden = false;
  els.recentGrid.innerHTML = "";
  items.forEach((v) => {
    const item = document.createElement("div");
    item.className = "vid-recent-item";
    const tag = v.mode === "image" ? "图生" : "文生";
    item.innerHTML = `
      <video src="${v.url}" preload="metadata" muted></video>
      <div class="vid-recent-tag">${tag}</div>`;
    item.addEventListener("click", () => {
      result = { url: v.url, downloadUrl: v.downloadUrl, size: v.size, seconds: v.seconds };
      save();
      renderStage();
      renderState();
    });
    els.recentGrid.appendChild(item);
  });
}

async function loadRecent() {
  try {
    const data = await apiGet("/api/videos?pageSize=8");
    renderRecent(data.items || []);
  } catch {
    /* 忽略 */
  }
}

async function uploadSource(file) {
  if (!file) return;
  uploading = true;
  setMsg("");
  renderSource();
  renderState();
  try {
    const form = new FormData();
    form.append("image", file);
    const data = await apiUpload("/api/videos/source", form);
    sourceImage = data.image;
  } catch (err) {
    setMsg(err.message, "error");
  } finally {
    uploading = false;
    save();
    renderSource();
    renderState();
  }
}

async function awaitTask(taskId) {
  try {
    const done = await pollTask(taskId, { timeoutMs: 12 * 60 * 1000, interval: 4000 });
    result = done.video || null;
    if (typeof done.credits === "number") setCredits(done.credits);
    setMsg("视频生成完成", "success");
    loadRecent();
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
  if (mode === "image" && !sourceImage) return setMsg("请先上传源图", "error");
  loading = true;
  result = null;
  setMsg("");
  renderState();
  renderStage();
  let taskId;
  try {
    ({ taskId } = await apiPost("/api/videos", {
      mode,
      prompt,
      ratio,
      quality,
      duration,
      negativePrompt: els.negative.value.trim(),
      seed: els.seed.value.trim(),
      steps: els.steps.value.trim(),
      sourceImageId: mode === "image" ? sourceImage.id : "",
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
  const ctx = await mountLayout({ active: "video", title: "AI 生视频", crumb: "TOOLS" });
  if (!ctx) return;
  Object.assign(els, {
    modes: document.getElementById("modes"),
    modeTitle: document.getElementById("modeTitle"),
    canvasBadge: document.getElementById("canvasBadge"),
    sourceBlock: document.getElementById("sourceBlock"),
    sourceDrop: document.getElementById("sourceDrop"),
    sourceInput: document.getElementById("sourceInput"),
    sourceInner: document.getElementById("sourceInner"),
    prompt: document.getElementById("prompt"),
    negative: document.getElementById("negative"),
    seed: document.getElementById("seed"),
    steps: document.getElementById("steps"),
    ratios: document.getElementById("ratios"),
    qualities: document.getElementById("qualities"),
    durations: document.getElementById("durations"),
    stage: document.getElementById("stage"),
    recentBlock: document.getElementById("recentBlock"),
    recentGrid: document.getElementById("recentGrid"),
    msg: document.getElementById("msg"),
    generateBtn: document.getElementById("generateBtn"),
    configHint: document.getElementById("configHint"),
  });

  loadSaved();
  renderMode();
  renderChips();

  els.modes.querySelectorAll(".vid-mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      renderMode();
      save();
      renderState();
    });
  });
  els.sourceInput.addEventListener("change", (e) => uploadSource(e.target.files[0]));
  els.prompt.addEventListener("input", () => { save(); renderState(); });
  els.negative.addEventListener("input", save);
  [els.seed, els.steps].forEach((el) => el.addEventListener("input", save));
  els.generateBtn.addEventListener("click", generate);

  try {
    const cfg = await apiGet("/api/video-config");
    hasVideoConfig = Boolean(cfg.config?.uploaded);
    if (typeof cfg.costPerSecond === "number") costPerSecond = cfg.costPerSecond;
  } catch {
    hasVideoConfig = false;
  }
  renderState();
  renderStage();
  loadRecent();

  // 离开前若有任务未轮询完，回来续上（避免扣了费视频却丢了）。
  if (pendingTask) {
    loading = true;
    renderState();
    renderStage();
    awaitTask(pendingTask);
  }
}

main();
