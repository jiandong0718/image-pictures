export const THEME_OPTIONS = ["tech", "xianxia", "mystic"];

export const RELEASE_NOTES = [
  {
    id: "2026-10-30-creative-entries-image-modes",
    date: "2026-10-30",
    title: { zh: "更多创作入口，多模式生图更方便", en: "More creative tools and image generation modes" },
    summary: {
      zh: "新增创作工作台、提示词中心、素材库和音频生成入口，支持提示词复用与素材引用。生图现已覆盖文生图、图生图、AI 修图、商品衍生图、商品微调图、版画商品图和 3D 转平面。各生图入口可跟随全局默认，或自选节点及其支持的模型。自由生图改为左侧看作品、右侧输入；工作台右上角可切换节点与模型；绘图聚集地补齐底部参数，支持分页及每页 12/24/48/96 条记录。音频服务统一在配置中心管理，配置完成后即可使用文字转语音。",
      en: "New entry points include the creative workspace, prompt library, asset library, and audio generation, with reusable prompts and asset references. Image workflows cover text-to-image, image-to-image, retouching, product variations, product refinements, print product images, and 3D-to-flat conversion. Follow the global default or choose a node and one of its supported models. Free image generation places results on the left and inputs on the right; workspace node and model controls open from the top right. The playground adds bottom parameter controls and pagination with 12/24/48/96 records per page. Audio service settings are managed in Settings; text-to-speech is available after configuration.",
    },
  },
  {
    id: "2026-10-29-model-services-creative-layout",
    date: "2026-10-29",
    title: { zh: "模型服务与创作布局更新", en: "Model services and creative workspace update" },
    summary: {
      zh: "配置中心支持模型发现与全局默认；生图节点和模型联动选择。音频配置集中管理，自由生图右侧输入，工作台采用选择抽屉，绘图聚集地恢复底部参数并支持分页。",
      en: "Discover models and set a global default in Settings. Image models follow the selected node. Audio settings are centralized, image inputs move to the right, workspaces gain a node drawer, and the playground restores bottom controls and pagination.",
    },
  },
  {
    id: "2026-09-29-inspiration-home",
    date: "2026-09-29",
    title: { zh: "灵感首页与体验更新", en: "Inspiration home and experience update" },
    summary: {
      zh: "新增公开灵感首页、作品发布与提示词复用；加入真实旅拍参考、雾面视觉和页面偏好设置。",
      en: "A public inspiration home, opt-in work sharing, prompt reuse, a real travel photo reference, a frosted look, and page preferences are now available.",
    },
  },
];

export function normalizeTheme(value) {
  return THEME_OPTIONS.includes(value) ? value : "mystic";
}

export function normalizeLanguage(value) {
  return value === "en" ? "en" : "zh";
}

export function parseReadReleaseIds(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function unreadReleaseIds(notes, readIds) {
  const read = new Set(readIds);
  return notes.filter((note) => !read.has(note.id)).map((note) => note.id);
}
