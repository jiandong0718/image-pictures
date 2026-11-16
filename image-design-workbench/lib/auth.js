"use strict";

// 会话与 Cookie：浏览器只持有 HttpOnly 的随机 token；Redis 是高频认证主读，
// MySQL sessions 表保留持久记录，并仅用于旧会话迁移和 Redis miss 的兼容回源。

const crypto = require("crypto");
const { getPool } = require("./db");
const { getUserById, publicUser } = require("./accounts");
const redis = require("./redis");

const COOKIE_NAME = "imgwb_session";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 24 * 7) * 60 * 60 * 1000;
const SESSION_KEY_PREFIX = "image-workbench:session:";
const REVOKED_SESSION_KEY_PREFIX = "image-workbench:revoked-session:";
const USER_SESSIONS_KEY_PREFIX = "image-workbench:user-sessions:";
const USER_AUTH_VERSION_KEY_PREFIX = "image-workbench:user-auth-version:";

class SessionStoreUnavailableError extends Error {
  constructor() {
    super("登录服务暂时不可用，请稍后重试");
    this.name = "SessionStoreUnavailableError";
    this.statusCode = 503;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  }
  return cookies;
}

function isServiceCenterRequest(req) {
  return typeof req?.url === "string" && req.url.startsWith("/api/service-center/");
}

function sessionHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function sessionKey(tokenOrHash, alreadyHashed = false) {
  return SESSION_KEY_PREFIX + (alreadyHashed ? tokenOrHash : sessionHash(tokenOrHash));
}

function revokedSessionKey(tokenOrHash, alreadyHashed = false) {
  return REVOKED_SESSION_KEY_PREFIX + (alreadyHashed ? tokenOrHash : sessionHash(tokenOrHash));
}

function userSessionsKey(userId) {
  return USER_SESSIONS_KEY_PREFIX + String(userId);
}

function userAuthVersionKey(userId) {
  return USER_AUTH_VERSION_KEY_PREFIX + String(userId);
}

function expiresAtMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function ttlSeconds(value) {
  return Math.floor((expiresAtMs(value) - Date.now()) / 1000);
}

function normalizeIdentity(value) {
  const id = Number(value?.id ?? value?.userId);
  const role = value?.role;
  const expiresAt = Number(value?.expiresAt);
  if (!Number.isInteger(id) || id < 1 || !["user", "admin"].includes(role)) {
    return null;
  }
  return {
    id,
    role,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
  };
}

function parseRedisSession(raw) {
  if (typeof raw !== "string" || !raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const identity = normalizeIdentity(parsed);
    const authVersion = Number(parsed.authVersion);
    if (!identity || identity.expiresAt <= Date.now() || !Number.isInteger(authVersion) || authVersion < 1) {
      return null;
    }
    return { identity, authVersion };
  } catch {
    return null;
  }
}

function parseRedisIdentity(raw) {
  return parseRedisSession(raw)?.identity || null;
}

async function requireRedis(command) {
  const result = await redis.execute(command);
  if (!result.available) {
    throw new SessionStoreUnavailableError();
  }
  return result.value;
}

async function getUserAuthVersion(userId) {
  const id = Number(userId);
  const value = await requireRedis(async (client) => {
    await client.set(userAuthVersionKey(id), "1", { condition: "NX" });
    return client.get(userAuthVersionKey(id));
  });
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new SessionStoreUnavailableError();
  }
  return version;
}

async function writeRedisSession(token, identity, expiresAt) {
  const ttl = ttlSeconds(expiresAt);
  if (ttl < 1) {
    return;
  }
  const hash = sessionHash(token);
  const authVersion = await getUserAuthVersion(identity.id);
  const value = JSON.stringify({
    userId: identity.id,
    role: identity.role,
    expiresAt: expiresAtMs(expiresAt),
    authVersion,
  });
  await requireRedis(async (client) => {
    await client.set(sessionKey(hash, true), value, {
      expiration: { type: "EX", value: ttl },
    });
    await client.sAdd(userSessionsKey(identity.id), hash);
    // 索引集合的 TTL 取完整会话窗口，不能被迁移中的短剩余 TTL 缩短，
    // 否则仍有效的其他设备会话无法在改角色/密码时一并失效。
    await client.expire(userSessionsKey(identity.id), Math.ceil(SESSION_TTL_MS / 1000));
  });
}

async function deleteRedisSession(token) {
  const hash = sessionHash(token);
  const expiresAt = await sessionExpiresAt(token);
  await requireRedis(async (client) => {
    const raw = await client.get(sessionKey(hash, true));
    const session = parseRedisSession(raw);
    const identity = session?.identity;
    const expiry = expiresAt || identity?.expiresAt || 0;
    const ttl = ttlSeconds(expiry);
    if (ttl > 0) {
      await client.set(revokedSessionKey(hash, true), "1", {
        expiration: { type: "EX", value: ttl },
      });
    }
    await client.del(sessionKey(hash, true));
    if (identity) {
      await client.sRem(userSessionsKey(identity.id), hash);
    }
  });
}

async function sessionExpiresAt(token) {
  const [rows] = await getPool().query(
    "SELECT expires_at FROM sessions WHERE token = ? LIMIT 1",
    [token],
  );
  return rows[0]?.expires_at || null;
}

async function resolveSessionIdentity(user) {
  const direct = normalizeIdentity(user);
  if (direct) {
    return direct;
  }
  const id = Number(user);
  const row = Number.isInteger(id) && id > 0 ? await getUserById(id) : null;
  const identity = normalizeIdentity(row);
  if (!identity) {
    const error = new Error("用户不存在");
    error.statusCode = 404;
    throw error;
  }
  return identity;
}

