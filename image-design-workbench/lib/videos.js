"use strict";

// 生视频元数据表：每条生成结果落一条记录（模式/提示词/时长/尺寸/归属/文件名），
// 供生视频页「最近生成」列出，避免刷新/换设备后丢失已扣费的视频。视频本体存磁盘
// （generated-images/product-design/<套图>/*.mp4），这里只存索引；id 即相对路径。

const { getPool } = require("./db");
const { normalizePagination } = require("./pagination");

async function createTables() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS videos (
      id VARCHAR(255) NOT NULL,
      owner_user_id BIGINT UNSIGNED NULL,
      image_set_id VARCHAR(16) NULL,
      mode VARCHAR(24) NULL,
      prompt TEXT NULL,
      filename VARCHAR(255) NULL,
      seconds VARCHAR(16) NULL,
      size VARCHAR(24) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_owner_created (owner_user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
  `);
}

async function init() {
  await createTables();
}

async function recordVideo(rec = {}) {
  if (!rec.id) {
    return;
  }
  await getPool().query(
    `INSERT INTO videos (id, owner_user_id, image_set_id, mode, prompt, filename, seconds, size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       owner_user_id = VALUES(owner_user_id),
       image_set_id = VALUES(image_set_id),
       mode = VALUES(mode),
       prompt = VALUES(prompt),
       filename = VALUES(filename),
       seconds = VALUES(seconds),
       size = VALUES(size)`,
    [
      rec.id,
      rec.ownerUserId ?? null,
      rec.imageSetId ?? null,
      rec.mode ?? null,
      rec.prompt ?? "",
      rec.filename ?? null,
      rec.seconds ?? null,
      rec.size ?? null,
    ],
  );
}

async function listVideos(ownerUserId, { page, pageSize } = {}) {
  const p = normalizePagination(page, pageSize);
  const pool = getPool();
  const [countRows] = await pool.query(
    "SELECT COUNT(*) AS n FROM videos WHERE owner_user_id = ?",
    [ownerUserId],
  );
  const total = Number(countRows[0].n) || 0;
  const [rows] = await pool.query(
    `SELECT id, image_set_id, mode, prompt, filename, seconds, size, created_at
     FROM videos WHERE owner_user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [ownerUserId, p.pageSize, p.offset],
  );
  return { items: rows, total, page: p.page, pageSize: p.pageSize };
}

async function removeByOwner(ownerUserId) {
  await getPool().query("DELETE FROM videos WHERE owner_user_id = ?", [ownerUserId]);
}

module.exports = { init, recordVideo, listVideos, removeByOwner };
