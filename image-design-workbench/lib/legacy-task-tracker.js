"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const defaultFs = require("node:fs/promises");

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TERMINAL = new Set(["done", "error"]);
const STATUSES = new Set(["running", "done", "error", "interrupted"]);
const PRIVATE_KEY = /api.*key|secret|password|authorization|credential|(?:access|refresh|auth|api|session).*token|private.*key|^(?:input|token|key|headers|cookie|env|__proto__|constructor|prototype)$/i;
const MAX_LOG_BYTES = 8 * 1024 * 1024;
const COMPLETED_CACHE_TTL_MS = 15 * 60 * 1000;

function redact(value) {
  return value
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, "[redacted]")
    .replace(/([?&](?:api[_-]?key|token|access_token|secret|password)=)[^&#\s]*/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^/\s@]+@/gi, "$1[redacted]@");
}

// 本地日志只保留 JSON 值和业务结果，不携带输入、配置、请求头或凭据。
// 异常值仅从日志中省略，不能令一个已成功生成的旧任务失败。
function safeValue(value, ancestors = new Set()) {
  if (value === null) return null;
  if (typeof value === "string") return redact(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (!value || typeof value !== "object" || ancestors.has(value) || ancestors.size > 64) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return undefined;
  ancestors.add(value);
  const result = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) {
    if (!PRIVATE_KEY.test(key)) result[key] = safeValue(item, ancestors);
  }
  ancestors.delete(value);
  return result;
}

function snapshot(task) {
  return safeValue({
    version: 1,
    id: task.id,
    taskId: task.id,
    userId: task.userId,
    kind: task.kind,
    status: task.status,
    result: task.result,
    error: task.error,
    partial: task.partial,
    metadata: task.metadata,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
}

function owns(task, user) {
  return Boolean(user && user.id !== undefined && user.id !== null
    && (user.role === "admin" || String(task.userId) === String(user.id)));
}

function createTracker({ tasks, directory, fsp = defaultFs, logger = console, now = Date.now }) {
  if (!tasks || !directory) throw new Error("任务兼容层缺少持久化模块或日志目录");
  const root = path.resolve(directory);
  const memory = new Map();
  const fileWrites = new Map();
  const databaseWrites = new Map();

  function cacheable(task) {
    const updatedAt = typeof task.updatedAt === "number" ? task.updatedAt : Date.parse(task.updatedAt);
    return TERMINAL.has(task.status) && Number.isFinite(updatedAt) && now() - updatedAt < COMPLETED_CACHE_TTL_MS;
  }

  function evictCompleted() {
    for (const [id, task] of memory) {
      if (TERMINAL.has(task.status) && !cacheable(task)) memory.delete(id);
    }
  }

  function report(operation, id, error) {
    // 不输出异常中的 SQL、请求体或配置，避免日志夹带凭据。
    try {
      logger.error(`[旧任务兼容] ${operation}失败（任务 ${id}），不改变已知业务结果`, {
        code: error?.code || error?.name || "Error",
      });
    } catch { /* 日志输出失败也不能改变业务结果。 */ }
  }

  async function bestEffort(operation, id, work) {
    try { return await work(); }
    catch (error) { report(operation, id, error); return null; }
  }

  function enqueue(queue, id, work) {
    const pending = (queue.get(id) || Promise.resolve()).then(work);
    const complete = pending.finally(() => {
      if (queue.get(id) === complete) queue.delete(id);
    });
    queue.set(id, complete);
    return complete;
  }

  function persist(task) {
    // 调用时取快照，再按调用顺序写文件；旧进度永远不能覆盖后来的终态。
    let contents;
    try {
      contents = JSON.stringify(snapshot(task));
      if (Buffer.byteLength(contents) > MAX_LOG_BYTES) throw new Error("任务日志超过大小限制");
    } catch (error) {
      report("序列化本地日志", task.id, error);
      return Promise.resolve();
    }
    return enqueue(fileWrites, task.id, () => bestEffort("写入本地日志", task.id, async () => {
      const destination = path.join(root, `${task.id}.json`);
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
      try {
        await fsp.mkdir(root, { recursive: true, mode: 0o700 });
        await fsp.writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
        await fsp.rename(temporary, destination);
      } finally { await fsp.unlink(temporary).catch(() => {}); }
    }));
  }

  function mirror(id, operation, work) {
    return enqueue(databaseWrites, id, () => bestEffort(operation, id, work));
  }

  async function create(userId, input = {}, kind = "image") {
    evictCompleted();
    const storedId = await bestEffort("创建数据库任务", "新任务", () => tasks.createTask({ userId, input, kind, maxCost: 0 }));
    const id = typeof storedId === "string" && UUID.test(storedId) ? storedId : crypto.randomUUID();
    const timestamp = now();
    const task = {
      id, userId, kind, status: "running", result: null, error: null,
      partial: { total: 0, images: [] }, metadata: {}, createdAt: timestamp, updatedAt: timestamp,
    };
    memory.set(id, task);
    await persist(task);
    return id;
  }

  function restored(record, id, fromDisk = false) {
    if (!record || record.id !== id || record.userId === undefined || record.userId === null || !STATUSES.has(record.status)) return null;
    const task = snapshot(record);
    if (fromDisk && task.status === "running") {
      task.status = "interrupted";
      task.error = "服务已重启，任务结果待确认，请勿重复提交";
    }
    return task;
  }

  async function readLog(id) {
    try {
      const filename = path.join(root, `${id}.json`);
      const stat = await fsp.stat(filename);
      if (!stat.isFile() || stat.size > MAX_LOG_BYTES) throw new Error("任务日志不合法");
      return restored(JSON.parse(await fsp.readFile(filename, "utf8")), id, true);
    } catch (error) {
      if (error.code !== "ENOENT") report("读取本地日志", id, error);
      return null;
    }
  }

  async function get(id, user) {
    evictCompleted();
    if (typeof id !== "string" || !UUID.test(id)) return null;
    const active = memory.get(id);
    if (active) return owns(active, user) ? snapshot(active) : null;
    const databaseTask = restored(await bestEffort("读取数据库任务", id, () => tasks.getTask(id, user)), id);
    if (databaseTask && owns(databaseTask, user) && TERMINAL.has(databaseTask.status)) {
      if (cacheable(databaseTask)) memory.set(id, databaseTask);
      return snapshot(databaseTask);
    }
    const diskTask = await readLog(id);
    const task = diskTask && TERMINAL.has(diskTask.status) ? diskTask : databaseTask || diskTask;
    if (!task || !owns(task, user)) return null;
    // 直接由数据库管理的音频等任务必须持续重新查询，不能缓存其中间状态。
    if (cacheable(task)) memory.set(id, task);
    return snapshot(task);
  }

  async function progress(id, operation, change, writeDatabase) {
    evictCompleted();
    const task = memory.get(id);
    if (!task || TERMINAL.has(task.status)) return null;
    change(task);
    task.updatedAt = now();
    await persist(task);
    await mirror(id, operation, writeDatabase);
    return snapshot(task);
  }

  async function setTotal(id, total) {
    return progress(id, "同步数据库总数", (task) => {
      const count = Number(total);
      task.partial = {
        total: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0,
        images: Array.isArray(task.partial?.images) ? task.partial.images : [],
      };
    }, () => tasks.setTotal(id, total));
  }

  async function pushImage(id, image) {
    if (!image) return null;
    return progress(id, "同步数据库图片进度", (task) => {
      task.partial ||= { total: 0, images: [] };
      task.partial.images ||= [];
      const key = (item) => item?.id || item?.imageId || item?.url || item?.filename;
      if (!key(image) || !task.partial.images.some((item) => key(item) === key(image))) task.partial.images.push(image);
    }, () => tasks.pushImage(id, image));
  }

  async function metadata(id, patch) {
    return progress(id, "同步数据库元数据", (task) => {
      task.metadata = { ...task.metadata, ...patch };
    }, () => tasks.updateTaskMetadata(id, patch));
  }

  async function finish(id, result) {
    evictCompleted();
    const task = memory.get(id);
    if (!task) return null;
    if (task.status === "done") return task.result;
    task.status = "done";
    task.result = result;
    task.error = null;
    task.updatedAt = now();
    await persist(task);
    // 原有业务流程已经扣费，兼容层只记录完成状态；不得覆盖业务返回的余额。
    await mirror(id, "同步数据库完成结果", () => tasks.completeTask(id, result, 0));
    return task.result;
  }

  async function fail(id, message) {
    evictCompleted();
    const task = memory.get(id);
    if (!task || TERMINAL.has(task.status)) return task?.result || null;
    task.status = "error";
    task.error = message || "生成失败";
    task.updatedAt = now();
    await persist(task);
    await mirror(id, "同步数据库失败状态", () => tasks.failTask(id, task.error, { actualCost: 0 }));
    return snapshot(task);
  }

  return { create, get, setTotal, pushImage, finish, fail, metadata };
}

module.exports = { createTracker };
