"use strict";

// 账户与积分的数据访问层：注册（赠送积分）、登录校验、积分原子扣减/充值、流水查询。
// 所有涉及余额变动的操作都用事务 + 行锁（SELECT ... FOR UPDATE）保证并发安全。

const { getPool, hashPassword, verifyPassword, SIGNUP_BONUS_CREDITS } = require("./db");
const { normalizePagination } = require("./pagination");
const { resolveVipStatus } = require("./vip-tiers");

const USERNAME_PATTERN = /^[a-zA-Z0-9_一-龥]{2,32}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^1[3-9]\d{9}$/;
// 禁止注册成看起来像管理员/官方身份的用户名，防止冒充。大小写、全半角均视为等价。
const RESERVED_USERNAME_WORDS = [
  "admin",
  "administrator",
  "root",
  "superadmin",
  "system",
  "official",
  "support",
  "客服",
  "管理员",
  "官方",
  "系统",
  "运营",
];

function isReservedUsername(name) {
  const normalized = name.toLowerCase();
  return RESERVED_USERNAME_WORDS.some((word) => normalized.includes(word.toLowerCase()));
}

class AccountError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function publicUser(row) {
  if (!row) {
    return null;
  }
  const result = {
    id: row.id,
    username: row.username,
    role: row.role,
    credits: row.credits,
    email: row.email || "",
    phone: row.phone || "",
    avatarUrl: row.avatar_path ? `/api/account/avatar/${row.id}` : "",
    createdAt: row.created_at,
  };
  // 只有查询里带了 total_generated（如管理员用户列表）才附带等级/总消耗，避免给每个 publicUser 调用点都加一次查询。
  // 1 积分 = 1 张图，累计生成张数就是累计消耗积分数。
  if (row.total_generated !== undefined) {
    result.vipTier = resolveVipStatus(row.total_generated).currentTier;
    result.totalConsumed = Number(row.total_generated) || 0;
  }
  return result;
}

