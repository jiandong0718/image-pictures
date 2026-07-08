// AI 修图页（画布布局）：中间画布（上传→照片→处理中→前后对比 + 底部信息 + 历史），
// 右侧控制面板（能力卡片 + 输出比例 + 折叠提示词 + 开始生成）。
// 链路复用现有接口：分配套图 → 上传照片 → /api/playground/images(mode:edit)。提示词/历史只存本地。

import { mountLayout, setCredits } from "/shared/layout.js";
import { apiGet, apiPost, apiUpload, pollTask } from "/shared/api.js";
import { createLocalState } from "/shared/persistence.js";

const ICONS = {
  removeBg:
    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
  removeText:
    '<polyline points="4 7 4 4 20 4 20 7"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="3" y1="3" x2="21" y2="21"/>',
  restore:
    '<path d="M12 3l1.8 4.5L18.5 9l-4.7 1.5L12 15l-1.8-4.5L5.5 9l4.7-1.5L12 3z"/><path d="M18 15l.7 1.8L20.5 17.5l-1.8.7L18 20l-.7-1.8L15.5 17.5l1.8-.7L18 15z"/>',
  replaceBg:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  cartoonify:
    '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  gif:
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l-3 3 3 3"/><path d="M14 9l3 3-3 3"/>',
};

const CAPS = [
  { key: "removeBg", label: "去背景", desc: "保留主体", prompt: "移除图片背景，只保留主体，输出干净的纯白色背景。主体边缘精细自然、无残留背景色块，完整保留主体本身的形态、光影和细节，不改变主体内容。" },
  { key: "removeText", label: "去文字", desc: "去水印文字", prompt: "去除图片中的所有文字、水印和 logo 标注，智能修补被文字遮挡的区域，使其与周围画面的纹理、颜色自然融合，图片其余部分保持原样不变。" },
  { key: "restore", label: "老照片修复", desc: "划痕修复", prompt: "修复这张老照片：去除划痕、折痕、霉斑、污渍和噪点，修补破损与缺失区域，提升清晰度与细节，还原自然真实的色彩和肤色，保持人物五官、表情和原始构图完全不变。" },
  { key: "replaceBg", label: "背景替换", desc: "换任意背景", prompt: "保持画面主体（人物或物体）完全不变，将背景替换为简洁高级的浅灰色影棚渐变背景，主体与新背景的光影、投影自然融合，边缘过渡真实。（可修改这段描述指定任意背景，例如：海边日落、城市夜景、纯色墙面等）" },
  { key: "cartoonify", label: "人物卡通化", desc: "变动漫风", prompt: "将照片中的人物转换为精致的卡通 / 动漫插画风格：保留人物的五官特征、发型、服饰和姿态神态，采用干净流畅的线条、明快柔和的色彩和自然的光影，输出可爱且有质感的卡通形象。" },
  { key: "gif", label: "GIF 动图", desc: "动感效果", prompt: "为这张图片生成富有动感张力的画面：强化动态氛围（如飘动的发丝与衣物、流动的光效、飞扬的粒子）。注意：当前生图模型输出的是静态图像，如需真正的逐帧动图请后续接入专门的动画模型。" },
];

// 每个能力一套赛博霓虹主色（RGB 三元组），用于卡片专属渐变 + 图标发光 + 角标。
const CAP_COLORS = {
  removeBg: "34,211,238",    // 青
  removeText: "96,165,250",  // 电蓝
  restore: "245,190,70",     // 琥珀金
  replaceBg: "167,120,255",  // 紫
  cartoonify: "244,114,208", // 品红
  gif: "45,230,160",         // 霓虹绿
};

const DEFAULT_PROMPTS = Object.fromEntries(CAPS.map((c) => [c.key, c.prompt]));
const SIZE = 1024;
const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const RATIO_PRESETS = { "1:1": [1, 1], "3:4": [3, 4], "4:3": [4, 3], "16:9": [16, 9], "9:16": [9, 16] };
const HISTORY_MAX = 12;
const MIN_PX = 256;
const MAX_PX = 4096;

function clampPx(v) {
  const n = Math.round(Number(v) || 0);
  return Math.min(MAX_PX, Math.max(MIN_PX, n || 1024));
}
function gcd(a, b) {
  return b ? gcd(b, a % b) : a || 1;
}

