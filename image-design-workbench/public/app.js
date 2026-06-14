const HAT_DERIVED_TYPES = ["whiteBackground", "dimensions", "detail", "worn", "scene", "sellingPoints"];
const BAG_DERIVED_TYPES = ["derived"];
const SHOULDER_BAG_FLAT_DERIVED_TYPES = ["shoulderBagStrap", "shoulderBagBody"];
const TYPES = ["main", "derived", ...HAT_DERIVED_TYPES, ...SHOULDER_BAG_FLAT_DERIVED_TYPES];
const DERIVED_TYPES = ["derived", ...HAT_DERIVED_TYPES, ...SHOULDER_BAG_FLAT_DERIVED_TYPES];
const DEFAULT_PRODUCT_SET_MODE = "hat";
const DEFAULT_ACTIVE_MODULE = "config";
const PRODUCT_WORKSPACE_MODES = ["hat", "bag", "shoulderBagFlat"];
const PRODUCT_SET_MODES = {
  hat: {
    label: "商品衍生图",
    types: ["main", ...HAT_DERIVED_TYPES],
    derivedTypes: HAT_DERIVED_TYPES,
    generateAllLabel: "生成六张衍生图",
    readyStatus: "主图已准备，可以继续生成六张衍生图",
    generatingStatus: "正在同时生成六张衍生图",
    doneStatus: "六张衍生图已生成",
    partialStatus: "部分衍生图生成失败",
  },
  bag: {
    label: "商品微调图",
    types: ["main", ...BAG_DERIVED_TYPES],
    derivedTypes: BAG_DERIVED_TYPES,
    generateAllLabel: "生成衍生图",
    readyStatus: "主图已准备，可以继续生成衍生图",
    generatingStatus: "正在生成衍生图",
    doneStatus: "衍生图已生成",
    partialStatus: "衍生图生成失败",
  },
  shoulderBagFlat: {
    label: "3D转平面",
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
const MODULES = {
  config: {
    kicker: "配置",
    title: "配置中心",
    subtitle: "保存 API Key 后解锁套图生成与提示词提取。",
    requiresApiConfig: false,
  },
  hat: {
    kicker: "套图工作流",
    title: "商品衍生图",
    subtitle: "从商品主图扩展白底、尺寸、细节、穿戴、场景和卖点等详情图。",
    productSetMode: "hat",
    requiresApiConfig: true,
  },
  bag: {
    kicker: "套图工作流",
    title: "商品微调图",
    subtitle: "基于商品主图做局部调整、风格延展或展示方式微调，保留主体一致性。",
    productSetMode: "bag",
    requiresApiConfig: true,
  },
  shoulderBagFlat: {
    kicker: "套图工作流",
    title: "3D转平面",
    subtitle: "上传 3D 商品图后生成适合电商详情页使用的平面结构部位图。",
    productSetMode: "shoulderBagFlat",
    requiresApiConfig: true,
  },
  promptExtractor: {
    kicker: "工具",
    title: "提示词提取",
    subtitle: "上传参考图，生成可复用的详细中文生图提示词。",
    requiresApiConfig: true,
  },
  playground: {
    kicker: "工具",
    title: "自由生图",
    subtitle: "融合通用生图能力，用于临时创意、参考图编辑和多张候选探索。",
    requiresApiConfig: true,
  },
  fullPlayground: {
    kicker: "完整工具",
    title: "绘图聚集地",
    subtitle: "完整图像创作工作区，保留图库、参数、参考图、遮罩和 Agent 工作流。",
    requiresApiConfig: false,
  },
};
const STORAGE_KEY = "imageDesignWorkbench.session.v5";
const IMAGE_SIZE_PRESETS = {
  "1k": 1024,
  "2k": 2048,
  "4k": 4096,
};
const IMAGE_RATIO_PRESETS = {
  "1:1": [1, 1],
  "3:2": [3, 2],
  "2:3": [2, 3],
  "16:9": [16, 9],
  "9:16": [9, 16],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "21:9": [21, 9],
};
const DEFAULT_IMAGE_SPEC = {
  sizeMode: "preset",
  sizePreset: "1k",
  customSize: 1024,
  ratioPreset: "1:1",
  customRatioWidth: 1,
  customRatioHeight: 1,
};
const DEFAULT_IMAGE_API_CONFIG = {
  uploaded: false,
  hasApiKey: false,
  uploadedAt: "",
};
const DEFAULT_PROMPT_EXTRACT_MODEL = "gpt-4o-mini";
const DEFAULT_PROMPT_API_CONFIG = {
  uploaded: false,
  apiBase: "",
  model: DEFAULT_PROMPT_EXTRACT_MODEL,
  hasApiKey: false,
  uploadedAt: "",
};
const DEFAULT_CONFIG_SCOPE = "all";
const CONFIG_SCOPES = new Set(["all", "image", "prompt"]);
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
    "基于主图生成一张商品微调图。保留商品主体、颜色、材质和图案细节，按照我的要求调整场景、角度或展示方式，画面干净高级，适合电商详情页。",
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
    "基于上传的 3D 商品图生成平面肩带部位图。保留商品颜色、材质、印花和五金细节，突出肩带连接、调节扣、走线和受力结构，画面干净，适合电商详情页。",
  shoulderBagBody:
    "基于上传的 3D 商品图生成平面包身部位图。保留包型、颜色、材质和印花细节，突出包身轮廓、开合结构、边缘工艺和容量区域，画面干净，适合电商详情页。",
};

const {
  createProductWorkspaces,
  getProductWorkspace,
} = globalThis.ProductWorkspaces || {};

let state = loadState();
let imageSetRequests = {};
let promptExtractionFile = null;
let promptExtractionPreviewUrl = "";
let promptExtractionLoading = false;
let playgroundLoading = false;

function normalizeImageSpec(rawSpec = {}) {
  const legacyMode = rawSpec.mode === "fixed" ? "fixed" : rawSpec.mode === "square" ? "square" : "";
  const legacySize = Number(rawSpec.size);
  const requestedSizeMode =
    rawSpec.sizeMode === "custom" || (legacyMode === "fixed" && !Object.values(IMAGE_SIZE_PRESETS).includes(legacySize))
      ? "custom"
      : "preset";
  const requestedSizePreset =
    typeof rawSpec.sizePreset === "string" && Object.hasOwn(IMAGE_SIZE_PRESETS, rawSpec.sizePreset)
      ? rawSpec.sizePreset
      : Object.entries(IMAGE_SIZE_PRESETS).find(([, value]) => value === legacySize)?.[0] || DEFAULT_IMAGE_SPEC.sizePreset;
  const customSize = Number.isInteger(Number(rawSpec.customSize))
    ? Math.min(Math.max(Number(rawSpec.customSize), MIN_IMAGE_SPEC_SIZE), MAX_IMAGE_SPEC_SIZE)
    : Number.isInteger(legacySize)
      ? Math.min(Math.max(legacySize, MIN_IMAGE_SPEC_SIZE), MAX_IMAGE_SPEC_SIZE)
      : DEFAULT_IMAGE_SPEC.customSize;
  const size = requestedSizeMode === "custom" ? customSize : IMAGE_SIZE_PRESETS[requestedSizePreset];

  const rawRatioPreset =
    typeof rawSpec.ratioPreset === "string" && (Object.hasOwn(IMAGE_RATIO_PRESETS, rawSpec.ratioPreset) || rawSpec.ratioPreset === "custom")
      ? rawSpec.ratioPreset
      : "";
  const legacyRatio = typeof rawSpec.ratio === "string" ? rawSpec.ratio.trim() : "";
  const requestedRatioPreset =
    rawRatioPreset ||
    (Object.hasOwn(IMAGE_RATIO_PRESETS, legacyRatio) ? legacyRatio : "") ||
    (legacyMode ? "1:1" : DEFAULT_IMAGE_SPEC.ratioPreset);

  const ratioWidthInput = Number(rawSpec.customRatioWidth);
  const ratioHeightInput = Number(rawSpec.customRatioHeight);
  const legacyRatioParts = legacyRatio.split(":").map((value) => Number(value));
  const customRatioWidth = Number.isInteger(ratioWidthInput) && ratioWidthInput > 0
    ? Math.min(ratioWidthInput, 99)
    : Number.isInteger(legacyRatioParts[0]) && legacyRatioParts[0] > 0
      ? Math.min(legacyRatioParts[0], 99)
      : DEFAULT_IMAGE_SPEC.customRatioWidth;
  const customRatioHeight = Number.isInteger(ratioHeightInput) && ratioHeightInput > 0
    ? Math.min(ratioHeightInput, 99)
    : Number.isInteger(legacyRatioParts[1]) && legacyRatioParts[1] > 0
      ? Math.min(legacyRatioParts[1], 99)
      : DEFAULT_IMAGE_SPEC.customRatioHeight;

  const [ratioWidth, ratioHeight] = requestedRatioPreset === "custom"
    ? [customRatioWidth, customRatioHeight]
    : IMAGE_RATIO_PRESETS[requestedRatioPreset || DEFAULT_IMAGE_SPEC.ratioPreset] || IMAGE_RATIO_PRESETS[DEFAULT_IMAGE_SPEC.ratioPreset];

  let width = size;
  let height = size;
  if (ratioWidth > ratioHeight) {
    height = Math.max(1, Math.round((size * ratioHeight) / ratioWidth));
  } else if (ratioHeight > ratioWidth) {
    width = Math.max(1, Math.round((size * ratioWidth) / ratioHeight));
  }

  const ratio = `${ratioWidth}:${ratioHeight}`;
  return {
    sizeMode: requestedSizeMode,
    sizePreset: requestedSizePreset,
    customSize,
    ratioPreset: requestedRatioPreset || DEFAULT_IMAGE_SPEC.ratioPreset,
    customRatioWidth,
    customRatioHeight,
    size,
    width,
    height,
    requestSize: `${width}x${height}`,
    ratio,
  };
}

function normalizeProductSetMode(value) {
  return PRODUCT_SET_MODES[value] ? value : DEFAULT_PRODUCT_SET_MODE;
}

function normalizeActiveModule(value) {
  return MODULES[value] ? value : DEFAULT_ACTIVE_MODULE;
}

function normalizeConfigScope(value) {
  return CONFIG_SCOPES.has(value) ? value : DEFAULT_CONFIG_SCOPE;
}

function getProductModule(mode) {
  const normalized = normalizeProductSetMode(mode);
  return MODULES[normalized] ? normalized : DEFAULT_PRODUCT_SET_MODE;
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

function readActiveModuleParam() {
  const raw = new URLSearchParams(window.location.search).get("module");
  return raw ? normalizeActiveModule(raw) : "";
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
    !url.searchParams.has("productSetMode") &&
    !url.searchParams.has("module")
  ) {
    return;
  }
  url.searchParams.delete("newSet");
  url.searchParams.delete("prompts");
  url.searchParams.delete("imageSpec");
  url.searchParams.delete("productSetMode");
  url.searchParams.delete("module");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function attachActiveWorkspaceRefs(nextState) {
  if (!createProductWorkspaces || !getProductWorkspace) {
    throw new Error("Product workspace helpers are unavailable");
  }
  nextState.productWorkspaces = createProductWorkspaces({
    modes: PRODUCT_WORKSPACE_MODES,
    defaultPrompts: DEFAULT_PROMPTS,
    savedWorkspaces: nextState.productWorkspaces,
    activeMode: normalizeProductSetMode(nextState.productSetMode),
    legacyWorkspace: {
      imageSet: nextState.imageSet,
      prompts: nextState.prompts,
      images: nextState.images,
    },
    forceNew: false,
  });
  const workspace = getProductWorkspace(
    nextState.productWorkspaces,
    normalizeProductSetMode(nextState.productSetMode),
    PRODUCT_WORKSPACE_MODES,
    DEFAULT_PROMPTS,
  );
  nextState.imageSet = workspace.imageSet;
  nextState.prompts = workspace.prompts;
  nextState.images = workspace.images;
  nextState.loading = workspace.loading;
  nextState.messages = workspace.messages;
  return nextState;
}

function syncActiveProductWorkspace() {
  attachActiveWorkspaceRefs(state);
  return getProductWorkspace(
    state.productWorkspaces,
    normalizeProductSetMode(state.productSetMode),
    PRODUCT_WORKSPACE_MODES,
    DEFAULT_PROMPTS,
  );
}

function setWorkspaceImageSet(mode, imageSet) {
  const workspace = getProductWorkspace(
    state.productWorkspaces,
    normalizeProductSetMode(mode),
    PRODUCT_WORKSPACE_MODES,
    DEFAULT_PROMPTS,
  );
  workspace.imageSet = imageSet || null;
  if (normalizeProductSetMode(state.productSetMode) === normalizeProductSetMode(mode)) {
    state.imageSet = workspace.imageSet;
  }
  return workspace.imageSet;
}

function setWorkspaceImage(mode, type, image) {
  const workspace = getProductWorkspace(
    state.productWorkspaces,
    normalizeProductSetMode(mode),
    PRODUCT_WORKSPACE_MODES,
    DEFAULT_PROMPTS,
  );
  if (image) {
    workspace.images[type] = image;
  } else {
    delete workspace.images[type];
  }
  if (normalizeProductSetMode(state.productSetMode) === normalizeProductSetMode(mode)) {
    state.images = workspace.images;
  }
}

function setWorkspaceMessage(mode, type, message, kind = "") {
  const workspace = getProductWorkspace(
    state.productWorkspaces,
    normalizeProductSetMode(mode),
    PRODUCT_WORKSPACE_MODES,
    DEFAULT_PROMPTS,
  );
  workspace.messages[type] = { text: message || "", kind: kind || "" };
  if (normalizeProductSetMode(state.productSetMode) === normalizeProductSetMode(mode)) {
    const el = qs(`[data-message="${type}"]`);
    el.textContent = message || "";
    el.classList.toggle("error", kind === "error");
    el.classList.toggle("success", kind === "success");
  }
}

function setWorkspaceLoading(mode, type, value) {
  const workspace = getProductWorkspace(
    state.productWorkspaces,
    normalizeProductSetMode(mode),
    PRODUCT_WORKSPACE_MODES,
    DEFAULT_PROMPTS,
  );
  workspace.loading[type] = Boolean(value);
  if (normalizeProductSetMode(state.productSetMode) !== normalizeProductSetMode(mode)) {
    return;
  }
  state.loading = workspace.loading;
  const card = qs(`[data-type="${type}"]`);
  const preview = qs(`[data-preview="${type}"]`);
  card.classList.toggle("loading", value);
  card.setAttribute("aria-busy", value ? "true" : "false");
  if (value) {
    preview.innerHTML = qs("#spinnerTemplate").innerHTML.replace("生成中", `${TYPE_LABELS[type]}生成中`);
  }
  updateControls();
}

function setActiveWorkspaceImageSet(imageSet) {
  return setWorkspaceImageSet(state.productSetMode, imageSet);
}

function resetActiveProductWorkspace(imageSet = null) {
  const workspace = syncActiveProductWorkspace();
  workspace.imageSet = imageSet;
  workspace.prompts = { ...DEFAULT_PROMPTS };
  workspace.images = {};
  workspace.loading = {};
  workspace.messages = {};
  state.imageSet = workspace.imageSet;
  state.prompts = workspace.prompts;
  state.images = workspace.images;
  state.loading = workspace.loading;
  state.messages = workspace.messages;
}

function resetAllProductWorkspaces(imageSet = null) {
  for (const mode of PRODUCT_WORKSPACE_MODES) {
    state.productWorkspaces[mode] = {
      imageSet: mode === normalizeProductSetMode(state.productSetMode) ? imageSet : null,
      prompts: { ...DEFAULT_PROMPTS },
      images: {},
      loading: {},
      messages: {},
    };
  }
  syncActiveProductWorkspace();
}

function loadState() {
  const promptParams = readPromptParams();
  const imageSpecParams = readImageSpecParams();
  const productSetModeParam = readProductSetModeParam();
  const activeModuleParam = readActiveModuleParam();
  const forceNewSet = shouldStartNewSet();

  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
    const productSetMode = normalizeProductSetMode(
      productSetModeParam || (forceNewSet ? DEFAULT_PRODUCT_SET_MODE : saved.productSetMode),
    );
    return attachActiveWorkspaceRefs({
      activeModule: normalizeActiveModule(
        activeModuleParam ||
          (productSetModeParam ? getProductModule(productSetModeParam) : "") ||
          (forceNewSet ? getProductModule(productSetMode) : saved.activeModule),
      ),
      configScope: normalizeConfigScope(forceNewSet ? DEFAULT_CONFIG_SCOPE : saved.configScope),
      productSetMode,
      productWorkspaces: createProductWorkspaces({
        modes: PRODUCT_WORKSPACE_MODES,
        defaultPrompts: DEFAULT_PROMPTS,
        savedWorkspaces: forceNewSet ? {} : saved.productWorkspaces,
        activeMode: productSetMode,
        legacyWorkspace: forceNewSet
          ? null
          : {
              imageSet: saved.imageSet || null,
              prompts: saved.prompts || {},
              images: saved.images || {},
            },
        forceNew: forceNewSet,
        promptOverrides: promptParams,
      }),
      imageSpec: normalizeImageSpec({ ...DEFAULT_IMAGE_SPEC, ...(forceNewSet ? {} : saved.imageSpec || {}), ...imageSpecParams }),
      playground: {
        mode: saved.playground?.mode === "edit" ? "edit" : "generate",
        prompt: typeof saved.playground?.prompt === "string" ? saved.playground.prompt : "",
        count: normalizePlaygroundCount(saved.playground?.count),
        background: typeof saved.playground?.background === "string" ? saved.playground.background : "",
        system: typeof saved.playground?.system === "string" ? saved.playground.system : "",
        referenceImageId: typeof saved.playground?.referenceImageId === "string" ? saved.playground.referenceImageId : "",
        results: Array.isArray(saved.playground?.results) ? saved.playground.results : [],
        imageSet: saved.playground?.imageSet || null,
      },
      imageApiConfig: { ...DEFAULT_IMAGE_API_CONFIG },
      promptApiConfig: { ...DEFAULT_PROMPT_API_CONFIG },
      loading: {},
      sidebarCollapsed: Boolean(saved.sidebarCollapsed),
    });
  } catch {
    const productSetMode = normalizeProductSetMode(productSetModeParam);
    return attachActiveWorkspaceRefs({
      activeModule: normalizeActiveModule(activeModuleParam || (productSetModeParam ? getProductModule(productSetMode) : "")),
      configScope: DEFAULT_CONFIG_SCOPE,
      productSetMode,
      productWorkspaces: createProductWorkspaces({
        modes: PRODUCT_WORKSPACE_MODES,
        defaultPrompts: DEFAULT_PROMPTS,
        savedWorkspaces: {},
        activeMode: productSetMode,
        legacyWorkspace: null,
        forceNew: false,
        promptOverrides: promptParams,
      }),
      imageSpec: normalizeImageSpec({ ...DEFAULT_IMAGE_SPEC, ...imageSpecParams }),
      playground: getDefaultPlaygroundState(),
      imageApiConfig: { ...DEFAULT_IMAGE_API_CONFIG },
      promptApiConfig: { ...DEFAULT_PROMPT_API_CONFIG },
      loading: {},
      sidebarCollapsed: false,
    });
  }
}

function saveState() {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      activeModule: state.activeModule,
      configScope: state.configScope,
      productSetMode: state.productSetMode,
      productWorkspaces: state.productWorkspaces,
      imageSpec: state.imageSpec,
      playground: state.playground,
      sidebarCollapsed: Boolean(state.sidebarCollapsed),
    }),
  );
}