async function getUserById(id) {
  const [rows] = await getPool().query(
    "SELECT id, username, role, credits, email, phone, avatar_path, created_at FROM users WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] || null;
}

async function getUserByUsername(username) {
  const [rows] = await getPool().query(
    "SELECT id, username, password_hash, role, credits, email, phone, avatar_path, created_at FROM users WHERE username = ? LIMIT 1",
    [username],
  );
  return rows[0] || null;
}

async function register(username, password, { email, phone } = {}) {
  const name = String(username || "").trim();
  const pass = String(password || "");
  const emailValue = String(email || "").trim();
  const phoneValue = String(phone || "").trim();
  if (!USERNAME_PATTERN.test(name)) {
    throw new AccountError("用户名需为 2-32 位字母、数字、下划线或中文");
  }
  if (isReservedUsername(name)) {
    throw new AccountError("该用户名不可用，请换一个");
  }
  if (pass.length < 6 || pass.length > 64) {
    throw new AccountError("密码长度需为 6-64 位");
  }
  if (!emailValue && !phoneValue) {
    throw new AccountError("请填写邮箱或手机号（至少一项）");
  }
  if (emailValue && !EMAIL_PATTERN.test(emailValue)) {
    throw new AccountError("邮箱格式不正确");
  }
  if (phoneValue && !PHONE_PATTERN.test(phoneValue)) {
    throw new AccountError("手机号格式不正确");
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query("SELECT id FROM users WHERE username = ? LIMIT 1", [name]);
    if (existing.length) {
      throw new AccountError("用户名已被注册", 409);
    }
    if (emailValue) {
      const [dup] = await conn.query("SELECT id FROM users WHERE email = ? LIMIT 1", [emailValue]);
      if (dup.length) {
        throw new AccountError("该邮箱已被注册", 409);
      }
    }
    if (phoneValue) {
      const [dup] = await conn.query("SELECT id FROM users WHERE phone = ? LIMIT 1", [phoneValue]);
      if (dup.length) {
        throw new AccountError("该手机号已被注册", 409);
      }
    }
    const [result] = await conn.query(
      "INSERT INTO users (username, password_hash, role, credits, email, phone) VALUES (?, ?, 'user', ?, ?, ?)",
      [name, hashPassword(pass), SIGNUP_BONUS_CREDITS, emailValue || null, phoneValue || null],
    );
    const userId = result.insertId;
    if (SIGNUP_BONUS_CREDITS > 0) {
      await conn.query(
        "INSERT INTO credit_transactions (user_id, amount, balance_after, type, note) VALUES (?, ?, ?, 'signup_bonus', ?)",
        [userId, SIGNUP_BONUS_CREDITS, SIGNUP_BONUS_CREDITS, "注册赠送积分"],
      );
    }
    await conn.commit();
    return publicUser(await getUserById(userId));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function login(username, password) {
  const row = await getUserByUsername(String(username || "").trim());
  if (!row || !verifyPassword(String(password || ""), row.password_hash)) {
    throw new AccountError("用户名或密码错误", 401);
  }
  return publicUser(row);
}

// 原子扣减积分；余额不足抛 402。返回扣减后的余额。
async function consumeCredits(userId, amount, note = "生成图片") {
  const cost = Number(amount);
  if (!Number.isInteger(cost) || cost <= 0) {
    throw new AccountError("扣减积分数不合法");
  }
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT credits FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!rows.length) {
      throw new AccountError("用户不存在", 404);
    }
    const current = rows[0].credits;
    if (current < cost) {
      throw new AccountError(`积分不足，本次需要 ${cost} 积分，当前剩余 ${current} 积分`, 402);
    }
    const balanceAfter = current - cost;
    await conn.query("UPDATE users SET credits = ? WHERE id = ?", [balanceAfter, userId]);
    await conn.query(
      "INSERT INTO credit_transactions (user_id, amount, balance_after, type, note) VALUES (?, ?, ?, 'consume', ?)",
      [userId, -cost, balanceAfter, note],
    );
    await conn.commit();
    return balanceAfter;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// 校验余额是否足够（不扣减），用于发起生图前的快速拦截。
async function assertEnoughCredits(userId, amount) {
  const cost = Number(amount) || 0;
  const user = await getUserById(userId);
  if (!user) {
    throw new AccountError("用户不存在", 404);
  }
  if (user.credits < cost) {
    throw new AccountError(`积分不足，本次需要 ${cost} 积分，当前剩余 ${user.credits} 积分`, 402);
  }
  return user.credits;
}

// 管理员为指定用户充值。
async function rechargeCredits(targetUserId, amount, operatorId, note = "管理员充值") {
  const value = Number(amount);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AccountError("充值积分数需为正整数");
  }
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT credits FROM users WHERE id = ? FOR UPDATE", [targetUserId]);
    if (!rows.length) {
      throw new AccountError("目标用户不存在", 404);
    }
    const balanceAfter = rows[0].credits + value;
    await conn.query("UPDATE users SET credits = ? WHERE id = ?", [balanceAfter, targetUserId]);
    await conn.query(
      "INSERT INTO credit_transactions (user_id, amount, balance_after, type, note, operator_id) VALUES (?, ?, ?, 'admin_recharge', ?, ?)",
      [targetUserId, value, balanceAfter, note, operatorId],
    );
    await conn.commit();
    return publicUser(await getUserById(targetUserId));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function listTransactions(userId, { page, pageSize } = {}) {
  const { page: p, pageSize: ps, offset } = normalizePagination(page, pageSize);
  const pool = getPool();
  // 累计消费/获得要基于全部记录聚合，不能只算当前页，所以和 COUNT 一起查。
  const [[{ total, spent, earned }]] = await pool.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS spent,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS earned
     FROM credit_transactions WHERE user_id = ?`,
    [userId],
  );
  const [rows] = await pool.query(
    "SELECT amount, balance_after, type, note, created_at FROM credit_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?",
    [userId, ps, offset],
  );
  return {
    items: rows.map((row) => ({
      amount: row.amount,
      balanceAfter: row.balance_after,
      type: row.type,
      note: row.note,
      createdAt: row.created_at,
    })),
    total,
    spent,
    earned,
    page: p,
    pageSize: ps,
  };
}

// 修改自己的密码：校验原密码后更新。
async function changePassword(userId, oldPassword, newPassword) {
  const next = String(newPassword || "");
  if (next.length < 6 || next.length > 64) {
    throw new AccountError("新密码长度需为 6-64 位");
  }
  const pool = getPool();
  const [rows] = await pool.query("SELECT password_hash FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!rows.length) {
    throw new AccountError("用户不存在", 404);
  }
  if (!verifyPassword(String(oldPassword || ""), rows[0].password_hash)) {
    throw new AccountError("原密码错误", 401);
  }
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [hashPassword(next), userId]);
}

async function searchUsers(keyword, { page, pageSize } = {}) {
  const term = String(keyword || "").trim();
  const like = `%${term}%`;
  const { page: p, pageSize: ps, offset } = normalizePagination(page, pageSize);
  const pool = getPool();
  const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE username LIKE ?", [like]);
  // LEFT JOIN 一次性把每个用户的累计生成张数带出来，算 VIP 等级用，避免逐行再查一次。
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.role, u.credits, u.email, u.phone, u.avatar_path, u.created_at,
            COALESCE(t.total, 0) AS total_generated
     FROM users u
     LEFT JOIN (
       SELECT user_id, SUM(-amount) AS total FROM credit_transactions WHERE type = 'consume' GROUP BY user_id
     ) t ON t.user_id = u.id
     WHERE u.username LIKE ?
     ORDER BY u.id ASC LIMIT ? OFFSET ?`,
    [like, ps, offset],
  );
  return { items: rows.map(publicUser), total, page: p, pageSize: ps };
}

// 管理员授权/取消他人的管理员身份；不允许修改自己的角色（调用方需在 HTTP 层拦一次）。
async function setRole(userId, role) {
  if (!["user", "admin"].includes(role)) {
    throw new AccountError("角色不合法");
  }
  const [rows] = await getPool().query("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!rows.length) {
    throw new AccountError("用户不存在", 404);
  }
  await getPool().query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
  return publicUser(await getUserById(userId));
}

// 绑定/清空邮箱；传空串清空。
async function setEmail(userId, email) {
  const value = String(email || "").trim();
  if (value && !EMAIL_PATTERN.test(value)) {
    throw new AccountError("邮箱格式不正确");
  }
  await getPool().query("UPDATE users SET email = ? WHERE id = ?", [value || null, userId]);
  return value;
}

async function setPhone(userId, phone) {
  const value = String(phone || "").trim();
  if (value && !PHONE_PATTERN.test(value)) {
    throw new AccountError("手机号格式不正确");
  }
  await getPool().query("UPDATE users SET phone = ? WHERE id = ?", [value || null, userId]);
  return value;
}

async function setAvatarPath(userId, avatarPath) {
  await getPool().query("UPDATE users SET avatar_path = ? WHERE id = ?", [avatarPath, userId]);
}

async function getAvatarPath(userId) {
  const [rows] = await getPool().query("SELECT avatar_path FROM users WHERE id = ? LIMIT 1", [userId]);
  return rows[0]?.avatar_path || "";
}

// 累计生成张数 = 历史全部「consume」流水的张数之和（与生图扣费逻辑天然一致，不用额外计数器）。
async function getVipStatus(userId) {
  const [[{ total }]] = await getPool().query(
    "SELECT COALESCE(SUM(-amount), 0) AS total FROM credit_transactions WHERE user_id = ? AND type = 'consume'",
    [userId],
  );
  return resolveVipStatus(total);
}

module.exports = {
  AccountError,
  publicUser,
  getUserById,
  getUserByUsername,
  register,
  login,
  consumeCredits,
  assertEnoughCredits,
  rechargeCredits,
  listTransactions,
  changePassword,
  searchUsers,
  setRole,
  setEmail,
  setPhone,
  setAvatarPath,
  getAvatarPath,
  getVipStatus,
};
