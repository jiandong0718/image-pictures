import { apiGet, fetchMe } from "/shared/api.js";
import { DEFAULT_AUTH_DESTINATION, resolveAuthDestination } from "/shared/auth-navigation.js";
import { saveReuse } from "/shared/reuse.js";
import { normalizeTheme, normalizeLanguage, parseReadReleaseIds, unreadReleaseIds, RELEASE_NOTES } from "/shared/site-preferences.js";

const EN = {
  brand: "AI Image Studio",
  navExplore: "Explore", navCreate: "Create", navGallery: "My gallery", login: "Log in / Sign up", openStudio: "Open studio",
  themeHeading: "APPEARANCE", themeTech: "Misty night", themeXianxia: "Soft daylight", themeMystic: "Violet haze",
  languageHeading: "LANGUAGE", releaseEyebrow: "WHAT'S NEW", releaseHeading: "Product updates", markAllRead: "Mark all as read", quickLinks: "QUICK LINKS",
  heroLineOne: "Great ideas,", heroLineTwo: "start with a view.", heroDescription: "Explore shared work and the ideas behind it. Find an image you love, learn from its prompt, and create your own version.",
  startCreating: "Start creating", browseWorks: "Explore works", tileFashion: "FASHION / Crimson couture", tileBeauty: "BEAUTY / Chrome portrait", tileNoir: "NOIR / Rainy city", tileTravel: "TRAVEL / Yangshuo at night · photo",
  galleryEyebrow: "THE OPEN GALLERY / SHARED WORK", galleryHeading: "A starting point for your next image.", galleryDescription: "Creators choose which images and videos to share here. Every work can spark a new idea.",
  allWorks: "All works", images: "Images", videos: "Videos", searchLabel: "Search titles or prompts", searchPlaceholder: "Search titles or prompts", searchButton: "Search works",
  videoPromoEyebrow: "VIDEO STUDIO / CREATE IN MOTION", videoPromoHeading: "Set your ideas in motion.", videoPromoDescription: "Start with a description or an image, then connect scenes with multiple keyframes.",
  videoPromoFeaturesLabel: "Video creation methods", videoPromoText: "Text to video", videoPromoImage: "Image to video", videoPromoFrames: "Keyframe sequence", videoPromoLink: "Open video studio", videoPromoNote: "This preview is edited from still images on this page. It demonstrates motion and is not an AI-generated video work.",
  videoPromoVideoLabel: "Preview edited from still images", videoPromoStageLabel: "00:10 / STILL IMAGE EDIT", videoPromoCount: "Video creation preview", videoPromoStatus: "No shared videos yet. Explore the video studio while the gallery grows.",
  closingVideoHeading: "Your next scene starts here.", closingVideoLink: "Enter the video studio ↗",
  closingHeading: "See something you love? Make your own.", closingLink: "Enter the studio ↗", footer: "Create · Explore · Create again", closeDetail: "Close work details", viewSource: "View original photograph ↗", copy: "Copy",
  notifications: "Product updates", themeButton: "Choose a theme", languageButton: "Choose a language", menuButton: "Open menu", markRead: "Mark as read", markUnread: "Mark as unread",
  sampleBadge: "IDEA", photoBadge: "REAL PHOTO", genericLabel: "Creative work", viewWork: "View", sampleCount: "creative directions", publicCount: "shared works", examplesStatus: "The public gallery is growing. Start with these ideas.",
  emptyHeading: "No works found", emptyDescription: "Try another search, or share one of your works.", emptyLink: "Go to my gallery ↗", loading: "Loading shared works…", loadError: "The public gallery is temporarily unavailable.", promptFallback: "Open this work for your next idea.",
  demoDetail: "CREATIVE DIRECTION / IDEA", realDetail: "REAL PHOTO / REFERENCE", publicVideo: "SHARED WORK / VIDEO", publicImage: "SHARED WORK / IMAGE", demoDate: "Start a new creation from this direction.", publishedOn: "Published on", photoCredit: "Photo: Willian Justen de Vasconcellos · Unsplash",
  promptMissing: "The creator did not add a prompt.", photoPromptHeading: "Prompt inspired by the composition", demoPromptHeading: "Reference prompt", promptHeading: "Creation prompt", createImage: "Create an image with this prompt ↗", createVideo: "Create a video with this prompt ↗", copied: "Prompt copied", copyFailed: "Copy failed. Please select the prompt and copy it manually.",
  closeAuth: "Close sign in", authEyebrow: "YOUR CREATIVE SPACE / SIGN IN", authDescription: "Sign in and go straight to the studio. Turn the ideas you found into your next work.", authRegisterDescription: "Create an account and go straight to the studio. Your first 20 credits are waiting.",
  usernameLabel: "Username", usernamePlaceholder: "Enter your username", passwordLabel: "Password", passwordPlaceholder: "Enter your password", emailLabel: "Email", phoneLabel: "Phone", phonePlaceholder: "Phone number",
  contactHint: "Add an email or phone number so you can recover your account later.", registerCredit: "New accounts get 20 credits", authLoginTitle: "Welcome back.", authRegisterTitle: "Start creating.",
  authLoginSubmit: "Sign in and enter the studio", authRegisterSubmit: "Create account and enter the studio", authSwitchToRegisterHint: "New here?", authSwitchToRegister: "Create an account", authSwitchToLoginHint: "Already have an account?", authSwitchToLogin: "Sign in",
  authMissingCredentials: "Enter your username and password.", authMissingContact: "Add an email or phone number.", authLoggingIn: "Signing in…", authRegistering: "Creating account…", authRequestFailed: "Something went wrong. Please try again.",
};

