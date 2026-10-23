"use strict";

// users.credits 是可用余额；未结算任务的 reserved_cost 保存已冻结余额。
// 冻结不是消费流水，结算时只记录实际消费，避免影响 VIP 累计消费统计。
const crypto = require("node:crypto");
const { normalizePagination } = require("./pagination");

const MAX_CREDITS = 2147483647;
const MAX_JSON_BYTES = 1024 * 1024;
const SECRET_KEY = /api.*key|secret|password|authorization|credential|(?:access|refresh|auth|api|session).*token|private.*key|^(?:token|key|headers|cookie|env)$/i;
const TASK_STATUSES = ["running", "done", "error", "interrupted"];

class GenerationTaskError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "GenerationTaskError";
    this.statusCode = statusCode;
  }
}

function redactText(value) {
  return String(value)
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, "[redacted]")
    .replace(/([?&](?:api[_-]?key|token|access_token|secret|password)=)[^&#\s]*/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^/\s@]+@/gi, "$1[redacted]@");
}

function sanitizeJson(value, ancestors = new Set()) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new GenerationTaskError("任务数据包含无效日期");
    }
    return value.toISOString();
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new GenerationTaskError("任务数据必须是可序列化的 JSON");
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new GenerationTaskError("任务数据必须是普通 JSON 对象");
  }
  ancestors.add(value);
  const result = Array.isArray(value) ? [] : Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (!SECRET_KEY.test(key) && !["__proto__", "constructor", "prototype"].includes(key)) {
      result[key] = sanitizeJson(item, ancestors);
    }
  }
  ancestors.delete(value);
  return result;
}

function encodeJson(value) {
  const encoded = JSON.stringify(sanitizeJson(value));
  if (Buffer.byteLength(encoded) > MAX_JSON_BYTES) {
    throw new GenerationTaskError("任务数据过大，请仅保存参数与资源引用");
  }
  return encoded;
}

function decodeJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  return typeof value === "string" ? JSON.parse(value) : value;
}

function creditsAmount(value, name) {
  const amount = Number(value);
  if (!["number", "string"].includes(typeof value) || String(value).trim() === ""
    || !Number.isSafeInteger(amount) || amount < 0 || amount > MAX_CREDITS) {
    throw new GenerationTaskError(`${name}需为非负整数`);
  }
  return amount;
}

function taskView(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.id,
    userId: row.user_id,
    kind: row.kind,
    status: row.status,
    input: decodeJson(row.input_json, {}),
    partial: decodeJson(row.partial_json, { total: 0, images: [] }),
    metadata: decodeJson(row.metadata_json, {}),
    result: decodeJson(row.result_json, null),
    error: row.error || null,
    maxCost: row.reserved_cost,
    reservedCredits: row.settled_at ? 0 : row.reserved_cost,
    actualCost: row.actual_cost,
    credits: row.balance_after,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    settledAt: row.settled_at ? new Date(row.settled_at).getTime() : null,
  };
}

