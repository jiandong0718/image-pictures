"use strict";

const crypto = require("crypto");
const { inputError, cleanText, normalizeAudioConfig, readLimitedBody } = require("./audio-client");

const MAX_TAGS = 20;
const MAX_CONTENT = 20000;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_TRUSTED_SOURCE_BYTES = 20 * 1024 * 1024;
const SOURCE_RETRY_MS = 60000;

function isAllowedNanoBananaPrompt(item) {
  const text = String(item?.prompt ?? item?.content ?? "").toLowerCase();
  return text.length > 0 && !/\b(nsfw|porn|porno|nude|nudity|naked|topless|explicit|erotic|fetish|sexual|lingerie|underwear|minor|child|teenage)\b/.test(text);
}

// 创作卡片页使用 12/18 条，独立于旧图库的 10/20/50 分页规则。
function normalizePagination(rawPage, rawPageSize) {
  const page = Number.isSafeInteger(Number(rawPage)) && Number(rawPage) > 0 && Number(rawPage) <= 1000000 ? Number(rawPage) : 1;
  const pageSize = Number.isInteger(Number(rawPageSize)) && Number(rawPageSize) > 0 && Number(rawPageSize) <= 100 ? Number(rawPageSize) : 18;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// 固定来源，刷新接口只接收 sourceId，绝不接收用户提供的 URL。
// 缓存由服务器维护；刷新失败不覆盖已经可用的内容。
const PROMPT_SOURCES = Object.freeze([
  ["banana-prompt-quicker", "Banana Prompt Quicker"],
  ["davidwu-gpt-image2-prompts", "DavidWu GPT Image 2"],
  ["freestylefly-gpt-image-2", "Freestylefly GPT Image 2"],
  ["awesome-gpt-image", "Awesome GPT Image"],
  ["awesome-gpt4o-image-prompts", "Awesome GPT-4o"],
  ["youmind-gpt-image-2", "YouMind GPT Image 2"],
  ["youmind-nano-banana-pro", "YouMind Nano Banana Pro"],
  [
    "imgedify-nano-banana-pro",
    "ImgEdify Nano Banana Pro（精选 1000）",
    "https://raw.githubusercontent.com/ImgEdify/awesome-nano-banana-pro-prompts/main/data/prompts.json",
    { maxItems: 1000, maxBytes: MAX_TRUSTED_SOURCE_BYTES, timeoutMs: 60000, useRemoteImages: false, filter: isAllowedNanoBananaPrompt },
  ],
].map(([id, title, url, options = {}]) => Object.freeze({
  id,
  title,
  url: url || `https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/${id}.json`,
  ...options,
})));

function normalizeTags(raw = []) {
  if (!Array.isArray(raw) || raw.length > MAX_TAGS) throw inputError("标签需为数组，最多 20 个");
  return [...new Set(raw.map((tag) => cleanText(tag, "标签", 40, true)))];
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw inputError("资源 ID 不正确");
  return id;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapPrompt(row) {
  return { id: row.id, title: row.title, content: row.content, tags: parseJson(row.tags, []), source: row.source_id || "mine", createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapAsset(row, internal = false) {
  if (!row) return null;
  const asset = { id: row.id, kind: row.kind, title: row.title, content: row.content || "", tags: parseJson(row.tags, []), favorite: Boolean(row.favorite), mediaId: row.media_id || "", mime: row.mime || "", size: Number(row.byte_size) || 0, url: row.kind === "text" ? "" : `/api/assets/file/${row.id}`, imageId: row.kind === "image" ? row.media_id || `asset:${row.id}` : "", createdAt: row.created_at, updatedAt: row.updated_at };
  asset.fileUrl = asset.url;
  if (asset.kind === "image") asset.thumbnailUrl = `${asset.url}?thumb=1`;
  if (asset.kind === "audio") {
    asset.format = ({ "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mp4": "m4a", "audio/flac": "flac", "audio/x-flac": "flac", "audio/aac": "aac" })[asset.mime] || "bin";
    asset.filename = `audio-${asset.id}.${asset.format}`;
  }
  if (internal) Object.assign(asset, { ownerUserId: row.owner_user_id, storagePath: row.storage_path || "", generationTaskId: row.generation_task_id || "" });
  return asset;
}

function sourceText(value, maxLength = 12000) {
  return ["string", "number"].includes(typeof value) ? String(value).trim().slice(0, maxLength) : "";
}

function sourceUrl(value, base) {
  const text = sourceText(value, 4096);
  if (!text) return "";
  try {
    const url = new URL(text, base);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : "";
  } catch { return ""; }
}

function publicSourcePrompt(item, source) {
  const referenceImageUrls = [...new Set((Array.isArray(item.referenceImageUrls) ? item.referenceImageUrls : []).map((url) => sourceUrl(url, source.url)).filter(Boolean))];
  return {
    ...item,
    content: item.content ?? item.prompt ?? "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    source: source.id,
    sourceId: source.id,
    sourceName: source.title,
    readOnly: true,
    description: sourceText(item.description),
    author: sourceText(item.author, 300),
    coverUrl: sourceUrl(item.coverUrl, source.url) || referenceImageUrls[0] || "",
    referenceImageUrls,
    sourceUrl: sourceUrl(item.sourceUrl, source.url),
  };
}

function normalizeSourcePrompts(value, sourceId, sourceInfo) {
  const items = Array.isArray(value) ? value : value?.prompts || value?.items || value?.data;
  if (!Array.isArray(items) || !items.length || items.length > 10000) throw inputError("来源必须是非空的标准 JSON 提示词数组，最多 10000 条", 502);
  const source = sourceInfo || PROMPT_SOURCES.find((item) => item.id === sourceId) || { id: sourceId, title: sourceId };
  const accepted = typeof source.filter === "function" ? items.filter((item) => source.filter(item)) : items;
  const bounded = accepted.slice(0, Number.isSafeInteger(source.maxItems) ? source.maxItems : 10000);
  if (!bounded.length) throw inputError("来源没有可用的提示词", 502);
  const normalized = bounded.map((item, index) => {
    const content = cleanText(item?.content ?? item?.prompt, "来源提示词", MAX_CONTENT, true);
    const title = cleanText(item?.title ?? item?.name ?? item?.act ?? `提示词 ${index + 1}`, "来源标题", 160, true);
    const originalId = ["string", "number"].includes(typeof item?.id) ? String(item.id).trim() : "";
    // 同样的文案可以对应不同案例/封面；以源内 ID 识别，不能按正文合并。
    const identity = originalId || `item-${index + 1}-${crypto.createHash("sha256").update(JSON.stringify(item)).digest("hex").slice(0, 20)}`;
    const tags = [...(Array.isArray(item?.tags) ? item.tags : []), item?.category, item?.style].filter(Boolean);
    return publicSourcePrompt({ id: `${sourceId}:${identity}`, originalId, title, content, tags: normalizeTags(tags), description: item?.description, author: item?.author, coverUrl: source.useRemoteImages === false ? "" : item?.coverUrl || item?.images?.[0], referenceImageUrls: source.useRemoteImages === false ? [] : item?.referenceImageUrls || item?.images, sourceUrl: item?.sourceUrl || item?.source_url }, source);
  });
  return [...new Map(normalized.map((item) => [item.id, item])).values()];
}

function createCreativeResources({ getPool = () => require("./db").getPool(), fetchImpl = (...args) => globalThis.fetch(...args), sources = PROMPT_SOURCES } = {}) {
  const refreshes = new Map();
  const refreshAttempts = new Map();

  async function init() {
    const pool = getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS creative_prompts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_user_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(160) NOT NULL, content MEDIUMTEXT NOT NULL, tags TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_creative_prompt_owner (owner_user_id, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS creative_assets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_user_id BIGINT UNSIGNED NOT NULL,
      kind VARCHAR(16) NOT NULL, title VARCHAR(160) NOT NULL, content MEDIUMTEXT NULL,
      tags TEXT NOT NULL, favorite TINYINT(1) NOT NULL DEFAULT 0,
      media_id VARCHAR(255) NULL, storage_path VARCHAR(255) NULL,
      generation_task_id CHAR(36) NULL,
      mime VARCHAR(100) NULL, byte_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_creative_asset_owner (owner_user_id, kind, updated_at),
      UNIQUE KEY uniq_creative_asset_task (generation_task_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
    // 仅为本次新增素材表补齐关联列；兼容开发测试期间已经建好的表。
    try { await pool.query("ALTER TABLE creative_assets ADD COLUMN generation_task_id CHAR(36) NULL"); }
    catch (error) { if (error.errno !== 1060) throw error; }
    try { await pool.query("ALTER TABLE creative_assets ADD UNIQUE KEY uniq_creative_asset_task (generation_task_id)"); }
    catch (error) { if (error.errno !== 1061) throw error; }
    await pool.query(`CREATE TABLE IF NOT EXISTS creative_prompt_cache (
      source_id VARCHAR(64) NOT NULL PRIMARY KEY, items MEDIUMTEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS creative_audio_config (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      api_base VARCHAR(500) NOT NULL DEFAULT '', api_key VARCHAR(1000) NOT NULL DEFAULT '',
      model VARCHAR(100) NOT NULL DEFAULT '', characters_per_credit INT NOT NULL DEFAULT 1000, credits_per_unit INT NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  }

  async function listPrompts(userId, query = {}) {
    const page = normalizePagination(query.page, query.pageSize);
    const source = cleanText(query.source || "mine", "来源", 64);
    const q = cleanText(query.q, "搜索内容", 200);
    const tag = cleanText(query.tag, "标签", 40);
    if (source !== "mine") {
      const selected = source === "all" ? sources : sources.filter((item) => item.id === source);
      if (!selected.length) throw inputError("提示词来源不存在", 404);
      const loaded = await Promise.all(selected.map(async (definition) => {
        let cache = await readSourceCache(definition.id);
        let refresh;
        if (!cache) {
          try { refresh = await refreshPromptSource(definition.id); }
          catch (error) { refresh = { success: false, error: error.message, warning: error.message }; }
          cache = await readSourceCache(definition.id);
        }
        const items = parseJson(cache?.items, []).map((item) => publicSourcePrompt(item, definition));
        const last = refresh || refreshAttempts.get(definition.id)?.result;
        return { items, source: { id: definition.id, title: definition.title, count: items.length, cachedAt: cache?.updated_at || null, success: last?.success !== false && Boolean(cache), error: last?.error || "", stale: last?.success === false && Boolean(cache) } };
      }));
      const allItems = loaded.flatMap((item) => item.items);
      const items = allItems.filter((item) => (!q || [item.title, item.content, item.description, item.author, item.sourceName, ...item.tags].join("\n").toLowerCase().includes(q.toLowerCase())) && (!tag || item.tags.some((value) => String(value).toLowerCase() === tag.toLowerCase())));
      const sourceStatuses = loaded.map((item) => item.source);
      const warnings = sourceStatuses.filter((item) => item.error).map((item) => ({ sourceId: item.id, sourceName: item.title, error: item.error }));
      return { items: items.slice(page.offset, page.offset + page.pageSize), total: items.length, totalAvailable: allItems.length, page: page.page, pageSize: page.pageSize, sources: sourceStatuses, warnings, tags: [...new Set(allItems.flatMap((item) => item.tags))].sort(), cachedAt: sourceStatuses.length === 1 ? sourceStatuses[0].cachedAt : null };
    }
    const where = ["owner_user_id = ?"];
    const values = [userId];
    if (q) { where.push("(title LIKE ? OR content LIKE ?)"); values.push(`%${q}%`, `%${q}%`); }
    if (tag) { where.push("JSON_CONTAINS(tags, ?) = 1"); values.push(JSON.stringify(tag)); }
    const [counts] = await getPool().query(`SELECT COUNT(*) AS n FROM creative_prompts WHERE ${where.join(" AND ")}`, values);
    const [rows] = await getPool().query(`SELECT * FROM creative_prompts WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`, [...values, page.pageSize, page.offset]);
    return { items: rows.map(mapPrompt), total: Number(counts[0].n), page: page.page, pageSize: page.pageSize };
  }

  async function savePrompt(userId, raw = {}) {
    const title = cleanText(raw.title, "标题", 160, true);
    const content = cleanText(raw.content, "提示词", MAX_CONTENT, true);
    const tags = normalizeTags(raw.tags);
    let id;
    if (raw.id !== undefined) {
      id = positiveId(raw.id);
      const [result] = await getPool().query("UPDATE creative_prompts SET title = ?, content = ?, tags = ? WHERE id = ? AND owner_user_id = ?", [title, content, JSON.stringify(tags), id, userId]);
      if (!result.affectedRows) throw inputError("提示词不存在", 404);
    } else {
      const [result] = await getPool().query("INSERT INTO creative_prompts (owner_user_id, title, content, tags) VALUES (?, ?, ?, ?)", [userId, title, content, JSON.stringify(tags)]);
      id = result.insertId;
    }
    const [rows] = await getPool().query("SELECT * FROM creative_prompts WHERE id = ? AND owner_user_id = ?", [id, userId]);
    return mapPrompt(rows[0]);
  }

  async function deletePrompt(userId, id) {
    const [result] = await getPool().query("DELETE FROM creative_prompts WHERE id = ? AND owner_user_id = ?", [positiveId(id), userId]);
    if (!result.affectedRows) throw inputError("提示词不存在", 404);
  }

  async function listPromptSources() {
    const [rows] = await getPool().query("SELECT source_id, updated_at, JSON_LENGTH(items) AS item_count FROM creative_prompt_cache");
    return sources.map((source) => {
      const cache = rows.find((row) => row.source_id === source.id);
      const last = refreshAttempts.get(source.id)?.result;
      return { id: source.id, title: source.title, url: source.url, cachedAt: cache?.updated_at || null, lastRefreshedAt: cache?.updated_at || null, count: Number(cache?.item_count) || 0, lastError: last?.error || "" };
    });
  }

  async function readSourceCache(sourceId) {
    const [rows] = await getPool().query("SELECT items, updated_at FROM creative_prompt_cache WHERE source_id = ?", [sourceId]);
    return rows[0] || null;
  }

  async function refreshPromptSource(sourceId, { force = false } = {}) {
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw inputError("提示词来源不存在", 404);
    if (refreshes.has(sourceId)) {
      const active = refreshes.get(sourceId);
      let result;
      try { result = await active.work; }
      catch (error) {
        if (force && !active.force && !active.didFetch) return refreshPromptSource(sourceId, { force: true });
        throw error;
      }
      // 若先到的普通请求仅复用了缓存，后到的强制请求仍需真正更新元数据。
      if (force && !active.force && !active.didFetch) return refreshPromptSource(sourceId, { force: true });
      return result;
    }
    const active = { work: null, force, didFetch: false };
    const work = (async () => {
      const existing = await readSourceCache(sourceId);
      const previous = refreshAttempts.get(sourceId);
      // 防止反复点击造成源站请求风暴。
      if (!force && previous && Date.now() - previous.at < SOURCE_RETRY_MS && previous.result?.success === false) {
        if (existing) return { ...previous.result, reused: true, throttled: true };
        throw inputError(previous.result.error, 502);
      }
      if (!force && existing && Date.now() - new Date(existing.updated_at).getTime() < SOURCE_RETRY_MS) return { sourceId, sourceName: source.title, count: parseJson(existing.items, []).length, cachedAt: existing.updated_at, reused: true, success: true };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const attemptedAt = Date.now();
      try {
        active.didFetch = true;
        const response = await fetchImpl(source.url, { redirect: "error", signal: controller.signal, headers: { Accept: "application/json" } });
        if (!response.ok) { await response.body?.cancel(); throw inputError(`来源返回 HTTP ${response.status}`, 502); }
      const raw = await readLimitedBody(response, Math.min(MAX_TRUSTED_SOURCE_BYTES, source.maxBytes || MAX_SOURCE_BYTES));
        const items = normalizeSourcePrompts(JSON.parse(raw.toString("utf8")), sourceId, source);
        await getPool().query("INSERT INTO creative_prompt_cache (source_id, items) VALUES (?, ?) ON DUPLICATE KEY UPDATE items = VALUES(items), updated_at = CURRENT_TIMESTAMP", [sourceId, JSON.stringify(items)]);
        const result = { sourceId, sourceName: source.title, count: items.length, cachedAt: new Date().toISOString(), reused: false, success: true };
        refreshAttempts.set(sourceId, { at: attemptedAt, result });
        return result;
      } catch (error) {
        const reason = error.statusCode ? error.message : error instanceof SyntaxError ? "来源 JSON 格式不正确" : controller.signal.aborted ? "来源请求超时" : "来源同步失败";
        const result = { sourceId, sourceName: source.title, count: parseJson(existing?.items, []).length, cachedAt: existing?.updated_at || null, stale: Boolean(existing), success: false, error: reason, warning: existing ? `${reason}，已保留上次缓存` : `${reason}，当前还没有缓存，请稍后重试` };
        refreshAttempts.set(sourceId, { at: attemptedAt, result });
        if (existing) return result;
        throw inputError(result.warning, 502);
      } finally { clearTimeout(timer); }
    })();
    active.work = work;
    refreshes.set(sourceId, active);
    try { return await work; } finally { if (refreshes.get(sourceId)?.work === work) refreshes.delete(sourceId); }
  }

  async function refreshAllSources(options = {}) {
    const results = await Promise.all(sources.map(async (source) => {
      try { return await refreshPromptSource(source.id, options); }
      catch (error) { return { sourceId: source.id, sourceName: source.title, count: 0, success: false, stale: false, error: error.message }; }
    }));
    const count = results.reduce((total, result) => total + result.count, 0);
    const successCount = results.filter((result) => result.success).length;
    const failureCount = results.length - successCount;
    return { sourceId: "all", results, sources: results, count, total: count, successCount, failureCount, stale: failureCount > 0, ...(failureCount ? { warning: `${failureCount} 个来源同步失败，已保留可用缓存` } : {}) };
  }

  async function getAsset(userId, id) {
    const [rows] = await getPool().query("SELECT * FROM creative_assets WHERE id = ? AND owner_user_id = ?", [positiveId(id), userId]);
    if (!rows.length) throw inputError("素材不存在", 404);
    return mapAsset(rows[0], true);
  }

  async function findAssetByTask(userId, taskId) {
    const [rows] = await getPool().query("SELECT * FROM creative_assets WHERE generation_task_id = ? AND owner_user_id = ? LIMIT 1", [taskId, userId]);
    return mapAsset(rows[0], true);
  }

  async function getOwnedMedia(userId, kind, mediaId) {
    if (!["image", "video"].includes(kind)) throw inputError("媒体类型不正确");
    const id = cleanText(mediaId, "媒体 ID", 255, true);
    if (!/^\d{1,16}\/[a-zA-Z0-9._-]+\.(?:png|jpe?g|webp|gif|mp4)$/i.test(id)) throw inputError("媒体 ID 格式不正确");
    const table = kind === "image" ? "images" : "videos";
    const [rows] = await getPool().query(`SELECT id, image_set_id, filename FROM ${table} WHERE id = ? AND owner_user_id = ?`, [id, userId]);
    if (!rows.length) throw inputError("媒体不存在或不属于当前账户", 404);
    return rows[0];
  }

  async function createAsset(userId, raw = {}, file = null) {
    const kind = raw.kind;
    if (!["text", "image", "video", "audio"].includes(kind)) throw inputError("素材类型不正确");
    const title = cleanText(raw.title, "标题", 160, true);
    const tags = normalizeTags(raw.tags);
    const content = kind === "text" ? cleanText(raw.content, "文本素材", MAX_CONTENT, true) : kind === "audio" ? cleanText(raw.content, "朗读文本", 4096) : "";
    let mediaId = null;
    if (!file && kind !== "text") {
      const media = await getOwnedMedia(userId, kind, raw.mediaId);
      mediaId = media.id;
    }
    // taskId 只允许由服务端文件参数传入，永远不读取客户端 raw.taskId。
    const generationTaskId = kind === "audio" && file?.taskId ? cleanText(file.taskId, "生成任务 ID", 36, true) : null;
    if (generationTaskId && !/^[a-zA-Z0-9_-]+$/.test(generationTaskId)) throw inputError("生成任务 ID 格式不正确");
    const [result] = await getPool().query("INSERT INTO creative_assets (owner_user_id, kind, title, content, tags, media_id, storage_path, mime, byte_size, generation_task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [userId, kind, title, content, JSON.stringify(tags), mediaId, file?.storagePath || null, file?.mime || null, file?.size || 0, generationTaskId]);
    return getAsset(userId, result.insertId);
  }

  async function listAssets(userId, query = {}) {
    const page = normalizePagination(query.page, query.pageSize);
    const where = ["owner_user_id = ?"];
    const values = [userId];
    const q = cleanText(query.q, "搜索内容", 200);
    const tag = cleanText(query.tag, "标签", 40);
    if (q) { where.push("(title LIKE ? OR content LIKE ?)"); values.push(`%${q}%`, `%${q}%`); }
    if (tag) { where.push("JSON_CONTAINS(tags, ?) = 1"); values.push(JSON.stringify(tag)); }
    if (query.kind) {
      if (!["text", "image", "video", "audio"].includes(query.kind)) throw inputError("素材类型不正确");
      where.push("kind = ?"); values.push(query.kind);
    }
    if (query.favorite === "true" || query.favorite === true) where.push("favorite = 1");
    const [counts] = await getPool().query(`SELECT COUNT(*) AS n FROM creative_assets WHERE ${where.join(" AND ")}`, values);
    const [rows] = await getPool().query(`SELECT * FROM creative_assets WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`, [...values, page.pageSize, page.offset]);
    return { items: rows.map((row) => mapAsset(row)), total: Number(counts[0].n), page: page.page, pageSize: page.pageSize };
  }

  async function updateAsset(userId, id, raw = {}) {
    const fields = [];
    const values = [];
    if (raw.title !== undefined) { fields.push("title = ?"); values.push(cleanText(raw.title, "标题", 160, true)); }
    if (raw.tags !== undefined) { fields.push("tags = ?"); values.push(JSON.stringify(normalizeTags(raw.tags))); }
    if (raw.favorite !== undefined) {
      if (typeof raw.favorite !== "boolean") throw inputError("收藏状态需为布尔值");
      fields.push("favorite = ?"); values.push(Number(raw.favorite));
    }
    if (!fields.length) throw inputError("没有可更新的素材字段");
    const [result] = await getPool().query(`UPDATE creative_assets SET ${fields.join(", ")} WHERE id = ? AND owner_user_id = ?`, [...values, positiveId(id), userId]);
    if (!result.affectedRows) throw inputError("素材不存在", 404);
    return getAsset(userId, id);
  }

  async function deleteAsset(userId, id) {
    const asset = await getAsset(userId, id);
    const [result] = await getPool().query("DELETE FROM creative_assets WHERE id = ? AND owner_user_id = ?", [positiveId(id), userId]);
    if (!result.affectedRows) throw inputError("素材不存在", 404);
    return asset;
  }

  async function resolveComposition(userId, raw = {}) {
    const text = cleanText(raw.text, "编排提示词", MAX_CONTENT);
    if (raw.assetIds !== undefined && (!Array.isArray(raw.assetIds) || raw.assetIds.length > 50)) throw inputError("最多引用 50 个素材");
    const tokenIds = [...text.matchAll(/@\[asset:(\d+)\]/g)].map((match) => positiveId(match[1]));
    const assetIds = [...new Set([...tokenIds, ...(raw.assetIds || []).map(positiveId)])];
    if (assetIds.length > 50) throw inputError("最多引用 50 个素材");
    const assets = await Promise.all(assetIds.map((id) => getAsset(userId, id)));
    const imageIds = [];
    const replacements = new Map();
    for (const asset of assets) {
      if (asset.kind === "text") replacements.set(Number(asset.id), asset.content);
      else if (asset.kind === "image") {
        if (asset.mediaId) await getOwnedMedia(userId, "image", asset.mediaId);
        const imageId = asset.imageId;
        if (!imageIds.includes(imageId)) imageIds.push(imageId);
        replacements.set(Number(asset.id), `[参考图 ${imageIds.indexOf(imageId) + 1}：${asset.title}]`);
      } else throw inputError("提示词编排目前仅支持文本和图片素材");
    }
    let prompt = text.replace(/@\[asset:(\d+)\]/g, (_, id) => replacements.get(Number(id)));
    for (const id of assetIds) if (!tokenIds.includes(id)) prompt += `${prompt ? "\n\n" : ""}${replacements.get(id)}`;
    if (!prompt.trim()) throw inputError("请填写提示词或选择文本、图片素材");
    if (prompt.length > MAX_CONTENT) throw inputError(`展开后的提示词不能超过 ${MAX_CONTENT} 字符`);
    if (imageIds.length > 16) throw inputError("最多引用 16 张图片");
    return { prompt, imageIds, assetIds };
  }

  async function getAudioConfig() {
    const [rows] = await getPool().query("SELECT api_base, api_key, model, characters_per_credit, credits_per_unit FROM creative_audio_config WHERE id = 1");
    const row = rows[0];
    return { apiBase: row?.api_base || "", apiKey: row?.api_key || "", model: row?.model || "", charactersPerCredit: Number(row?.characters_per_credit) || 1000, creditsPerUnit: Number(row?.credits_per_unit) || 1 };
  }

  async function saveAudioConfig(raw) {
    const config = normalizeAudioConfig(raw, await getAudioConfig());
    await getPool().query("INSERT INTO creative_audio_config (id, api_base, api_key, model, characters_per_credit, credits_per_unit) VALUES (1, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE api_base = VALUES(api_base), api_key = VALUES(api_key), model = VALUES(model), characters_per_credit = VALUES(characters_per_credit), credits_per_unit = VALUES(credits_per_unit)", [config.apiBase, config.apiKey, config.model, config.charactersPerCredit, config.creditsPerUnit]);
    return config;
  }

  return { init, listPrompts, savePrompt, deletePrompt, listPromptSources, refreshPromptSource, refreshAllSources, getAsset, findAssetByTask, getOwnedMedia, createAsset, listAssets, updateAsset, deleteAsset, resolveComposition, getAudioConfig, saveAudioConfig };
}

const defaults = createCreativeResources();
module.exports = { ...defaults, createCreativeResources, PROMPT_SOURCES, MAX_CONTENT, normalizeTags, positiveId, normalizeSourcePrompts, mapAsset };