const ZH = {
  openStudio: "进入工作台", notifications: "版本更新通知", themeButton: "选择主题", languageButton: "切换语言", menuButton: "打开菜单", markRead: "标为已读", markUnread: "标为未读",
  sampleBadge: "灵感示例", photoBadge: "实拍参考", genericLabel: "创作作品", viewWork: "查看", examplesStatus: "公开作品正在生长；先从这些示例中找到灵感。",
  videoPromoCount: "视频创作预览", videoPromoStatus: "公开视频还在征集中，先了解视频创作方式。",
  closingVideoHeading: "下一段画面，从这里开始。", closingVideoLink: "进入视频工作台 ↗",
  emptyHeading: "还没有找到这类作品", emptyDescription: "换个关键词，或来发布一件你的作品。", emptyLink: "去我的图库 ↗", loading: "正在加载公开作品…", loadError: "公开作品暂时无法加载。", promptFallback: "打开作品，寻找下一次创作的灵感。",
  demoDetail: "CREATIVE DIRECTION / 灵感示例", realDetail: "REAL PHOTO / 实拍参考", publicVideo: "PUBLIC WORK / 视频", publicImage: "PUBLIC WORK / 图片", demoDate: "从一个方向，开始自己的创作。", publishedOn: "发布于", photoCredit: "摄影：Willian Justen de Vasconcellos · Unsplash",
  promptMissing: "创作者未留下提示词。", photoPromptHeading: "借鉴构图的提示词", demoPromptHeading: "参考提示词", promptHeading: "创作提示词", createImage: "用提示词创作图片 ↗", createVideo: "用提示词创作视频 ↗", copied: "提示词已复制", copyFailed: "复制失败，请选中提示词手动复制",
  authDescription: "登录后直接进入创作工作台，让刚看到的灵感变成下一张作品。", authRegisterDescription: "注册后直接进入创作工作台，开始制作你的第一张作品。", authLoginTitle: "欢迎回来。", authRegisterTitle: "开启创作。", authLoginSubmit: "登录并进入工作台", authRegisterSubmit: "注册并进入工作台", authSwitchToRegisterHint: "还没有账户？", authSwitchToRegister: "立即注册", authSwitchToLoginHint: "已有账户？", authSwitchToLogin: "去登录",
  authMissingCredentials: "请输入用户名和密码", authMissingContact: "请填写邮箱或手机号（至少一项）", authLoggingIn: "登录中…", authRegistering: "注册中…", authRequestFailed: "操作失败，请稍后重试",
};