// 工厂允许注入隔离 pool；默认实例直到调用方法时才读取项目连接池。
function createGenerationTaskStore({ pool, getPool = () => require("./db").getPool() } = {}) {
  const db = () => pool || getPool();
  let initPromise;

  async function transaction(operation) {
    const conn = await db().getConnection();
    try {
      await conn.beginTransaction();
      const result = await operation(conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async function lockedTask(conn, id) {
    const [rows] = await conn.query("SELECT * FROM generation_tasks WHERE id = ? FOR UPDATE", [id]);
    if (!rows.length) throw new GenerationTaskError("任务不存在", 404);
    return rows[0];
  }

  // 单进程启动时可恢复旧任务状态；多实例部署应由唯一恢复者启用 recoverInterrupted。
  // 只标记中断，绝不自动重发请求或释放无法确认是否已成功的预占。
  async function init({ recoverInterrupted = true } = {}) {
    if (!initPromise) {
      initPromise = (async () => {
        await db().query(`CREATE TABLE IF NOT EXISTS generation_tasks (
          id CHAR(36) NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          kind VARCHAR(40) NOT NULL,
          status ENUM('running','done','error','interrupted') NOT NULL DEFAULT 'running',
          input_json LONGTEXT NOT NULL,
          partial_json LONGTEXT NOT NULL,
          metadata_json LONGTEXT NOT NULL,
          result_json LONGTEXT NULL,
          error VARCHAR(512) NULL,
          note VARCHAR(255) NOT NULL DEFAULT '',
          reserved_cost INT NOT NULL,
          actual_cost INT NULL,
          balance_after INT NULL,
          settled_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_generation_user_created (user_id, created_at, id),
          KEY idx_generation_status_updated (status, updated_at),
          CONSTRAINT fk_generation_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
        if (recoverInterrupted) {
          await db().query(
            "UPDATE generation_tasks SET status = 'interrupted', error = ? WHERE status = 'running' AND settled_at IS NULL",
            ["服务已重启，任务结果待确认，请勿重复提交"],
          );
        }
      })().catch((error) => {
        initPromise = null;
        throw error;
      });
    }
    return initPromise;
  }

  async function createTask({ userId, kind, input = {}, maxCost, note = "生成任务" }) {
    const cost = creditsAmount(maxCost, "预占积分");
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(kind || "")) {
      throw new GenerationTaskError("任务类型不合法");
    }
    const inputJson = encodeJson(input);
    const id = crypto.randomUUID();
    return transaction(async (conn) => {
      const [rows] = await conn.query("SELECT credits FROM users WHERE id = ? FOR UPDATE", [userId]);
      if (!rows.length) throw new GenerationTaskError("用户不存在", 404);
      const balance = Number(rows[0].credits);
      if (balance < cost) {
        throw new GenerationTaskError(`积分不足，本次需要 ${cost} 积分，当前剩余 ${balance} 积分`, 402);
      }
      await conn.query("UPDATE users SET credits = ? WHERE id = ?", [balance - cost, userId]);
      await conn.query(
        `INSERT INTO generation_tasks
          (id, user_id, kind, input_json, partial_json, metadata_json, reserved_cost, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, kind, inputJson, '{"total":0,"images":[]}', "{}", cost, redactText(note).slice(0, 255)],
      );
      return id;
    });
  }

  function ownership(user) {
    if (!user || user.id === undefined || user.id === null) {
      throw new GenerationTaskError("请先登录", 401);
    }
    return user.role === "admin" ? { sql: "", params: [] } : { sql: " AND user_id = ?", params: [user.id] };
  }

  async function getTask(id, user) {
    const owner = ownership(user);
    const [rows] = await db().query(`SELECT * FROM generation_tasks WHERE id = ?${owner.sql} LIMIT 1`, [id, ...owner.params]);
    return taskView(rows[0]);
  }

  async function listTasks(user, { page, pageSize, status, kind } = {}) {
    const owner = ownership(user);
    const pagination = normalizePagination(page, pageSize);
    let where = `WHERE 1 = 1${owner.sql}`;
    const params = [...owner.params];
    if (status) {
      if (!TASK_STATUSES.includes(status)) throw new GenerationTaskError("任务状态不合法");
      where += " AND status = ?";
      params.push(status);
    }
    if (kind) {
      where += " AND kind = ?";
      params.push(kind);
    }
    const [[{ total }]] = await db().query(`SELECT COUNT(*) AS total FROM generation_tasks ${where}`, params);
    const [rows] = await db().query(
      `SELECT * FROM generation_tasks ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset],
    );
    return { items: rows.map(taskView), total: Number(total), page: pagination.page, pageSize: pagination.pageSize };
  }

  async function mutateJson(id, column, update) {
    return transaction(async (conn) => {
      const row = await lockedTask(conn, id);
      if (row.settled_at) return taskView(row);
      const value = update(decodeJson(row[column], {}));
      const encoded = encodeJson(value);
      // column 仅由下面固定的两个内部调用点提供。
      await conn.query(`UPDATE generation_tasks SET ${column} = ? WHERE id = ?`, [encoded, id]);
      return taskView({ ...row, [column]: encoded });
    });
  }

  async function setTotal(id, n) {
    const total = creditsAmount(n, "任务总数");
    return mutateJson(id, "partial_json", (partial) => ({ ...partial, total, images: partial.images || [] }));
  }

  async function pushImage(id, image) {
    if (!image || typeof image !== "object" || Array.isArray(image)) {
      throw new GenerationTaskError("图片记录不合法");
    }
    const cleanImage = decodeJson(encodeJson(image));
    const imageKey = (item) => String(item.id || item.imageId || item.url || item.filename || JSON.stringify(item));
    return mutateJson(id, "partial_json", (partial) => {
      const images = partial.images || [];
      if (!images.some((item) => imageKey(item) === imageKey(cleanImage))) images.push(cleanImage);
      return { total: partial.total || 0, images };
    });
  }

  async function updateTaskMetadata(id, metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new GenerationTaskError("任务元数据不合法");
    }
    const cleanMetadata = decodeJson(encodeJson(metadata));
    return mutateJson(id, "metadata_json", (current) => ({ ...current, ...cleanMetadata }));
  }

  async function settle(conn, row, { status, result, actualCost, note, message }) {
    // 同一任务的状态、退款和消费流水在同一个事务中写入；重复回调直接返回第一次结算结果。
    if (row.settled_at) return decodeJson(row.result_json, { credits: row.balance_after });
    const cost = creditsAmount(actualCost, "实际积分");
    if (cost > row.reserved_cost) throw new GenerationTaskError("实际积分不能超过预占积分", 409);
    const [users] = await conn.query("SELECT credits FROM users WHERE id = ? FOR UPDATE", [row.user_id]);
    if (!users.length) throw new GenerationTaskError("用户不存在", 404);
    const balance = Number(users[0].credits) + row.reserved_cost - cost;
    if (balance > MAX_CREDITS) throw new GenerationTaskError("用户积分超过余额上限", 409);
    const finalResult = { ...result, credits: balance };
    const encodedResult = encodeJson(finalResult);
    await conn.query("UPDATE users SET credits = ? WHERE id = ?", [balance, row.user_id]);
    if (cost > 0) {
      const transactionNote = `${redactText(note || row.note).slice(0, 210)} [${row.id}]`;
      await conn.query(
        "INSERT INTO credit_transactions (user_id, amount, balance_after, type, note) VALUES (?, ?, ?, 'consume', ?)",
        [row.user_id, -cost, balance, transactionNote],
      );
    }
    await conn.query(
      `UPDATE generation_tasks SET status = ?, result_json = ?, error = ?, actual_cost = ?,
        balance_after = ?, settled_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, encodedResult, message || null, cost, balance, row.id],
    );
    return decodeJson(encodedResult);
  }

  async function completeTask(id, result, actualCost, note) {
    return transaction(async (conn) => {
      const row = await lockedTask(conn, id);
      return settle(conn, row, { status: "done", result, actualCost, note });
    });
  }

  async function failTask(id, message, { uncertain = false, actualCost, note, result } = {}) {
    return transaction(async (conn) => {
      const row = await lockedTask(conn, id);
      if (row.settled_at) return decodeJson(row.result_json, { credits: row.balance_after });
      const error = redactText(message || "生成失败").slice(0, 512);
      if (uncertain) {
        await conn.query("UPDATE generation_tasks SET status = 'interrupted', error = ? WHERE id = ?", [error, id]);
        return taskView({ ...row, status: "interrupted", error });
      }
      const partial = decodeJson(row.partial_json, { images: [] });
      // 本项目图片单价为 1；其他计费方式（如视频）由调用方明确传 actualCost。
      return settle(conn, row, {
        status: "error",
        result: result || { images: partial.images || [] },
        actualCost: actualCost === undefined ? (partial.images || []).length : actualCost,
        note,
        message: error,
      });
    });
  }

  return { init, createTask, getTask, listTasks, setTotal, pushImage, updateTaskMetadata, completeTask, failTask };
}

module.exports = { ...createGenerationTaskStore(), createGenerationTaskStore, GenerationTaskError };
