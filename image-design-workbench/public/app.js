const HAT_DERIVED_TYPES = ["whiteBackground", "dimensions", "detail", "worn", "scene", "sellingPoints"];
const BAG_DERIVED_TYPES = ["derived"];
const SHOULDER_BAG_FLAT_DERIVED_TYPES = ["shoulderBagStrap", "shoulderBagBody"];
const TYPES = ["main", "derived", ...HAT_DERIVED_TYPES, ...SHOULDER_BAG_FLAT_DERIVED_TYPES];
const DERIVED_TYPES = ["derived", ...HAT_DERIVED_TYPES, ...SHOULDER_BAG_FLAT_DERIVED_TYPES];
const DEFAULT_PRODUCT_SET_MODE = "hat";
const PRODUCT_SET_MODES = {
  hat: {
    label: "帽子套图",
    types: ["main", ...HAT_DERIVED_TYPES],
    derivedTypes: HAT_DERIVED_TYPES,
    generateAllLabel: "生成六张衍生图",
    readyStatus: "主图已准备，可以继续生成六张衍生图",
    generatingStatus: "正在同时生成六张衍生图",
    doneStatus: "六张衍生图已生成",
    partialStatus: "部分衍生图生成失败",
  },
  bag: {
    label: "包包套图",
    types: ["main", ...BAG_DERIVED_TYPES],
    derivedTypes: BAG_DERIVED_TYPES,
    generateAllLabel: "生成衍生图",
    readyStatus: "主图已准备，可以继续生成衍生图",
    generatingStatus: "正在生成衍生图",
    doneStatus: "衍生图已生成",
    partialStatus: "衍生图生成失败",
  },
  shoulderBagFlat: {
    label: "单肩背包平面图",
    types: ["main", ...SHOULDER_BAG_FLAT_DERIVED_TYPES],
    derivedTypes: SHOULDER_BAG_FLAT_DERIVED_TYPES,
    generateAllLabel: "生成两张部位图",
    readyStatus: "主图已准备，可以继续生成两张部位图",
    generatingStatus: "正在同时生成两张部位图",
    doneStatus: "两张部位图已生成",
    partialStatus: "部分部位图生成失败",
    mainUploadOnly: true,
  },
};
const STORAGE_KEY = "imageDesignWorkbench.session.v5";
const DEFAULT_IMAGE_SPEC = { mode: "square", size: 1024 };
const MIN_IMAGE_SPEC_SIZE = 256;
const MAX_IMAGE_SPEC_SIZE = 4096;

const TYPE_LABELS = {
  main: "主图",
  derived: "衍生图",
  whiteBackground: "白色背景图",
  dimensions: "尺寸标注图",
  detail: "局部放大图",
  worn: "人物穿戴图",
  scene: "场景展示图",
  sellingPoints: "卖点展示图",
  shoulderBagStrap: "肩带部位图",
  shoulderBagBody: "包身部位图",
};

const DEFAULT_PROMPTS = {
  main:
    "为一款 3D 印花商品生成电商主图。商品居中展示，图案清晰，材质真实，光线干净，高级商业摄影风格，适合电商平台首图。",
  derived:
    "基于主图生成一张包包商品衍生图。保留包包主体、颜色、材质和图案细节，按照我的要求调整场景、角度或展示方式，画面干净高级，适合电商详情页。",
  whiteBackground:
    "基于主图保留商品外观、颜色和 3D 印花细节，生成纯白背景电商图。商品完整居中，边缘干净，无多余道具。",
  dimensions:
    "基于主图生成尺寸标注图。保留商品正面外观，添加清晰的尺寸辅助线、箭头和标注区域，画面整洁，适合商品详情页。",
  detail:
    "基于主图生成局部放大细节图。突出 3D 印花纹理、面料质感、边缘工艺和颜色层次，带局部放大窗口，商业详情页风格。",
  worn:
    "基于主图生成真实人物穿戴图。模特自然穿戴该商品，商品图案和颜色保持一致，姿态自然，背景简洁，适合电商展示。",
  scene:
    "基于主图生成生活场景展示图。保留商品外观、颜色和 3D 印花细节，将商品自然放置在简洁真实的使用场景中，适合商品详情页。",
  sellingPoints:
    "基于主图生成卖点展示图。保留商品外观、颜色和 3D 印花细节，加入清晰卖点标注区域和简洁版式，不添加虚假参数。",
  shoulderBagStrap:
    "基于上传的单肩背包平面图生成肩带部位图。保留背包颜色、材质、印花和五金细节，突出肩带连接、调节扣、走线和受力结构，画面干净，适合电商详情页。",
  shoulderBagBody:
    "基于上传的单肩背包平面图生成包身部位图。保留包型、颜色、材质和印花细节，突出包身轮廓、开合结构、边缘工艺和容量区域，画面干净，适合电商详情页。",
};