const storage = createLocalState("imageStudio:retouch:v1");
const els = {};
let currentCap = CAPS[0].key;
let currentRatio = "1:1";
let prompts = { ...DEFAULT_PROMPTS };
let history = [];
let active = null; // 当前对比展示 { before, after, afterDownload, label }
let file = null;
let previewUrl = "";
let imageSet = null;
let loading = false;
let hasImageConfig = false;
let hintSeen = false;

function buildImageSpec() {
  // 自定义：用户填宽高像素 → 长边作 customSize，宽高比约分为 customRatio（后端上限 99，超了按比例缩）。
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
  const [rw, rh] = RATIO_PRESETS[currentRatio] || [1, 1];
  let width = SIZE, height = SIZE;
  if (rw > rh) height = Math.round((SIZE * rh) / rw);
  else if (rh > rw) width = Math.round((SIZE * rw) / rh);
  return {
    sizeMode: "preset", sizePreset: "1k", customSize: SIZE,
    ratioPreset: currentRatio, customRatioWidth: rw, customRatioHeight: rh,
    width, height, ratio: `${rw}:${rh}`, requestSize: `${width}x${height}`,
  };
}

function loadSaved() {
  const saved = storage.load(null);
  if (!saved || typeof saved !== "object") return;
  if (saved.prompts && typeof saved.prompts === "object") prompts = { ...DEFAULT_PROMPTS, ...saved.prompts };
  if (typeof saved.currentCap === "string" && DEFAULT_PROMPTS[saved.currentCap]) currentCap = saved.currentCap;
  if (typeof saved.ratioPreset === "string" && (RATIO_PRESETS[saved.ratioPreset] || saved.ratioPreset === "custom")) currentRatio = saved.ratioPreset;
  if (saved.customW) els.customW.value = clampPx(saved.customW);
  if (saved.customH) els.customH.value = clampPx(saved.customH);
  if (saved.hintSeen) hintSeen = true;
  if (Array.isArray(saved.history)) history = saved.history.slice(0, HISTORY_MAX);
}

function save() {
  storage.save({
    prompts,
    currentCap,
    ratioPreset: currentRatio,
    customW: els.customW.value,
    customH: els.customH.value,
    hintSeen,
    history,
  });
}

function setMsg(text, kind = "") {
  els.msg.textContent = text || "";
  els.msg.className = `msg ${kind}`;
}

function renderCaps() {
  els.caps.innerHTML = "";
  CAPS.forEach((cap) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `rt-cap${cap.key === currentCap ? " active" : ""}`;
    btn.style.setProperty("--cap", CAP_COLORS[cap.key] || "120,140,180");
    btn.innerHTML = `
      <span class="rt-cap-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[cap.key]}</svg></span>
      <span class="rt-cap-label">${cap.label}</span>
      <span class="rt-cap-desc">${cap.desc}</span>`;
    btn.addEventListener("click", () => {
      currentCap = cap.key;
      els.prompt.value = prompts[cap.key] || "";
      renderCaps();
      save();
    });
    els.caps.appendChild(btn);
  });
}

function renderRatios() {
  els.ratios.innerHTML = "";
  [...RATIOS, "custom"].forEach((r) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `rt-ratio${r === currentRatio ? " active" : ""}`;
    btn.textContent = r === "custom" ? "自定义" : r;
    btn.addEventListener("click", () => {
      currentRatio = r;
      renderRatios();
      save();
      renderState();
      renderCanvas();
    });
    els.ratios.appendChild(btn);
  });
  els.customSize.hidden = currentRatio !== "custom";
}

function renderState() {
  els.generateBtn.disabled = !hasImageConfig || loading || !file;
  els.generateBtn.innerHTML = loading ? `<span class="spinner"></span>生成中…` : "开始生成";
  els.configHint.textContent = hasImageConfig ? "" : "尚未配置生图 API Key，请先到「配置中心」保存。";
  els.configHint.style.color = hasImageConfig ? "var(--ink-mute)" : "var(--warn)";
  els.canvasBadge.textContent = `${history.length} 个结果`;
  els.canvasTitle.textContent = active ? "原图 / 结果对比" : file ? "已就绪，点击「开始生成」" : "上传照片开始";
}

