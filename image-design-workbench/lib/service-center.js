"use strict";

const {
  normalizePagination
} = require("./pagination");
const DAY = 86400000;
const OFFSET = 8 * 3600000;
const MODULES = Object.freeze({
  workbench: "创作工作台",
  "product-sets": "电商套图",
  "text-image": "文生图",
  "image-image": "图生图",
  retouch: "AI 修图",
  "studio-hat": "商品衍生图",
  "studio-bag": "商品微调图",
  "studio-print": "版画商品图",
  "studio-3d": "3D 转平面",
  "full-playground": "绘图聚集地",
  "video-text": "文生视频",
  "video-image": "图生视频",
  audio: "语音生成",
  "prompt-extract": "提示词提取",
  "legacy-image": "生图（入口未知）",
  "legacy-video": "视频（模式未知）"
});
function dayOf(ms = Date.now()) {
  return new Date(Number(ms) + OFFSET).toISOString().slice(0, 10);
}
function dayStart(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) throw inputError("请选择有效日期");
  const value = Date.parse(day + "T00:00:00+08:00");
  if (!Number.isFinite(value) || dayOf(value) !== day) throw inputError("日期不存在");
  return value;
}
function inputError(message) {
  return Object.assign(new Error(message), {
    statusCode: 400
  });
}
function rangeOf(options = {}, now = Date.now()) {
  const end = options.end || dayOf(now);
  const start = options.start || dayOf(dayStart(end) - 29 * DAY);
  const startMs = dayStart(start);
  const endMs = dayStart(end) + DAY;
  if (endMs <= startMs || endMs - startMs > 366 * DAY) throw inputError("请选择先后顺序正确、最多 366 天的日期范围");
  if (end > dayOf(now)) throw inputError("结束日期不能晚于今天");
  return {
    start,
    end,
    startMs,
    endMs,
    includeAdmins: options.includeAdmins === true || options.includeAdmins === "true"
  };
}
function moduleFor(input = {}, kind = "image", metadata = {}) {
  const specified = metadata.analyticsModule || input.analyticsModule;
  if (Object.hasOwn(MODULES, specified)) return specified;
  if (kind === "audio") return "audio";
  if (kind === "prompt") return "prompt-extract";
  if (kind === "proxy-image") return "full-playground";
  if (kind === "video") return input.mode === "text" ? "video-text" : input.mode === "image" ? "video-image" : "legacy-video";
  return "legacy-image";
}
function moduleFromRequest(req, kind = "image", input = {}) {
  if (kind === "video") return input.mode === "image" ? "video-image" : "video-text";
  if (kind === "proxy-image") return "full-playground";
  let pathname = "";
  try {
    pathname = new URL(req.headers.referer).pathname.replace(/\/$/, "");
  } catch {/* 无来源时保留未知分类。 */}
  const routes = {
    "/workbench": "workbench",
    "/product-sets": "product-sets",
    "/retouch": "retouch",
    "/studio/hat": "studio-hat",
    "/studio/bag": "studio-bag",
    "/studio/print": "studio-print",
    "/studio/3d": "studio-3d"
  };
  if (pathname === "/playground") return input.mode === "edit" ? "image-image" : "text-image";
  return routes[pathname] || "legacy-image";
}
function parse(value, fallback = {}) {
  try {
    return typeof value === "string" ? JSON.parse(value) : value || fallback;
  } catch {
    return fallback;
  }
}
function outputId(item, kind) {
  let id = item?.id || item?.imageId || item?.url;
  if (id === undefined || id === null) return "";
  id = String(id);
  const match = /^\/api\/(?:images|videos)\/file\/(.+)$/.exec(id);
  if (match) {
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      return "";
    }
  }
  if (kind === "audio") return id.startsWith("asset:") ? id : "asset:" + id;
  // 外部 URL 可能包含签名或过期；只保存不可逆摘要，不存凭据。
  if (/^https?:|^data:/i.test(id)) return "external:" + require("node:crypto").createHash("sha256").update(id).digest("hex");
  return id.length <= 255 ? id : "";
}
function taskOutputs(task) {
  if (task.kind === "prompt") return [];
  const kind = task.kind === "video" ? "video" : task.kind === "audio" ? "audio" : "image";
  const result = { ...(task.metadata?.result || {}), ...(task.result || {}) };
  const items = kind === "video" ? [result.video] : kind === "audio" ? [result.audio] : [result.image, ...(Array.isArray(result.images) ? result.images : []), ...Object.values(result.results || {}), ...(Array.isArray(task.partial?.images) ? task.partial.images : [])];
  const found = new Map();
  for (const item of items) {
    const id = outputId(item, kind);
    const explicitAt = kind !== "audio" && typeof item?.createdAt === "string" && /T.*Z$/.test(item.createdAt) ? Date.parse(item.createdAt) : 0;
    if (id && !found.has(id)) found.set(id, {
      id,
      kind,
      at: explicitAt || Number(task.metadata?.outputCompletedAt) || 0
    });
    else if (id && Number.isFinite(explicitAt) && explicitAt > 0) found.get(id).at = explicitAt;
  }
  // 同步代理没有图库 ID，但每个任务的输出位置仍可用于幂等计数。
  if (kind === "image" && result.generatedCount && task.kind === "proxy-image") {
    for (let index = 0; index < Math.min(100, result.generatedCount); index++) found.set(`proxy:${task.id}:${index}`, {
      id: `proxy:${task.id}:${index}`,
      kind,
      at: Number(task.metadata?.outputCompletedAt) || 0
    });
  }
  return [...found.values()];
}
function taskState(task, count) {
  if (task.status !== "done") return task.status;
  if (task.kind === "prompt") return "done";
  if (!count) return "error";
  return Object.keys(task.result?.errors || {}).length ? "partial" : "done";
}
function activityRequest(req) {
  const pathname = String(req.url || "").split("?")[0];
  if (req.method === "GET") return ["/api/auth/me", "/api/gallery", "/api/gallery/item", "/api/prompts", "/api/assets", "/api/videos", "/api/audio", "/api/account", "/api/service-center/dashboard", "/api/service-center/users", "/api/service-center/tasks"].includes(pathname) || !pathname.startsWith("/api/") && !/\.[a-z0-9]+$/i.test(pathname);
  return ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && pathname.startsWith("/api/") && pathname !== "/api/auth/logout";
}
function createServiceCenter({
  getPool = () => require("./db").getPool(),
  now = Date.now,
  logger = console
} = {}) {
  const db = () => getPool();
  let ready;
  let activitySince = 0;
  let lastErrorAt = null;
  const activityCache = new Map();
  async function bestEffort(work) {
    try {
      return await work();
    } catch (error) {
      lastErrorAt = now();
      logger.error("[服务中心] 统计记录失败", {
        code: error.code || error.name
      });
      return null;
    }
  }
  async function init() {
    if (!ready) ready = (async () => {
      await db().query(`CREATE TABLE IF NOT EXISTS service_metrics_meta (k VARCHAR(64) PRIMARY KEY, v VARCHAR(255) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
      await db().query(`CREATE TABLE IF NOT EXISTS service_user_activity (
        user_id BIGINT UNSIGNED NOT NULL, day DATE NOT NULL, last_seen_ms BIGINT NOT NULL,
        PRIMARY KEY (user_id, day), KEY idx_service_activity_day (day, user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
      await db().query(`CREATE TABLE IF NOT EXISTS service_tasks (
        id VARCHAR(64) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, user_role VARCHAR(16) NOT NULL,
        module VARCHAR(40) NOT NULL, kind VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL,
        created_ms BIGINT NOT NULL, updated_ms BIGINT NOT NULL, output_count INT NOT NULL DEFAULT 0,
        KEY idx_service_task_date (created_ms, user_id), KEY idx_service_task_user (user_id, created_ms)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
      await db().query(`CREATE TABLE IF NOT EXISTS service_outputs (
        kind VARCHAR(16) NOT NULL, output_id VARCHAR(255) NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
        user_role VARCHAR(16) NOT NULL, module VARCHAR(40) NOT NULL, task_id VARCHAR(64) NULL,
        completed_ms BIGINT NOT NULL, day DATE NOT NULL, source VARCHAR(24) NOT NULL,
        PRIMARY KEY (kind, output_id), KEY idx_service_output_day (day, user_id), KEY idx_service_output_user (user_id, day)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
      await db().query("INSERT IGNORE INTO service_metrics_meta (k, v) VALUES ('activity_since_ms', ?)", [String(now())]);
      const [meta] = await db().query("SELECT v FROM service_metrics_meta WHERE k = 'activity_since_ms'");
      activitySince = Number(meta[0].v);
    })().catch(error => {
      ready = null;
      throw error;
    });
    return ready;
  }
  async function recordActivity(userId, req) {
    if (req && !activityRequest(req)) return;
    return bestEffort(async () => {
      await init();
      const ms = now();
      const day = dayOf(ms);
      const key = String(userId);
      const cached = activityCache.get(key);
      if (cached?.day === day && ms - cached.ms < 60000) return;
      await db().query("INSERT INTO service_user_activity (user_id, day, last_seen_ms) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE last_seen_ms = GREATEST(last_seen_ms, VALUES(last_seen_ms))", [userId, day, ms]);
      if (activityCache.size >= 10000) activityCache.clear();
      activityCache.set(key, {
        day,
        ms
      });
    });
  }
  async function recordTask(task, source = "task") {
    if (!task?.id || !task.userId) return;
    await init();
    const [[user]] = await db().query("SELECT role FROM users WHERE id = ?", [task.userId]);
    const role = user?.role || "user";
    const module = moduleFor(task.input, task.kind, task.metadata);
    const kind = ["audio", "video", "prompt"].includes(task.kind) ? task.kind : "image";
    const outputs = taskOutputs(task);
    const updated = Number(task.updatedAt) || now();
    await db().query(`INSERT INTO service_tasks (id, user_id, user_role, module, kind, status, created_ms, updated_ms, output_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE
      status = CASE
        WHEN status IN ('done','error','partial') AND VALUES(status) IN ('running','interrupted') THEN status
        WHEN status='running' AND VALUES(status) IN ('done','error','partial','interrupted') THEN VALUES(status)
        WHEN VALUES(updated_ms) >= updated_ms THEN VALUES(status) ELSE status END,
      output_count = GREATEST(output_count, VALUES(output_count)),
      module = IF(module LIKE 'legacy-%', VALUES(module), module), updated_ms = GREATEST(updated_ms, VALUES(updated_ms))`, [task.id, task.userId, role, module, kind, taskState(task, outputs.length), Number(task.createdAt) || updated, updated, outputs.length]);
    for (const output of outputs) {
      const at = Number.isFinite(output.at) && output.at > 0 ? output.at : updated;
      await db().query(`INSERT INTO service_outputs (kind, output_id, user_id, user_role, module, task_id, completed_ms, day, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        module = IF(user_id = VALUES(user_id) AND module LIKE 'legacy-%' AND VALUES(module) NOT LIKE 'legacy-%', VALUES(module), module),
        task_id = IF(user_id = VALUES(user_id) AND task_id IS NULL, VALUES(task_id), task_id)`, [output.kind, output.id, task.userId, role, module, task.id, at, dayOf(at), source]);
    }
  }
  async function observeTask(task) {
    return bestEffort(() => recordTask(task));
  }
  function fromRow(row) {
    return {
      id: row.id,
      userId: row.user_id,
      kind: row.kind,
      status: row.status,
      input: parse(row.input_json),
      metadata: parse(row.metadata_json),
      result: parse(row.result_json),
      partial: parse(row.partial_json),
      createdAt: Number(row.created_ms),
      updatedAt: Number(row.updated_ms)
    };
  }
  async function observeAudioTask(id) {
    return bestEffort(async () => {
      const [rows] = await db().query("SELECT *, UNIX_TIMESTAMP(created_at)*1000 AS created_ms, UNIX_TIMESTAMP(COALESCE(settled_at, updated_at))*1000 AS updated_ms FROM generation_tasks WHERE id = ? AND kind = 'audio'", [id]);
      if (rows[0]) await recordTask(fromRow(rows[0]));
    });
  }
  async function backfillMedia() {
    await init();
    const daySql = "DATE_ADD('1970-01-01', INTERVAL FLOOR((UNIX_TIMESTAMP(m.created_at)+28800)/86400) DAY)";
    for (const [table, kind, module] of [["images", "image", "legacy-image"], ["videos", "video", "legacy-video"]]) {
      await db().query(`INSERT IGNORE INTO service_outputs (kind, output_id, user_id, user_role, module, completed_ms, day, source)
        SELECT ?, m.id, m.owner_user_id, COALESCE(u.role,'user'), ?, UNIX_TIMESTAMP(m.created_at)*1000, ${daySql}, 'historical-media'
        FROM ${table} m LEFT JOIN users u ON u.id = m.owner_user_id
        WHERE m.owner_user_id IS NOT NULL ${kind === "image" ? "AND COALESCE(m.filename, '') NOT LIKE 'uploaded-%'" : ""}`, [kind, module]);
    }
    await db().query("INSERT INTO service_metrics_meta (k,v) VALUES ('media_backfilled', ?) ON DUPLICATE KEY UPDATE v=VALUES(v)", [String(now())]);
  }
  // 初始化时回填可核实的记录；主键去重，既不回填活跃，也不依赖积分推算作品数量。
  async function backfill() {
    await init();
    let cursor = "";
    while (true) {
      const [rows] = await db().query("SELECT *, UNIX_TIMESTAMP(created_at)*1000 AS created_ms, UNIX_TIMESTAMP(COALESCE(settled_at, updated_at))*1000 AS updated_ms FROM generation_tasks WHERE id > ? ORDER BY id LIMIT 200", [cursor]);
      for (const row of rows) await recordTask(fromRow(row), "historical-task");
      if (rows.length < 200) break;
      cursor = rows[rows.length - 1].id;
    }
    await backfillMedia();
    // 以首次迁移时的流水 ID 为界，避免以后同时记录实时任务和流水而重复统计。
    await db().query("INSERT IGNORE INTO service_metrics_meta (k,v) SELECT 'prompt_credit_cutoff', COALESCE(MAX(id),0) FROM credit_transactions");
    await db().query(`INSERT IGNORE INTO service_tasks (id,user_id,user_role,module,kind,status,created_ms,updated_ms,output_count)
      SELECT CONCAT('prompt-credit:', c.id), c.user_id, COALESCE(u.role,'user'), 'prompt-extract', 'prompt', 'done',
      UNIX_TIMESTAMP(c.created_at)*1000, UNIX_TIMESTAMP(c.created_at)*1000, 0
      FROM credit_transactions c LEFT JOIN users u ON u.id=c.user_id
      WHERE c.type='consume' AND c.note='提示词提取' AND c.id <= CAST((SELECT v FROM service_metrics_meta WHERE k='prompt_credit_cutoff') AS UNSIGNED)`);
  }
  const roleFilter = (includeAdmins, alias = "u") => includeAdmins ? "1=1" : `${alias}.role = 'user'`;
  const retainedRole = (includeAdmins, alias) => includeAdmins ? "1=1" : `COALESCE(u.role, ${alias}.user_role) = 'user'`;
  async function getDashboard(options = {}) {
    await init();
    const range = rangeOf(options, now());
    const today = dayOf(now());
    const todayStart = dayStart(today);
    const role = roleFilter(range.includeAdmins);
    const outputRole = retainedRole(range.includeAdmins, "o");
    const taskRole = retainedRole(range.includeAdmins, "t");
    const results = await Promise.all([db().query(`SELECT COUNT(*) AS total, COALESCE(SUM(u.created_at >= FROM_UNIXTIME(?/1000) AND u.created_at < FROM_UNIXTIME(?/1000)),0) AS new_today FROM users u WHERE ${role}`, [todayStart, todayStart + DAY]), db().query(`SELECT a.day, COUNT(*) AS n FROM service_user_activity a JOIN users u ON u.id = a.user_id WHERE ${role} AND a.day BETWEEN ? AND ? GROUP BY a.day`, [range.start < today ? range.start : today, range.end > today ? range.end : today]), db().query(`SELECT FLOOR((UNIX_TIMESTAMP(u.created_at)+28800)/86400) AS day_number, COUNT(*) AS n FROM users u WHERE ${role} AND u.created_at >= FROM_UNIXTIME(?/1000) AND u.created_at < FROM_UNIXTIME(?/1000) GROUP BY day_number`, [range.startMs, range.endMs]), db().query(`SELECT o.day, o.kind, COUNT(*) AS n FROM service_outputs o LEFT JOIN users u ON u.id=o.user_id WHERE ${outputRole} AND o.day BETWEEN ? AND ? GROUP BY o.day,o.kind`, [range.start < today ? range.start : today, today]), db().query(`SELECT FLOOR((UNIX_TIMESTAMP(c.created_at)+28800)/86400) AS day_number, SUM(-c.amount) AS n FROM credit_transactions c JOIN users u ON u.id=c.user_id WHERE ${role} AND c.type='consume' AND c.created_at >= FROM_UNIXTIME(?/1000) AND c.created_at < FROM_UNIXTIME(?/1000) GROUP BY day_number`, [Math.min(range.startMs, todayStart), todayStart + DAY]), db().query(`SELECT t.module, COUNT(*) AS submitted, SUM(t.status='done') AS succeeded, SUM(t.status='partial') AS partial, SUM(t.status='error') AS failed, SUM(t.status='running') AS running, SUM(t.status='interrupted') AS interrupted FROM service_tasks t LEFT JOIN users u ON u.id=t.user_id WHERE ${taskRole} AND t.created_ms >= ? AND t.created_ms < ? GROUP BY t.module`, [range.startMs, range.endMs]), db().query(`SELECT o.module,o.kind,COUNT(*) AS n FROM service_outputs o LEFT JOIN users u ON u.id=o.user_id WHERE ${outputRole} AND o.day BETWEEN ? AND ? GROUP BY o.module,o.kind`, [range.start, range.end])]);
    const [[users], [activities], [signups], [outputs], [credits], [tasks], [moduleOutputs]] = results;
    const [[todayTasks]] = await db().query(`SELECT COUNT(*) AS n FROM service_tasks t LEFT JOIN users u ON u.id=t.user_id WHERE ${taskRole} AND t.created_ms>=? AND t.created_ms<?`, [todayStart, todayStart + DAY]);
    const activityMap = new Map();
    // DATE 列通过 DATE_FORMAT 读取，避免驱动把日期转换成 UTC Date。
    const normalizeDay = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    activities.forEach(r => activityMap.set(normalizeDay(r.day), Number(r.n)));
    const daily = new Map();
    for (let ms = range.startMs; ms < range.endMs; ms += DAY) {
      const day = dayOf(ms);
      daily.set(day, {
        day,
        newUsers: 0,
        activeUsers: day < dayOf(activitySince) ? null : activityMap.get(day) || 0,
        image: 0,
        video: 0,
        audio: 0,
        credits: 0
      });
    }
    signups.forEach(r => {
      const day = dayOf(Number(r.day_number) * DAY - OFFSET);
      if (daily.has(day)) daily.get(day).newUsers = Number(r.n);
    });
    const todayData = {
      users: Number(users[0].total),
      newUsers: Number(users[0].new_today),
      activeUsers: activityMap.get(today) || 0,
      image: 0,
      video: 0,
      audio: 0,
      credits: 0,
      tasks: Number(todayTasks.n)
    };
    outputs.forEach(r => {
      const day = normalizeDay(r.day);
      if (daily.has(day)) daily.get(day)[r.kind] = Number(r.n);
      if (day === today) todayData[r.kind] = Number(r.n);
    });
    credits.forEach(r => {
      const day = dayOf(Number(r.day_number) * DAY - OFFSET);
      if (daily.has(day)) daily.get(day).credits = Number(r.n);
      if (day === today) todayData.credits = Number(r.n);
    });
    const services = Object.entries(MODULES).map(([id, label]) => {
      const row = tasks.find(t => t.module === id) || {};
      const counts = moduleOutputs.filter(o => o.module === id);
      const service = {
        id,
        label,
        submitted: Number(row.submitted) || 0,
        succeeded: Number(row.succeeded) || 0,
        partial: Number(row.partial) || 0,
        failed: Number(row.failed) || 0,
        running: Number(row.running) || 0,
        interrupted: Number(row.interrupted) || 0,
        image: 0,
        video: 0,
        audio: 0
      };
      counts.forEach(c => {
        service[c.kind] = Number(c.n);
      });
      const finished = service.succeeded + service.partial + service.failed;
      service.successRate = finished ? service.succeeded / finished : null;
      return service;
    });
    return {
      today: todayData,
      todayDate: today,
      range,
      days: [...daily.values()],
      services,
      coverage: {
        activitySince,
        firstDayPartial: true,
        historicalOutputs: "已有任务与作品记录回填；历史入口无法确认时归入历史分类，已删除且无记录的产出无法还原。",
        taskScope: "任务按提交日统计，产出按完成日统计；成功率为完整成功任务 ÷ 已结束任务，部分成功单列。",
        lastErrorAt
      },
      updatedAt: now()
    };
  }
  async function listUsers(options = {}) {
    await init();
    const range = rangeOf(options, now());
    const page = normalizePagination(options.page, options.pageSize);
    const keyword = String(options.keyword || "").trim().slice(0, 64);
    const where = `${roleFilter(range.includeAdmins)} AND u.username LIKE ?`;
    const [count] = await db().query(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`, [`%${keyword}%`]);
    const total = Number(count[0].n);
    page.page = Math.min(page.page, Math.max(1, Math.ceil(total / page.pageSize)));
    page.offset = (page.page - 1) * page.pageSize;
    const [rows] = await db().query(`SELECT u.id,u.username,u.role,u.credits,UNIX_TIMESTAMP(u.created_at)*1000 AS registeredAt,
      (SELECT MAX(a.last_seen_ms) FROM service_user_activity a WHERE a.user_id=u.id) AS lastActiveAt,
      (SELECT COUNT(*) FROM service_outputs o WHERE o.user_id=u.id AND o.kind='image' AND o.day BETWEEN ? AND ?) AS image,
      (SELECT COUNT(*) FROM service_outputs o WHERE o.user_id=u.id AND o.kind='video' AND o.day BETWEEN ? AND ?) AS video,
      (SELECT COUNT(*) FROM service_outputs o WHERE o.user_id=u.id AND o.kind='audio' AND o.day BETWEEN ? AND ?) AS audio,
      (SELECT COALESCE(SUM(-c.amount),0) FROM credit_transactions c WHERE c.user_id=u.id AND c.type='consume' AND c.created_at>=FROM_UNIXTIME(?/1000) AND c.created_at<FROM_UNIXTIME(?/1000)) AS consumed
      FROM users u WHERE ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`, [range.start, range.end, range.start, range.end, range.start, range.end, range.startMs, range.endMs, `%${keyword}%`, page.pageSize, page.offset]);
    return {
      items: rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, ["username", "role"].includes(key) ? value : value === null ? null : Number(value)]))),
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total
      }
    };
  }
  async function listTasks(options = {}) {
    await init();
    const range = rangeOf(options, now());
    const page = normalizePagination(options.page, options.pageSize);
    const where = [retainedRole(range.includeAdmins, "t"), "t.created_ms >= ?", "t.created_ms < ?"];
    const values = [range.startMs, range.endMs];
    if (options.module) {
      if (!Object.hasOwn(MODULES, options.module)) throw inputError("未知服务分类");
      where.push("t.module=?");
      values.push(options.module);
    }
    if (options.userId) {
      if (!/^\d+$/.test(String(options.userId))) throw inputError("用户编号无效");
      where.push("t.user_id=?");
      values.push(options.userId);
    }
    const from = `FROM service_tasks t LEFT JOIN users u ON u.id=t.user_id WHERE ${where.join(" AND ")}`;
    const [count] = await db().query(`SELECT COUNT(*) AS n ${from}`, values);
    const total = Number(count[0].n);
    page.page = Math.min(page.page, Math.max(1, Math.ceil(total / page.pageSize)));
    page.offset = (page.page - 1) * page.pageSize;
    const [rows] = await db().query(`SELECT t.id,t.user_id AS userId,COALESCE(u.username,'已删除用户') AS username,t.module,t.kind,t.status,t.created_ms AS createdAt,t.updated_ms AS updatedAt,t.output_count AS outputCount ${from} ORDER BY t.created_ms DESC,t.id DESC LIMIT ? OFFSET ?`, [...values, page.pageSize, page.offset]);
    return {
      items: rows.map(r => ({
        ...r,
        moduleLabel: MODULES[r.module],
        createdAt: Number(r.createdAt),
        updatedAt: Number(r.updatedAt),
        outputCount: Number(r.outputCount)
      })),
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total
      }
    };
  }
  return {
    init,
    backfill,
    backfillMedia,
    recordActivity,
    observeTask,
    observeAudioTask,
    getDashboard,
    listUsers,
    listTasks
  };
}
module.exports = {
  ...createServiceCenter(),
  createServiceCenter,
  dayOf,
  dayStart,
  rangeOf,
  moduleFor,
  moduleFromRequest,
  taskOutputs,
  taskState,
  activityRequest,
  MODULES
};
