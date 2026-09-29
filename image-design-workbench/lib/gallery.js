"use strict";

// 单件作品是画廊卡片；套图只用于详情中的关联浏览。
// 一个旧套图可能积累数百张图，仍需能逐件分页、搜索与收藏。
const { getPool } = require("./db");
const { normalizePagination } = require("./pagination");

const MEDIA_SQL =
  "SELECT 'image' AS kind, id, image_set_id, type, label, prompt, filename, created_at " +
  "FROM images WHERE owner_user_id = ? UNION ALL " +
  "SELECT 'video' AS kind, id, image_set_id, mode AS type, 'AI 视频' AS label, " +
  "prompt, filename, created_at FROM videos WHERE owner_user_id = ?";

const PUBLIC_MEDIA_SQL =
  "SELECT 'image' AS kind, source.id, source.type, source.label, source.prompt, " +
  "source.created_at, meta.title, meta.published_at " +
  "FROM gallery_entries AS meta JOIN images AS source " +
  "ON source.id = meta.media_id AND source.owner_user_id = meta.owner_user_id " +
  "WHERE meta.kind = 'image' AND meta.is_public = 1 UNION ALL " +
  "SELECT 'video' AS kind, source.id, source.mode AS type, 'AI 视频' AS label, " +
  "source.prompt, source.created_at, meta.title, meta.published_at " +
  "FROM gallery_entries AS meta JOIN videos AS source " +
  "ON source.id = meta.media_id AND source.owner_user_id = meta.owner_user_id " +
  "WHERE meta.kind = 'video' AND meta.is_public = 1";

function normalizeFilters(raw = {}) {
  return {
    media: ["image", "video"].includes(raw.media) ? raw.media : "all",
    favorite: raw.favorite === "1" || raw.favorite === true,
    keyword: String(raw.keyword || "").trim().slice(0, 120),
  };
}

function normalizeItemKey(kind, id) {
  if (!["image", "video"].includes(kind)) throw new Error("作品类型无效");
  const mediaId = String(id || "");
  if (!mediaId || mediaId.length > 255) throw new Error("作品编号无效");
  return { kind, id: mediaId };
}

function toGalleryItem(row) {
  const base = row.kind === "video" ? "videos" : "images";
  return {
    kind: row.kind,
    id: row.id,
    imageSetId: row.image_set_id || "",
    type: row.type || "",
    label: row.label || (row.kind === "video" ? "AI 视频" : "图片"),
    prompt: row.prompt || "",
    filename: row.filename || "",
    createdAt: row.created_at,
    title: row.title || "",
    favorite: Boolean(row.favorite),
    published: Boolean(row.is_public),
    url: "/api/" + base + "/file/" + encodeURIComponent(row.id),
    downloadUrl: "/api/" + base + "/download/" + encodeURIComponent(row.id),
  };
}

function toPublicItem(row) {
  return {
    kind: row.kind,
    id: row.id,
    type: row.type || "",
    label: row.label || (row.kind === "video" ? "AI 视频" : "图片"),
    prompt: row.prompt || "",
    title: row.title || "",
    createdAt: row.created_at,
    publishedAt: row.published_at,
    url: "/api/showcase/media/" + row.kind + "/" + encodeURIComponent(row.id),
  };
}

async function init() {
  await getPool().query(
    "CREATE TABLE IF NOT EXISTS gallery_entries (" +
      "owner_user_id BIGINT UNSIGNED NOT NULL, " +
      "kind ENUM('image','video') NOT NULL, " +
      "media_id VARCHAR(255) NOT NULL, " +
      "title VARCHAR(120) NOT NULL DEFAULT '', " +
      "favorite TINYINT(1) NOT NULL DEFAULT 0, " +
      "is_public TINYINT(1) NOT NULL DEFAULT 0, " +
      "published_at DATETIME NULL, " +
      "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
      "PRIMARY KEY (owner_user_id, kind, media_id), " +
      "KEY idx_gallery_favorite (owner_user_id, favorite), " +
      "KEY idx_gallery_public (is_public, published_at)" +
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci",
  );
  const [publicColumn] = await getPool().query("SHOW COLUMNS FROM gallery_entries LIKE 'is_public'");
  if (!publicColumn.length) {
    await getPool().query("ALTER TABLE gallery_entries ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0");
  }
  const [publishedColumn] = await getPool().query("SHOW COLUMNS FROM gallery_entries LIKE 'published_at'");
  if (!publishedColumn.length) {
    await getPool().query("ALTER TABLE gallery_entries ADD COLUMN published_at DATETIME NULL");
    await getPool().query("ALTER TABLE gallery_entries ADD KEY idx_gallery_public (is_public, published_at)");
  }
}

