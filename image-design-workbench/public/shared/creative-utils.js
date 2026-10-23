export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function parseTags(value) {
  const tags = Array.isArray(value) ? value : String(value || "").split(/[,，]/);
  return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 20);
}

export function safeMediaUrl(value) {
  const url = String(value || "").trim();
  if (/[\\\u0000-\u0020]/.test(url)) return "";
  if (/^\/(?!\/)/.test(url) || /^https?:\/\//i.test(url)) return url;
  return "";
}

export function thumbnailUrl(item) {
  if (item.thumbnailUrl) return safeMediaUrl(item.thumbnailUrl);
  const url = safeMediaUrl(item.fileUrl || item.url || (item.id ? `/api/assets/file/${encodeURIComponent(item.id)}` : ""));
  if (!url) return "";
  const parsed = new URL(url, "https://local.invalid");
  parsed.searchParams.delete("t");
  parsed.searchParams.set("thumb", "1");
  return url.startsWith("/") ? parsed.pathname + parsed.search + parsed.hash : parsed.href;
}

export function mediaUrl(item) {
  return safeMediaUrl(item.fileUrl || item.url || item.downloadUrl || (item.id ? `/api/assets/file/${encodeURIComponent(item.id)}` : ""));
}

export function mergeBatch(history, batch) {
  const existing = Array.isArray(history) ? history : [];
  const index = existing.findIndex((item) => item.id === batch.id);
  if (index < 0) return [batch, ...existing];
  return existing.map((item, i) => i === index ? { ...item, ...batch } : item);
}

export function listTotal(data) {
  return Math.max(0, Number(data?.pagination?.total ?? data?.total) || 0);
}

export function audioCost(prompt, config = {}) {
  const characterCount = Array.from(String(prompt || "").trim()).length;
  const charactersPerCredit = Number(config.charactersPerCredit) || 1000;
  const creditsPerUnit = Number(config.creditsPerUnit) || 1;
  return { characterCount, estimatedCost: Math.ceil(characterCount / charactersPerCredit) * creditsPerUnit, charactersPerCredit, creditsPerUnit };
}

// 草稿只有可序列化字段；创建快照和载入快照都复制，避免后续编辑改到旧方案。
export function cloneCreativeDraft(value = {}) {
  return JSON.parse(JSON.stringify(value && typeof value === "object" ? value : {}));
}

export function audioFilename(item = {}) {
  const extensions = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "audio/opus": "ogg", "audio/aac": "aac", "audio/flac": "flac", "audio/x-flac": "flac", "audio/mp4": "m4a" };
  const mime = String(item.mime || "").split(";")[0].trim().toLowerCase();
  const extension = extensions[mime] || ({ mp3: "mp3", wav: "wav", opus: "ogg", aac: "aac", flac: "flac", m4a: "m4a" })[item.format] || "audio";
  const title = String(item.title || item.filename || "speech").replace(/[\\/\u0000-\u001f]/g, "-").replace(/\.(?:mp3|wav|ogg|opus|aac|flac|m4a)$/i, "").trim() || "speech";
  return `${title}.${extension}`;
}

export function referenceToken(id) {
  return `@[asset:${String(id).replace(/^asset:/, "")}]`;
}

export function storageKey(userId, name) {
  if (userId === undefined || userId === null || String(userId) === "") throw new Error("缺少用户信息");
  return `imageStudio:creative:${String(userId)}:${name}`;
}

export function readStored(userId, name, fallback) {
  try { return JSON.parse(localStorage.getItem(storageKey(userId, name))) ?? fallback; } catch { return fallback; }
}

export function writeStored(userId, name, data) {
  try { localStorage.setItem(storageKey(userId, name), JSON.stringify(data)); return true; } catch { return false; }
}