function shouldUseCollapsibleSidebar() {
  return window.matchMedia("(min-width: 1121px)").matches;
}

function updateSidebarView() {
  const appShell = qs(".app-shell");
  const toggle = qs("#toggleSidebar");
  const collapsed = Boolean(state.sidebarCollapsed && shouldUseCollapsibleSidebar());
  appShell.dataset.sidebar = collapsed ? "collapsed" : "expanded";
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  toggle.setAttribute("aria-label", collapsed ? "展开菜单" : "收起菜单");
  toggle.title = collapsed ? "展开菜单" : "收起菜单";
}

function setSidebarCollapsed(collapsed, persist = true) {
  state.sidebarCollapsed = Boolean(collapsed);
  if (persist) {
    saveState();
  }
  updateSidebarView();
}

function autoCollapseSidebar() {
  if (shouldUseCollapsibleSidebar()) {
    setSidebarCollapsed(true);
  }
}

function getDefaultPlaygroundState() {
  return {
    mode: "generate",
    prompt: "",
    count: 1,
    background: "",
    system: "",
    referenceImageId: "",
    results: [],
    imageSet: null,
  };
}

function normalizePlaygroundCount(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return 1;
  }
  return Math.min(Math.max(parsed, 1), 4);
}

function updateImageSetView() {
  const el = qs("#imageSetName");
  if (el) {
    el.textContent = state.imageSet?.folderName || "--";
  }
}