function mediaWithMetaSql() {
  return "FROM (" + MEDIA_SQL + ") AS media LEFT JOIN gallery_entries AS meta " +
    "ON meta.owner_user_id = ? AND meta.kind = media.kind AND meta.media_id = media.id";
}

async function listGallery(ownerUserId, raw = {}) {
  const filters = normalizeFilters(raw);
  const pagination = normalizePagination(raw.page, raw.pageSize);
  const where = [];
  const whereParams = [];
  if (filters.media !== "all") {
    where.push("media.kind = ?");
    whereParams.push(filters.media);
  }
  if (filters.favorite) where.push("COALESCE(meta.favorite, 0) = 1");
  if (filters.keyword) {
    const match = "%" + filters.keyword + "%";
    where.push("(meta.title LIKE ? OR media.prompt LIKE ? OR media.label LIKE ? OR media.type LIKE ?)");
    whereParams.push(match, match, match, match);
  }
  const source = mediaWithMetaSql() + (where.length ? " WHERE " + where.join(" AND ") : "");
  const params = [ownerUserId, ownerUserId, ownerUserId, ...whereParams];
  const db = getPool();
  const [countRows] = await db.query("SELECT COUNT(*) AS n " + source, params);
  const total = Number(countRows[0]?.n) || 0;
  const [rows] = await db.query(
    "SELECT media.*, COALESCE(meta.title, '') AS title, COALESCE(meta.favorite, 0) AS favorite, " +
      "COALESCE(meta.is_public, 0) AS is_public " +
      source + " ORDER BY media.created_at DESC, media.id DESC LIMIT ? OFFSET ?",
    [...params, pagination.pageSize, pagination.offset],
  );
  return {
    items: rows.map(toGalleryItem),
    pagination: { page: pagination.page, pageSize: pagination.pageSize, total },
  };
}

async function getOwnedItem(ownerUserId, kind, id) {
  const key = normalizeItemKey(kind, id);
  const table = key.kind === "video" ? "videos" : "images";
  const typeColumn = key.kind === "video" ? "mode" : "type";
  const labelColumn = key.kind === "video" ? "'AI 视频'" : "source.label";
  const [rows] = await getPool().query(
    "SELECT ? AS kind, source.id, source.image_set_id, source." + typeColumn + " AS type, " +
      labelColumn + " AS label, source.prompt, source.filename, source.created_at, " +
      "COALESCE(meta.title, '') AS title, COALESCE(meta.favorite, 0) AS favorite, " +
      "COALESCE(meta.is_public, 0) AS is_public " +
      "FROM " + table + " AS source LEFT JOIN gallery_entries AS meta " +
      "ON meta.owner_user_id = ? AND meta.kind = ? AND meta.media_id = source.id " +
      "WHERE source.owner_user_id = ? AND source.id = ? LIMIT 1",
    [key.kind, ownerUserId, key.kind, ownerUserId, key.id],
  );
  return rows[0] ? toGalleryItem(rows[0]) : null;
}

async function getGalleryDetail(ownerUserId, kind, id) {
  const selected = await getOwnedItem(ownerUserId, kind, id);
  if (!selected) return null;
  if (!selected.imageSetId) {
    return { item: selected, items: [selected], selectedIndex: 0, totalInSet: 1 };
  }
  const db = getPool();
  const [rows] = await db.query(
    "SELECT media.*, COALESCE(meta.title, '') AS title, COALESCE(meta.favorite, 0) AS favorite, " +
      "COALESCE(meta.is_public, 0) AS is_public " +
      mediaWithMetaSql() +
      " WHERE media.image_set_id = ? AND NOT (media.kind = ? AND media.id = ?) " +
      "ORDER BY ABS(TIMESTAMPDIFF(SECOND, media.created_at, ?)), media.created_at DESC LIMIT 11",
    [ownerUserId, ownerUserId, ownerUserId, selected.imageSetId, selected.kind, selected.id, selected.createdAt],
  );
  const [countRows] = await db.query(
    "SELECT COUNT(*) AS n FROM (" + MEDIA_SQL + ") AS media WHERE media.image_set_id = ?",
    [ownerUserId, ownerUserId, selected.imageSetId],
  );
  const items = [selected, ...rows.map(toGalleryItem)].sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt) || b.id.localeCompare(a.id));
  return {
    item: selected,
    items,
    selectedIndex: items.findIndex((entry) => entry.kind === selected.kind && entry.id === selected.id),
    totalInSet: Number(countRows[0]?.n) || 1,
  };
}

