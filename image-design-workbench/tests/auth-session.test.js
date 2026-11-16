const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SessionStoreUnavailableError,
  parseCookies,
  sessionHash,
  sessionKey,
  revokedSessionKey,
  userAuthVersionKey,
  userSessionsKey,
} = require("../lib/auth");

test("Redis 会话 key 使用 token 摘要，不把原始 Cookie token 写进 Redis key", () => {
  const token = "opaque-session-token-for-test";
  const hash = sessionHash(token);

  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(sessionKey(token), `image-workbench:session:${hash}`);
  assert.equal(sessionKey(hash, true), `image-workbench:session:${hash}`);
  assert.equal(sessionKey(token).includes(token), false);
  assert.equal(revokedSessionKey(token), `image-workbench:revoked-session:${hash}`);
  assert.equal(revokedSessionKey(token).includes(token), false);
  assert.equal(userSessionsKey(42), "image-workbench:user-sessions:42");
  assert.equal(userAuthVersionKey(42), "image-workbench:user-auth-version:42");
});

test("Cookie 解析保持 HttpOnly 会话 token 的原始值，Redis 不可用返回可识别的 503", () => {
  const parsed = parseCookies({ headers: { cookie: "other=x; imgwb_session=abc%2F123" } });
  assert.equal(parsed.imgwb_session, "abc/123");

  const error = new SessionStoreUnavailableError();
  assert.equal(error.statusCode, 503);
  assert.match(error.message, /登录服务/);
});