let state = loadState();
let imageSetRequest = null;

function normalizeImageSpec(rawSpec = {}) {
  const mode = rawSpec.mode === "fixed" ? "fixed" : "square";
  const parsedSize = Number(rawSpec.size);
  const size = Number.isInteger(parsedSize)
    ? Math.min(Math.max(parsedSize, MIN_IMAGE_SPEC_SIZE), MAX_IMAGE_SPEC_SIZE)
    : DEFAULT_IMAGE_SPEC.size;
  return { mode, size };
}

function normalizeProductSetMode(value) {
  return PRODUCT_SET_MODES[value] ? value : DEFAULT_PRODUCT_SET_MODE;
}

function getProductSetConfig() {
  return PRODUCT_SET_MODES[normalizeProductSetMode(state.productSetMode)];
}

function getActiveTypes() {
  return getProductSetConfig().types;
}

function getActiveDerivedTypes() {
  return getProductSetConfig().derivedTypes;
}

function readPromptParams() {
  try {
    const raw = new URLSearchParams(window.location.search).get("prompts");
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return TYPES.reduce((prompts, type) => {
      if (typeof parsed[type] === "string") {
        prompts[type] = parsed[type];
      }
      return prompts;
    }, {});
  } catch {
    return {};
  }
}

function readProductSetModeParam() {
  const raw = new URLSearchParams(window.location.search).get("productSetMode");
  return raw ? normalizeProductSetMode(raw) : "";
}

function readImageSpecParams() {
  try {
    const raw = new URLSearchParams(window.location.search).get("imageSpec");
    return raw ? normalizeImageSpec(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function shouldStartNewSet() {
  return new URLSearchParams(window.location.search).get("newSet") === "1";
}

function cleanStartupParams() {
  const url = new URL(window.location.href);
  if (
    !url.searchParams.has("newSet") &&
    !url.searchParams.has("prompts") &&
    !url.searchParams.has("imageSpec") &&
    !url.searchParams.has("productSetMode")
  ) {
    return;
  }
  url.searchParams.delete("newSet");
  url.searchParams.delete("prompts");
  url.searchParams.delete("imageSpec");
  url.searchParams.delete("productSetMode");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function loadState() {
  const promptParams = readPromptParams();
  const imageSpecParams = readImageSpecParams();
  const productSetModeParam = readProductSetModeParam();
  const forceNewSet = shouldStartNewSet();

  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
    return {
      productSetMode: normalizeProductSetMode(
        productSetModeParam || (forceNewSet ? DEFAULT_PRODUCT_SET_MODE : saved.productSetMode),
      ),
      imageSet: forceNewSet ? null : saved.imageSet || null,
      prompts: { ...DEFAULT_PROMPTS, ...(forceNewSet ? {} : saved.prompts || {}), ...promptParams },
      imageSpec: normalizeImageSpec({ ...DEFAULT_IMAGE_SPEC, ...(forceNewSet ? {} : saved.imageSpec || {}), ...imageSpecParams }),
      images: forceNewSet ? {} : { ...(saved.images || {}) },
      loading: {},
    };
  } catch {
    return {
      productSetMode: normalizeProductSetMode(productSetModeParam),
      imageSet: null,
      prompts: { ...DEFAULT_PROMPTS, ...promptParams },
      imageSpec: normalizeImageSpec({ ...DEFAULT_IMAGE_SPEC, ...imageSpecParams }),
      images: {},
      loading: {},
    };
  }
}

function saveState() {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      imageSet: state.imageSet,
      productSetMode: state.productSetMode,
      prompts: state.prompts,
      imageSpec: state.imageSpec,
      images: state.images,
    }),
  );
}

function updateImageSetView() {
  const el = qs("#imageSetName");
  if (el) {
    el.textContent = state.imageSet?.folderName || "--";
  }
}

function updateProductSetModeControl() {
  const mode = qs("#productSetMode");
  if (mode) {
    mode.value = normalizeProductSetMode(state.productSetMode);
  }
  const board = qs("#imageBoard");
  if (board) {
    board.dataset.productSet = normalizeProductSetMode(state.productSetMode);
  }
}