const EXAMPLE_EN = {
  1: { title: "Crimson couture", label: "Editorial / Fashion", prompt: "An adult East Asian model in a sculptural crimson silk gown stands in a pale concrete courtyard. The dress sweeps into a dramatic red arc in the wind. Confident gaze, full-body composition, morning side light, tactile silk, and a premium fashion editorial feel. No text or logos." },
  2: { title: "Moonlit Magic · Halloween Pendant", label: "E-commerce visual", badge: "Amazon product details", detailLabel: "E-COMMERCE VISUAL / PRODUCT DETAILS", prompt: "Create a process detail poster for a round PMMA acrylic Halloween pendant based on the supplied main image. Add a red label reading “2D Flat Acrylic” at the lower right, and show four close-up views of the original pendant's pearl effect, color layers, UV highlights, and raised finish." },
  3: { title: "Neon rain", label: "Editorial / Cinema", prompt: "An adult East Asian man in a tailored black coat holds a vivid red umbrella on a rainy city street. Wet pavement reflects red and cyan neon; distant people and headlights are softly blurred. Full-body framing, cinematic backlight, and fashion campaign photography. No readable signs or logos." },
  4: { title: "Two beneath the moon", label: "Editorial / Scene", prompt: "Two adult models in minimal ivory couture stand apart on a reflective salt flat at dusk. A huge amber moon meets the horizon, with distant misty mountains and soft reflections. A wide, quiet, cinematic fashion composition. No text or logos." },
  5: { title: "Yangshuo after dark", label: "Real photo / Holiday travel", photoCredit: "Photo: Willian Justen de Vasconcellos · Unsplash", prompt: "A lively pedestrian street in Yangshuo at night. A young woman in locally inspired traditional dress stands naturally among the crowd with a relaxed smile. Warm shop lights meet blue-green neon, with passersby softly out of focus. Candid environmental portrait with an authentic street atmosphere." },
  6: { title: "A vase in the light", label: "Materials / Still life", prompt: "An ivory sculptural ceramic vase on a travertine surface, with soft linen falling naturally beside it. Slanting afternoon sun creates delicate shadows. Warm tones, refined still-life photography, realistic materials, and a quiet composition." },
  7: { title: "A product from tomorrow", label: "Product concept", prompt: "A futuristic wearable device in a dark studio, with a cobalt translucent shell and mirrored metal details. Dramatic rim light, a clean silhouette, and precise industrial-design photography." },
  8: { title: "Beyond the mountains", label: "Imagined worlds", prompt: "Layered teal mountains and a sea of clouds, with a glowing river winding through the valley. An Eastern fantasy world at sunrise, poetic atmosphere, cinematic environmental light, and a sweeping wide composition." },
  9: { title: "A brand's atmosphere", label: "Brand visual", prompt: "An amber serum bottle on pale travertine, with natural shadows cast by leaves. Warm beige background, soft morning light, and premium skincare campaign photography. No text or logos." },
  10: { title: "Binggou River · Qilian inspiration", label: "AI landscape / Wuwei, Gansu", badge: "AI LANDSCAPE", detailLabel: "AI LANDSCAPE / TRAVEL INSPIRATION", prompt: "Create a photorealistic landscape inspired by the Binggou River area near Wuwei, Gansu: a clear mountain stream winding through conifer forest and alpine meadow, with distant snow-capped Qilian peaks. This is an AI-generated travel inspiration image, not a photograph of the actual site." },
  11: { title: "Sayram Lake · blue horizon", label: "Real photo / Xinjiang", badge: "REAL PHOTO", photoCredit: "Photo: Fumikas Sagisavas · Wikimedia Commons (CC0)", prompt: "Draw inspiration from this real photograph of Sayram Lake: deep blue water, distant mountains, layered clouds, and a calm lakeshore. Preserve the natural atmosphere and generous sky in a new landscape composition." },
};

const examples = [
  {
    kind: "image", demo: 1, image: "/assets/editorial-crimson.jpg", title: "赤色高定", label: "人物大片 / 时尚",
    prompt: "一位成年东亚女性模特身穿雕塑感深红丝绸礼服，站在浅色混凝土建筑庭院。长裙被风吹成巨大的红色弧线，人物目光坚定，全身构图，早晨侧光，真实丝绸质感，高级时尚杂志摄影，无文字与标志。",
  },
  {
    kind: "image", demo: 2, featured: true, image: "/assets/halloween-acrylic-worn-049.png", title: "月夜魔法 · 万圣节挂饰", label: "电商商品图", badge: "亚马逊商品细节", detailLabel: "电商商品图 / 亚马逊商品细节", cardMeta: "2026/09/27",
    prompt: "基于提供的主图生成一个圆形 PMMA 亚克力万圣节挂饰工艺细节说明海报。画面右下角放置一个横向正红色长方形标签，与画面边缘保持安全距离，使用鲜艳正红色背景和白色粗体衬线字体，文字内容为“2D Flat Acrylic”。右侧四组圆形局部放大镜展示珠光、彩色叠层、UV 高光和立体工艺细节。",
  },
  {
    kind: "image", demo: 3, image: "/assets/editorial-rain.jpg", title: "霓虹雨夜", label: "人物大片 / 电影感",
    prompt: "成年东亚男性模特穿剪裁利落的黑色长大衣，在雨夜城市街头撑一把鲜红雨伞。湿润路面倒映红色和青蓝色霓虹，远处行人与车灯虚化，人物全身可见，电影感逆光，时尚广告摄影，无可读文字与标志。",
  },
  {
    kind: "image", demo: 4, image: "/assets/editorial-moon.jpg", title: "月下双人", label: "人物大片 / 场景",
    prompt: "两位成年模特身穿极简象牙白高定服装，相隔数米站在黄昏时的镜面盐湖。地平线上一轮巨大的琥珀色月亮，水面映出人物和天空，远山隐于薄雾，宽幅对称构图，安静而恢宏的电影时尚摄影，无文字与标志。",
  },
  {
    kind: "image", demo: 5, image: "/assets/real-yangshuo-night.jpg", title: "阳朔夜游", label: "实拍旅拍 / 假日出游",
    photoCredit: "摄影：Willian Justen de Vasconcellos · Unsplash",
    sourceUrl: "https://unsplash.com/photos/woman-in-traditional-attire-on-a-busy-street-pLJdpeYQq7k",
    prompt: "阳朔夜晚的热闹步行街，一位年轻旅行者穿着富有地方特色的传统服饰，自然地站在人群中，面带轻松的笑容。街头暖色灯光与蓝绿色霓虹交织，背景行人柔和虚化，真实抓拍感，环境人像摄影，保留街道的烟火气。",
  },
  {
    kind: "image", demo: 6, title: "一束光，一件静物", label: "材质与静物",
    prompt: "米白色雕塑陶瓷花器置于洞石台面，柔软亚麻布自然垂落。午后斜阳留下细腻的光影，暖色调，高级静物摄影，强调真实材质与安静的构图。",
  },
  {
    kind: "image", demo: 10, image: "/assets/binggouhe-inspired.png", title: "冰沟河 · 祁连山间", label: "AI 风光 / 甘肃武威", badge: "AI 风光示意", detailLabel: "AI 地景创作 / 冰沟河风光灵感",
    prompt: "以甘肃武威天祝冰沟河一带的山地景观为灵感，创作写实风光画面：清澈溪流穿过祁连山针叶林和高山草甸，远处可见雪峰。这是 AI 生成的旅行灵感图，并非景区实拍。",
  },
  {
    kind: "image", demo: 7, title: "来自未来的产品", label: "产品概念",
    prompt: "深色摄影棚中的未来感可穿戴设备，钴蓝色半透明外壳与镜面金属细节，戏剧性的边缘光，干净的产品轮廓，精密工业设计摄影。",
  },
  {
    kind: "image", demo: 11, image: "/assets/sayram-lake-real.jpg", title: "赛里木湖 · 湖岸晴光", label: "风景实拍 / 新疆", badge: "实拍风光",
    photoCredit: "摄影：Fumikas Sagisavas · Wikimedia Commons（CC0）",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Sayram_Lake_scenery.jpg",
    prompt: "参考这张赛里木湖实拍照片的构图：湛蓝湖水、远山与层叠云朵，以宽阔天空和宁静湖岸呈现自然风光。",
  },
  {
    kind: "image", demo: 8, title: "山川里的另一种可能", label: "场景想象",
    prompt: "层叠的青绿色山峦与云海，一条发光的河流在山谷中蜿蜒。日出时分，诗意的东方奇幻世界，电影级环境光，大场景构图。",
  },
  {
    kind: "image", demo: 9, title: "为品牌创造氛围", label: "品牌视觉",
    prompt: "琥珀色精华瓶置于浅色洞石台面，植物枝叶投下自然阴影，温暖米色背景，柔和晨光，高级护肤品牌广告摄影，不含文字或商标。",
  },
];

