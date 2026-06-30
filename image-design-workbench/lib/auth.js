"use strict";

// 会话与 Cookie：基于随机 token 的服务端会话，存 sessions 表。
// Cookie 为 httpOnly，避免脚本读取。提供从请求解析当前登录用户的工具。

const crypto = require("crypto");
const { getPool } = require("./db");
const { getUserById, publicUser } = require("./accounts");

const COOKIE_NAME = "imgwb_session";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 24 * 7) * 60 * 60 * 1000;

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

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getPool().query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
    [token, userId, expiresAt],
  );
  return { token, expiresAt };
}

async function destroySession(token) {
  if (!token) {
    return;
  }
  await getPool().query("DELETE FROM sessions WHERE token = ?", [token]);
}

async function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) {
    return null;
  }
  const [rows] = await getPool().query(
    "SELECT user_id, expires_at FROM sessions WHERE token = ? LIMIT 1",
    [token],
  );
  if (!rows.length) {
    return null;
  }
  if (new Date(rows[0].expires_at).getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  const user = await getUserById(rows[0].user_id);
  if (!user) {
    return null;
  }
  const result = publicUser(user);
  result.sessionToken = token;
  return result;
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
  parseCookies,
  createSession,
  destroySession,
  getSessionUser,
  buildSessionCookie,
  buildClearCookie,
};
