"use strict";

// Redis 基础设施层：认证会话以 Redis 为主读路径。这里不保存业务密钥，
// 仅提供受控连接和命令执行包装，调用方决定各类 key 的数据结构与失效策略。

const { createClient } = require("redis");

const REDIS_URL = (process.env.REDIS_URL || "redis://127.0.0.1:6379/0").trim();
const REDIS_CONNECT_TIMEOUT_MS = Math.max(200, Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 1500);
const REDIS_ERROR_LOG_INTERVAL_MS = 30 * 1000;

let client = null;
let connectPromise = null;
let lastErrorLogAt = 0;

function logUnavailable(error) {
  const now = Date.now();
  if (now - lastErrorLogAt < REDIS_ERROR_LOG_INTERVAL_MS) {
    return;
  }
  lastErrorLogAt = now;
  console.error("[Redis] 连接或命令失败", { code: error?.code || error?.name || "unknown" });
}

function createRedisClient() {
  const next = createClient({
    url: REDIS_URL,
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      // 会话认证不能无限等待后台重连；下一次请求会创建新的连接并明确返回服务不可用。
      reconnectStrategy: false,
    },
  });
  // node-redis 要求始终监听 error，否则网络故障会让 Node 进程退出。
  next.on("error", logUnavailable);
  return next;
}

async function ensureClient() {
  if (client?.isReady) {
    return client;
  }
  if (connectPromise) {
    return connectPromise;
  }

  if (client?.isOpen) {
    client.destroy();
  }
  client = createRedisClient();
  const current = client;
  connectPromise = current.connect()
    .then(() => current)
    .catch((error) => {
      if (current.isOpen) {
        current.destroy();
      }
      if (client === current) {
        client = null;
      }
      throw error;
    })
    .finally(() => {
      connectPromise = null;
    });
  return connectPromise;
}

async function init() {
  await ensureClient();
}

// 返回 { available, value }，避免把连接故障误判成 Redis key 不存在。
async function execute(command) {
  try {
    const active = await ensureClient();
    return { available: true, value: await command(active) };
  } catch (error) {
    logUnavailable(error);
    return { available: false, value: null, error };
  }
}

async function close() {
  const active = client;
  client = null;
  if (active?.isOpen) {
    await active.close();
  }
}

function status() {
  return { ready: Boolean(client?.isReady), urlConfigured: Boolean(REDIS_URL) };
}

module.exports = {
  init,
  execute,
  close,
  status,
};