function updateImageSpecControls() {
  const spec = normalizeImageSpec(state.imageSpec);
  const mode = qs("#imageSpecMode");
  const size = qs("#imageSpecSize");
  mode.value = spec.mode;
  size.value = String(spec.size);
}

async function ensureImageSet(forceNew = false) {
  if (!forceNew && state.imageSet?.id) {
    return state.imageSet;
  }
  if (!forceNew && imageSetRequest) {
    return imageSetRequest;
  }

  imageSetRequest = apiPost("/api/image-sets", {})
    .then((data) => {
      state.imageSet = data.imageSet;
      saveState();
      updateImageSetView();
      return state.imageSet;
    })
    .finally(() => {
      imageSetRequest = null;
    });

  return imageSetRequest;
}

function qs(selector, root = document) {
  return root.querySelector(selector);
}

function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

function setStatus(message) {
  qs("#globalStatus").textContent = message;
}

function setMessage(type, message, kind = "") {
  const el = qs(`[data-message="${type}"]`);
  el.textContent = message || "";
  el.classList.toggle("error", kind === "error");
  el.classList.toggle("success", kind === "success");
}

function setLoading(type, value) {
  state.loading[type] = value;
  const card = qs(`[data-type="${type}"]`);
  const preview = qs(`[data-preview="${type}"]`);
  card.classList.toggle("loading", value);
  if (value) {
    preview.innerHTML = qs("#spinnerTemplate").innerHTML;
  }
  updateControls();
}

function imageIsFresh(type) {
  if (type === "main") {
    return true;
  }
  return Boolean(state.images[type]?.sourceMainId && state.images[type].sourceMainId === state.images.main?.id);
}

function renderPreview(type) {
  const preview = qs(`[data-preview="${type}"]`);
  const image = state.images[type];
  const isMainReady = Boolean(state.images.main);

  preview.classList.toggle("locked", type !== "main" && !isMainReady);

  if (state.loading[type]) {
    preview.innerHTML = qs("#spinnerTemplate").innerHTML;
    return;
  }

  if (image) {
    preview.innerHTML = "";
    const img = document.createElement("img");
    img.src = `${image.url}?t=${encodeURIComponent(image.createdAt || "")}`;
    img.alt = TYPE_LABELS[type];
    img.loading = "lazy";
    img.addEventListener("click", () => window.open(image.url, "_blank", "noopener"));
    preview.appendChild(img);
    return;
  }

  const icon = type !== "main" && !isMainReady ? "lock" : "image";
  const text = type !== "main" && !isMainReady ? "需要主图" : "等待生成";
  preview.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon" data-icon="${icon}"></span>
      <span>${text}</span>
    </div>
  `;
}

function updateBadges() {
  for (const type of DERIVED_TYPES) {
    const badge = qs(`[data-badge="${type}"]`);
    const image = state.images[type];
    badge.className = "badge";
    if (!state.images.main) {
      badge.textContent = "待主图";
    } else if (!image) {
      badge.textContent = "可生成";
      badge.classList.add("ready");
    } else if (!imageIsFresh(type)) {
      badge.textContent = "需更新";
      badge.classList.add("stale");
    } else {
      badge.textContent = "已生成";
      badge.classList.add("ready");
    }
  }
}

function updateControls() {
  const config = getProductSetConfig();
  const activeTypes = getActiveTypes();
  const hasImageSet = Boolean(state.imageSet?.id);
  const hasMain = Boolean(state.images.main);
  const anyLoading = Object.values(state.loading).some(Boolean);
  const anyImage = activeTypes.some((type) => Boolean(state.images[type]));

  qs("#generateAll").disabled = !hasImageSet || !hasMain || anyLoading;
  qs("#generateAll").innerHTML = `<span class="icon" data-icon="layers"></span>${config.generateAllLabel}`;
  qs("#downloadAll").disabled = !hasImageSet || !anyImage || anyLoading;
  qs("#generateMainTop").hidden = Boolean(config.mainUploadOnly);
  qs("#generateMainTop").disabled = Boolean(config.mainUploadOnly) || !hasImageSet || Boolean(state.loading.main);
  qs("#uploadMainButton").disabled = !hasImageSet || Boolean(state.loading.main);

  for (const type of TYPES) {
    const card = qs(`[data-type="${type}"]`);
    const generateButton = qs(`[data-action="generate"][data-type="${type}"]`);
    const downloadButton = qs(`[data-action="download"][data-type="${type}"]`);
    const isActive = activeTypes.includes(type);
    const canGenerate =
      isActive &&
      (type === "main" ? hasImageSet && !state.loading.main : hasImageSet && hasMain && !state.loading[type]);

    card.hidden = !isActive;
    generateButton.hidden = type === "main" && Boolean(config.mainUploadOnly);
    generateButton.disabled = !canGenerate;
    generateButton.innerHTML =
      type === "main"
        ? `<span class="icon" data-icon="spark"></span>${state.images.main ? "重新生成主图" : "生成主图"}`
        : `<span class="icon" data-icon="refresh"></span>${state.images[type] ? "重新生成" : "生成"}`;
    downloadButton.disabled = !isActive || !state.images[type] || anyLoading;
  }

  qs("#prompt-main").closest(".prompt-field").hidden = Boolean(config.mainUploadOnly);

  updateBadges();
}

function render() {
  updateImageSetView();
  updateProductSetModeControl();
  updateImageSpecControls();
  for (const type of TYPES) {
    const textarea = qs(`#prompt-${type}`);
    if (textarea.value !== state.prompts[type]) {
      textarea.value = state.prompts[type];
    }
    renderPreview(type);
  }
  updateControls();
}

