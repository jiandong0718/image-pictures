import { previewUrl } from "/shared/media.js";
// AI 生视频（赛博画布布局）：中间画布（模式切换 + 提示词 + 结果），右侧控制面板（比例/清晰度/时长/高级）。
// 文生视频 + 图生视频，接 Agnes 异步接口：提交拿 taskId，前端轮询 /api/tasks/:id 取 mp4。每条固定扣积分。

import { mountLayout, setCredits } from "/shared/layout.js";
import { apiGet, apiPost, apiUpload, downloadFile } from "/shared/api.js";
import { createLocalState } from "/shared/persistence.js";
import { enableImagePaste } from "/shared/image-paste.js";
import { takeReuse } from "/shared/reuse.js";
import { VIDEO_INSPIRATIONS } from "./video-inspiration.js";

const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const $ = id => document.getElementById(id);
const QUALITIES = ["480p", "720p", "1080p"];
const DURATIONS = ["3s", "5s", "10s", "15s"];
const MAX_SOURCE_IMAGES = 5; // 1 张=图生视频；2–5 张=关键帧动画

const storage = createLocalState("imageStudio:video:v1");
const els = {};
let mode = "text"; // text | image
let ratio = "16:9";
let quality = "720p";
let duration = "5s";
let sourceImages = []; // [{ id, url }] 图生视频源图（1 张普通图生，2–5 张关键帧）
let result = null; // 当前结果视频
let loading = false;
let uploading = false;
let hasVideoConfig = false;
let costPerSecond = 1; // 每秒扣多少积分，来自 /api/video-config
let pendingTask = null;
let canUnlinkTask = false;
let videoEndpointId = "";
let videoNodes = [];
let defaultVideoId = "";
let defaultCostPerSecond = 1;
let selectedVideo = null;
let videoCaps = { modes: ["text", "image"], qualities: QUALITIES, durations: [3, 5, 10, 15], maxImages: 5, ratios: RATIOS, negativePrompt: true, seed: true, steps: true, protocol: "agnes" };

// 本次消耗 = 选中时长秒数 × 单价（如 10s × 1 = 10 积分）。
function currentCost() {
  return videoCaps.billingUnit === "task" ? costPerSecond : (parseInt(duration, 10) || 5) * costPerSecond;
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
  if (typeof saved.quality === "string") quality = saved.quality;
  if (/^\d+s$/.test(saved.duration || "")) duration = saved.duration;
  if (typeof saved.prompt === "string") els.prompt.value = saved.prompt;
  if (typeof saved.negative === "string") els.negative.value = saved.negative;
  if (Array.isArray(saved.sourceImages)) {
    sourceImages = saved.sourceImages.filter((s) => s && s.id).slice(0, MAX_SOURCE_IMAGES);
  } else if (saved.sourceImage && saved.sourceImage.id) {
    sourceImages = [saved.sourceImage]; // 兼容旧存档的单图字段
  }
  if (saved.result && saved.result.url) result = saved.result;
  if (typeof saved.pendingTask === "string") pendingTask = saved.pendingTask;
  if (typeof saved.videoEndpointId === "string") videoEndpointId = saved.videoEndpointId;
}

function save() {
  storage.save({
    mode,
    ratio,
    quality,
    duration,
    prompt: els.prompt.value,
    negative: els.negative.value,
    sourceImages,
    result,
    pendingTask,
    videoEndpointId,
  });
}

function chipRow(container, items, current, onPick, labelFn = (x) => x, isDisabled = () => false) {
  container.innerHTML = "";
  items.forEach((v) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `vid-chip${v === current ? " active" : ""}`;
    btn.textContent = labelFn(v);
    btn.disabled = isDisabled(v);
    if (btn.disabled) btn.title = "1080P 最长支持 10 秒";
    btn.addEventListener("click", () => onPick(v));
    container.appendChild(btn);
  });
}