function updateProductSetModeControl() {
  const board = qs("#imageBoard");
  if (board) {
    const productSetMode = normalizeProductSetMode(state.productSetMode);
    board.dataset.productSet = productSetMode;
    board.classList.toggle("bag-workbench", productSetMode === "bag");
  }
}

function updateSetupChecklist() {
  const imageItem = qs('[data-check-item="image"]');
  const promptItem = qs('[data-check-item="prompt"]');
  if (imageItem) {
    imageItem.classList.toggle("complete", Boolean(state.imageApiConfig?.uploaded));
  }
  if (promptItem) {
    promptItem.classList.toggle("complete", Boolean(state.promptApiConfig?.uploaded));
  }
}

function isProductModule(moduleName = state.activeModule) {
  return Boolean(MODULES[moduleName]?.productSetMode);
}

function moduleHasRequiredConfig(moduleName) {
  if (isProductModule(moduleName)) {
    return Boolean(state.imageApiConfig?.uploaded);
  }
  if (moduleName === "promptExtractor") {
    return Boolean(state.promptApiConfig?.uploaded);
  }
  if (moduleName === "playground") {
    return Boolean(state.imageApiConfig?.uploaded);
  }
  return true;
}

function getConfigScopeForModule(moduleName) {
  if (isProductModule(moduleName)) {
    return "image";
  }
  if (moduleName === "promptExtractor") {
    return "prompt";
  }
  return "all";
}

function updateConfigCenterView() {
  const scope = normalizeConfigScope(state.configScope);
  const title = qs("#settingsTitle");
  const description = qs("#settingsDescription");
  const facts = qs("#settingsFacts");

  const copy = {
    all: {
      title: "连接你的生产服务",
      description: "生图和提示词提取使用两套独立 API 配置。提示词提取需要具备视觉理解能力的 GPT 通道，不影响画图接口。",
      facts: ["生图 URL 服务端固定", "提示词 API 单独配置", "Key 不写入浏览器存储"],
    },
    image: {
      title: "配置画图能力",
      description: "这里只配置套图生成使用的生图 API Key。提示词提取使用另一套 GPT 配置，不会在这里出现。",
      facts: ["只影响套图生成", "生图 URL 服务端固定", "不影响提示词提取"],
    },
    prompt: {
      title: "配置提示词提取能力",
      description: "这里只配置图片理解/GPT 能力使用的 API URL 和 API Key，不展示也不修改画图 API 配置。",
      facts: ["只影响提示词提取", "需要视觉理解模型", "不影响画图接口"],
    },
  }[scope];

  title.textContent = copy.title;
  description.textContent = copy.description;
  facts.innerHTML = copy.facts.map((fact) => `<span>${fact}</span>`).join("");
  qsa("[data-config-scope]").forEach((section) => {
    section.hidden = scope !== "all" && section.dataset.configScope !== scope;
  });
}