const protectedHomeDestinations = new Set(["/playground", "/my-images", "/video"]);

const els = {
  accountLink: document.getElementById("accountLink"),
  accountLabel: document.getElementById("accountLabel"),
  menuAccount: document.getElementById("menuAccount"),
  authDialog: document.getElementById("authDialog"),
  authClose: document.getElementById("authClose"),
  authTitle: document.getElementById("authTitle"),
  authDescription: document.getElementById("authDescription"),
  authForm: document.getElementById("authForm"),
  authUsername: document.getElementById("authUsername"),
  authPassword: document.getElementById("authPassword"),
  authContactFields: document.getElementById("authContactFields"),
  authEmail: document.getElementById("authEmail"),
  authPhone: document.getElementById("authPhone"),
  authMessage: document.getElementById("authMessage"),
  authSubmit: document.getElementById("authSubmit"),
  authSwitchHint: document.getElementById("authSwitchHint"),
  authSwitchMode: document.getElementById("authSwitchMode"),
  headerActions: document.getElementById("headerActions"),
  themeToggle: document.getElementById("themeToggle"),
  languageToggle: document.getElementById("languageToggle"),
  notificationToggle: document.getElementById("notificationToggle"),
  menuToggle: document.getElementById("menuToggle"),
  themePanel: document.getElementById("themePanel"),
  languagePanel: document.getElementById("languagePanel"),
  notificationPanel: document.getElementById("notificationPanel"),
  menuPanel: document.getElementById("menuPanel"),
  notificationBadge: document.getElementById("notificationBadge"),
  releaseList: document.getElementById("releaseList"),
  markAllRead: document.getElementById("markAllRead"),
  tabs: document.querySelector(".works-tabs"),
  keyword: document.getElementById("keyword"),
  searchForm: document.getElementById("searchForm"),
  videoPromo: document.getElementById("videoPromo"),
  videoPromoClip: document.getElementById("videoPromoClip"),
  closingHeading: document.getElementById("closingHeading"),
  closingLink: document.getElementById("closingLink"),
  grid: document.getElementById("worksGrid"),
  status: document.getElementById("worksStatus"),
  count: document.getElementById("resultCount"),
  loadMore: document.getElementById("loadMore"),
  dialog: document.getElementById("workDialog"),
  dialogMedia: document.getElementById("dialogMedia"),
  dialogLabel: document.getElementById("dialogLabel"),
  dialogTitle: document.getElementById("dialogTitle"),
  dialogDate: document.getElementById("dialogDate"),
  dialogPrompt: document.getElementById("dialogPrompt"),
  dialogPromptHeading: document.getElementById("dialogPromptHeading"),
  dialogSource: document.getElementById("dialogSource"),
  dialogMessage: document.getElementById("dialogMessage"),
  copyPrompt: document.getElementById("copyPrompt"),
  createFromPrompt: document.getElementById("createFromPrompt"),
};

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Preference remains active for this page. */ }
}