function createHarness({ redisAvailable = true, failSessionDelete = false } = {}) {
  const sessionRows = new Map();
  const users = new Map([[7, { id: 7, username: "tester", role: "user", credits: 9, email: "", phone: "", avatar_path: "", created_at: new Date() }]]);
  const values = new Map();
  const sets = new Map();
  let sessionSelects = 0;

  const client = {
    async get(key) { return values.get(key) || null; },
    async set(key, value, options = {}) {
      if (options.condition === "NX" && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async del(key) { values.delete(key); sets.delete(key); return 1; },
    async incr(key) { const next = Number(values.get(key) || 0) + 1; values.set(key, String(next)); return next; },
    async sAdd(key, value) { if (!sets.has(key)) sets.set(key, new Set()); sets.get(key).add(value); return 1; },
    async sRem(key, value) { sets.get(key)?.delete(value); return 1; },
    async sMembers(key) { return [...(sets.get(key) || [])]; },
    async expire() { return 1; },
  };
  const db = {
    getPool: () => ({
      query: async (sql, params = []) => {
        if (sql.startsWith("INSERT INTO sessions")) {
          sessionRows.set(params[0], { userId: params[1], expiresAt: params[2] });
          return [{}];
        }
        if (sql.startsWith("SELECT expires_at FROM sessions")) {
          const row = sessionRows.get(params[0]);
          return [[row ? { expires_at: row.expiresAt } : undefined].filter(Boolean)];
        }
        if (sql.includes("FROM sessions s") && sql.includes("WHERE s.token")) {
          sessionSelects++;
          const row = sessionRows.get(params[0]);
          const user = row && users.get(row.userId);
          return [[row && user ? { user_id: row.userId, expires_at: row.expiresAt, role: user.role } : undefined].filter(Boolean)];
        }
        if (sql.startsWith("SELECT token, expires_at FROM sessions")) {
          return [[...sessionRows.entries()].filter(([, row]) => row.userId === Number(params[0])).map(([token, row]) => ({ token, expires_at: row.expiresAt }))];
        }
        if (sql.startsWith("DELETE FROM sessions WHERE token")) {
          if (failSessionDelete) throw new Error("simulated MySQL delete failure");
          sessionRows.delete(params[0]);
          return [{}];
        }
        if (sql.startsWith("DELETE FROM sessions WHERE user_id")) {
          for (const [token, row] of sessionRows) if (row.userId === Number(params[0])) sessionRows.delete(token);
          return [{}];
        }
        throw new Error("unexpected SQL: " + sql);
      },
    }),
  };
  const accounts = {
    getUserById: async (id) => users.get(Number(id)) || null,
    publicUser: (row) => ({ id: row.id, username: row.username, role: row.role, credits: row.credits, email: row.email, phone: row.phone, avatarUrl: "", createdAt: row.created_at }),
  };
  const redis = {
    execute: async (work) => redisAvailable
      ? { available: true, value: await work(client) }
      : { available: false, value: null, error: new Error("redis offline") },
  };
  const serviceCenter = { recordActivity: async () => null };

  const authPath = require.resolve("../lib/auth");
  const dependencies = new Map([
    [require.resolve("../lib/db"), db],
    [require.resolve("../lib/accounts"), accounts],
    [require.resolve("../lib/redis"), redis],
    [require.resolve("../lib/service-center"), serviceCenter],
  ]);
  const originals = new Map();
  for (const [modulePath, exports] of dependencies) {
    originals.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  }
  const originalAuth = require.cache[authPath];
  delete require.cache[authPath];
  const isolatedAuth = require(authPath);

  return {
    auth: isolatedAuth,
    sessionRows,
    values,
    get sessionSelects() { return sessionSelects; },
    restore() {
      delete require.cache[authPath];
      if (originalAuth) require.cache[authPath] = originalAuth;
      for (const [modulePath, previous] of originals) {
        if (previous) require.cache[modulePath] = previous;
        else delete require.cache[modulePath];
      }
    },
  };
}

test("Redis 命中会话时认证不回查 MySQL；Redis miss 的旧会话只回源一次", async (t) => {
  const h = createHarness();
  t.after(() => h.restore());
  const created = await h.auth.createSession({ id: 7, role: "user" });
  const req = { headers: { cookie: `${h.auth.COOKIE_NAME}=${created.token}` }, url: "/api/assets" };

  const first = await h.auth.getSessionIdentity(req);
  assert.equal(first.id, 7);
  assert.equal(first.role, "user");
  assert.ok(first.expiresAt > Date.now());
  assert.equal(h.sessionSelects, 0);

  const redisKey = h.auth.sessionKey(created.token);
  h.values.delete(redisKey);
  const legacy = await h.auth.getSessionIdentity(req);
  assert.equal(legacy.id, 7);
  assert.equal(h.sessionSelects, 1);
  assert.ok(h.values.has(redisKey));
});

test("登出 Redis 删除后即使 MySQL 删除失败，也不会从旧持久会话回填", async (t) => {
  const h = createHarness({ failSessionDelete: true });
  t.after(() => h.restore());
  const created = await h.auth.createSession({ id: 7, role: "user" });
  await assert.rejects(() => h.auth.destroySession(created.token), /simulated MySQL delete failure/);

  const req = { headers: { cookie: `${h.auth.COOKIE_NAME}=${created.token}` }, url: "/api/assets" };
  assert.equal(await h.auth.getSessionIdentity(req), null);
  assert.equal(h.sessionSelects, 0);
});

test("Redis 不可用明确返回 503，不把存储故障误判为未登录", async (t) => {
  const h = createHarness({ redisAvailable: false });
  t.after(() => h.restore());
  const req = { headers: { cookie: "imgwb_session=opaque" }, url: "/api/assets" };
  await assert.rejects(() => h.auth.getSessionIdentity(req), (error) => error.statusCode === 503);
});

test("认证版本递增后，即使并发残留的 Redis session key 仍在也不能继续认证", async (t) => {
  const h = createHarness();
  t.after(() => h.restore());
  const created = await h.auth.createSession({ id: 7, role: "user" });
  const req = { headers: { cookie: `${h.auth.COOKIE_NAME}=${created.token}` }, url: "/api/assets" };

  await h.auth.invalidateUserSessions(7);
  // 模拟删除集合之后仍残留一枚旧 session key；认证必须由 auth version 拒绝它。
  h.values.delete(h.auth.revokedSessionKey(created.token));
  h.values.set(h.auth.sessionKey(created.token), JSON.stringify({
    userId: 7,
    role: "user",
    expiresAt: Date.now() + 60_000,
    authVersion: 1,
  }));

  assert.equal(await h.auth.getSessionIdentity(req), null);
});