// 画布主体：根据状态渲染 上传区 / 照片 / 处理中 / 前后对比，外加底部信息 + 历史。
function renderCanvas() {
  let stage;
  if (loading) {
    const base = active?.before || previewUrl || "";
    stage = `<div class="rt-stage rt-stage-loading">
      ${base ? `<img class="rt-stage-img dim" src="${base}" alt="" />` : ""}
      <div class="rt-loading"><span class="spinner"></span>正在处理…</div>
    </div>`;
  } else if (active) {
    stage = `<div class="rt-stage">
      <div class="rt-compare" id="compare">
        <img class="rt-compare-after" id="cmpAfter" src="${active.after}" alt="结果" />
        <img class="rt-compare-before" id="cmpBefore" src="${active.before}" alt="原图" />
        <div class="rt-compare-divider" id="cmpDivider"></div>
        <input type="range" min="0" max="100" value="50" class="rt-compare-range" id="cmpRange" aria-label="对比滑块" />
        <span class="rt-compare-tag rt-tag-before">原图</span>
        <span class="rt-compare-tag rt-tag-after">结果</span>
      </div>
    </div>`;
  } else if (previewUrl) {
    stage = `<div class="rt-stage"><img class="rt-stage-img" src="${previewUrl}" alt="待处理照片" /></div>`;
  } else {
    stage = `<div class="rt-stage rt-drop" id="dropZone">
      <div class="rt-drop-inner">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <div class="rt-drop-title">点击或拖拽上传照片</div>
        <div class="mono" style="font-size: 11px; color: var(--ink-mute)">PNG / JPG / WEBP / GIF · ≤20MB</div>
      </div>
    </div>`;
  }

  const ratioText = currentRatio === "custom" ? `${clampPx(els.customW.value)}×${clampPx(els.customH.value)}` : currentRatio;
  const info = active
    ? `${active.label} · ${ratioText}`
    : file
      ? `${(file.size / 1024 / 1024).toFixed(2)}MB · 待处理`
      : "尚未上传";
  const actions = active
    ? `<a class="btn sm" href="${active.afterDownload || active.after}">下载结果</a>
       <button class="btn sm ghost" id="reupload" type="button">换一张</button>`
    : file
      ? `<button class="btn sm ghost" id="reupload" type="button">换一张</button>`
      : "";

  const histHtml = history.length
    ? `<div class="rt-history"><div class="rt-history-strip" id="histStrip"></div></div>`
    : "";

  els.canvas.innerHTML = `${stage}
    <div class="rt-canvas-foot">
      <span class="rt-foot-info">${info}</span>
      <span class="rt-foot-actions">${actions}</span>
    </div>
    ${histHtml}`;

  // 事件绑定
  const drop = document.getElementById("dropZone");
  if (drop) {
    drop.addEventListener("click", () => els.fileInput.click());
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("dragging");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("dragging");
      selectFile(e.dataTransfer.files?.[0]);
    });
  }
  const reupload = document.getElementById("reupload");
  if (reupload) reupload.addEventListener("click", () => els.fileInput.click());

  const range = document.getElementById("cmpRange");
  if (range) {
    const before = document.getElementById("cmpBefore");
    const divider = document.getElementById("cmpDivider");
    const apply = (v) => {
      before.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
      divider.style.left = `${v}%`;
    };
    apply(50);
    range.addEventListener("input", () => apply(Number(range.value)));
  }

  const strip = document.getElementById("histStrip");
  if (strip) {
    history.forEach((h) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = `rt-thumb${active && active.after === h.after ? " active" : ""}`;
      thumb.innerHTML = `<img src="${h.after}" alt="${h.label || "结果"}" loading="lazy" />`;
      thumb.addEventListener("click", () => {
        active = h;
        renderState();
        renderCanvas();
      });
      strip.appendChild(thumb);
    });
  }
}

function selectFile(f) {
  if (!f) return;
  if (!f.type.startsWith("image/")) return setMsg("请选择图片文件", "error");
  if (f.size > 20 * 1024 * 1024) return setMsg("图片不能超过 20MB", "error");
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  file = f;
  previewUrl = URL.createObjectURL(f);
  active = null; // 新照片，清掉旧对比
  setMsg("图片已就绪，点击「开始生成」", "success");
  renderState();
  renderCanvas();
}

async function ensureImageSet() {
  if (imageSet?.id) return imageSet;
  const data = await apiPost("/api/image-sets", {});
  imageSet = data.imageSet;
  return imageSet;
}

