"use strict";

// 账户相关的 HTTP 接口集合：注册 / 登录 / 登出 / 当前用户 / 账户流水 / 管理员充值 / 用户中心（头像+邮箱）。
// 由 server.js 在 handleApi 最前面调用 handleAccountApi；命中则返回 true。

const fs = require("fs/promises");
const path = require("path");
const accounts = require("./accounts");
const auth = require("./auth");

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

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

const AVATAR_MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

function createAccountApi({ sendJson, sendError, readJson, readMultipartFile, inferUploadedImageExt, avatarDir }) {
  async function saveAvatar(userId, upload) {
    const ext = inferUploadedImageExt(upload.data, upload.mime);
    if (!ext) {
      throw new accounts.AccountError("只支持 PNG、JPG、WEBP 或 GIF 图片");
    }
    if (upload.data.length > AVATAR_MAX_BYTES) {
      throw new accounts.AccountError("头像不能超过 5MB");
    }
    await fs.mkdir(avatarDir, { recursive: true });
    const previous = await accounts.getAvatarPath(userId);
    const filename = `${userId}.${ext}`;
    await fs.writeFile(path.join(avatarDir, filename), upload.data);
    if (previous && previous !== filename) {
      await fs.unlink(path.join(avatarDir, previous)).catch(() => {});
    }
    await accounts.setAvatarPath(userId, filename);
  }

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
      const url = new URL(req.url, "http://localhost");
      const { items, total, spent, earned, page, pageSize } = await accounts.listTransactions(user.id, {
        page: url.searchParams.get("page"),
        pageSize: url.searchParams.get("pageSize"),
      });
      sendJson(res, 200, {
        ok: true,
        user: sanitize(user),
        transactions: items,
        spent,
        earned,
        pagination: { page, pageSize, total },
      });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/account/vip") {
      const user = await requireUser(req, res);
      if (!user) {
        return true;
      }
      const vip = await accounts.getVipStatus(user.id);
      sendJson(res, 200, { ok: true, vip });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/account/email") {
      const user = await requireUser(req, res);
      if (!user) {
        return true;
      }
      const payload = await readJson(req);
      try {
        const email = await accounts.setEmail(user.id, payload.email);
        sendJson(res, 200, { ok: true, email });
      } catch (error) {
        sendError(res, error.statusCode || 400, error.message || "邮箱绑定失败");
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/account/avatar") {
      const user = await requireUser(req, res);
      if (!user) {
        return true;
      }
      try {
        const upload = await readMultipartFile(req, "avatar");
        await saveAvatar(user.id, upload);
        sendJson(res, 200, { ok: true, avatarUrl: `/api/account/avatar/${user.id}` });
      } catch (error) {
        sendError(res, error.statusCode || 400, error.message || "头像上传失败");
      }
      return true;
    }

    if (req.method === "GET" && pathname.startsWith("/api/account/avatar/")) {
      const user = await requireUser(req, res);
      if (!user) {
        return true;
      }
      const userId = Number(pathname.replace("/api/account/avatar/", ""));
      const filename = Number.isInteger(userId) ? await accounts.getAvatarPath(userId) : "";
      if (!filename) {
        sendError(res, 404, "还没有头像");
        return true;
      }
      try {
        const data = await fs.readFile(path.join(avatarDir, filename));
        const ext = filename.split(".").pop();
        res.writeHead(200, {
          "Content-Type": AVATAR_MIME_BY_EXT[ext] || "application/octet-stream",
          "Content-Length": data.length,
          "Cache-Control": "no-store",
        });
        res.end(data);
      } catch {
        sendError(res, 404, "头像文件不存在");
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/account/password") {
      const user = await requireUser(req, res);
      if (!user) {
        return true;
      }
      const payload = await readJson(req);
      try {
        await accounts.changePassword(user.id, payload.oldPassword, payload.newPassword);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendError(res, error.statusCode || 400, error.message || "修改密码失败");
      }
      return true;
    }

    if (req.method === "GET" && pathname === "/api/admin/users") {
      const admin = await requireAdmin(req, res);
      if (!admin) {
        return true;
      }
      const url = new URL(req.url, "http://localhost");
      const keyword = url.searchParams.get("keyword") || "";
      const { items, total, page, pageSize } = await accounts.searchUsers(keyword, {
        page: url.searchParams.get("page"),
        pageSize: url.searchParams.get("pageSize"),
      });
      sendJson(res, 200, { ok: true, users: items, pagination: { page, pageSize, total } });
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

    if (req.method === "POST" && pathname === "/api/admin/set-role") {
      const admin = await requireAdmin(req, res);
      if (!admin) {
        return true;
      }
      const payload = await readJson(req);
      if (Number(payload.userId) === Number(admin.id)) {
        sendError(res, 400, "不能修改自己的角色");
        return true;
      }
      try {
        const user = await accounts.setRole(payload.userId, payload.role);
        sendJson(res, 200, { ok: true, user });
      } catch (error) {
        sendError(res, error.statusCode || 400, error.message || "操作失败");
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
      email: user.email || "",
      avatarUrl: user.avatarUrl || "",
      createdAt: user.createdAt,
    };
  }

  return { handle, requireUser, requireAdmin };
}

module.exports = { createAccountApi };