const state = {
  media: "all", keyword: "", page: 1, pageSize: 9, total: 0, items: [], selected: null, request: 0,
  language: normalizeLanguage(readStorage("imageStudioLanguage")),
  theme: normalizeTheme(document.documentElement.dataset.theme),
  readReleases: new Set(parseReadReleaseIds(readStorage("imageStudioReadReleases"))),
  user: null,
  authMode: "login",
  authDestination: DEFAULT_AUTH_DESTINATION,
};

const staticText = new Map([...document.querySelectorAll("[data-i18n]")].map((element) => [element, element.textContent]));
const staticPlaceholders = new Map([...document.querySelectorAll("[data-i18n-placeholder]")].map((element) => [element, element.getAttribute("placeholder")]));
const staticAria = new Map([...document.querySelectorAll("[data-i18n-aria]")].map((element) => [element, element.getAttribute("aria-label")]));

function tr(key) {
  return (state.language === "en" ? EN : ZH)[key] || key;
}

function fieldOf(item, field) {
  return state.language === "en" && item.demo ? (EXAMPLE_EN[item.demo]?.[field] || item[field]) : item[field];
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const panelControls = {
  theme: [els.themeToggle, els.themePanel],
  language: [els.languageToggle, els.languagePanel],
  notification: [els.notificationToggle, els.notificationPanel],
  menu: [els.menuToggle, els.menuPanel],
};

function closePanels(focus = false) {
  for (const [button, panel] of Object.values(panelControls)) {
    if (!panel.hidden && focus) button.focus();
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }
}

function togglePanel(name) {
  const wasOpen = !panelControls[name][1].hidden;
  closePanels();
  if (!wasOpen) {
    const [button, panel] = panelControls[name];
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
  }
}

function syncAccount() {
  els.accountLabel.textContent = state.user ? tr("openStudio") : state.language === "en" ? EN.login : "登录 / 注册";
  els.accountLink.href = state.user ? "/playground" : "/login";
  els.menuAccount.textContent = els.accountLabel.textContent;
  els.menuAccount.href = els.accountLink.href;
}

function setAuthMessage(message, isError = false) {
  els.authMessage.textContent = message;
  els.authMessage.classList.toggle("is-error", isError);
}

function renderAuthMode() {
  const isLogin = state.authMode === "login";
  els.authTitle.textContent = tr(isLogin ? "authLoginTitle" : "authRegisterTitle");
  els.authDescription.textContent = tr(isLogin ? "authDescription" : "authRegisterDescription");
  els.authSubmit.firstChild.textContent = tr(isLogin ? "authLoginSubmit" : "authRegisterSubmit") + " ";
  els.authSwitchHint.textContent = tr(isLogin ? "authSwitchToRegisterHint" : "authSwitchToLoginHint");
  els.authSwitchMode.textContent = tr(isLogin ? "authSwitchToRegister" : "authSwitchToLogin");
  els.authPassword.autocomplete = isLogin ? "current-password" : "new-password";
  els.authContactFields.hidden = isLogin;
  setAuthMessage("");
}

function openAuth(mode = "login", redirect = null) {
  if (state.user) {
    location.assign(resolveAuthDestination(redirect));
    return;
  }
  closePanels();
  state.authMode = mode === "register" ? "register" : "login";
  state.authDestination = resolveAuthDestination(redirect);
  els.authForm.reset();
  renderAuthMode();
  if (!els.authDialog.open) els.authDialog.showModal();
  els.authUsername.focus();
}

async function submitAuth(event) {
  event.preventDefault();
  const username = els.authUsername.value.trim();
  const password = els.authPassword.value;
  if (!username || !password) {
    setAuthMessage(tr("authMissingCredentials"), true);
    return;
  }
  const email = els.authEmail.value.trim();
  const phone = els.authPhone.value.trim();
  if (state.authMode === "register" && !email && !phone) {
    setAuthMessage(tr("authMissingContact"), true);
    return;
  }
  els.authSubmit.disabled = true;
  setAuthMessage(tr(state.authMode === "login" ? "authLoggingIn" : "authRegistering"));
  try {
    const response = await fetch(state.authMode === "login" ? "/api/auth/login" : "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.authMode === "login" ? { username, password } : { username, password, email, phone }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || tr("authRequestFailed"));
    location.assign(state.authDestination);
  } catch (error) {
    setAuthMessage(error.message || tr("authRequestFailed"), true);
    els.authSubmit.disabled = false;
  }
}

function applyTheme(theme, persist = true) {
  state.theme = normalizeTheme(theme);
  document.documentElement.dataset.theme = state.theme;
  if (persist) writeStorage("imageStudioTheme", state.theme);
  els.themePanel.querySelectorAll("[data-theme-choice]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === state.theme)));
}

function renderReleases() {
  const unread = unreadReleaseIds(RELEASE_NOTES, state.readReleases);
  els.notificationBadge.hidden = unread.length === 0;
  els.notificationBadge.textContent = unread.length > 9 ? "9+" : String(unread.length);
  els.notificationToggle.setAttribute("aria-label", tr("notifications") + (unread.length ?
    (state.language === "en" ? `, ${unread.length} unread` : `，${unread.length} 条未读`) : ""));
  els.markAllRead.disabled = unread.length === 0;
  els.releaseList.replaceChildren();
  for (const note of RELEASE_NOTES) {
    const isUnread = unread.includes(note.id);
    const article = document.createElement("article");
    article.className = "release-item" + (isUnread ? " is-unread" : "");
    article.innerHTML = '<time datetime="' + escapeHtml(note.date) + '">' + escapeHtml(note.date) +
      '</time><h3>' + escapeHtml(note.title[state.language]) + '</h3><p>' +
      escapeHtml(note.summary[state.language]) + '</p>';
    const markButton = document.createElement("button");
    markButton.type = "button";
    markButton.textContent = tr(isUnread ? "markRead" : "markUnread");
    markButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setReleaseRead(note.id, isUnread);
    });
    article.appendChild(markButton);
    els.releaseList.appendChild(article);
  }
}

function markReleasesRead(ids) {
  ids.forEach((id) => state.readReleases.add(id));
  writeStorage("imageStudioReadReleases", JSON.stringify([...state.readReleases]));
  renderReleases();
}

function setReleaseRead(id, read) {
  if (read) state.readReleases.add(id);
  else state.readReleases.delete(id);
  writeStorage("imageStudioReadReleases", JSON.stringify([...state.readReleases]));
  renderReleases();
}

function applyLanguage(language, persist = true) {
  state.language = normalizeLanguage(language);
  document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
  if (persist) writeStorage("imageStudioLanguage", state.language);
  for (const [element, original] of staticText) {
    element.textContent = state.language === "en" ? (EN[element.dataset.i18n] || original) : original;
  }
  for (const [element, original] of staticPlaceholders) {
    element.placeholder = state.language === "en" ? (EN[element.dataset.i18nPlaceholder] || original) : original;
  }
  for (const [element, original] of staticAria) {
    element.setAttribute("aria-label", state.language === "en" ? (EN[element.dataset.i18nAria] || original) : original);
  }
  document.title = state.language === "en" ? "Inspiration home · AI Image Studio" : "灵感首页 · AI 图像设计工作台";
  els.themeToggle.setAttribute("aria-label", tr("themeButton"));
  els.languageToggle.setAttribute("aria-label", tr("languageButton"));
  els.menuToggle.setAttribute("aria-label", tr("menuButton"));
  els.menuPanel.setAttribute("aria-label", state.language === "en" ? "Quick menu" : "快捷菜单");
  renderAuthMode();
  document.querySelector(".site-brand").setAttribute("aria-label", state.language === "en" ? "AI Image Studio home" : "AI 图像设计工作台首页");
  document.querySelector(".hero-visual").setAttribute("aria-label", state.language === "en" ? "Editorial and travel ideas" : "人物大片与中国旅行风格示例");
  document.querySelector(".works-tabs").setAttribute("aria-label", state.language === "en" ? "Filter works by type" : "筛选作品类型");
  document.querySelector(".closing-banner").setAttribute("aria-label", state.language === "en" ? "Start creating" : "开始创作");
  els.languagePanel.querySelectorAll("[data-language-choice]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.languageChoice === state.language)));
  syncAccount();
  renderReleases();
  render();
}

function initControls() {
  for (const link of [els.accountLink, els.menuAccount]) {
    link.addEventListener("click", (event) => {
      if (state.user) return;
      event.preventDefault();
      openAuth();
    });
  }
  els.authClose.addEventListener("click", () => els.authDialog.close());
  els.authDialog.addEventListener("click", (event) => {
    if (event.target !== els.authDialog) return;
    const bounds = els.authDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) els.authDialog.close();
  });
  els.authDialog.addEventListener("close", () => {
    els.authForm.reset();
    els.authSubmit.disabled = false;
    setAuthMessage("");
  });
  els.authSwitchMode.addEventListener("click", () => {
    state.authMode = state.authMode === "login" ? "register" : "login";
    renderAuthMode();
  });
  els.authForm.addEventListener("submit", submitAuth);
  document.addEventListener("click", (event) => {
    if (state.user) return;
    const link = event.target.closest("a");
    if (!link || link.target || !protectedHomeDestinations.has(link.getAttribute("href"))) return;
    event.preventDefault();
    openAuth("login", link.getAttribute("href"));
  });
  for (const [name, [button]] of Object.entries(panelControls)) {
    button.addEventListener("click", () => togglePanel(name));
  }
  els.themePanel.querySelectorAll("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => {
    applyTheme(button.dataset.themeChoice);
    closePanels(true);
  }));
  els.languagePanel.querySelectorAll("[data-language-choice]").forEach((button) => button.addEventListener("click", () => {
    applyLanguage(button.dataset.languageChoice);
    closePanels(true);
  }));
  els.markAllRead.addEventListener("click", (event) => {
    event.stopPropagation();
    markReleasesRead(RELEASE_NOTES.map((note) => note.id));
  });
  els.menuPanel.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => closePanels()));
  document.addEventListener("click", (event) => {
    if (!els.headerActions.contains(event.target)) closePanels();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanels(true);
  });
  applyTheme(state.theme, false);
  applyLanguage(state.language, false);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(state.language === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function titleOf(item) {
  return fieldOf(item, "title") || fieldOf(item, "label") || (item.kind === "video" ? tr("videos") : tr("images"));
}

function promptOf(item) {
  return fieldOf(item, "prompt") || "";
}

function mediaMarkup(item) {
  if (item.image) {
    return imageMarkup(item.image);
  }
  if (item.demo) {
    return '<span class="demo-art demo-art-' + item.demo + '"></span>';
  }
  if (item.kind === "video") {
    return '<span class="video-poster" aria-hidden="true">▶</span>';
  }
  return imageMarkup(item.url + '?thumb=1');
}

function imageMarkup(source) {
  const src = escapeHtml(source);
  return '<img class="work-media-image" src="' + src + '" alt="" loading="lazy" />';
}

function renderCard(item, index) {
  const card = document.createElement("article");
  card.className = "work-card";
  const badge = fieldOf(item, "badge") || (item.sourceUrl ? tr("photoBadge") : item.demo ? tr("sampleBadge") : item.kind === "video" ? "VIDEO" : "IMAGE");
  const cardMeta = item.cardMeta || (item.demo ? String(index + 1).padStart(2, "0") + " / " + String(examples.length).padStart(2, "0") : formatDate(item.publishedAt));
  card.innerHTML = '<button type="button" aria-label="' + escapeHtml(tr("viewWork")) + ' ' + escapeHtml(titleOf(item)) + '">' +
    '<span class="work-media">' + mediaMarkup(item) +
    '<span class="media-badge">' + escapeHtml(badge) +
    '</span></span><span class="work-card-body"><span class="work-card-meta"><span>' +
    escapeHtml(fieldOf(item, "label") || tr("genericLabel")) + '</span><span>' +
    escapeHtml(cardMeta) +
    '</span></span><h3>' + escapeHtml(titleOf(item)) + '</h3><p>' +
    escapeHtml(promptOf(item) || tr("promptFallback")) + '</p></span></button>';
  card.querySelector("button").addEventListener("click", () => openDetail(item));
  return card;
}

function render() {
  els.grid.replaceChildren();
  const showVideoPromo = !state.keyword && (state.media === "all" || state.media === "video");
  const promoWasVisible = !els.videoPromo.hidden;
  els.videoPromo.hidden = !showVideoPromo;
  if (showVideoPromo !== promoWasVisible) {
    if (!showVideoPromo) els.videoPromoClip.pause();
    else if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) els.videoPromoClip.play().catch(() => {});
  }
  const showVideoInvite = !state.items.length && !state.total && !state.keyword && state.media === "video";
  els.grid.hidden = showVideoInvite;
  els.videoPromo.closest(".works-section").classList.toggle("is-video-only", showVideoInvite);
  els.closingHeading.textContent = state.media === "video" ? tr("closingVideoHeading") : (state.language === "en" ? EN.closingHeading : "看到喜欢的，就动手做出来。");
  els.closingLink.textContent = state.media === "video" ? tr("closingVideoLink") : (state.language === "en" ? EN.closingLink : "进入创作工作台 ↗");
  els.closingLink.href = state.media === "video" ? "/video" : "/playground";
  const showExamples = !state.items.length && !state.total && !state.keyword && state.media !== "video";
  if (showExamples) {
    examples.forEach((item, index) => els.grid.appendChild(renderCard(item, index)));
    els.count.textContent = state.total ? state.total + (state.language === "en" ? " " + tr("publicCount") : " 件公开作品") :
      String(examples.length).padStart(2, "0") + " " + (state.language === "en" ? tr("sampleCount") : "个创作方向");
    els.status.textContent = tr("examplesStatus");
  } else if (showVideoInvite) {
    els.count.textContent = tr("videoPromoCount");
    els.status.textContent = tr("videoPromoStatus");
  } else if (!state.items.length) {
    const empty = document.createElement("div");
    empty.className = "works-empty";
    empty.innerHTML = '<span aria-hidden="true">✳</span><h3>' + tr("emptyHeading") + '</h3>' +
      '<p>' + tr("emptyDescription") + '</p><a href="/my-images">' + tr("emptyLink") + '</a>';
    els.grid.appendChild(empty);
    els.count.textContent = state.total + (state.language === "en" ? " " + tr("publicCount") : " 件公开作品");
    els.status.textContent = "";
  } else {
    state.items.forEach((item, index) => els.grid.appendChild(renderCard(item, index)));
    els.count.textContent = state.total + (state.language === "en" ? " " + tr("publicCount") : " 件公开作品");
    els.status.textContent = "";
  }
  els.loadMore.hidden = state.items.length >= state.total || !state.total;
}