function selectVideoService() {
  selectedVideo = videoNodes.find(node => String(node.id) === (videoEndpointId || defaultVideoId)) || null;
  if (!selectedVideo) { hasVideoConfig = false; renderState(); return; }
  videoCaps = selectedVideo.capabilities;
  costPerSecond = selectedVideo.creditsPerSecond ?? defaultCostPerSecond;
  if (!videoCaps.modes.includes(mode)) mode = videoCaps.modes[0];
  if (!videoCaps.qualities.includes(quality)) quality = videoCaps.qualities.includes("720p") ? "720p" : videoCaps.qualities.includes("768p") ? "768p" : videoCaps.qualities[0];
  if (!videoCaps.ratios.includes(ratio)) ratio = videoCaps.ratios[0];
  if (!videoCaps.durations.includes(Number.parseInt(duration, 10))) duration = videoCaps.durations.includes(5) ? "5s" : `${videoCaps.durations[0]}s`;
  if (videoCaps.protocol === "agnes" && quality === "1080p" && duration === "15s") duration = "10s";
  $("negativeField").hidden = !videoCaps.negativePrompt;
  $("seedField").hidden = !videoCaps.seed;
  $("stepsField").hidden = !videoCaps.steps;
  $("videoAdvanced").hidden = !videoCaps.negativePrompt && !videoCaps.seed && !videoCaps.steps;
  $("videoQualityField").hidden = Boolean(videoCaps.providerParameters);
  $("videoDurationField").hidden = Boolean(videoCaps.providerParameters);
  $("videoCapabilityHint").textContent = videoCaps.providerParameters ? "时长与清晰度由 Grsai 模型决定；站内按次计费。" : videoCaps.imageRatio && mode === "image" ? "图生视频的画面比例由首帧图片决定；具体能力以模型服务为准。" : "时长与清晰度按所选模型显示，具体能力以模型服务为准。";
  renderMode(); renderChips(); renderState();
}

function renderChips() {
  chipRow(els.ratios, videoCaps.ratios || RATIOS, ratio, (v) => { ratio = v; renderChips(); save(); });
  chipRow(els.qualities, videoCaps.qualities, quality, (v) => {
    quality = v;
    if (videoCaps.protocol === "agnes" && quality === "1080p" && duration === "15s") duration = "10s";
    renderChips();
    save();
    renderState();
  }, (v) => v.toUpperCase());
  chipRow(
    els.durations,
    videoCaps.durations.map(value => `${value}s`),
    duration,
    (v) => { duration = v; renderChips(); save(); renderState(); },
    (v) => v,
    (v) => videoCaps.protocol === "agnes" && quality === "1080p" && v === "15s",
  );
}

function renderMode() {
  els.modes.querySelectorAll(".vid-mode").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.disabled = !videoCaps.modes.includes(b.dataset.mode);
  });
  els.modeTitle.textContent = mode === "image" ? "图生视频" : "文生视频";
  els.sourceBlock.hidden = mode !== "image";
  els.sourceGrid.hidden = Boolean(videoCaps.externalFrames);
  $("videoFrameUrls").hidden = !videoCaps.externalFrames;
  els.sourceCount.hidden = Boolean(videoCaps.externalFrames);
  els.sourceTip.textContent = videoCaps.externalFrames ? "Grsai 需要可公开访问的图片 HTTPS 地址，提交时会将地址发送给 Grsai；请勿填写私密地址。" : videoCaps.imageSizeMustMatch ? "使用 1 张首帧，图片尺寸需匹配所选比例：横屏 1280×720，竖屏 720×1280。" : ["minimax_h3", "wan3"].includes(videoCaps.protocol) ? "最多 2 张，按顺序作为首帧和尾帧。" : videoCaps.protocol === "wan26" ? "万相 2.6 使用 1 张首帧图片；视频比例跟随图片。" : "最多 5 张；1 张为普通图生，2–5 张按顺序作为关键帧。";
  els.inspirations.replaceChildren(...VIDEO_INSPIRATIONS.filter(item => item.mode === mode).map(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vid-inspiration-button";
    button.textContent = item.title + " · 追加";
    button.title = item.prompt;
    button.addEventListener("click", () => {
      els.prompt.value = [els.prompt.value.trim(), item.prompt].filter(Boolean).join("\n\n");
      els.prompt.dispatchEvent(new Event("input", { bubbles: true }));
      els.prompt.focus();
      setMsg("已追加提示词，可以继续编辑", "success");
    });
    return button;
  }));
  renderSource();
}