async function generate() {
  if (!file) return setMsg("请先上传图片", "error");
  const prompt = els.prompt.value.trim();
  if (!prompt) return setMsg("提示词不能为空", "error");
  loading = true;
  setMsg("");
  renderState();
  renderCanvas();
  try {
    const spec = buildImageSpec();
    const set = await ensureImageSet();

    const fd = new FormData();
    fd.append("image", file);
    const params = new URLSearchParams({
      imageSetId: set.id,
      imageSpecSizeMode: spec.sizeMode,
      imageSpecSizePreset: spec.sizePreset,
      imageSpecCustomSize: String(spec.customSize),
      imageSpecRatioPreset: spec.ratioPreset,
      imageSpecCustomRatioWidth: String(spec.customRatioWidth),
      imageSpecCustomRatioHeight: String(spec.customRatioHeight),
    });
    const uploaded = await apiUpload(`/api/images/main/upload?${params}`, fd);
    const beforeUrl = uploaded.image.url;

    const { taskId } = await apiPost("/api/playground/images", {
      mode: "edit",
      prompt,
      count: 1,
      referenceImageId: uploaded.image.id,
      imageSpec: spec,
    });
    const done = await pollTask(taskId);
    const out = (done.images || [])[0];
    if (typeof done.credits === "number") setCredits(done.credits);
    if (!out) {
      setMsg("未生成结果，请重试", "error");
    } else {
      const label = CAPS.find((c) => c.key === currentCap)?.label || "结果";
      active = { before: beforeUrl, after: out.url, afterDownload: out.downloadUrl, label };
      history.unshift(active);
      history = history.slice(0, HISTORY_MAX);
      save();
      setMsg("处理完成（消耗 1 积分）", "success");
    }
  } catch (err) {
    setMsg(err.message, "error");
  } finally {
    loading = false;
    renderState();
    renderCanvas();
  }
}

async function main() {
  const ctx = await mountLayout({ active: "retouch", title: "AI 修图", crumb: "TOOLS" });
  if (!ctx) return;
  Object.assign(els, {
    canvas: document.getElementById("canvas"),
    canvasTitle: document.getElementById("canvasTitle"),
    canvasBadge: document.getElementById("canvasBadge"),
    caps: document.getElementById("caps"),
    ratios: document.getElementById("ratios"),
    customSize: document.getElementById("customSize"),
    customW: document.getElementById("customW"),
    customH: document.getElementById("customH"),
    fileInput: document.getElementById("fileInput"),
    prompt: document.getElementById("prompt"),
    resetPrompt: document.getElementById("resetPrompt"),
    advanced: document.getElementById("advanced"),
    editPoke: document.getElementById("editPoke"),
    msg: document.getElementById("msg"),
    generateBtn: document.getElementById("generateBtn"),
    configHint: document.getElementById("configHint"),
  });

  loadSaved();
  renderCaps();
  renderRatios();
  els.prompt.value = prompts[currentCap] || "";
  if (history.length) active = history[0];

  // 跳动手势：引导去点「编辑」，展开一次后永久消失。
  if (hintSeen) els.editPoke.remove();
  els.advanced.addEventListener("toggle", () => {
    if (els.advanced.open && !hintSeen) {
      hintSeen = true;
      els.editPoke.remove();
      save();
    }
  });

  els.fileInput.addEventListener("change", (e) => {
    selectFile(e.target.files?.[0]);
    e.target.value = "";
  });
  els.prompt.addEventListener("input", () => {
    prompts[currentCap] = els.prompt.value;
    save();
  });
  els.resetPrompt.addEventListener("click", (e) => {
    e.preventDefault();
    prompts[currentCap] = DEFAULT_PROMPTS[currentCap];
    els.prompt.value = prompts[currentCap];
    save();
    setMsg("已恢复该能力的默认提示词", "success");
  });
  [els.customW, els.customH].forEach((el) => {
    el.addEventListener("input", () => {
      save();
      renderState();
      renderCanvas();
    });
  });
  els.generateBtn.addEventListener("click", generate);

  try {
    const cfg = await apiGet("/api/image-config");
    hasImageConfig = Boolean(cfg.config?.uploaded);
  } catch {
    hasImageConfig = false;
  }
  renderState();
  renderCanvas();
}

main();