async function load(reset = true) {
  const request = ++state.request;
  if (reset) {
    state.page = 1;
    state.items = [];
    els.status.textContent = tr("loading");
    els.grid.replaceChildren();
  }
  els.loadMore.disabled = true;
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
  if (state.media !== "all") params.set("media", state.media);
  if (state.keyword) params.set("keyword", state.keyword);
  try {
    const data = await apiGet("/api/showcase?" + params);
    if (request !== state.request) return;
    state.total = data.pagination?.total || 0;
    state.items = reset ? (data.items || []) : [...state.items, ...(data.items || [])];
    render();
  } catch (error) {
    if (request !== state.request) return;
    if (!reset) state.page = Math.max(1, state.page - 1);
    render();
    els.status.textContent = tr("loadError") + (error.message ? " " + error.message : "");
  } finally {
    if (request === state.request) els.loadMore.disabled = false;
  }
}

function openDetail(item) {
  state.selected = item;
  els.dialogMedia.innerHTML = item.image ?
    '<img src="' + escapeHtml(item.image) + '" alt="' + escapeHtml(titleOf(item)) + '" />' :
    item.demo ?
    '<div class="detail-demo demo-art demo-art-' + item.demo + '" role="img" aria-label="' + escapeHtml(titleOf(item)) + '"></div>' :
    item.kind === "video" ?
      '<video src="' + escapeHtml(item.url) + '" controls playsinline preload="metadata"></video>' :
      '<img src="' + escapeHtml(item.url) + '" alt="' + escapeHtml(titleOf(item)) + '" />';
  els.dialogLabel.textContent = fieldOf(item, "detailLabel") || (item.sourceUrl ? tr("realDetail") : item.demo ? tr("demoDetail") :
    item.kind === "video" ? tr("publicVideo") : tr("publicImage"));
  els.dialogTitle.textContent = titleOf(item);
  els.dialogDate.textContent = item.cardMeta || (item.photoCredit ? fieldOf(item, "photoCredit") :
    item.demo ? tr("demoDate") : tr("publishedOn") + " " + formatDate(item.publishedAt));
  els.dialogSource.hidden = !item.sourceUrl;
  if (item.sourceUrl) els.dialogSource.href = item.sourceUrl;
  els.dialogPrompt.textContent = promptOf(item) || tr("promptMissing");
  els.dialogPromptHeading.textContent = item.sourceUrl ? tr("photoPromptHeading") : item.demo && !item.featured ? tr("demoPromptHeading") : tr("promptHeading");
  els.dialogMessage.textContent = "";
  els.copyPrompt.disabled = !promptOf(item);
  els.createFromPrompt.disabled = !promptOf(item);
  els.createFromPrompt.textContent = item.kind === "video" ? tr("createVideo") : tr("createImage");
  els.dialog.showModal();
}

