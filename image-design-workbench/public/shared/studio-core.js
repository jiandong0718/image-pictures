// 套图工作台核心引擎（被三个工作台页面复用，但每个页面有自己独立的入口 JS 与 HTML）。
// 通过 createStudio(config) 注入：模式、衍生类型、默认提示词、文案。引擎负责：
// 套图分配、主图生成/上传、衍生图单张/批量生成、图板渲染、积分余额联动。

import { mountLayout, setCredits } from "/shared/layout.js";
import { apiGet, apiPost, apiUpload, downloadFile, downloadJsonFile, pollTask } from "/shared/api.js";
import { createLocalState } from "/shared/persistence.js";
import { enableImagePaste, createClearButton } from "/shared/image-paste.js";

const SIZE_PRESETS = { "1k": 1024, "2k": 2048, "4k": 4096 };
const RATIO_PRESETS = {
  "1:1": [1, 1], "3:2": [3, 2], "2:3": [2, 3], "16:9": [16, 9],
  "9:16": [9, 16], "4:3": [4, 3], "3:4": [3, 4], "21:9": [21, 9],
};

function normalizeSpec(spec) {
  const size = SIZE_PRESETS[spec.sizePreset] || 1024;
  const [rw, rh] = RATIO_PRESETS[spec.ratioPreset] || [1, 1];
  let width = size;
  let height = size;
  if (rw > rh) height = Math.round((size * rh) / rw);
  else if (rh > rw) width = Math.round((size * rw) / rh);
  return {
    sizeMode: "preset",
    sizePreset: spec.sizePreset,
    customSize: size,
    ratioPreset: spec.ratioPreset,
    customRatioWidth: rw,
    customRatioHeight: rh,
    width,
    height,
    ratio: `${rw}:${rh}`,
    requestSize: `${width}x${height}`,
  };
}