function updateWorkspaceView() {
  const activeModule = normalizeActiveModule(state.activeModule);
  const moduleConfig = MODULES[activeModule];
  const isProduct = isProductModule(activeModule);
  const isPromptExtractor = activeModule === "promptExtractor";
  const isPlayground = activeModule === "playground";
  const isFullPlayground = activeModule === "fullPlayground";
  const showsImageSpec = isProduct || isPlayground;
  const showsTopbarActions = activeModule !== "config" && !isFullPlayground;
  const topbar = qs(".topbar");
  const topbarActions = qs(".topbar-actions");
  const topbarSettings = qs(".topbar-settings");
  const topbarPrimaryActions = qs(".topbar-primary-actions");
  const configPanel = qs("#configCenterPanel");
  const promptPanel = qs("#promptExtractorPanel");
  const playgroundPanel = qs("#playgroundPanel");
  const fullPlaygroundPanel = qs("#fullPlaygroundPanel");
  const board = qs("#imageBoard");
  const productToolbar = qs("#productToolbar");
  const title = qs("#workspaceTitle");
  const kicker = qs("#workspaceKicker");
  const subtitle = qs("#workspaceSubtitle");
  const specControl = qs("#imageSpecControl");
  const imageSetControl = qs("#imageSetControl");
  const openNewWindow = qs("#openNewWindow");
  const generateAll = qs("#generateAll");
  const downloadAll = qs("#downloadAll");
  const moreActions = qs("#topbarMoreActions");
  const appShell = qs(".app-shell");

  title.textContent = moduleConfig.title;
  kicker.textContent = moduleConfig.kicker;
  subtitle.textContent = moduleConfig.subtitle || "";
  if (appShell) {
    appShell.dataset.module = activeModule;
  }
  if (topbar) {
    topbar.hidden = isFullPlayground;
  }
  if (topbarActions) {
    topbarActions.hidden = !showsTopbarActions;
  }
  if (topbarSettings) {
    topbarSettings.hidden = !showsImageSpec && !isProduct;
  }
  if (topbarPrimaryActions) {
    topbarPrimaryActions.hidden = !isProduct;
  }
  configPanel.hidden = activeModule !== "config";
  if (activeModule === "config") {
    updateConfigCenterView();
  }
  promptPanel.hidden = !isPromptExtractor;
  playgroundPanel.hidden = !isPlayground;
  fullPlaygroundPanel.hidden = !isFullPlayground;
  if (productToolbar) {
    productToolbar.hidden = !isProduct;
  }
  board.hidden = !isProduct;
  specControl.hidden = !isProduct;
  imageSetControl.hidden = !isProduct;
  openNewWindow.hidden = !isProduct;
  generateAll.hidden = !isProduct;
  downloadAll.hidden = !isProduct;
  if (moreActions) {
    moreActions.hidden = !showsTopbarActions;
    if (!isProduct) {
      openNewWindow.hidden = true;
      downloadAll.hidden = true;
    }
    if (!showsTopbarActions) {
      moreActions.open = false;
    }
  }

  qsa("[data-module]").forEach((item) => {
    const moduleName = item.dataset.module;
    const locked = MODULES[moduleName]?.requiresApiConfig && !moduleHasRequiredConfig(moduleName);
    item.classList.toggle("active", moduleName === activeModule);
    item.classList.toggle("locked", Boolean(locked));
    item.setAttribute("aria-current", moduleName === activeModule ? "page" : "false");
  });
}

function getFullPlaygroundFrame() {
  return qs("#fullPlaygroundPanel iframe");
}

function notifyFullPlaygroundConfigChanged() {
  const frame = getFullPlaygroundFrame();
  if (!frame?.contentWindow) {
    return;
  }
  frame.contentWindow.postMessage({ type: "image-workbench:config-changed" }, window.location.origin);
}

function switchActiveModule(moduleName) {
  const normalized = normalizeActiveModule(moduleName);
  const moduleConfig = MODULES[normalized];
  if (moduleConfig.requiresApiConfig && !moduleHasRequiredConfig(normalized)) {
    state.activeModule = "config";
    state.configScope = getConfigScopeForModule(normalized);
    saveState();
    render();
    setStatus(normalized === "promptExtractor" ? "请先在配置中心保存提示词 API 配置" : "请先在配置中心保存生图 API Key");
    requestAnimationFrame(() => {
      const focusTarget = state.configScope === "prompt" ? "#promptApiUrlInput" : "#apiKeyInput";
      qs(focusTarget)?.focus();
    });
    return;
  }
  state.activeModule = normalized;
  if (normalized === "config") {
    state.configScope = "all";
  }
  if (moduleConfig.productSetMode) {
    state.productSetMode = moduleConfig.productSetMode;
    syncActiveProductWorkspace();
  }
  saveState();
  render();
  requestAnimationFrame(() => {
    qs("#mainContent")?.focus({ preventScroll: true });
  });
  setStatus(moduleConfig.title);
}

function updateImageSpecControls() {
  const spec = normalizeImageSpec(state.imageSpec);
  qsa("[data-image-size-preset]").forEach((button) => {
    button.classList.toggle("active", spec.sizeMode === "preset" && button.dataset.imageSizePreset === spec.sizePreset);
    button.setAttribute("aria-pressed", button.classList.contains("active") ? "true" : "false");
  });
  qsa("[data-image-ratio-preset]").forEach((button) => {
    button.classList.toggle("active", spec.ratioPreset !== "custom" && button.dataset.imageRatioPreset === spec.ratioPreset);
    button.setAttribute("aria-pressed", button.classList.contains("active") ? "true" : "false");
  });
  const customSizeButton = qs("#imageSpecCustomSizeButton");
  const customRatioButton = qs("#imageSpecCustomRatioButton");
  const customSizeWrap = qs("#imageSpecCustomSizeWrap");
  const customRatioWrap = qs("#imageSpecCustomRatioWrap");
  const customSize = qs("#imageSpecCustomSize");
  const customRatioWidth = qs("#imageSpecCustomRatioWidth");
  const customRatioHeight = qs("#imageSpecCustomRatioHeight");

  customSizeButton?.classList.toggle("active", spec.sizeMode === "custom");
  customSizeButton?.setAttribute("aria-pressed", spec.sizeMode === "custom" ? "true" : "false");
  customRatioButton?.classList.toggle("active", spec.ratioPreset === "custom");
  customRatioButton?.setAttribute("aria-pressed", spec.ratioPreset === "custom" ? "true" : "false");
  if (customSizeWrap) {
    customSizeWrap.hidden = spec.sizeMode !== "custom";
  }
  if (customRatioWrap) {
    customRatioWrap.hidden = spec.ratioPreset !== "custom";
  }
  if (customSize) {
    customSize.value = String(spec.customSize);
  }
  if (customRatioWidth) {
    customRatioWidth.value = String(spec.customRatioWidth);
  }
  if (customRatioHeight) {
    customRatioHeight.value = String(spec.customRatioHeight);
  }
}

function updateApiConfigView() {
  const config = state.imageApiConfig || DEFAULT_IMAGE_API_CONFIG;
  const status = qs("#apiConfigStatus");
  const imageInlineStatus = qs("#imageApiInlineStatus");
  const promptInlineStatus = qs("#promptApiInlineStatus");
  const promptConfig = state.promptApiConfig || DEFAULT_PROMPT_API_CONFIG;

  if (status) {
    const allConfigured = Boolean(config.uploaded && promptConfig.uploaded);
    const partialConfigured = Boolean(config.uploaded || promptConfig.uploaded);
    status.className = allConfigured ? "badge ready" : partialConfigured ? "badge stale" : "badge";
    status.textContent = allConfigured ? "已配置" : partialConfigured ? "部分配置" : "未配置";
  }

  if (imageInlineStatus) {
    imageInlineStatus.className = config.uploaded ? "badge ready" : "badge";
    imageInlineStatus.textContent = config.uploaded ? "已配置" : "未配置";
  }

  if (promptInlineStatus) {
    promptInlineStatus.className = promptConfig.uploaded ? "badge ready" : "badge";
    promptInlineStatus.textContent = promptConfig.uploaded ? "已配置" : "未配置";
  }

  updateSetupChecklist();
}

function setApiConfigMessage(message, kind = "") {
  const el = qs("#apiConfigMessage");
  if (!el) {
    return;
  }
  el.textContent = message || "";
  el.classList.toggle("error", kind === "error");
  el.classList.toggle("success", kind === "success");
}

function setPromptApiConfigMessage(message, kind = "") {
  const el = qs("#promptApiConfigMessage");
  if (!el) {
    return;
  }
  el.textContent = message || "";
  el.classList.toggle("error", kind === "error");
  el.classList.toggle("success", kind === "success");
}

function openApiConfigDialog() {
  state.activeModule = "config";
  state.configScope = "all";
  saveState();
  render();
  setApiConfigMessage("");
  requestAnimationFrame(() => {
    qs("#apiKeyInput").focus();
  });
}

function closeApiConfigDialog() {
  setApiConfigMessage("");
  qs("#apiKeyInput").value = "";
}

function openPromptExtractorDialog() {
  switchActiveModule("promptExtractor");
  setPromptExtractorMessage("");
  renderPromptExtractor();
}

function closePromptExtractorDialog() {
  setPromptExtractorMessage("");
}

function setPlaygroundMessage(message, kind = "") {
  const el = qs("#playgroundMessage");
  if (!el) {
    return;
  }
  el.textContent = message || "";
  el.classList.toggle("error", kind === "error");
  el.classList.toggle("success", kind === "success");
}