async function createSession(user) {
  const identity = await resolveSessionIdentity(user);
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getPool().query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
    [token, identity.id, expiresAt],
  );
  try {
    await writeRedisSession(token, identity, expiresAt);
  } catch (error) {
    await getPool().query("DELETE FROM sessions WHERE token = ?", [token]).catch(() => {});
    throw error;
  }
  // 活跃统计属于尽力记录，不能让登录被统计表的初始化或写入拖慢。
  void require("./service-center").recordActivity(identity.id).catch(() => {});
  return { token, expiresAt };
}

async function destroySession(token) {
  if (!token) {
    return;
  }
  // Redis 是在线认证主来源；先删除 Redis，避免 MySQL 删除成功后仍可被旧缓存放行。
  await deleteRedisSession(token);
  await getPool().query("DELETE FROM sessions WHERE token = ?", [token]);
}

async function loadLegacyIdentity(token) {
  const [rows] = await getPool().query(
    `SELECT s.user_id, s.expires_at, u.role
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
      LIMIT 1`,
    [token],
  );
  if (!rows.length) {
    return null;
  }
  const expiresAt = rows[0].expires_at;
  if (expiresAtMs(expiresAt) <= Date.now()) {
    await getPool().query("DELETE FROM sessions WHERE token = ?", [token]);
    return null;
  }
  const identity = normalizeIdentity({
    id: rows[0].user_id,
    role: rows[0].role,
    expiresAt: expiresAtMs(expiresAt),
  });
  if (!identity) {
    return null;
  }
  await writeRedisSession(token, identity, expiresAt);
  return identity;
}

// 高频 API 只取 id/role，完全从 Redis 读取；Redis miss 时仅为兼容老 MySQL 会话回源一次。
async function getSessionIdentity(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) {
    return null;
  }
  const hash = sessionHash(token);
  const [revoked, raw] = await requireRedis((client) => Promise.all([
    client.get(revokedSessionKey(hash, true)),
    client.get(sessionKey(hash, true)),
  ]));
  if (revoked) {
    return null;
  }
  const session = parseRedisSession(raw);
  if (session) {
    const currentVersion = await getUserAuthVersion(session.identity.id);
    if (session.authVersion === currentVersion) {
      await recordActivity(session.identity.id, req);
      return session.identity;
    }
    // 版本不匹配说明密码/角色变更已经开始或完成；不能再走 MySQL fallback 复活旧 token。
    await requireRedis((client) => client.del(sessionKey(hash, true)));
    return null;
  }
  const legacy = await loadLegacyIdentity(token);
  if (legacy) {
    await recordActivity(legacy.id, req);
  }
  return legacy;
}

async function recordActivity(userId, req) {
  const activity = require("./service-center").recordActivity(userId, req);
  // 普通页面和创作接口不等待统计落库；服务中心自身仍等待，确保刚访问后的看板
  // 读取到同一请求的活跃记录，保留统计实时性。
  if (isServiceCenterRequest(req)) {
    await activity;
  } else {
    void activity.catch(() => {});
  }
}

// 只在 bootstrap / 账户资料等确实需要昵称、余额、联系方式时读取 MySQL 用户资料。
async function getSessionUser(req) {
  const identity = await getSessionIdentity(req);
  if (!identity) {
    return null;
  }
  const user = await getUserById(identity.id);
  if (!user) {
    return null;
  }
  // 若管理员在数据库侧完成角色调整，下一次需要展示完整资料时同步刷新当前会话的 Redis 身份。
  if (user.role !== identity.role) {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) {
      await writeRedisSession(token, { ...identity, role: user.role }, new Date(identity.expiresAt));
    }
  }
  const result = publicUser(user);
  result.sessionToken = parseCookies(req)[COOKIE_NAME];
  return result;
}

// 角色或密码变更时使该用户全部 Redis / MySQL 会话失效，保证旧权限不会沿用到 TTL 结束。
async function invalidateUserSessions(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id < 1) {
    return;
  }
  // 先原子递增版本，随后创建或读取到旧版本的会话都会立即失效；不依赖枚举集合的时序。
  await requireRedis((client) => client.incr(userAuthVersionKey(id)));
  const [rows] = await getPool().query(
    "SELECT token, expires_at FROM sessions WHERE user_id = ?",
    [id],
  );
  const expiryByHash = new Map(rows.map((row) => [sessionHash(row.token), row.expires_at]));
  await requireRedis(async (client) => {
    const hashes = new Set([
      ...expiryByHash.keys(),
      ...(await client.sMembers(userSessionsKey(id))),
    ]);
    for (const hash of hashes) {
      const raw = await client.get(sessionKey(hash, true));
      const identity = parseRedisIdentity(raw);
      const ttl = ttlSeconds(expiryByHash.get(hash) || identity?.expiresAt || 0);
      if (ttl > 0) {
        await client.set(revokedSessionKey(hash, true), "1", {
          expiration: { type: "EX", value: ttl },
        });
      }
      await client.del(sessionKey(hash, true));
    }
    await client.del(userSessionsKey(id));
  });
  await getPool().query("DELETE FROM sessions WHERE user_id = ?", [id]);
}

function buildSessionCookie(token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return (
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`
  );
}

function buildClearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

module.exports = {
  COOKIE_NAME,
  SessionStoreUnavailableError,
  parseCookies,
  createSession,
  destroySession,
  getSessionIdentity,
  getSessionUser,
  invalidateUserSessions,
  buildSessionCookie,
  buildClearCookie,
  // 纯函数导出给测试，Redis key 不包含原始 token。
  sessionHash,
  sessionKey,
  revokedSessionKey,
  userSessionsKey,
  userAuthVersionKey,
};
