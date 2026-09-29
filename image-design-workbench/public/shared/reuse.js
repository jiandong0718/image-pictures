// 从图库跳转到创作工具时传递提示词与源图，避免把私人提示词放进 URL。
const KEY = "imageStudio:galleryReuse:v1";
const TTL_MS = 30 * 60 * 1000;

export function saveReuse(payload) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...payload, savedAt: Date.now() }));
  } catch {
    // 浏览器禁用存储时，图库仍可复制提示词。
  }
}

export function takeReuse(target) {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (payload.target !== target) return null;
    sessionStorage.removeItem(KEY);
    if (!Number.isFinite(payload.savedAt) || Date.now() - payload.savedAt > TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}