async function apiPost(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.details || data.error || "请求失败");
  }
  return data;
}

async function apiUploadMain(file, imageSetId, imageSpec) {
  const formData = new FormData();
  formData.append("image", file);
  const spec = normalizeImageSpec(imageSpec);
  const params = new URLSearchParams({
    imageSetId,
    imageSpecMode: spec.mode,
    imageSpecSize: String(spec.size),
  });
  const response = await fetch(`/api/images/main/upload?${params.toString()}`, {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.details || data.error || "上传失败");
  }
  return data;
}

function readLocalImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片尺寸"));
    };
    image.src = url;
  });
}

function collectPrompt(type) {
  const value = qs(`#prompt-${type}`).value.trim();
  state.prompts[type] = value;
  saveState();
  return value;
}

function collectImageSpec() {
  state.imageSpec = normalizeImageSpec({
    mode: qs("#imageSpecMode").value,
    size: qs("#imageSpecSize").value,
  });
  saveState();
  updateImageSpecControls();
  return state.imageSpec;
}

function imageSpecError(dimensions, spec) {
  if (dimensions.width !== dimensions.height) {
    return `上传主图必须是 1:1 方图，当前是 ${dimensions.width} x ${dimensions.height}`;
  }
  if (spec.mode === "fixed" && dimensions.width !== spec.size) {
    return `上传主图必须是 ${spec.size} x ${spec.size}，当前是 ${dimensions.width} x ${dimensions.height}`;
  }
  return "";
}

function collectAllPrompts() {
  const prompts = {};
  for (const type of TYPES) {
    prompts[type] = collectPrompt(type);
  }
  return prompts;
}

function openNewImageSetWindow() {
  const prompts = collectAllPrompts();
  const imageSpec = collectImageSpec();
  const url = new URL(window.location.href);
  url.searchParams.set("newSet", "1");
  url.searchParams.set("prompts", JSON.stringify(prompts));
  url.searchParams.set("imageSpec", JSON.stringify(imageSpec));
  url.searchParams.set("productSetMode", normalizeProductSetMode(state.productSetMode));
  window.open(url.toString(), "_blank", "noopener");
}

async function generateMain() {
  const imageSet = await ensureImageSet();
  const prompt = collectPrompt("main");
  const imageSpec = collectImageSpec();
  if (!prompt) {
    setMessage("main", "主图提示词不能为空", "error");
    return;
  }

  if (state.images.main && DERIVED_TYPES.some((type) => state.images[type])) {
    const ok = window.confirm("重新生成主图后，已有衍生图会标记为需更新。继续吗？");
    if (!ok) {
      return;
    }
  }

  setLoading("main", true);
  setMessage("main", "");
  setStatus("正在生成主图");
  try {
    const data = await apiPost("/api/images/main", { prompt, imageSetId: imageSet.id, imageSpec });
    state.images.main = data.image;
    saveState();
    setMessage("main", "主图已生成", "success");
    setStatus(getProductSetConfig().readyStatus);
  } catch (error) {
    setMessage("main", error.message, "error");
    setStatus("主图生成失败");
  } finally {
    setLoading("main", false);
    render();
  }
}