function renderSource() {
  if (mode !== "image") return;
  const parts = sourceImages.map((img, i) => `
    <div class="vid-thumb">
      <img src="${previewUrl(img.url)}" decoding="async" alt="源图 ${i + 1}" />
      <button type="button" class="vid-thumb-remove" data-idx="${i}" title="移除">✕</button>
      <span class="vid-thumb-idx">${i + 1}</span>
    </div>`);
  if (uploading) {
    parts.push(`<div class="vid-thumb uploading"><span class="spinner"></span></div>`);
  }
  if (sourceImages.length < videoCaps.maxImages && !uploading) {
    parts.push(`
      <button type="button" class="vid-thumb add" data-add="1">
        <span class="vid-drop-plus">＋</span>
        <span class="vid-drop-hint">选图（可多选）</span>
      </button>`);
  }
  els.sourceGrid.innerHTML = parts.join("");
  els.sourceCount.textContent = `${sourceImages.length}/${videoCaps.maxImages}`;
}

function renderState() {
  const hasPrompt = els.prompt.value.trim().length > 0;
  const needSource = mode === "image" && (videoCaps.externalFrames ? !$("videoFirstFrame").value.trim() : !sourceImages.length);
  const tooManySources = mode === "image" && !videoCaps.externalFrames && sourceImages.length > videoCaps.maxImages;
  els.generateBtn.disabled = !hasVideoConfig || loading || Boolean(pendingTask) || uploading || !hasPrompt || needSource || tooManySources;
  els.resumeTask.hidden = !pendingTask || loading;
  els.unlinkTask.hidden = !pendingTask || loading || !canUnlinkTask;
  els.generateBtn.innerHTML = loading
    ? `<span class="spinner"></span>生成中…`
    : `生成视频（${currentCost()} 积分）`;
  if (!hasVideoConfig) {
    els.configHint.textContent = "尚未配置生视频 API Key，请先到「配置中心」保存。";
    els.configHint.style.color = "var(--warn)";
  } else if (needSource || tooManySources) {
    els.configHint.textContent = tooManySources ? `当前模型最多支持 ${videoCaps.maxImages} 张参考图，请移除多余图片。` : videoCaps.externalFrames ? "图生视频请先填写可公开访问的首帧地址。" : `图生视频请先上传源图，当前模型最多支持 ${videoCaps.maxImages} 张。`;
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
    const ideas = ["缓慢推近的产品特写，柔光", "360° 环绕展示，纯色背景", "生活场景中自然使用，氛围感", "慢动作细节，光影流动"];
    els.stage.innerHTML = `
      <div class="stage-empty">
        <div class="stage-empty-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/><path d="M22 8.5 16 12l6 3.5z"/></svg></div>
        <div class="stage-empty-title">描述一段画面，生成视频</div>
        <div class="stage-empty-sub">在右侧输入提示词，或点选一个灵感快速开始</div>
        <div class="stage-empty-ideas">${ideas.map((s) => `<button class="stage-idea" type="button" data-idea="${s}">${s}</button>`).join("")}</div>
      </div>`;
    els.stage.querySelectorAll("[data-idea]").forEach((b) => {
      b.addEventListener("click", () => {
        els.prompt.value = [els.prompt.value.trim(), b.dataset.idea].filter(Boolean).join("\n\n");
        els.prompt.dispatchEvent(new Event("input", { bubbles: true }));
        els.prompt.focus();
        renderState();
      });
    });
    return;
  }
  const meta = [result.size, result.seconds ? `${result.seconds}s` : ""].filter(Boolean).join(" · ");
  els.stage.innerHTML = `
    <div class="vid-result">
      <video src="${result.url}" controls playsinline preload="metadata"></video>
      <div class="vid-result-bar">
        <span class="badge ok">${meta || "视频"}</span>
        <button class="btn sm" id="downloadVideo" type="button">下载 MP4</button>
      </div>
    </div>`;
  document.getElementById("downloadVideo")?.addEventListener("click", async () => {
    setMsg("");
    try {
      await downloadFile(result.downloadUrl, "video.mp4");
    } catch (err) {
      setMsg(`下载失败：${err.message}`, "error");
    }
  });
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

async function uploadSource(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;
  const room = videoCaps.maxImages - sourceImages.length;
  if (room <= 0) {
    setMsg(`当前模型最多 ${videoCaps.maxImages} 张`, "error");
    return;
  }
  const toUpload = files.slice(0, room);
  setMsg(files.length > room ? `当前模型最多 ${videoCaps.maxImages} 张，多余的已忽略` : "");
  uploading = true;
  renderSource();
  renderState();
  try {
    for (const file of toUpload) {
      const form = new FormData();
      form.append("image", file);
      const data = await apiUpload("/api/videos/source", form);
      sourceImages.push(data.image);
    }
  } catch (err) {
    setMsg(err.message, "error");
  } finally {
    uploading = false;
    save();
    renderSource();
    renderState();
  }
}

function removeSource(idx) {
  if (idx < 0 || idx >= sourceImages.length) return;
  sourceImages.splice(idx, 1);
  save();
  renderSource();
  renderState();
}

async function awaitTask(taskId) {
  loading = true;
  canUnlinkTask = false;
  renderState();
  try {
    const deadline = Date.now() + 31 * 60 * 1000;
    while (Date.now() < deadline) {
      const task = await apiGet(`/api/tasks/${encodeURIComponent(taskId)}`);
      if (task.status === "done") {
        result = task.result?.video || null;
        if (typeof task.result?.credits === "number") setCredits(task.result.credits);
        pendingTask = null;
        setMsg("视频生成完成", "success");
        loadRecent();
        return;
      }
      if (task.status === "error") { pendingTask = null; throw new Error(task.error || "视频生成失败"); }
      if (task.status === "interrupted") { canUnlinkTask = true; throw new Error(task.error || "任务结果待确认，请联系管理员检查上游，勿重复提交"); }
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    throw new Error("任务仍在处理中，请稍后查询上次任务，勿重复提交");
  } catch (err) {
    if ([403, 404].includes(err.status)) canUnlinkTask = true;
    setMsg(err.message, "error");
  } finally {
    loading = false;
    save();
    renderState();
    renderStage();
  }
}

async function generate() {
  const prompt = els.prompt.value.trim();
  if (!prompt) return setMsg("提示词不能为空", "error");
  if (mode === "image" && (videoCaps.externalFrames ? !$("videoFirstFrame").value.trim() : !sourceImages.length)) return setMsg("请先提供源图", "error");
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
      endpointId: videoEndpointId,
      expectedPricing: selectedVideo ? { endpointId: selectedVideo.id, creditsPerSecond: costPerSecond } : undefined,
      negativePrompt: videoCaps.negativePrompt ? els.negative.value.trim() : "",
      seed: videoCaps.seed ? els.seed.value.trim() : "",
      steps: videoCaps.steps ? els.steps.value.trim() : "",
      sourceImageIds: mode === "image" ? sourceImages.map((s) => s.id) : [],
      sourceImageUrls: mode === "image" && videoCaps.externalFrames ? [$("videoFirstFrame").value.trim(), $("videoLastFrame").value.trim()].filter(Boolean) : [],
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
    sourceInput: document.getElementById("sourceInput"),
    sourceGrid: document.getElementById("sourceGrid"),
    sourceCount: document.getElementById("sourceCount"),
    prompt: document.getElementById("prompt"),
    negative: document.getElementById("negative"),
    seed: document.getElementById("seed"),
    steps: document.getElementById("steps"),
    ratios: document.getElementById("ratios"),
    qualities: document.getElementById("qualities"),
    durations: document.getElementById("durations"),
    inspirations: document.getElementById("videoInspirations"),
    videoService: document.getElementById("videoService"),
    stage: document.getElementById("stage"),
    recentBlock: document.getElementById("recentBlock"),
    recentGrid: document.getElementById("recentGrid"),
    msg: document.getElementById("msg"),
    generateBtn: document.getElementById("generateBtn"),
    configHint: document.getElementById("configHint"),
    sourceTip: document.getElementById("sourceTip"),
    resumeTask: document.getElementById("resumeVideoTask"),
    unlinkTask: document.getElementById("unlinkVideoTask"),
  });

  loadSaved();
  const reuse = takeReuse("video");
  if (reuse?.prompt) {
    els.prompt.value = reuse.prompt;
    save();
  }
  renderMode();
  renderChips();

  els.modes.querySelectorAll(".vid-mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      $("videoCapabilityHint").textContent = videoCaps.providerParameters ? "时长与清晰度由 Grsai 模型决定；站内按次计费。" : videoCaps.imageRatio && mode === "image" ? "图生视频的画面比例由首帧图片决定；具体能力以模型服务为准。" : "时长与清晰度按所选模型显示，具体能力以模型服务为准。";
      renderMode();
      save();
      renderState();
    });
  });
  els.sourceInput.addEventListener("change", (e) => {
    uploadSource(e.target.files);
    e.target.value = ""; // 清空以便重选同一文件也能触发
  });
  // 粘贴图片：自动切到图生视频并加为源图（满 5 张则忽略，uploadSource 内已判）。
  enableImagePaste((f) => {
    if (!videoCaps.modes.includes("image")) return setMsg("当前模型不支持图生视频，请切换模型", "error");
    if (mode !== "image") {
      mode = "image";
      renderMode();
      save();
    }
    uploadSource([f]);
  });
  els.sourceGrid.addEventListener("click", (e) => {
    const rm = e.target.closest(".vid-thumb-remove");
    if (rm) {
      removeSource(Number(rm.dataset.idx));
      return;
    }
    if (e.target.closest(".vid-thumb.add")) {
      els.sourceInput.click();
    }
  });
  els.prompt.addEventListener("input", () => { save(); renderState(); });
  els.negative.addEventListener("input", save);
  [els.seed, els.steps].forEach((el) => el.addEventListener("input", save));
  els.generateBtn.addEventListener("click", generate);
  els.resumeTask.addEventListener("click", () => { if (pendingTask && !loading) awaitTask(pendingTask); });
  els.unlinkTask.addEventListener("click", () => { if (!canUnlinkTask || loading) return; pendingTask = null; canUnlinkTask = false; save(); renderState(); setMsg("已解除本地关联；上游任务和账单不会因此改变。", "success"); });
  els.videoService.addEventListener("change", () => { videoEndpointId = els.videoService.value; selectVideoService(); save(); });
  $("videoFirstFrame").addEventListener("input", renderState);

  try {
    const cfg = await apiGet("/api/video-config");
    hasVideoConfig = Boolean(cfg.config?.uploaded);
    const nodes = Array.isArray(cfg.nodes) ? cfg.nodes : [];
    videoNodes = nodes;
    defaultVideoId = cfg.defaultId || "";
    els.videoService.replaceChildren(new Option("默认服务", ""), ...nodes.map(node => new Option(`${node.name} · ${node.model}`, String(node.id))));
    if (!nodes.some(node => String(node.id) === videoEndpointId)) videoEndpointId = "";
    els.videoService.value = videoEndpointId;
    if (typeof cfg.costPerSecond === "number") defaultCostPerSecond = cfg.costPerSecond;
    selectVideoService();
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