export function createStudio(config) {
  const { mode, crumb, title, derivedTypes, typeLabels, defaultPrompts, generateAllLabel, mainUploadOnly,
    mainLabel = "主图", mainBadge = "源图", derivedBadge = "衍生" } = config;
  const allTypes = ["main", ...derivedTypes];
  const storage = createLocalState(`imageStudio:studio:${mode}:v1`);
  // 衍生数较多时用「主视图大图 + 延展网格」布局；少时保持均匀网格。
  const heroLayout = derivedTypes.length >= 3;

  const state = {
    imageSet: null,
    spec: { sizePreset: "1k", ratioPreset: "1:1" },
    prompts: { main: defaultPrompts.main || "", ...defaultPrompts },
    images: {},
    loading: {},
    hasImageConfig: false,
    // 正在进行的生成任务（切走页面也要能续上，回来把图捞回，避免扣了费图却丢了）。
    pending: null,
  };

  let board;

  function readSavedState() {
    const saved = storage.load(null);
    return saved && typeof saved === "object" ? saved : null;
  }

  function applySavedState() {
    const saved = readSavedState();
    if (!saved) return;
    if (saved.imageSet && typeof saved.imageSet === "object") {
      state.imageSet = saved.imageSet;
    }
    if (saved.spec && typeof saved.spec === "object") {
      state.spec = {
        sizePreset: saved.spec.sizePreset || state.spec.sizePreset,
        ratioPreset: saved.spec.ratioPreset || state.spec.ratioPreset,
      };
    }
    if (saved.prompts && typeof saved.prompts === "object") {
      state.prompts = { ...state.prompts, ...saved.prompts };
    }
    if (saved.images && typeof saved.images === "object") {
      state.images = saved.images;
    }
    if (saved.pending && typeof saved.pending === "object" && saved.pending.taskId) {
      state.pending = saved.pending;
    }
  }

  function saveState() {
    storage.save({
      imageSet: state.imageSet,
      spec: state.spec,
      prompts: state.prompts,
      images: state.images,
      pending: state.pending,
    });
  }

  // 记录/清除「进行中的任务」。同一时刻按钮互斥，最多一个任务在跑。
  function setPending(types, taskId) {
    state.pending = { types, taskId };
    saveState();
  }
  function clearPending() {
    state.pending = null;
    saveState();
  }

  // 轮询任务并把结果落到对应图位。main/derived 返回 {image}，批量返回 {results,errors}。
  async function pollAndApply(types, taskId) {
    const result = await pollTask(taskId);
    if (result.results) {
      types.forEach((type) => {
        if (result.results[type]) {
          state.images[type] = result.results[type];
          setMsg(type, `${typeLabels[type]}已生成`, "success");
        } else if (result.errors?.[type]) {
          setMsg(type, result.errors[type], "error");
        }
      });
    } else if (result.image) {
      const type = types[0];
      state.images[type] = result.image;
      setMsg(type, type === "main" ? "主图已生成" : `${typeLabels[type]}已生成`, "success");
    }
    if (typeof result.credits === "number") setCredits(result.credits);
    saveState();
  }

  // 页面挂载时，若上次离开时还有任务没轮询完，续上把图捞回来。
  async function resumePending() {
    const p = state.pending;
    if (!p || !p.taskId || !Array.isArray(p.types)) return;
    p.types.forEach((type) => setLoading(type, true));
    try {
      await pollAndApply(p.types, p.taskId);
      clearPending();
    } catch {
      // 任务已过期或失败：只清 pending，已有的图片一律保留不动。
      clearPending();
    } finally {
      p.types.forEach((type) => setLoading(type, false));
    }
  }

  async function ensureImageSet() {
    if (state.imageSet?.id) {
      return state.imageSet;
    }
    const data = await apiPost("/api/image-sets", {});
    state.imageSet = data.imageSet;
    renderImageSet();
    saveState();
    return state.imageSet;
  }

  function renderImageSet() {
    const el = document.getElementById("imageSetName");
    if (el) el.textContent = state.imageSet?.folderName || "--";
  }

  function setMsg(type, text, kind = "") {
    const el = board.querySelector(`[data-msg="${type}"]`);
    if (el) {
      el.textContent = text || "";
      el.className = `msg ${kind}`;
    }
  }

  function setLoading(type, value) {
    state.loading[type] = value;
    renderCard(type);
    renderControls();
  }

  function renderPreview(type) {
    const preview = board.querySelector(`[data-preview="${type}"]`);
    if (!preview) return;
    const image = state.images[type];
    const mainReady = Boolean(state.images.main);
    if (state.loading[type]) {
      preview.innerHTML = `<div class="empty"><span class="spinner"></span>${typeLabels[type] || "图片"}生成中…</div>`;
      return;
    }
    if (image) {
      preview.innerHTML = "";
      const img = document.createElement("img");
      img.src = `${image.url}?t=${encodeURIComponent(image.createdAt || "")}`;
      img.alt = typeLabels[type] || type;
      img.loading = "lazy";
      img.addEventListener("click", () => window.open(image.url, "_blank", "noopener"));
      preview.appendChild(img);
      if (type === "main") {
        preview.style.position = "relative";
        preview.appendChild(createClearButton(clearMain, "清除主图"));
      }
      return;
    }
    if (type !== "main" && !mainReady) {
      preview.innerHTML = `<div class="empty">需要先准备主图</div>`;
      return;
    }
    preview.innerHTML = `<div class="empty">${type === "main" ? (mainUploadOnly ? "上传源图" : "等待生成主图") : "可生成"}</div>`;
  }

  function renderCard(type) {
    renderPreview(type);
  }

  function renderControls() {
    const anyLoading = Object.values(state.loading).some(Boolean);
    const hasMain = Boolean(state.images.main);
    const cfg = state.hasImageConfig;

    allTypes.forEach((type) => {
      const genBtn = board.querySelector(`[data-action="generate"][data-type="${type}"]`);
      const dlBtn = board.querySelector(`[data-action="download"][data-type="${type}"]`);
      if (genBtn) {
        const canGen = cfg && !anyLoading && (type === "main" ? true : hasMain);
        genBtn.disabled = !canGen;
        genBtn.textContent = state.images[type]
          ? (type === "main" ? "重新生成主图" : "重新生成")
          : (type === "main" ? "生成主图" : "生成");
      }
      if (dlBtn) {
        dlBtn.disabled = !state.images[type] || anyLoading;
      }
    });

    const genAll = document.getElementById("generateAll");
    if (genAll) {
      genAll.disabled = !cfg || !hasMain || anyLoading;
      genAll.textContent = generateAllLabel;
    }
    const dlAll = document.getElementById("downloadAll");
    if (dlAll) {
      dlAll.disabled = anyLoading || !allTypes.some((t) => state.images[t]);
    }
    const hint = document.getElementById("configHint");
    if (hint) {
      hint.textContent = cfg ? "" : "尚未配置生图 API Key，请先到「配置中心」保存。";
      hint.style.color = cfg ? "var(--ink-mute)" : "var(--warn)";
    }
  }

  function collectPrompt(type) {
    const ta = board.querySelector(`#prompt-${type}`);
    state.prompts[type] = ta ? ta.value.trim() : "";
    saveState();
    return state.prompts[type];
  }

  async function generateMain() {
    const prompt = collectPrompt("main");
    if (!prompt) {
      setMsg("main", "主图提示词不能为空", "error");
      return;
    }
    const imageSet = await ensureImageSet();
    setLoading("main", true);
    setMsg("main", "");
    try {
      const { taskId } = await apiPost("/api/images/main", {
        prompt,
        imageSetId: imageSet.id,
        imageSpec: normalizeSpec(state.spec),
      });
      setPending(["main"], taskId);
      await pollAndApply(["main"], taskId);
      clearPending();
    } catch (err) {
      setMsg("main", err.message, "error");
      clearPending();
    } finally {
      setLoading("main", false);
    }
  }

  async function uploadMain(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMsg("main", "请选择图片文件", "error");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setMsg("main", "图片不能超过 20MB", "error");
      return;
    }
    const imageSet = await ensureImageSet();
    const spec = normalizeSpec(state.spec);
    setLoading("main", true);
    setMsg("main", "");
    try {
      const fd = new FormData();
      fd.append("image", file);
      const params = new URLSearchParams({
        imageSetId: imageSet.id,
        imageSpecSizeMode: spec.sizeMode,
        imageSpecSizePreset: spec.sizePreset,
        imageSpecCustomSize: String(spec.customSize),
        imageSpecRatioPreset: spec.ratioPreset,
        imageSpecCustomRatioWidth: String(spec.customRatioWidth),
        imageSpecCustomRatioHeight: String(spec.customRatioHeight),
      });
      const data = await apiUpload(`/api/images/main/upload?${params}`, fd);
      state.images.main = data.image;
      saveState();
      setMsg("main", "已上传为主图", "success");
    } catch (err) {
      setMsg("main", err.message, "error");
    } finally {
      setLoading("main", false);
    }
  }

  // 清除主图：衍生图依赖主图，清掉后相应按钮自动禁用；已生成的衍生图保留。
  function clearMain() {
    state.images.main = null;
    saveState();
    setMsg("main", "");
    allTypes.forEach(renderCard);
    renderControls();
  }

  async function generateDerived(type) {
    if (!state.images.main) {
      setMsg(type, "请先准备主图", "error");
      return;
    }
    const prompt = collectPrompt(type);
    if (!prompt) {
      setMsg(type, `${typeLabels[type]}提示词不能为空`, "error");
      return;
    }
    const imageSet = await ensureImageSet();
    setLoading(type, true);
    setMsg(type, "");
    try {
      const { taskId } = await apiPost("/api/images/derived", {
        type,
        prompt,
        mainImageId: state.images.main.id,
        imageSetId: imageSet.id,
        imageSpec: normalizeSpec(state.spec),
      });
      setPending([type], taskId);
      await pollAndApply([type], taskId);
      clearPending();
    } catch (err) {
      setMsg(type, err.message, "error");
      clearPending();
    } finally {
      setLoading(type, false);
    }
  }

  async function generateAll() {
    if (!state.images.main) {
      return;
    }
    if (derivedTypes.length === 1) {
      await generateDerived(derivedTypes[0]);
      return;
    }
    const prompts = {};
    for (const type of derivedTypes) {
      prompts[type] = collectPrompt(type);
      if (!prompts[type]) {
        setMsg(type, `${typeLabels[type]}提示词不能为空`, "error");
        return;
      }
    }
    const imageSet = await ensureImageSet();
    derivedTypes.forEach((type) => {
      setLoading(type, true);
      setMsg(type, "");
    });
    try {
      const { taskId } = await apiPost("/api/images/derived/batch", {
        types: derivedTypes,
        mainImageId: state.images.main.id,
        imageSetId: imageSet.id,
        prompts,
        imageSpec: normalizeSpec(state.spec),
      });
      setPending(derivedTypes, taskId);
      await pollAndApply(derivedTypes, taskId);
      clearPending();
    } catch (err) {
      derivedTypes.forEach((type) => setMsg(type, err.message, "error"));
      clearPending();
    } finally {
      derivedTypes.forEach((type) => (state.loading[type] = false));
      derivedTypes.forEach((type) => renderCard(type));
      renderControls();
    }
  }

  async function downloadAll() {
    const ids = allTypes.map((t) => state.images[t]?.id).filter(Boolean);
    if (!ids.length) return;
    const msgType = allTypes.find((t) => state.images[t]) || "main";
    setMsg(msgType, "");
    try {
      await downloadJsonFile(
        "/api/images/download-all",
        { ids, imageSetId: state.imageSet?.id || "" },
        state.imageSet?.folderName ? `product-${state.imageSet.folderName}.zip` : "product.zip",
      );
    } catch (err) {
      setMsg(msgType, `套图下载失败：${err.message}`, "error");
    }
  }

  async function downloadImage(type) {
    const image = state.images[type];
    if (!image?.downloadUrl) return;
    setMsg(type, "");
    try {
      await downloadFile(image.downloadUrl, image.filename || `${type}.png`);
    } catch (err) {
      setMsg(type, `下载失败：${err.message}`, "error");
    }
  }

  function cardHtml(type) {
    const isMain = type === "main";
    const label = isMain ? mainLabel : typeLabels[type];
    const uploadBtn = isMain
      ? `<button class="btn" data-action="upload" type="button">上传主图</button>`
      : "";
    const genBtn = isMain && mainUploadOnly
      ? ""
      : `<button class="btn primary" data-action="generate" data-type="${type}" type="button" disabled>生成</button>`;
    return `
      <article class="studio-card${isMain ? " main" : ""}" data-card="${type}">
        <div class="studio-card-head">
          <h3>${label}</h3>
          <span class="badge${isMain ? " ok" : ""}">${isMain ? mainBadge : derivedBadge}</span>
        </div>
        <div class="studio-preview" data-preview="${type}"><div class="empty">等待生成</div></div>
        <label class="field"><span>提示词</span>
          <textarea class="textarea" id="prompt-${type}" rows="4">${state.prompts[type] || ""}</textarea>
        </label>
        <div class="studio-card-actions">
          ${genBtn}
          ${uploadBtn}
          <button class="btn" data-action="download" data-type="${type}" type="button" disabled>下载</button>
        </div>
        <p class="msg" data-msg="${type}"></p>
      </article>`;
  }

  function buildBoardHtml() {
    if (heroLayout) {
      return cardHtml("main") + `<div class="derived-grid">${derivedTypes.map(cardHtml).join("")}</div>`;
    }
    return allTypes.map(cardHtml).join("");
  }

  function bindBoard() {
    board.querySelectorAll('[data-action="generate"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.type;
        if (type === "main") generateMain();
        else generateDerived(type);
      });
    });
    board.querySelectorAll('[data-action="download"]').forEach((btn) => {
      btn.addEventListener("click", () => downloadImage(btn.dataset.type));
    });
    board.querySelectorAll("textarea").forEach((ta) => {
      ta.addEventListener("input", () => {
        const type = ta.id.replace(/^prompt-/, "");
        state.prompts[type] = ta.value;
        saveState();
      });
    });
    const uploadBtn = board.querySelector('[data-action="upload"]');
    if (uploadBtn) {
      const input = document.getElementById("mainUploadInput");
      uploadBtn.addEventListener("click", () => input.click());
      input.addEventListener("change", async (e) => {
        await uploadMain(e.target.files?.[0]);
        e.target.value = "";
      });
      enableImagePaste((f) => uploadMain(f)); // Ctrl/Cmd+V 粘贴主图
    }
  }

  function bindToolbar() {
    document.querySelectorAll("[data-size-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.spec.sizePreset = btn.dataset.sizePreset;
        syncSpecButtons();
        saveState();
      });
    });
    document.querySelectorAll("[data-ratio-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.spec.ratioPreset = btn.dataset.ratioPreset;
        syncSpecButtons();
        saveState();
      });
    });
    document.getElementById("generateAll")?.addEventListener("click", generateAll);
    document.getElementById("downloadAll")?.addEventListener("click", downloadAll);
    document.getElementById("newWindow")?.addEventListener("click", () => window.open(location.pathname, "_blank"));
  }

  function syncSpecButtons() {
    document.querySelectorAll("[data-size-preset]").forEach((b) =>
      b.classList.toggle("active", b.dataset.sizePreset === state.spec.sizePreset));
    document.querySelectorAll("[data-ratio-preset]").forEach((b) =>
      b.classList.toggle("active", b.dataset.ratioPreset === state.spec.ratioPreset));
  }

  async function start() {
    const ctx = await mountLayout({ active: mode === "hat" ? "studio-hat" : mode === "bag" ? "studio-bag" : "studio-3d", title, crumb });
    if (!ctx) return;

    applySavedState();
    board = document.getElementById("board");
    board.dataset.count = String(allTypes.length);
    if (heroLayout) board.dataset.layout = "hero";
    board.innerHTML = buildBoardHtml();
    bindBoard();
    bindToolbar();
    renderImageSet();
    syncSpecButtons();

    try {
      const cfg = await apiGet("/api/image-config");
      state.hasImageConfig = Boolean(cfg.config?.uploaded);
    } catch {
      state.hasImageConfig = false;
    }

    allTypes.forEach((type) => renderCard(type));
    renderControls();
    await ensureImageSet().catch(() => {});
    // 续上离开前没轮询完的任务（不阻塞首屏，图片就绪后自动补上）。
    resumePending();
  }

  return { start };
}