els.tabs.querySelectorAll("[data-media]").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.media = tab.dataset.media;
    els.tabs.querySelectorAll("[data-media]").forEach((button) =>
      button.setAttribute("aria-selected", String(button === tab)));
    load();
  });
});

els.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.keyword = els.keyword.value.trim();
  load();
});

els.loadMore.addEventListener("click", () => { state.page += 1; load(false); });
document.getElementById("closeDialog").addEventListener("click", () => els.dialog.close());
els.dialog.addEventListener("close", () => {
  state.selected = null;
  els.dialogMedia.replaceChildren();
});
els.copyPrompt.addEventListener("click", async () => {
  if (!state.selected || !promptOf(state.selected)) return;
  try {
    await navigator.clipboard.writeText(promptOf(state.selected));
    els.dialogMessage.textContent = tr("copied");
  } catch {
    els.dialogMessage.textContent = tr("copyFailed");
  }
});
els.createFromPrompt.addEventListener("click", () => {
  if (!state.selected || !promptOf(state.selected)) return;
  const target = state.selected.kind === "video" ? "video" : "playground";
  saveReuse({ target, prompt: promptOf(state.selected) });
  const destination = target === "video" ? "/video" : "/playground";
  if (!state.user) {
    els.dialog.close();
    openAuth("login", destination);
    return;
  }
  location.href = destination;
});

fetchMe().then((user) => {
  if (!user) return;
  state.user = user;
  syncAccount();
  if (els.authDialog.open) location.assign(state.authDestination);
}).catch(() => {});

initControls();
const authParams = new URLSearchParams(location.search);
if (authParams.has("auth")) {
  openAuth(authParams.get("auth"), authParams.get("redirect"));
  authParams.delete("auth");
  authParams.delete("redirect");
  history.replaceState(null, "", location.pathname + (authParams.size ? "?" + authParams : "") + location.hash);
}
load();