async function uploadMain(file) {
  if (!file) {
    return;
  }
  const imageSet = await ensureImageSet();
  const imageSpec = collectImageSpec();
  if (!file.type.startsWith("image/")) {
    setMessage("main", "请选择图片文件", "error");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    setMessage("main", "上传图片不能超过 20MB", "error");
    return;
  }
  let dimensions;
  try {
    dimensions = await readLocalImageDimensions(file);
  } catch (error) {
    setMessage("main", "无法读取图片尺寸，请上传 PNG、JPG、WEBP 或 GIF 图片", "error");
    return;
  }
  void dimensions;

  if (state.images.main && DERIVED_TYPES.some((type) => state.images[type])) {
    const ok = window.confirm("上传新主图后，已有衍生图会标记为需更新。继续吗？");
    if (!ok) {
      return;
    }
  }

  setLoading("main", true);
  setMessage("main", "");
  setStatus("正在上传主图");
  try {
    const data = await apiUploadMain(file, imageSet.id, imageSpec);
    state.images.main = data.image;
    saveState();
    setMessage("main", "已上传为主图", "success");
    setStatus(getProductSetConfig().readyStatus);
  } catch (error) {
    setMessage("main", error.message, "error");
    setStatus("主图上传失败");
  } finally {
    setLoading("main", false);
    render();
  }
}

async function generateDerived(type) {
  if (!state.images.main) {
    setStatus("请先生成主图");
    return;
  }
  const imageSet = await ensureImageSet();
  const prompt = collectPrompt(type);
  const imageSpec = collectImageSpec();
  if (!prompt) {
    setMessage(type, `${TYPE_LABELS[type]}提示词不能为空`, "error");
    return;
  }

  setLoading(type, true);
  setMessage(type, "");
  setStatus(`正在生成${TYPE_LABELS[type]}`);
  try {
    const data = await apiPost("/api/images/derived", {
      type,
      prompt,
      mainImageId: state.images.main.id,
      imageSetId: imageSet.id,
      imageSpec,
    });
    state.images[type] = data.image;
    saveState();
    setMessage(type, `${TYPE_LABELS[type]}已生成`, "success");
    setStatus(`${TYPE_LABELS[type]}已生成`);
  } catch (error) {
    setMessage(type, error.message, "error");
    setStatus(`${TYPE_LABELS[type]}生成失败`);
  } finally {
    setLoading(type, false);
    render();
  }
}

async function generateAllDerived() {
  if (!state.images.main) {
    setStatus("请先生成主图");
    return;
  }
  const config = getProductSetConfig();
  const derivedTypes = getActiveDerivedTypes();
  if (derivedTypes.length === 1) {
    await generateDerived(derivedTypes[0]);
    return;
  }
  const imageSet = await ensureImageSet();
  const imageSpec = collectImageSpec();

  const prompts = {};
  for (const type of derivedTypes) {
    prompts[type] = collectPrompt(type);
    if (!prompts[type]) {
      setMessage(type, `${TYPE_LABELS[type]}提示词不能为空`, "error");
      return;
    }
  }

  for (const type of derivedTypes) {
    setLoading(type, true);
    setMessage(type, "");
  }
  setStatus(config.generatingStatus);
  try {
    const data = await apiPost("/api/images/derived/batch", {
      types: derivedTypes,
      mainImageId: state.images.main.id,
      imageSetId: imageSet.id,
      prompts,
      imageSpec,
    });

    for (const type of derivedTypes) {
      if (data.results?.[type]) {
        state.images[type] = data.results[type];
        setMessage(type, `${TYPE_LABELS[type]}已生成`, "success");
      } else if (data.errors?.[type]) {
        setMessage(type, data.errors[type], "error");
      }
    }
    saveState();
    setStatus(data.ok ? config.doneStatus : config.partialStatus);
  } catch (error) {
    for (const type of derivedTypes) {
      setMessage(type, error.message, "error");
    }
    setStatus("衍生图生成失败");
  } finally {
    for (const type of derivedTypes) {
      setLoading(type, false);
    }
    render();
  }
}

function downloadSingle(type) {
  const image = state.images[type];
  if (!image) {
    return;
  }
  window.location.href = image.downloadUrl;
}

