"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGenerationTaskStore } = require("../lib/generation-tasks");

// 隔离事务替身：连接按事务互斥，提交前使用独立快照；回滚丢弃所有改动。
// 不加载 .env、不调用项目 db.init，也不连接任何真实数据库。
function createPool(credits = 10) {
  const pool = {
    state: { users: [{ id: 1, credits }, { id: 2, credits: 20 }], tasks: [], transactions: [] },
    statements: [],
    failNext: null,
  };
  let queue = Promise.resolve();

  function query(state, text, params = [], inTransaction = false) {
    const sql = text.replace(/\s+/g, " ").trim();
    pool.statements.push(sql);
    if (pool.failNext && sql.includes(pool.failNext)) {
      pool.failNext = null;
      throw new Error("模拟数据库写入失败");
    }
    if (sql.startsWith("CREATE TABLE")) return [{ affectedRows: 0 }];
    if (sql.includes("FOR UPDATE")) assert.equal(inTransaction, true, "行锁必须在事务内");
    if (sql.startsWith("SELECT credits FROM users")) {
      return [state.users.filter((row) => String(row.id) === String(params[0])).map((row) => ({ credits: row.credits }))];
    }
    if (sql === "UPDATE users SET credits = ? WHERE id = ?") {
      const user = state.users.find((row) => String(row.id) === String(params[1]));
      user.credits = params[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("INSERT INTO generation_tasks")) {
      const [id, userId, kind, input, partial, metadata, reservedCost, note] = params;
      state.tasks.push({
        id, user_id: userId, kind, input_json: input, partial_json: partial, metadata_json: metadata,
        reserved_cost: reservedCost, note, status: "running", actual_cost: null, balance_after: null,
        result_json: null, error: null, settled_at: null, created_at: new Date(), updated_at: new Date(),
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("INSERT INTO credit_transactions")) {
      state.transactions.push({ user_id: params[0], amount: params[1], balance_after: params[2], type: "consume", note: params[3] });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("SELECT * FROM generation_tasks WHERE id = ?")) {
      return [structuredClone(state.tasks.filter((row) => row.id === params[0]
        && (!sql.includes("AND user_id = ?") || String(row.user_id) === String(params[1]))))];
    }
    if (sql.startsWith("SELECT COUNT(*) AS total FROM generation_tasks") || sql.startsWith("SELECT * FROM generation_tasks WHERE 1 = 1")) {
      let index = 0;
      let rows = state.tasks.slice();
      for (const [condition, column] of [["AND user_id = ?", "user_id"], ["AND status = ?", "status"], ["AND kind = ?", "kind"]]) {
        if (sql.includes(condition)) {
          const value = params[index++];
          rows = rows.filter((row) => String(row[column]) === String(value));
        }
      }
      if (sql.startsWith("SELECT COUNT")) return [[{ total: rows.length }]];
      rows.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
      return [structuredClone(rows.slice(params[index + 1], params[index + 1] + params[index]))];
    }
    if (sql === "UPDATE generation_tasks SET status = 'interrupted', error = ? WHERE status = 'running' AND settled_at IS NULL") {
      state.tasks.filter((row) => row.status === "running" && !row.settled_at).forEach((row) => {
        row.status = "interrupted";
        row.error = params[0];
      });
      return [{ affectedRows: 1 }];
    }
    const jsonUpdate = sql.match(/^UPDATE generation_tasks SET (partial_json|metadata_json) = \? WHERE id = \?$/);
    if (jsonUpdate) {
      const row = state.tasks.find((task) => task.id === params[1]);
      row[jsonUpdate[1]] = params[0];
      return [{ affectedRows: 1 }];
    }
    if (sql === "UPDATE generation_tasks SET status = 'interrupted', error = ? WHERE id = ?") {
      const row = state.tasks.find((task) => task.id === params[1]);
      row.status = "interrupted";
      row.error = params[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE generation_tasks SET status = ?, result_json = ?")) {
      const row = state.tasks.find((task) => task.id === params[5]);
      Object.assign(row, {
        status: params[0], result_json: params[1], error: params[2], actual_cost: params[3],
        balance_after: params[4], settled_at: new Date(),
      });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`未处理的测试 SQL: ${sql}`);
  }

  pool.query = async (sql, params) => query(pool.state, sql, params);
  pool.getConnection = async () => {
    let local;
    let unlock;
    return {
      async beginTransaction() {
        const previous = queue;
        queue = new Promise((resolve) => { unlock = resolve; });
        await previous;
        local = structuredClone(pool.state);
      },
      async query(sql, params) { return query(local, sql, params, true); },
      async commit() { pool.state = local; },
      async rollback() {},
      release() { unlock(); },
    };
  };
  return pool;
}

function setup(credits = 10) {
  const pool = createPool(credits);
  const store = createGenerationTaskStore({ pool });
  const create = (overrides = {}) => store.createTask({ userId: 1, kind: "image", maxCost: 4, input: { prompt: "测试" }, ...overrides });
  const user = { id: 1, role: "user" };
  return { pool, store, create, user };
}

test("提交时原子预占；余额不足的并发提交不能超卖", async () => {
  const { pool, create } = setup(5);
  const results = await Promise.allSettled([create(), create()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.statusCode, 402);
  assert.equal(pool.state.users[0].credits, 1);
  assert.equal(pool.state.tasks.length, 1);
  assert.equal(pool.state.transactions.length, 0);
  assert.ok(pool.statements.includes("SELECT credits FROM users WHERE id = ? FOR UPDATE"));
});

test("创建任务失败时预占一起回滚", async () => {
  const { pool, create } = setup();
  pool.failNext = "INSERT INTO generation_tasks";
  await assert.rejects(create(), /模拟数据库写入失败/);
  assert.equal(pool.state.users[0].credits, 10);
  assert.equal(pool.state.tasks.length, 0);
});

test("按实际成功费用结算，重复完成和迟到失败只返回原结果", async () => {
  const { pool, store, create, user } = setup();
  const id = await create();
  const result = await store.completeTask(id, { images: [{ id: "a" }, { id: "b" }] }, 2, "成功两张");
  assert.equal(result.credits, 8);
  assert.deepEqual(await store.completeTask(id, { images: [] }, 4), result);
  assert.deepEqual(await store.failTask(id, "迟到的失败"), result);
  assert.equal(pool.state.users[0].credits, 8);
  assert.equal(pool.state.transactions.length, 1);
  assert.equal(pool.state.transactions[0].amount, -2);
  assert.ok(pool.state.transactions[0].note.includes(id));
  const task = await store.getTask(id, user);
  assert.equal(task.status, "done");
  assert.equal(task.actualCost, 2);
  assert.equal(task.reservedCredits, 0);
});

test("结算写入失败时余额、流水与状态全部回滚，重试只结算一次", async () => {
  const { pool, store, create, user } = setup();
  const id = await create();
  pool.failNext = "UPDATE generation_tasks SET status = ?, result_json = ?";
  await assert.rejects(store.completeTask(id, { image: { id: "a" } }, 1), /模拟数据库写入失败/);
  assert.equal(pool.state.users[0].credits, 6);
  assert.equal(pool.state.transactions.length, 0);
  assert.equal((await store.getTask(id, user)).status, "running");
  await store.completeTask(id, { image: { id: "a" } }, 1);
  assert.equal(pool.state.users[0].credits, 9);
  assert.equal(pool.state.transactions.length, 1);
});

test("并发重复完成仅扣款一次", async () => {
  const { pool, store, create } = setup();
  const id = await create();
  const results = await Promise.all([
    store.completeTask(id, { image: { id: "a" } }, 1),
    store.completeTask(id, { image: { id: "a" } }, 1),
    store.failTask(id, "并发异常"),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], results[2]);
  assert.equal(pool.state.users[0].credits, 9);
  assert.equal(pool.state.transactions.length, 1);
});

test("完全失败释放预占，部分失败仅收取已持久化图片费用", async () => {
  const { pool, store, create, user } = setup();
  const emptyId = await create();
  assert.equal((await store.failTask(emptyId, "未生成任何图片")).credits, 10);
  assert.equal(pool.state.transactions.length, 0);
  const partialId = await create();
  await store.pushImage(partialId, { id: "a" });
  await store.pushImage(partialId, { id: "b" });
  const result = await store.failTask(partialId, "剩余图片失败");
  assert.equal(result.credits, 8);
  assert.equal(result.images.length, 2);
  assert.equal((await store.getTask(partialId, user)).status, "error");
  await store.failTask(partialId, "重复失败");
  assert.equal(pool.state.transactions.length, 1);
});

test("未知上游状态保留预占和部分结果，明确结果后仍能完成结算", async () => {
  const { pool, store, create, user } = setup();
  const id = await create({ kind: "video", maxCost: 8 });
  await store.updateTaskMetadata(id, { upstreamTaskId: "upstream-123", phase: "polling", endpointId: 3 });
  const interrupted = await store.failTask(id, "上游结果待确认", { uncertain: true });
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.reservedCredits, 8);
  assert.equal(pool.state.users[0].credits, 2);
  assert.equal(pool.state.transactions.length, 0);
  assert.equal((await store.getTask(id, user)).metadata.upstreamTaskId, "upstream-123");
  await store.completeTask(id, { video: { id: "video-1" } }, 8);
  assert.equal(pool.state.users[0].credits, 2);
  assert.equal(pool.state.transactions[0].amount, -8);
});

test("部分结果不丢失、不重复，重启后可查询且不会重新提交或退款", async () => {
  const { pool, store, create, user } = setup();
  const id = await create();
  await Promise.all([store.pushImage(id, { id: "a" }), store.pushImage(id, { id: "b" }), store.pushImage(id, { id: "a" })]);
  await store.setTotal(id, 4);
  await store.updateTaskMetadata(id, { upstreamTaskId: "external-1" });
  const restarted = createGenerationTaskStore({ pool });
  await restarted.init();
  await restarted.init();
  const task = await restarted.getTask(id, user);
  assert.equal(task.status, "interrupted");
  assert.equal(task.partial.total, 4);
  assert.equal(task.partial.images.length, 2);
  assert.equal(task.metadata.upstreamTaskId, "external-1");
  assert.equal(pool.state.users[0].credits, 6);
  assert.equal(pool.state.transactions.length, 0);
  assert.equal(pool.statements.filter((sql) => sql.startsWith("CREATE TABLE")).length, 1);
});

test("可关闭启动恢复；初始化失败后可以重试", async () => {
  const { pool, store, create, user } = setup();
  const id = await create();
  pool.failNext = "CREATE TABLE";
  await assert.rejects(store.init({ recoverInterrupted: false }), /模拟数据库写入失败/);
  await store.init({ recoverInterrupted: false });
  assert.equal((await store.getTask(id, user)).status, "running");
});

test("查询和列表限制所有权，管理员可以查看所有任务并筛选", async () => {
  const { store, create, user } = setup();
  const own = await create();
  const other = await create({ userId: 2, kind: "video" });
  assert.equal(await store.getTask(other, user), null);
  assert.equal((await store.getTask(other, { id: 1, role: "admin" })).id, other);
  assert.equal((await store.listTasks(user)).total, 1);
  assert.equal((await store.listTasks(user)).items[0].id, own);
  const adminList = await store.listTasks({ id: 1, role: "admin" }, { kind: "video", status: "running" });
  assert.equal(adminList.total, 1);
  assert.equal(adminList.items[0].id, other);
  await assert.rejects(store.getTask(own, null), (error) => error.statusCode === 401);
  await assert.rejects(store.listTasks(user, { status: "bogus" }), /任务状态不合法/);
});

test("持久化输入和元数据去除密钥、请求头及常见内嵌凭据", async () => {
  const { pool, store, create, user } = setup();
  const id = await create({ input: {
    prompt: "normal", apiKey: "api-secret-value", nested: { authorization: "private", accessToken: "access-private", keep: true },
    api_token: "api-token-private", privateKey: "private-key-value", key: "bare-key-private",
    headers: { Authorization: "Bearer credential" }, endpoint: "https://name:password@example.com/run?api_key=url-private",
    description: "Bearer abcdef12345 sk-1234567890abcdef",
  } });
  await store.updateTaskMetadata(id, { upstreamTaskId: "safe-id", api_key: "another-private", credentials: "private" });
  const serialized = JSON.stringify(pool.state.tasks);
  for (const secret of ["api-secret-value", "access-private", "credential", "url-private", "abcdef12345", "sk-1234567890abcdef", "another-private", "name:password", "api-token-private", "private-key-value", "bare-key-private"]) {
    assert.ok(!serialized.includes(secret), `不得持久化 ${secret}`);
  }
  const task = await store.getTask(id, user);
  assert.equal(task.input.prompt, "normal");
  assert.equal(task.input.nested.keep, true);
  assert.equal(task.metadata.upstreamTaskId, "safe-id");
});

test("拒绝非法费用、超额扣费和不可序列化输入，终态不再追加结果", async () => {
  const { pool, store, create, user } = setup();
  await assert.rejects(create({ maxCost: -1 }), /非负整数/);
  await assert.rejects(create({ maxCost: 1.5 }), /非负整数/);
  await assert.rejects(create({ maxCost: null }), /非负整数/);
  await assert.rejects(create({ maxCost: true }), /非负整数/);
  await assert.rejects(create({ maxCost: "" }), /非负整数/);
  const cycle = {}; cycle.self = cycle;
  await assert.rejects(create({ input: cycle }), /JSON/);
  const id = await create();
  await assert.rejects(store.completeTask(id, {}, 5), (error) => error.statusCode === 409);
  assert.equal(pool.state.users[0].credits, 6);
  await store.completeTask(id, {}, 0);
  await store.pushImage(id, { id: "late" });
  await store.updateTaskMetadata(id, { late: true });
  const task = await store.getTask(id, user);
  assert.equal(task.partial.images.length, 0);
  assert.deepEqual(task.metadata, {});
  assert.equal(pool.state.users[0].credits, 10);
});

test("旧流程零预占任务保留已有消费结果，既有 credits 字段不触发二次扣费", async () => {
  const { pool, store, create, user } = setup();
  const id = await create({ maxCost: 0 });
  assert.equal(pool.state.users[0].credits, 10);
  assert.equal((await store.getTask(id, user)).reservedCredits, 0);

  // 模拟现有 accounts.consumeCredits 已完成其独立事务；任务层只记录结果。
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  await conn.query("SELECT credits FROM users WHERE id = ? FOR UPDATE", [1]);
  await conn.query("UPDATE users SET credits = ? WHERE id = ?", [8, 1]);
  await conn.query(
    "INSERT INTO credit_transactions (user_id, amount, balance_after, type, note) VALUES (?, ?, ?, 'consume', ?)",
    [1, -2, 8, "既有生图流程扣费"],
  );
  await conn.commit();
  conn.release();

  const existingResult = { images: [{ id: "first" }, { id: "second" }], credits: 8 };
  assert.deepEqual(await store.completeTask(id, existingResult, 0), existingResult);
  assert.deepEqual(await store.completeTask(id, existingResult, 0), existingResult);
  assert.deepEqual(await store.failTask(id, "迟到异常", { actualCost: 0 }), existingResult);
  assert.deepEqual((await store.getTask(id, user)).result, existingResult);
  assert.equal(pool.state.users[0].credits, 8);
  assert.equal(pool.state.transactions.length, 1);
  assert.equal(pool.state.transactions[0].note, "既有生图流程扣费");
});

test("旧流程零预占任务明确失败费用为零，部分图片不会再次计费", async () => {
  const { pool, store, create, user } = setup();
  const id = await create({ maxCost: 0 });
  await store.pushImage(id, { id: "already-handled-by-legacy" });
  const result = await store.failTask(id, "旧流程已处理费用", { actualCost: 0 });
  assert.equal(result.credits, 10);
  assert.equal(result.images.length, 1);
  assert.equal(pool.state.users[0].credits, 10);
  assert.equal(pool.state.transactions.length, 0);
  assert.equal((await store.getTask(id, user)).actualCost, 0);
});

test("MySQL 返回的素材 Date 可写入任务输入、元数据及完成结果并规范化为 ISO", async () => {
  const { store, create, user } = setup();
  const createdAt = new Date("2026-10-23T10:20:30.123+08:00");
  const updatedAt = new Date("2026-10-23T03:45:00.000Z");
  const id = await create({ maxCost: 0, input: { requestedAt: createdAt } });
  const result = { audio: { id: "audio-1", createdAt, updatedAt } };
  await store.updateTaskMetadata(id, { result });
  const before = await store.getTask(id, user);
  assert.equal(before.input.requestedAt, "2026-10-23T02:20:30.123Z");
  assert.equal(before.metadata.result.audio.createdAt, "2026-10-23T02:20:30.123Z");
  assert.equal(before.metadata.result.audio.updatedAt, "2026-10-23T03:45:00.000Z");
  const completed = await store.completeTask(id, result, 0);
  assert.deepEqual(completed.audio, before.metadata.result.audio);
  assert.deepEqual((await store.getTask(id, user)).result, completed);
  assert.equal(createdAt instanceof Date, true);
});

test("无效 Date 明确拒绝且不写入任务、不更改元数据或结算余额", async () => {
  const { pool, store, create, user } = setup();
  const invalidDate = new Date("invalid");
  await assert.rejects(create({ input: { createdAt: invalidDate } }), /无效日期/);
  assert.equal(pool.state.tasks.length, 0);
  assert.equal(pool.state.users[0].credits, 10);
  const id = await create();
  await assert.rejects(store.updateTaskMetadata(id, { result: { createdAt: invalidDate } }), /无效日期/);
  await assert.rejects(store.completeTask(id, { audio: { updatedAt: invalidDate } }, 1), /无效日期/);
  const task = await store.getTask(id, user);
  assert.deepEqual(task.metadata, {});
  assert.equal(task.status, "running");
  assert.equal(task.result, null);
  assert.equal(pool.state.users[0].credits, 6);
  assert.equal(pool.state.transactions.length, 0);
});
