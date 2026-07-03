"use strict";

// 套图归属表：记录每个套图目录（generated-images/product-design/<id>/）属于哪个用户，
// 用于跨账户访问隔离。id 即目录名（如 "007"）。

const { getPool } = require("./db");

async function createTables() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS image_sets (
      id VARCHAR(16) NOT NULL,
      owner_user_id BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_owner (owner_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
  `);
}

// 启动时把磁盘上已存在、但表里还没有归属记录的旧套图目录全部划给管理员账号。
async function backfillLegacyOwners(existingIds) {
  if (!existingIds.length) {
    return;
  }
  const db = getPool();
  const [adminRows] = await db.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
  const adminId = adminRows[0]?.id;
  if (!adminId) {
    return;
  }
  const [known] = await db.query("SELECT id FROM image_sets");
  const knownIds = new Set(known.map((row) => row.id));
  const missing = existingIds.filter((id) => !knownIds.has(id));
  if (!missing.length) {
    return;
  }
  await db.query("INSERT INTO image_sets (id, owner_user_id) VALUES ?", [
    missing.map((id) => [id, adminId]),
  ]);
}

async function init(existingIds = []) {
  await createTables();
  await backfillLegacyOwners(existingIds);
}

async function recordOwner(id, ownerUserId) {
  await getPool().query(
    "INSERT INTO image_sets (id, owner_user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE owner_user_id = VALUES(owner_user_id)",
    [id, ownerUserId],
  );
}

// 未知套图（表里没有记录）返回 undefined，与「已记录但归属未知」的 null 区分开。
async function getOwner(id) {
  const [rows] = await getPool().query("SELECT owner_user_id FROM image_sets WHERE id = ? LIMIT 1", [id]);
  return rows.length ? rows[0].owner_user_id : undefined;
}

async function listOwnedIds(ownerUserId) {
  const [rows] = await getPool().query("SELECT id FROM image_sets WHERE owner_user_id = ?", [ownerUserId]);
  return rows.map((row) => row.id);
}

async function removeOwned(ownerUserId) {
  await getPool().query("DELETE FROM image_sets WHERE owner_user_id = ?", [ownerUserId]);
}

module.exports = { init, recordOwner, getOwner, listOwnedIds, removeOwned };