function getReferenceImageOptions() {
  return TYPES.map((type) => state.images[type]).filter(Boolean);
}

function getPlaygroundReferenceImage() {
  return getReferenceImageOptions().find((image) => image.id === state.playground.referenceImageId) || null;
}

function renderPlaygroundReference() {
  const wrap = qs("#playgroundReferenceWrap");
  const preview = qs("#playgroundReferencePreview");
  const meta = qs("#playgroundReferenceMeta");
  const select = qs("#playgroundReferenceSelect");
  const options = getReferenceImageOptions();
  const referenceImage = getPlaygroundReferenceImage();
  wrap.hidden = state.playground.mode !== "edit";
  if (wrap.hidden) {
    return;
  }
  select.innerHTML = options.length
    ? options
        .map((image) => `<option value="${image.id}">${image.label || image.type} · ${image.filename || image.id}</option>`)
        .join("")
    : `<option value="">暂无可选图片</option>`;
  select.value = referenceImage?.id || "";
  if (referenceImage) {
    preview.innerHTML = "";
    const img = document.createElement("img");
    img.src = `${referenceImage.url}?t=${encodeURIComponent(referenceImage.createdAt || "")}`;
    img.alt = "自由生图参考图";
    preview.appendChild(img);
    meta.textContent = `${referenceImage.label || "参考图"} · ${referenceImage.filename || referenceImage.id}`;
    return;
  }
  preview.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon" data-icon="image"></span>
      <span>选择参考图</span>
    </div>
  `;
  meta.textContent = options.length
    ? "点击下方套图结果可设为参考图"
    : "当前还没有可用参考图，先在套图工作流生成或上传主图";
}

function renderPlaygroundResults() {
  const results = qs("#playgroundResults");
  const images = Array.isArray(state.playground.results) ? state.playground.results : [];
  if (playgroundLoading) {
    results.innerHTML = qs("#spinnerTemplate").innerHTML;
    return;
  }
  if (!images.length) {
    results.innerHTML = `
      <div class="empty-state wide">
        <span class="empty-icon" data-icon="image"></span>
        <span>等待生成</span>
      </div>
    `;
    return;
  }
  results.innerHTML = "";
  images.forEach((image, index) => {
    const item = document.createElement("article");
    item.className = "playground-result";
    item.innerHTML = `
      <div class="preview">
        <img src="${image.url}?t=${encodeURIComponent(image.createdAt || "")}" alt="自由生图结果 ${index + 1}" loading="lazy" />
      </div>
      <div class="playground-result-actions">
        <span class="badge ready">结果 ${index + 1}</span>
        <button class="icon-button" type="button" title="下载图片" aria-label="下载图片">
          <span class="icon" data-icon="download"></span>
        </button>
      </div>
    `;
    item.querySelector("img").addEventListener("click", () => window.open(image.url, "_blank", "noopener"));
    item.querySelector("button").addEventListener("click", () => {
      window.location.href = image.downloadUrl;
    });
    results.appendChild(item);
  });
}

function renderPlayground() {
  const playground = state.playground || getDefaultPlaygroundState();
  state.playground = playground;
  qs("#playgroundPrompt").value = playground.prompt || "";
  qs("#playgroundCount").value = String(normalizePlaygroundCount(playground.count));
  qs("#playgroundBackground").value = playground.background || "";
  qs("#playgroundSystem").value = playground.system || "";
  qs("#playgroundModeBadge").textContent = playground.mode === "edit" ? "参考图编辑" : "文生图";
  qsa("[data-playground-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.playgroundMode === playground.mode);
  });
  renderPlaygroundReference();
  renderPlaygroundResults();
}

function clearPromptExtractionPreviewUrl() {
  if (promptExtractionPreviewUrl) {
    URL.revokeObjectURL(promptExtractionPreviewUrl);
    promptExtractionPreviewUrl = "";
  }
}

function setPromptExtractorMessage(message, kind = "") {
  const el = qs("#promptExtractorMessage");
  if (!el) {
    return;
  }
  el.textContent = message || "";
  el.classList.toggle("error", kind === "error");
  el.classList.toggle("success", kind === "success");
}

function renderPromptExtractor() {
  const preview = qs("#promptUploadPreview");
  const meta = qs("#promptImageMeta");
  const output = qs("#extractedPrompt");
  const extractButton = qs("#extractPromptButton");
  const copyButton = qs("#copyExtractedPrompt");
  const hasFile = Boolean(promptExtractionFile);
  const hasPrompt = Boolean(output?.value.trim());
  const hasApiConfig = Boolean(state.promptApiConfig?.uploaded);

  if (preview) {
    if (promptExtractionLoading) {
      preview.innerHTML = qs("#spinnerTemplate").innerHTML.replace("生成中", "提取中");
    } else if (promptExtractionPreviewUrl) {
      preview.innerHTML = "";
      const img = document.createElement("img");
      img.src = promptExtractionPreviewUrl;
      img.alt = "待提取提示词的图片";
      preview.appendChild(img);
    } else {
      preview.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon" data-icon="image"></span>
          <span>上传图片</span>
        </div>
      `;
    }
  }

  if (meta) {
    meta.textContent = hasFile
      ? `${promptExtractionFile.name} · ${(promptExtractionFile.size / 1024 / 1024).toFixed(2)}MB`
      : "支持 PNG、JPG、WEBP、GIF，最大 20MB";
  }
  if (extractButton) {
    extractButton.disabled = !hasApiConfig || !hasFile || promptExtractionLoading;
    extractButton.innerHTML = promptExtractionLoading
      ? `<span class="spinner compact"></span>提取中`
      : `<span class="icon" data-icon="prompt"></span>提取提示词`;
  }
  if (copyButton) {
    copyButton.disabled = !hasPrompt || promptExtractionLoading;
  }
}

async function ensureImageSet(forceNew = false) {
  const mode = normalizeProductSetMode(state.productSetMode);
  if (!forceNew && state.imageSet?.id) {
    return state.imageSet;
  }
  if (!forceNew && imageSetRequests[mode]) {
    return imageSetRequests[mode];
  }

  imageSetRequests[mode] = apiPost("/api/image-sets", {})
    .then((data) => {
      setWorkspaceImageSet(mode, data.imageSet);
      saveState();
      updateImageSetView();
      return data.imageSet;
    })
    .finally(() => {
      delete imageSetRequests[mode];
    });

  return imageSetRequests[mode];
}

function qs(selector, root = document) {
  return root.querySelector(selector);
}

function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

function setStatus(message) {
  const status = qs("#globalStatus");
  if (status) {
    status.textContent = message;
  }
}

function setMessage(type, message, kind = "") {
  setWorkspaceMessage(state.productSetMode, type, message, kind);
}

function setLoading(type, value) {
  setWorkspaceLoading(state.productSetMode, type, value);
}

function imageIsFresh(type) {
  if (type === "main") {
    return true;
  }
  return Boolean(state.images[type]?.sourceMainId && state.images[type].sourceMainId === state.images.main?.id);
}

function setImageAsReference(type) {
  const image = state.images[type];
  if (!image) {
    return;
  }
  state.playground = state.playground || getDefaultPlaygroundState();
  state.playground.mode = "edit";
  state.playground.referenceImageId = image.id;
  state.activeModule = "playground";
  saveState();
  render();
  setStatus(`${TYPE_LABELS[type]}已设为自由生图参考图`);
}

function getEmptyStateContent(type, isMainReady) {
  if (type !== "main" && !isMainReady) {
    return {
      icon: "lock",
      title: "需要主图",
      detail: "先生成或上传主图，再继续生产这张详情图。",
    };
  }
  if (type === "main" && getProductSetConfig().mainUploadOnly) {
    return {
      icon: "upload",
      title: "上传源图",
      detail: "3D 转平面模式需要先上传商品图作为参考。",
    };
  }
  if (type === "main") {
    return {
      icon: "image",
      title: "准备主图",
      detail: "填写提示词生成，或上传已有商品图。",
    };
  }
  return {
    icon: "image",
    title: "可生成",
    detail: "检查提示词后点击生成，结果会自动归一化为当前选定的输出比例。",
  };
}