async function updateGalleryItem(ownerUserId, kind, id, payload = {}) {
  const key = normalizeItemKey(kind, id);
  const existing = await getOwnedItem(ownerUserId, key.kind, key.id);
  if (!existing) return null;
  if (Object.hasOwn(payload, "title") &&
      (typeof payload.title !== "string" || payload.title.trim().length > 120)) {
    throw new Error("标题不能超过 120 个字");
  }
  if (Object.hasOwn(payload, "favorite") && typeof payload.favorite !== "boolean") {
    throw new Error("收藏状态无效");
  }
  if (Object.hasOwn(payload, "published") && typeof payload.published !== "boolean") {
    throw new Error("发布状态无效");
  }
  if (Object.hasOwn(payload, "title")) {
    await getPool().query(
      "INSERT INTO gallery_entries (owner_user_id, kind, media_id, title) VALUES (?, ?, ?, ?) " +
        "ON DUPLICATE KEY UPDATE title = VALUES(title)",
      [ownerUserId, key.kind, key.id, payload.title.trim()],
    );
  }
  if (Object.hasOwn(payload, "favorite")) {
    await getPool().query(
      "INSERT INTO gallery_entries (owner_user_id, kind, media_id, favorite) VALUES (?, ?, ?, ?) " +
        "ON DUPLICATE KEY UPDATE favorite = VALUES(favorite)",
      [ownerUserId, key.kind, key.id, payload.favorite ? 1 : 0],
    );
  }
  if (Object.hasOwn(payload, "published")) {
    await getPool().query(
      "INSERT INTO gallery_entries (owner_user_id, kind, media_id, is_public, published_at) " +
        "VALUES (?, ?, ?, ?, IF(?, NOW(), NULL)) " +
        "ON DUPLICATE KEY UPDATE is_public = VALUES(is_public), published_at = VALUES(published_at)",
      [ownerUserId, key.kind, key.id, payload.published ? 1 : 0, payload.published ? 1 : 0],
    );
  }
  return getOwnedItem(ownerUserId, key.kind, key.id);
}

async function listShowcase(raw = {}) {
  const filters = normalizeFilters(raw);
  const pagination = normalizePagination(raw.page, raw.pageSize);
  const where = [];
  const params = [];
  if (filters.media !== "all") {
    where.push("media.kind = ?");
    params.push(filters.media);
  }
  if (filters.keyword) {
    const match = "%" + filters.keyword + "%";
    where.push("(media.title LIKE ? OR media.prompt LIKE ? OR media.label LIKE ?)");
    params.push(match, match, match);
  }
  const source = "FROM (" + PUBLIC_MEDIA_SQL + ") AS media" +
    (where.length ? " WHERE " + where.join(" AND ") : "");
  const db = getPool();
  const [countRows] = await db.query("SELECT COUNT(*) AS n " + source, params);
  const [rows] = await db.query(
    "SELECT media.* " + source +
      " ORDER BY media.published_at DESC, media.id DESC LIMIT ? OFFSET ?",
    [...params, pagination.pageSize, pagination.offset],
  );
  return {
    items: rows.map(toPublicItem),
    pagination: { page: pagination.page, pageSize: pagination.pageSize, total: Number(countRows[0]?.n) || 0 },
  };
}

async function getPublicMediaOwner(kind, id) {
  const key = normalizeItemKey(kind, id);
  const table = key.kind === "video" ? "videos" : "images";
  const [rows] = await getPool().query(
    "SELECT source.owner_user_id AS owner_user_id FROM gallery_entries AS meta " +
      "JOIN " + table + " AS source ON source.id = meta.media_id " +
      "AND source.owner_user_id = meta.owner_user_id " +
      "WHERE meta.kind = ? AND meta.media_id = ? AND meta.is_public = 1 LIMIT 1",
    [key.kind, key.id],
  );
  return rows[0]?.owner_user_id ?? null;
}

async function removeByOwner(ownerUserId) {
  await getPool().query("DELETE FROM gallery_entries WHERE owner_user_id = ?", [ownerUserId]);
}

module.exports = {
  init, listGallery, getGalleryDetail, updateGalleryItem, removeByOwner,
  listShowcase, getPublicMediaOwner, normalizeFilters, normalizeItemKey, toGalleryItem, toPublicItem,
};
