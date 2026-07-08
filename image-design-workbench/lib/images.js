"use strict";

// 图片元数据表：每张生成的图落一条记录（提示词/类型/时间/归属/所属套图/文件名），
// 用于「我的图库」按时间倒序分页 + 按提示词搜索。图片本体仍在磁盘
// （generated-images/product-design/<套图>/），这里只存索引；id 即相对路径（如 "033/playground-...-01.png"）。

const { getPool } = require("./db");
const { normalizePagination } = require("./pagination");

async function createTables() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS images (
      id VARCHAR(255) NOT NULL,
      owner_user_id BIGINT UNSIGNED NULL,
      image_set_id VARCHAR(16) NULL,
      type VARCHAR(48) NULL,
      label VARCHAR(64) NULL,
      prompt TEXT NULL,
      filename VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_owner_created (owner_user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
  `);
}

async function init() {
  await createTables();
}

// 落一条图片记录。id 重复（同一文件回填多次）时只更新元数据，不改 created_at。
// 不传 createdAt 走库默认 CURRENT_TIMESTAMP（服务器本地时间）；回填历史图时传解析出的本地时间。
async function recordImage(rec = {}) {
  if (!rec.id) {
    return;
  }
  const cols = ["id", "owner_user_id", "image_set_id", "type", "label", "prompt", "filename"];
  const vals = [
    rec.id,
    rec.ownerUserId ?? null,
    rec.imageSetId ?? null,
    rec.type ?? null,
    rec.label ?? null,
    rec.prompt ?? "",
    rec.filename ?? null,
  ];
  if (rec.createdAt) {
    cols.push("created_at");
    vals.push(rec.createdAt);
  }
  const placeholders = cols.map(() => "?").join(", ");
  await getPool().query(
    `INSERT INTO images (${cols.join(", ")}) VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE
       owner_user_id = VALUES(owner_user_id),
       image_set_id = VALUES(image_set_id),
       type = VALUES(type),
       label = VALUES(label),
       prompt = VALUES(prompt),
       filename = VALUES(filename)`,
    vals,
  );
}

// 分页列出某用户的图；keyword 匹配提示词，type 精确匹配类型。
async function listImages(ownerUserId, { page, pageSize, keyword = "", type = "" } = {}) {
  const p = normalizePagination(page, pageSize);
  const where = ["owner_user_id = ?"];
  const params = [ownerUserId];
  if (keyword) {
    where.push("prompt LIKE ?");
    params.push(`%${keyword}%`);
  }
  if (type) {
    where.push("type = ?");
    params.push(type);
  }
  const whereSql = where.join(" AND ");
  const pool = getPool();
  const [countRows] = await pool.query(`SELECT COUNT(*) AS n FROM images WHERE ${whereSql}`, params);
  const total = Number(countRows[0].n) || 0;
  const [rows] = await pool.query(
    `SELECT id, image_set_id, type, label, prompt, filename, created_at
     FROM images WHERE ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, p.pageSize, p.offset],
  );
  return { items: rows, total, page: p.page, pageSize: p.pageSize };
}

// 回填历史图时用：已有记录的套图直接跳过，避免每次启动重复扫盘。
async function listRecordedSetIds() {
  const [rows] = await getPool().query(
    "SELECT DISTINCT image_set_id FROM images WHERE image_set_id IS NOT NULL",
  );
  return rows.map((row) => row.image_set_id);
}

async function removeByOwner(ownerUserId) {
  await getPool().query("DELETE FROM images WHERE owner_user_id = ?", [ownerUserId]);
}

module.exports = { init, recordImage, listImages, listRecordedSetIds, removeByOwner };