function renderPreview(type) {
  const preview = qs(`[data-preview="${type}"]`);
  const image = state.images[type];
  const isMainReady = Boolean(state.images.main);

  preview.classList.toggle("locked", type !== "main" && !isMainReady);

  if (state.loading[type]) {
    preview.innerHTML = qs("#spinnerTemplate").innerHTML.replace("生成中", `${TYPE_LABELS[type]}生成中`);
    return;
  }

  if (image) {
    preview.innerHTML = "";
    const img = document.createElement("img");
    img.src = `${image.url}?t=${encodeURIComponent(image.createdAt || "")}`;
    img.alt = TYPE_LABELS[type];
    img.loading = "lazy";
    img.addEventListener("click", () => window.open(image.url, "_blank", "noopener"));
    img.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      setImageAsReference(type);
    });
    preview.appendChild(img);
    return;
  }

  const empty = getEmptyStateContent(type, isMainReady);
  preview.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon" data-icon="${empty.icon}"></span>
      <span class="empty-copy">
        <strong>${empty.title}</strong>
        <small>${empty.detail}</small>
      </span>
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
  const isProduct = isProductModule();
  const hasImageSet = Boolean(state.imageSet?.id);
  const hasApiConfig = Boolean(state.imageApiConfig?.uploaded);
  const hasPromptApiConfig = Boolean(state.promptApiConfig?.uploaded);
  const hasMain = Boolean(state.images.main);
  const anyLoading = Object.values(state.loading).some(Boolean) || promptExtractionLoading || playgroundLoading;
  const anyImage = activeTypes.some((type) => Boolean(state.images[type]));

  qs("#generateAll").disabled = !hasApiConfig || !hasImageSet || !hasMain || anyLoading;
  qs("#generateAll").innerHTML = `<span class="icon" data-icon="layers"></span>${config.generateAllLabel}`;
  qs("#downloadAll").disabled = !hasImageSet || !anyImage || anyLoading;
  qs("#uploadMainButton").disabled = !hasImageSet || Boolean(state.loading.main);
  qs("#uploadApiConfig").disabled = anyLoading;
  qs("#uploadPromptApiConfig").disabled = anyLoading;
  qs("#extractPromptButton").disabled = !hasPromptApiConfig || !promptExtractionFile || promptExtractionLoading;
  qs("#copyExtractedPrompt").disabled =
    promptExtractionLoading || !qs("#extractedPrompt").value.trim();
  qs("#generatePlayground").disabled = !hasApiConfig || playgroundLoading;
  qs("#generatePlayground").innerHTML = playgroundLoading
    ? `<span class="spinner compact"></span>生成中`
    : `<span class="icon" data-icon="spark"></span>生成图片`;
  qs("#downloadPlaygroundAll").disabled =
    playgroundLoading || !(Array.isArray(state.playground?.results) && state.playground.results.length);

  for (const type of TYPES) {
    const card = qs(`[data-type="${type}"]`);
    const generateButton = qs(`[data-action="generate"][data-type="${type}"]`);
    const downloadButton = qs(`[data-action="download"][data-type="${type}"]`);
    const referenceButton = qs(`[data-action="reference"][data-type="${type}"]`);
    const isActive = activeTypes.includes(type);
    const canGenerate =
      hasApiConfig &&
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
    if (referenceButton) {
      referenceButton.disabled = !isActive || !state.images[type] || anyLoading;
    }
  }

  qs("#prompt-main").closest(".prompt-field").hidden = Boolean(config.mainUploadOnly);

  updateBadges();
  renderPromptExtractor();
  renderPlayground();
}

function render() {
  updateSidebarView();
  updateImageSetView();
  updateProductSetModeControl();
  updateImageSpecControls();
  updateApiConfigView();
  updateSetupChecklist();
  updateWorkspaceView();
  for (const type of TYPES) {
    const textarea = qs(`#prompt-${type}`);
    if (textarea.value !== state.prompts[type]) {
      textarea.value = state.prompts[type];
    }
    const messageState = state.messages?.[type] || { text: "", kind: "" };
    const message = qs(`[data-message="${type}"]`);
    message.textContent = messageState.text || "";
    message.classList.toggle("error", messageState.kind === "error");
    message.classList.toggle("success", messageState.kind === "success");
    renderPreview(type);
  }
  updateControls();
}

function collectPlaygroundInput() {
  state.playground = state.playground || getDefaultPlaygroundState();
  state.playground.prompt = qs("#playgroundPrompt").value.trim();
  state.playground.count = normalizePlaygroundCount(qs("#playgroundCount").value);
  state.playground.background = qs("#playgroundBackground").value.trim();
  state.playground.system = qs("#playgroundSystem").value.trim();
  saveState();
  return state.playground;
}

async function generatePlaygroundImages() {
  if (!state.imageApiConfig?.uploaded) {
    setPlaygroundMessage("请先保存生图 API Key", "error");
    setStatus("请先保存生图 API Key");
    return;
  }
  const playground = collectPlaygroundInput();
  if (!playground.prompt) {
    setPlaygroundMessage("自由生图提示词不能为空", "error");
    qs("#playgroundPrompt").focus();
    return;
  }
  if (playground.mode === "edit" && !playground.referenceImageId) {
    setPlaygroundMessage("参考图编辑需要先选择当前套图中的一张图片", "error");
    return;
  }

  playgroundLoading = true;
  setPlaygroundMessage("");
  setStatus(playground.mode === "edit" ? "正在按参考图编辑" : "正在自由生图");
  updateControls();
  try {
    const data = await apiPost("/api/playground/images", {
      mode: playground.mode,
      prompt: playground.prompt,
      count: playground.count,
      background: playground.background,
      system: playground.system,
      referenceImageId: playground.referenceImageId,
      imageSpec: collectImageSpec(),
    });
    state.playground.results = data.images || [];
    state.playground.imageSet = data.imageSet || null;
    saveState();
    setPlaygroundMessage(`已生成 ${state.playground.results.length} 张图片`, "success");
    setStatus("自由生图已完成");
  } catch (error) {
    setPlaygroundMessage(error.message, "error");
    setStatus("自由生图失败");
  } finally {
    playgroundLoading = false;
    render();
  }
}

