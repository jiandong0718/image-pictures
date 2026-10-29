export const THEME_OPTIONS = ["tech", "xianxia", "mystic"];

export const RELEASE_NOTES = [
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
