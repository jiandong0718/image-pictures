"use strict";

// 账户相关的 HTTP 接口集合：注册 / 登录 / 登出 / 当前用户 / 账户流水 / 管理员充值。
// 由 server.js 在 handleApi 最前面调用 handleAccountApi；命中则返回 true。

const accounts = require("./accounts");
const auth = require("./auth");

// 一次套图/单图都按「成功生成张数」扣费，1 张 = 1 积分。
function setCookie(res, value) {
  const prev = res.getHeader("Set-Cookie");
  if (!prev) {
    res.setHeader("Set-Cookie", value);
  } else if (Array.isArray(prev)) {
    res.setHeader("Set-Cookie", [...prev, value]);
  } else {
    res.setHeader("Set-Cookie", [prev, value]);
  }
}

function createAccountApi({ sendJson, sendError, readJson }) {
  async function requireUser(req, res) {
    const user = await auth.getSessionUser(req);
    if (!user) {
      sendError(res, 401, "请先登录");
      return null;
    }
    return user;
  }

  async function requireAdmin(req, res) {
    const user = await requireUser(req, res);
    if (!user) {
      return null;
    }
    if (user.role !== "admin") {
      sendError(res, 403, "需要管理员权限");
      return null;
    }
    return user;
  }

  async function handle(req, res, pathname) {
    if (req.method === "POST" && pathname === "/api/auth/register") {
      const payload = await readJson(req);
      try {
        const user = await accounts.register(payload.username, payload.password);
        const { token, expiresAt } = await auth.createSession(user.id);
        setCookie(res, auth.buildSessionCookie(token, expiresAt));
        sendJson(res, 200, { ok: true, user });
      } catch (error) {
        sendError(res, error.statusCode || 400, error.message || "注册失败");
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const payload = await readJson(req);
      try {
        const user = await accounts.login(payload.username, payload.password);
        const { token, expiresAt } = await auth.createSession(user.id);
        setCookie(res, auth.buildSessionCookie(token, expiresAt));
        sendJson(res, 200, { ok: true, user });
      } catch (error) {
        sendError(res, error.statusCode || 401, error.message || "登录失败");
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      const cookies = auth.parseCookies(req);
      await auth.destroySession(cookies[auth.COOKIE_NAME]);
      setCookie(res, auth.buildClearCookie());
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
      const user = await auth.getSessionUser(req);
      sendJson(res, 200, { ok: true, user: user ? sanitize(user) : null });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/account") {
      const user = await requireUser(req, res);
      if (!user) {
        return true;
      }
      const transactions = await accounts.listTransactions(user.id, 50);
      sendJson(res, 200, { ok: true, user: sanitize(user), transactions });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/admin/users") {
      const admin = await requireAdmin(req, res);
      if (!admin) {
        return true;
      }
      const url = new URL(req.url, "http://localhost");
      const keyword = url.searchParams.get("keyword") || "";
      const users = await accounts.searchUsers(keyword, 30);
      sendJson(res, 200, { ok: true, users });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/admin/recharge") {
      const admin = await requireAdmin(req, res);
      if (!admin) {
        return true;
      }
      const payload = await readJson(req);
      try {
        const user = await accounts.rechargeCredits(
          payload.userId,
          payload.amount,
          admin.id,
          payload.note || "管理员充值",
        );
        sendJson(res, 200, { ok: true, user });
      } catch (error) {
        sendError(res, error.statusCode || 400, error.message || "充值失败");
      }
      return true;
    }

    return false;
  }

  function sanitize(user) {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      credits: user.credits,
      createdAt: user.createdAt,
    };
  }

  return { handle, requireUser, requireAdmin };
}

module.exports = { createAccountApi };