async function downloadPlaygroundAll() {
  const ids = (state.playground?.results || []).map((image) => image.id).filter(Boolean);
  if (!ids.length) {
    return;
  }
  setStatus("正在打包自由生图结果");
  try {
    const response = await fetch("/api/images/download-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, imageSetId: state.playground?.imageSet?.id || "" }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.details || data.error || "打包下载失败");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = state.playground?.imageSet?.folderName
      ? `playground-images-${state.playground.imageSet.folderName}.zip`
      : "playground-images.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("自由生图结果已打包下载");
  } catch (error) {
    setStatus(error.message);
  }
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

async function apiGet(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
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
    imageSpecSizeMode: spec.sizeMode,
    imageSpecSizePreset: spec.sizePreset,
    imageSpecCustomSize: String(spec.customSize),
    imageSpecRatioPreset: spec.ratioPreset,
    imageSpecCustomRatioWidth: String(spec.customRatioWidth),
    imageSpecCustomRatioHeight: String(spec.customRatioHeight),
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

async function apiExtractPrompt(file) {
  const formData = new FormData();
  formData.append("image", file);
  const response = await fetch("/api/prompts/extract", {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.details || data.error || "提示词提取失败");
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
  state.imageSpec = normalizeImageSpec(state.imageSpec);
  saveState();
  updateImageSpecControls();
  return state.imageSpec;
}

async function loadApiConfigStatus() {
  try {
    const [imageData, promptData] = await Promise.all([
      apiGet("/api/image-config"),
      apiGet("/api/prompt-config"),
    ]);
    state.imageApiConfig = { ...DEFAULT_IMAGE_API_CONFIG, ...(imageData.config || {}) };
    state.promptApiConfig = { ...DEFAULT_PROMPT_API_CONFIG, ...(promptData.config || {}) };
    if (state.promptApiConfig.apiBase) {
      qs("#promptApiUrlInput").value = state.promptApiConfig.apiBase;
    }
    qs("#promptApiModelInput").value = state.promptApiConfig.model || DEFAULT_PROMPT_EXTRACT_MODEL;
    if (!moduleHasRequiredConfig(state.activeModule)) {
      state.configScope = getConfigScopeForModule(state.activeModule);
      state.activeModule = "config";
      saveState();
    }
    updateApiConfigView();
    updateControls();
    if (!state.imageApiConfig.uploaded || !state.promptApiConfig.uploaded) {
      setStatus("请在配置中心保存所需 API 配置");
    }
  } catch (error) {
    state.imageApiConfig = { ...DEFAULT_IMAGE_API_CONFIG };
    state.promptApiConfig = { ...DEFAULT_PROMPT_API_CONFIG };
    updateApiConfigView();
    updateControls();
    setStatus(error.message);
  }
}

async function uploadApiConfig(event) {
  event.preventDefault();
  const apiKey = qs("#apiKeyInput").value.trim();
  if (!apiKey) {
    setApiConfigMessage("API Key 不能为空", "error");
    qs("#apiKeyInput").focus();
    return;
  }

  const button = qs("#uploadApiConfig");
  button.disabled = true;
  setApiConfigMessage("正在保存 API 配置");
  setStatus("正在保存 API 配置");
  try {
    const data = await apiPost("/api/image-config", { apiKey });
    state.imageApiConfig = { ...DEFAULT_IMAGE_API_CONFIG, ...(data.config || {}) };
    if (state.activeModule === "config") {
      state.activeModule = getProductModule(state.productSetMode);
    }
    qs("#apiKeyInput").value = "";
    setApiConfigMessage("API 配置已生效", "success");
    saveState();
    render();
    notifyFullPlaygroundConfigChanged();
    setStatus("API 配置已生效");
  } catch (error) {
    setApiConfigMessage(error.message, "error");
    setStatus(error.message);
  } finally {
    button.disabled = false;
    updateControls();
  }
}

async function uploadPromptApiConfig(event) {
  event.preventDefault();
  const apiBase = qs("#promptApiUrlInput").value.trim();
  const apiKey = qs("#promptApiKeyInput").value.trim();
  const model = qs("#promptApiModelInput").value.trim() || DEFAULT_PROMPT_EXTRACT_MODEL;
  if (!apiBase) {
    setPromptApiConfigMessage("提示词 API URL 不能为空", "error");
    qs("#promptApiUrlInput").focus();
    return;
  }
  if (!apiKey) {
    setPromptApiConfigMessage("提示词 API Key 不能为空", "error");
    qs("#promptApiKeyInput").focus();
    return;
  }

  const button = qs("#uploadPromptApiConfig");
  button.disabled = true;
  setPromptApiConfigMessage("正在保存提示词 API 配置");
  setStatus("正在保存提示词 API 配置");
  try {
    const data = await apiPost("/api/prompt-config", { apiBase, apiKey, model });
    state.promptApiConfig = { ...DEFAULT_PROMPT_API_CONFIG, ...(data.config || {}) };
    qs("#promptApiModelInput").value = state.promptApiConfig.model || DEFAULT_PROMPT_EXTRACT_MODEL;
    qs("#promptApiKeyInput").value = "";
    if (state.activeModule === "config" && state.configScope === "prompt") {
      state.activeModule = "promptExtractor";
    }
    setPromptApiConfigMessage("提示词 API 配置已生效", "success");
    saveState();
    render();
    notifyFullPlaygroundConfigChanged();
    setStatus("提示词 API 配置已生效");
  } catch (error) {
    setPromptApiConfigMessage(error.message, "error");
    setStatus(error.message);
  } finally {
    button.disabled = false;
    updateControls();
  }
}

function imageSpecError(dimensions, spec) {
  if (dimensions.width !== spec.width || dimensions.height !== spec.height) {
    return `上传主图必须是 ${spec.width} x ${spec.height}（${spec.ratio}），当前是 ${dimensions.width} x ${dimensions.height}`;
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
  url.searchParams.set("module", getProductModule(state.productSetMode));
  window.open(url.toString(), "_blank", "noopener");
}

async function generateMain() {
  const workspaceMode = normalizeProductSetMode(state.productSetMode);
  if (!state.imageApiConfig?.uploaded) {
    setStatus("请先保存 API 配置");
    return;
  }
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
    setWorkspaceImage(workspaceMode, "main", data.image);
    saveState();
    setWorkspaceMessage(workspaceMode, "main", "主图已生成", "success");
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      setStatus(PRODUCT_SET_MODES[workspaceMode].readyStatus);
    }
  } catch (error) {
    setWorkspaceMessage(workspaceMode, "main", error.message, "error");
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      setStatus("主图生成失败");
    }
  } finally {
    setWorkspaceLoading(workspaceMode, "main", false);
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      render();
    }
  }
}

async function uploadMain(file) {
  const workspaceMode = normalizeProductSetMode(state.productSetMode);
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
    setWorkspaceImage(workspaceMode, "main", data.image);
    saveState();
    setWorkspaceMessage(workspaceMode, "main", "已上传为主图", "success");
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      setStatus(PRODUCT_SET_MODES[workspaceMode].readyStatus);
    }
  } catch (error) {
    setWorkspaceMessage(workspaceMode, "main", error.message, "error");
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      setStatus("主图上传失败");
    }
  } finally {
    setWorkspaceLoading(workspaceMode, "main", false);
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      render();
    }
  }
}

async function selectPromptExtractionImage(file) {
  if (!file) {
    return;
  }
  if (!file.type.startsWith("image/")) {
    setPromptExtractorMessage("请选择图片文件", "error");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    setPromptExtractorMessage("上传图片不能超过 20MB", "error");
    return;
  }
  try {
    await readLocalImageDimensions(file);
  } catch (error) {
    setPromptExtractorMessage("无法读取图片，请上传 PNG、JPG、WEBP 或 GIF 图片", "error");
    return;
  }

  clearPromptExtractionPreviewUrl();
  promptExtractionFile = file;
  promptExtractionPreviewUrl = URL.createObjectURL(file);
  qs("#extractedPrompt").value = "";
  setPromptExtractorMessage("图片已准备，可以提取提示词", "success");
  renderPromptExtractor();
  updateControls();
}

async function extractPromptFromImage() {
  if (!state.promptApiConfig?.uploaded) {
    setPromptExtractorMessage("请先保存提示词 API 配置", "error");
    setStatus("请先保存提示词 API 配置");
    return;
  }
  if (!promptExtractionFile) {
    setPromptExtractorMessage("请先上传图片", "error");
    return;
  }

  promptExtractionLoading = true;
  setPromptExtractorMessage("");
  setStatus("正在提取图片提示词");
  updateControls();
  try {
    const data = await apiExtractPrompt(promptExtractionFile);
    qs("#extractedPrompt").value = data.prompt || "";
    setPromptExtractorMessage("提示词已提取", "success");
    setStatus("提示词已提取");
  } catch (error) {
    setPromptExtractorMessage(error.message, "error");
    setStatus("提示词提取失败");
  } finally {
    promptExtractionLoading = false;
    updateControls();
  }
}

async function copyExtractedPrompt() {
  const prompt = qs("#extractedPrompt").value.trim();
  if (!prompt) {
    return;
  }
  try {
    await navigator.clipboard.writeText(prompt);
    setPromptExtractorMessage("已复制提示词", "success");
    setStatus("已复制提示词");
  } catch (error) {
    qs("#extractedPrompt").select();
    setPromptExtractorMessage("复制失败，请手动复制文本", "error");
  }
  renderPromptExtractor();
}

async function generateDerived(type) {
  const workspaceMode = normalizeProductSetMode(state.productSetMode);
  if (!state.imageApiConfig?.uploaded) {
    setStatus("请先保存 API 配置");
    return;
  }
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
    setWorkspaceImage(workspaceMode, type, data.image);
    saveState();
    setWorkspaceMessage(workspaceMode, type, `${TYPE_LABELS[type]}已生成`, "success");
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      setStatus(`${TYPE_LABELS[type]}已生成`);
    }
  } catch (error) {
    setWorkspaceMessage(workspaceMode, type, error.message, "error");
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      setStatus(`${TYPE_LABELS[type]}生成失败`);
    }
  } finally {
    setWorkspaceLoading(workspaceMode, type, false);
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      render();
    }
  }
}

