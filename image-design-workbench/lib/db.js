"use strict";

// MySQL 连接池与建表。连接信息从环境变量读取（见 .env）。
// 启动时自动建库所需的表，并按 ADMIN_USERNAME / ADMIN_PASSWORD 初始化首个管理员。

const mysql = require("mysql2/promise");
const crypto = require("crypto");

const DB_HOST = process.env.DB_HOST || "127.0.0.1";
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_NAME = process.env.DB_NAME || "image_workbench";

const SIGNUP_BONUS_CREDITS = Number(process.env.SIGNUP_BONUS_CREDITS || 20);

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: "utf8mb4_general_ci",
      timezone: "Z",
    });
  }
  return pool;
}

// scrypt 密码哈希：salt$hash，纯 Node 标准库实现，不引第三方。
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !stored.includes("$")) {
    return false;
  }
  const [salt, hash] = stored.split("$");
  if (!salt || !hash) {
    return false;
  }
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const a = Buffer.from(derived, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// 给已存在的表补列（用于给老库加字段），列已存在则跳过。
async function ensureColumn(table, column, definition) {
  const db = getPool();
  const [rows] = await db.query(
    "SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  );
  if (!rows[0].cnt) {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

// 先用无库连接确保数据库存在，再建表。
async function ensureDatabase() {
  const admin = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true,
  });
  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;`,
    );
  } finally {
    await admin.end();
  }
}

async function createTables() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(64) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('user','admin') NOT NULL DEFAULT 'user',
      credits INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
  `);
  // 用户中心：绑定邮箱 + 头像，老库上没有这两列，启动时按需补上。
  await ensureColumn("users", "email", "email VARCHAR(255) NULL DEFAULT NULL");
  await ensureColumn("users", "avatar_path", "avatar_path VARCHAR(255) NULL DEFAULT NULL");

  await db.query(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      amount INT NOT NULL,
      balance_after INT NOT NULL,
      type ENUM('signup_bonus','consume','admin_recharge','adjust') NOT NULL,
      note VARCHAR(255) NOT NULL DEFAULT '',
      operator_id BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_created (user_id, created_at),
      CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token CHAR(64) NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      PRIMARY KEY (token),
      KEY idx_session_user (user_id),
      CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
  `);
}

// 启动时根据 .env 的 ADMIN_USERNAME / ADMIN_PASSWORD 确保有一个管理员。
async function ensureAdminUser() {
  const username = (process.env.ADMIN_USERNAME || "").trim();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!username || !password) {
    return;
  }
  const db = getPool();
  const [rows] = await db.query("SELECT id, role FROM users WHERE username = ? LIMIT 1", [username]);
  if (rows.length) {
    if (rows[0].role !== "admin") {
      await db.query("UPDATE users SET role = 'admin' WHERE id = ?", [rows[0].id]);
    }
    return;
  }
  await db.query(
    "INSERT INTO users (username, password_hash, role, credits) VALUES (?, ?, 'admin', ?)",
    [username, hashPassword(password), 0],
  );
}

let initPromise = null;
async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureDatabase();
      await createTables();
      await ensureAdminUser();
    })();
  }
  return initPromise;
}

module.exports = {
  getPool,
  init,
  hashPassword,
  verifyPassword,
  SIGNUP_BONUS_CREDITS,
  config: { DB_HOST, DB_PORT, DB_USER, DB_NAME },
};
