"use strict";

// 账户与积分的数据访问层：注册（赠送积分）、登录校验、积分原子扣减/充值、流水查询。
// 所有涉及余额变动的操作都用事务 + 行锁（SELECT ... FOR UPDATE）保证并发安全。

const { getPool, hashPassword, verifyPassword, SIGNUP_BONUS_CREDITS } = require("./db");

const USERNAME_PATTERN = /^[a-zA-Z0-9_一-龥]{2,32}$/;

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
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    credits: row.credits,
    createdAt: row.created_at,
  };
}

async function getUserById(id) {
  const [rows] = await getPool().query(
    "SELECT id, username, role, credits, created_at FROM users WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] || null;
}

async function getUserByUsername(username) {
  const [rows] = await getPool().query(
    "SELECT id, username, password_hash, role, credits, created_at FROM users WHERE username = ? LIMIT 1",
    [username],
  );
  return rows[0] || null;
}

async function register(username, password) {
  const name = String(username || "").trim();
  const pass = String(password || "");
  if (!USERNAME_PATTERN.test(name)) {
    throw new AccountError("用户名需为 2-32 位字母、数字、下划线或中文");
  }
  if (pass.length < 6 || pass.length > 64) {
    throw new AccountError("密码长度需为 6-64 位");
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query("SELECT id FROM users WHERE username = ? LIMIT 1", [name]);
    if (existing.length) {
      throw new AccountError("用户名已被注册", 409);
    }
    const [result] = await conn.query(
      "INSERT INTO users (username, password_hash, role, credits) VALUES (?, ?, 'user', ?)",
      [name, hashPassword(pass), SIGNUP_BONUS_CREDITS],
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

async function listTransactions(userId, limit = 50) {
  const [rows] = await getPool().query(
    "SELECT amount, balance_after, type, note, created_at FROM credit_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?",
    [userId, Number(limit) || 50],
  );
  return rows.map((row) => ({
    amount: row.amount,
    balanceAfter: row.balance_after,
    type: row.type,
    note: row.note,
    createdAt: row.created_at,
  }));
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

async function searchUsers(keyword, limit = 20) {
  const term = String(keyword || "").trim();
  const like = `%${term}%`;
  const [rows] = await getPool().query(
    "SELECT id, username, role, credits, created_at FROM users WHERE username LIKE ? ORDER BY id ASC LIMIT ?",
    [like, Number(limit) || 20],
  );
  return rows.map(publicUser);
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
};