async function generateAllDerived() {
  const workspaceMode = normalizeProductSetMode(state.productSetMode);
  if (!state.imageApiConfig?.uploaded) {
    setStatus("请先保存 API 配置");
    return;
  }
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
        setWorkspaceImage(workspaceMode, type, data.results[type]);
        setWorkspaceMessage(workspaceMode, type, `${TYPE_LABELS[type]}已生成`, "success");
      } else if (data.errors?.[type]) {
        setWorkspaceMessage(workspaceMode, type, data.errors[type], "error");
      }
    }
    saveState();
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      setStatus(data.ok ? config.doneStatus : config.partialStatus);
    }
  } catch (error) {
    for (const type of derivedTypes) {
      setWorkspaceMessage(workspaceMode, type, error.message, "error");
    }
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      setStatus("衍生图生成失败");
    }
  } finally {
    for (const type of derivedTypes) {
      setWorkspaceLoading(workspaceMode, type, false);
    }
    if (normalizeProductSetMode(state.productSetMode) === workspaceMode) {
      render();
    }
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
  resetActiveProductWorkspace(null);
  state.imageSpec = imageSpec;
  state.playground = { ...getDefaultPlaygroundState(), imageSpec };
  state.loading = {};
  for (const type of TYPES) {
    setMessage(type, "");
  }
  saveState();
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
  const activeModule = normalizeActiveModule(state.activeModule);
  const configScope = normalizeConfigScope(state.configScope);
  const promptApiConfig = state.promptApiConfig || { ...DEFAULT_PROMPT_API_CONFIG };
  const imageSpec = collectImageSpec();
  const resetButton = qs("#resetGeneratedCache");
  resetButton.disabled = true;
  setStatus("正在重置生成缓存");
  try {
    const data = await apiPost("/api/image-sets/reset", {});
    imageSetRequests = {};
    state.activeModule = activeModule;
    state.configScope = configScope;
    state.productSetMode = productSetMode;
    state.imageSpec = imageSpec;
    state.playground = getDefaultPlaygroundState();
    state.imageApiConfig = state.imageApiConfig || { ...DEFAULT_IMAGE_API_CONFIG };
    state.promptApiConfig = promptApiConfig;
    state.loading = {};
    resetAllProductWorkspaces(data.imageSet);
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

function handleFullPlaygroundMessage(event) {
  if (event.origin !== window.location.origin || event.source !== getFullPlaygroundFrame()?.contentWindow) {
    return;
  }
  const type = event.data?.type;
  if (type === "image-workbench:clear-state") {
    void clearState();
  } else if (type === "image-workbench:reset-cache") {
    void resetGeneratedCache();
  } else if (type === "image-workbench:request-config") {
    notifyFullPlaygroundConfigChanged();
  }
}

function bindEvents() {
  qsa(".card-message").forEach((message) => {
    message.setAttribute("aria-live", "polite");
  });

  for (const type of TYPES) {
    qs(`#prompt-${type}`).addEventListener("input", (event) => {
      state.prompts[type] = event.target.value;
      saveState();
    });
  }

  qsa(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      switchActiveModule(button.dataset.module);
      if (button.dataset.module !== "config") {
        autoCollapseSidebar();
      }
    });
  });
  qs("#toggleSidebar").addEventListener("click", () => {
    setSidebarCollapsed(!state.sidebarCollapsed);
  });
  window.addEventListener("resize", updateSidebarView);
  qsa("[data-image-size-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      state.imageSpec = normalizeImageSpec({
        ...state.imageSpec,
        sizeMode: "preset",
        sizePreset: button.dataset.imageSizePreset,
      });
      collectImageSpec();
    });
  });
  qs("#imageSpecCustomSizeButton").addEventListener("click", () => {
    state.imageSpec = normalizeImageSpec({
      ...state.imageSpec,
      sizeMode: "custom",
      customSize: qs("#imageSpecCustomSize").value,
    });
    collectImageSpec();
    qs("#imageSpecCustomSize").focus();
  });
  qs("#imageSpecCustomSize").addEventListener("change", () => {
    state.imageSpec = normalizeImageSpec({
      ...state.imageSpec,
      sizeMode: "custom",
      customSize: qs("#imageSpecCustomSize").value,
    });
    collectImageSpec();
  });
  qs("#imageSpecCustomSize").addEventListener("blur", () => {
    state.imageSpec = normalizeImageSpec({
      ...state.imageSpec,
      sizeMode: "custom",
      customSize: qs("#imageSpecCustomSize").value,
    });
    collectImageSpec();
  });
  qsa("[data-image-ratio-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      state.imageSpec = normalizeImageSpec({
        ...state.imageSpec,
        ratioPreset: button.dataset.imageRatioPreset,
      });
      collectImageSpec();
    });
  });
  qs("#imageSpecCustomRatioButton").addEventListener("click", () => {
    state.imageSpec = normalizeImageSpec({
      ...state.imageSpec,
      ratioPreset: "custom",
      customRatioWidth: qs("#imageSpecCustomRatioWidth").value,
      customRatioHeight: qs("#imageSpecCustomRatioHeight").value,
    });
    collectImageSpec();
    qs("#imageSpecCustomRatioWidth").focus();
  });
  ["#imageSpecCustomRatioWidth", "#imageSpecCustomRatioHeight"].forEach((selector) => {
    qs(selector).addEventListener("change", () => {
      state.imageSpec = normalizeImageSpec({
        ...state.imageSpec,
        ratioPreset: "custom",
        customRatioWidth: qs("#imageSpecCustomRatioWidth").value,
        customRatioHeight: qs("#imageSpecCustomRatioHeight").value,
      });
      collectImageSpec();
    });
    qs(selector).addEventListener("blur", () => {
      state.imageSpec = normalizeImageSpec({
        ...state.imageSpec,
        ratioPreset: "custom",
        customRatioWidth: qs("#imageSpecCustomRatioWidth").value,
        customRatioHeight: qs("#imageSpecCustomRatioHeight").value,
      });
      collectImageSpec();
    });
  });
  qs("#selectPromptImage").addEventListener("click", () => qs("#promptImageInput").click());
  qs("#promptImageInput").addEventListener("change", async (event) => {
    await selectPromptExtractionImage(event.target.files?.[0]);
    event.target.value = "";
  });
  qs("#extractPromptButton").addEventListener("click", extractPromptFromImage);
  qs("#copyExtractedPrompt").addEventListener("click", copyExtractedPrompt);
  qs("#promptUploadZone").addEventListener("dragover", (event) => {
    event.preventDefault();
    event.currentTarget.classList.add("dragging");
  });
  qs("#promptUploadZone").addEventListener("dragleave", (event) => {
    event.currentTarget.classList.remove("dragging");
  });
  qs("#promptUploadZone").addEventListener("drop", async (event) => {
    event.preventDefault();
    event.currentTarget.classList.remove("dragging");
    await selectPromptExtractionImage(event.dataTransfer.files?.[0]);
  });
  qsa("[data-playground-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.playground = state.playground || getDefaultPlaygroundState();
      state.playground.mode = button.dataset.playgroundMode === "edit" ? "edit" : "generate";
      saveState();
      render();
    });
  });
  qs("#playgroundPrompt").addEventListener("input", collectPlaygroundInput);
  qs("#playgroundCount").addEventListener("change", collectPlaygroundInput);
  qs("#playgroundBackground").addEventListener("change", collectPlaygroundInput);
  qs("#playgroundSystem").addEventListener("input", collectPlaygroundInput);
  qs("#playgroundReferenceSelect").addEventListener("change", (event) => {
    state.playground = state.playground || getDefaultPlaygroundState();
    state.playground.referenceImageId = event.target.value;
    saveState();
    renderPlayground();
  });
  qs("#generatePlayground").addEventListener("click", generatePlaygroundImages);
  qs("#downloadPlaygroundAll").addEventListener("click", downloadPlaygroundAll);
  qs("#apiConfigForm").addEventListener("submit", uploadApiConfig);
  qs("#promptApiConfigForm").addEventListener("submit", uploadPromptApiConfig);
  qs("#generateAll").addEventListener("click", generateAllDerived);
  qs("#downloadAll").addEventListener("click", downloadAll);
  qs("#clearState").addEventListener("click", clearState);
  qs("#resetGeneratedCache").addEventListener("click", resetGeneratedCache);
  window.addEventListener("message", handleFullPlaygroundMessage);
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

  qsa("[data-action='reference']").forEach((button) => {
    button.addEventListener("click", () => setImageAsReference(button.dataset.type));
  });
}

bindEvents();
render();
cleanStartupParams();
setStatus(state.imageSet?.folderName ? `准备就绪，当前输出文件夹：${state.imageSet.folderName}` : "正在分配套图文件夹");
Promise.all([loadApiConfigStatus(), ensureImageSet()])
  .then(([, imageSet]) => {
    const apiStatus = state.imageApiConfig?.uploaded
      ? "API 配置已生效"
      : "请先保存 API 配置";
    setStatus(`${apiStatus}，当前输出文件夹：${imageSet.folderName}`);
    render();
  })
  .catch((error) => {
    setStatus(error.message);
    render();
  });