async function downloadAll() {
  const ids = getActiveTypes().map((type) => state.images[type]?.id).filter(Boolean);
  if (!ids.length) {
    return;
  }
  setStatus("正在打包图片");
  try {
    const response = await fetch("/api/images/download-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, imageSetId: state.imageSet?.id || "" }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.details || data.error || "打包下载失败");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = state.imageSet?.folderName
      ? `product-images-${state.imageSet.folderName}.zip`
      : "product-images.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("图片已打包下载");
  } catch (error) {
    setStatus(error.message);
  }
}

async function clearState() {
  const ok = window.confirm("清空页面上的提示词和图片记录吗？本地已生成图片文件不会删除。");
  if (!ok) {
    return;
  }
  const imageSpec = collectImageSpec();
  sessionStorage.removeItem(STORAGE_KEY);
  state = {
    productSetMode: normalizeProductSetMode(state.productSetMode),
    imageSet: null,
    prompts: { ...DEFAULT_PROMPTS },
    imageSpec,
    images: {},
    loading: {},
  };
  for (const type of TYPES) {
    setMessage(type, "");
  }
  render();
  setStatus("正在分配新的套图文件夹");
  try {
    const imageSet = await ensureImageSet(true);
    setStatus(`已清空页面，当前输出文件夹：${imageSet.folderName}`);
  } catch (error) {
    setStatus(error.message);
  }
  render();
}

async function resetGeneratedCache() {
  const ok = window.confirm("这会删除所有已生成图片文件，并让新套图编号从 001 开始。继续吗？");
  if (!ok) {
    return;
  }

  const productSetMode = normalizeProductSetMode(state.productSetMode);
  const imageSpec = collectImageSpec();
  const resetButton = qs("#resetGeneratedCache");
  resetButton.disabled = true;
  setStatus("正在重置生成缓存");
  try {
    const data = await apiPost("/api/image-sets/reset", {});
    sessionStorage.removeItem(STORAGE_KEY);
    state = {
      productSetMode,
      imageSet: data.imageSet,
      prompts: { ...DEFAULT_PROMPTS },
      imageSpec,
      images: {},
      loading: {},
    };
    for (const type of TYPES) {
      setMessage(type, "");
    }
    saveState();
    render();
    setStatus(`缓存已清理，当前输出文件夹：${data.imageSet.folderName}`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    resetButton.disabled = false;
    render();
  }
}

function bindEvents() {
  for (const type of TYPES) {
    qs(`#prompt-${type}`).addEventListener("input", (event) => {
      state.prompts[type] = event.target.value;
      saveState();
    });
  }

  qs("#productSetMode").addEventListener("change", (event) => {
    state.productSetMode = normalizeProductSetMode(event.target.value);
    saveState();
    render();
    setStatus(`已切换到${getProductSetConfig().label}`);
  });
  qs("#imageSpecMode").addEventListener("change", () => {
    collectImageSpec();
  });
  qs("#imageSpecSize").addEventListener("change", () => {
    collectImageSpec();
  });
  qs("#imageSpecSize").addEventListener("blur", () => {
    collectImageSpec();
  });

  qs("#generateMainTop").addEventListener("click", generateMain);
  qs("#generateAll").addEventListener("click", generateAllDerived);
  qs("#downloadAll").addEventListener("click", downloadAll);
  qs("#clearState").addEventListener("click", clearState);
  qs("#resetGeneratedCache").addEventListener("click", resetGeneratedCache);
  qs("#openNewWindow").addEventListener("click", openNewImageSetWindow);
  qs("#uploadMainButton").addEventListener("click", () => qs("#uploadMainInput").click());
  qs("#uploadMainInput").addEventListener("change", async (event) => {
    await uploadMain(event.target.files?.[0]);
    event.target.value = "";
  });

  qsa("[data-action='generate']").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.type;
      if (type === "main") {
        generateMain();
      } else {
        generateDerived(type);
      }
    });
  });

  qsa("[data-action='download']").forEach((button) => {
    button.addEventListener("click", () => downloadSingle(button.dataset.type));
  });
}

bindEvents();
render();
cleanStartupParams();
setStatus(state.imageSet?.folderName ? `准备就绪，当前输出文件夹：${state.imageSet.folderName}` : "正在分配套图文件夹");
ensureImageSet()
  .then((imageSet) => {
    setStatus(`准备就绪，当前输出文件夹：${imageSet.folderName}`);
    render();
  })
  .catch((error) => {
    setStatus(error.message);
    render();
  });
