"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createTracker } = require("../lib/legacy-task-tracker");

function fakeTasks() {
  const records = new Map();
  const calls = [];
  const failures = new Set();
  function call(name, args) {
    calls.push({ name, args });
    if (failures.has(name)) throw Object.assign(new Error("数据库暂不可用"), { code: "ETIMEDOUT" });
  }
  return {
    records, calls, failures,
    async createTask(options) {
      call("createTask", [options]);
      const id = crypto.randomUUID();
      records.set(id, { id, userId: options.userId, kind: options.kind, status: "running", result: null, error: null, partial: { total: 0, images: [] }, metadata: {}, createdAt: Date.now(), updatedAt: Date.now() });
      return id;
    },
    async getTask(id, user) {
      call("getTask", [id, user]);
      const task = records.get(id);
      return task && (user?.role === "admin" || String(task.userId) === String(user?.id)) ? structuredClone(task) : null;
    },
    async setTotal(id, total) {
      call("setTotal", [id, total]);
      records.get(id).partial.total = total;
    },
    async pushImage(id, image) {
      call("pushImage", [id, image]);
      records.get(id).partial.images.push(image);
    },
    async updateTaskMetadata(id, patch) {
      call("updateTaskMetadata", [id, patch]);
      Object.assign(records.get(id).metadata, patch);
    },
    async completeTask(id, result, actualCost) {
      call("completeTask", [id, result, actualCost]);
      Object.assign(records.get(id), { status: "done", result: { ...result, credits: 999 } });
      return records.get(id).result;
    },
    async failTask(id, message, options) {
      call("failTask", [id, message, options]);
      Object.assign(records.get(id), { status: "error", error: message });
    },
  };
}

async function setup(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-task-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const tasks = fakeTasks();
  const logs = [];
  const options = { tasks, directory, logger: { error: (...args) => logs.push(args) }, ...overrides };
  return { directory, tasks, logs, options, tracker: createTracker(options), user: { id: 7, role: "user" } };
}

test("进度和元数据数据库写失败不会阻止已生成图片或最终成功", async (t) => {
  const { tasks, logs, tracker, user } = await setup(t);
  const id = await tracker.create(user.id);
  for (const method of ["setTotal", "pushImage", "updateTaskMetadata"]) tasks.failures.add(method);
  await tracker.setTotal(id, 2);
  await tracker.pushImage(id, { id: "first" });
  await tracker.metadata(id, { phase: "downloaded" });
  const partial = await tracker.get(id, user);
  assert.equal(partial.partial.total, 2);
  assert.deepEqual(partial.partial.images, [{ id: "first" }]);
  assert.equal(partial.metadata.phase, "downloaded");
  const result = { images: [{ id: "first" }], credits: 8 };
  assert.deepEqual(await tracker.finish(id, result), result);
  assert.deepEqual((await tracker.get(id, user)).result, result);
  assert.equal(logs.length, 3);
});

test("完成数据库写失败后，重启优先恢复本地成功日志且保留既有积分结果", async (t) => {
  const { tasks, options, tracker, user, directory } = await setup(t);
  const id = await tracker.create(user.id, { prompt: "原业务输入" });
  await tracker.pushImage(id, { id: "image-1" });
  tasks.failures.add("completeTask");
  const result = { image: { id: "image-1", createdAt: new Date("2026-10-23T01:02:03Z") }, credits: 17 };
  await tracker.finish(id, result);
  const restarted = createTracker(options);
  const restored = await restarted.get(id, user);
  assert.equal(restored.status, "done");
  assert.equal(restored.result.credits, 17);
  assert.equal(restored.result.image.createdAt, "2026-10-23T01:02:03.000Z");
  assert.equal(restored.partial.images.length, 1);
  assert.equal(tasks.records.get(id).status, "running");
  assert.deepEqual(await fs.readdir(directory), [`${id}.json`]);
});

test("本进程内存结果优先，重启后数据库终态优先于本地日志终态", async (t) => {
  const { tasks, options, tracker, user } = await setup(t);
  const id = await tracker.create(user.id);
  const result = { images: [{ id: "local" }], credits: 8 };
  await tracker.finish(id, result);
  assert.equal((await tracker.get(id, user)).result.credits, 8);
  tasks.records.get(id).result = { images: [{ id: "database" }], credits: 9 };
  const restarted = createTracker(options);
  assert.deepEqual((await restarted.get(id, user)).result, tasks.records.get(id).result);
});

test("重启后的本地 running 日志转为待确认，不重发上游或退款", async (t) => {
  const { tasks, options, tracker, user } = await setup(t);
  const id = await tracker.create(user.id);
  await tracker.metadata(id, { upstreamTaskId: "external-1" });
  tasks.failures.add("getTask");
  const before = tasks.calls.length;
  const restored = await createTracker(options).get(id, user);
  assert.equal(restored.status, "interrupted");
  assert.match(restored.error, /待确认/);
  assert.equal(restored.metadata.upstreamTaskId, "external-1");
  assert.deepEqual(tasks.calls.slice(before).map((call) => call.name), ["getTask"]);
});

test("数据库创建失败仍返回可用任务，并能从本地日志恢复", async (t) => {
  const { tasks, options, tracker, user } = await setup(t);
  tasks.failures.add("createTask");
  tasks.failures.add("completeTask");
  const id = await tracker.create(user.id, {}, "video");
  assert.match(id, /^[a-f0-9-]{36}$/);
  await tracker.finish(id, { video: { id: "video-1" }, credits: 12 });
  const restored = await createTracker(options).get(id, user);
  assert.equal(restored.status, "done");
  assert.equal(restored.result.video.id, "video-1");
});

test("内存和本地日志均校验归属，管理员可读，非法 UUID 不访问持久化层", async (t) => {
  const { tasks, options, tracker, user, directory } = await setup(t);
  const id = await tracker.create(user.id);
  tasks.failures.add("completeTask");
  await tracker.finish(id, { image: { id: "private" }, credits: 3 });
  assert.equal(await tracker.get(id, { id: 8, role: "user" }), null);
  const restarted = createTracker(options);
  assert.equal(await restarted.get(id, { id: 8, role: "user" }), null);
  assert.equal((await restarted.get(id, { id: 99, role: "admin" })).result.image.id, "private");
  assert.equal(await restarted.get(id, null), null);
  const count = tasks.calls.length;
  assert.equal(await restarted.get("../../private", user), null);
  assert.equal(tasks.calls.length, count);
  const mismatchedId = crypto.randomUUID();
  await fs.writeFile(path.join(directory, `${mismatchedId}.json`), JSON.stringify({ id, userId: user.id, status: "done" }));
  assert.equal(await createTracker(options).get(mismatchedId, user), null);
});

test("迟到失败和重复完成不能改写成功；任务层始终使用零费用", async (t) => {
  const { tasks, tracker, user } = await setup(t);
  const id = await tracker.create(user.id);
  const result = { images: [{ id: "a" }], credits: 8 };
  await tracker.finish(id, result);
  await tracker.fail(id, "迟到的失败");
  await tracker.finish(id, { images: [], credits: 0 });
  await tracker.pushImage(id, { id: "late" });
  assert.deepEqual((await tracker.get(id, user)).result, result);
  assert.equal(tasks.calls.filter((call) => call.name === "completeTask").length, 1);
  assert.equal(tasks.calls.filter((call) => call.name === "failTask").length, 0);
  assert.equal(tasks.calls.find((call) => call.name === "completeTask").args[2], 0);
  assert.equal(tasks.calls.find((call) => call.name === "createTask").args[0].maxCost, 0);
  const failed = await tracker.create(user.id);
  await tracker.pushImage(failed, { id: "partial" });
  await tracker.fail(failed, "生成失败");
  assert.deepEqual(tasks.calls.find((call) => call.name === "failTask").args[2], { actualCost: 0 });
});

test("进度文件写入被延迟时仍按顺序发布，最终成功日志不被旧进度覆盖", async (t) => {
  const context = await setup(t);
  let delay = false;
  let resume;
  let started;
  const gate = new Promise((resolve) => { resume = resolve; });
  const ready = new Promise((resolve) => { started = resolve; });
  const tracker = createTracker({ ...context.options, fsp: { ...fs, async writeFile(filename, data, options) {
    if (delay && JSON.parse(data).status === "running") {
      started();
      await gate;
    }
    return fs.writeFile(filename, data, options);
  } } });
  const id = await tracker.create(context.user.id);
  delay = true;
  const partial = tracker.pushImage(id, { id: "a" });
  await ready;
  const completed = tracker.finish(id, { image: { id: "a" }, credits: 10 });
  assert.equal((await tracker.get(id, context.user)).status, "done");
  resume();
  await Promise.all([partial, completed]);
  const stored = JSON.parse(await fs.readFile(path.join(context.directory, `${id}.json`), "utf8"));
  assert.equal(stored.status, "done");
  assert.equal(stored.partial.images.length, 1);
  assert.equal(stored.result.credits, 10);
});

test("本地写盘与数据库完成同时失败也保留成功结果，并明确记录故障", async (t) => {
  const context = await setup(t);
  let failWrites = false;
  const tracker = createTracker({ ...context.options, fsp: { ...fs, async writeFile(...args) {
    if (failWrites) throw Object.assign(new Error("磁盘空间不足"), { code: "ENOSPC" });
    return fs.writeFile(...args);
  } } });
  const id = await tracker.create(context.user.id);
  failWrites = true;
  context.tasks.failures.add("completeTask");
  await tracker.finish(id, { audio: { id: "audio-1" }, credits: 4 });
  const task = await tracker.get(id, context.user);
  assert.equal(task.status, "done");
  assert.equal(task.result.credits, 4);
  assert.equal(context.logs.length, 2);
  assert.match(context.logs[0][0], /写入本地日志失败/);
  assert.match(context.logs[1][0], /同步数据库完成结果失败/);
  assert.equal(context.logs[0][1].code, "ENOSPC");
});

test("本地日志不保存输入、密钥或请求头，嵌套结果仅保留安全字段", async (t) => {
  const { tracker, user, directory } = await setup(t);
  const id = await tracker.create(user.id, { prompt: "input-must-not-be-stored", apiKey: "input-secret-value" });
  await tracker.metadata(id, { upstreamTaskId: "external-1", api_key: "metadata-secret-value", headers: { Authorization: "header-secret-value" }, nested: { input: "nested-input-value" } });
  await tracker.finish(id, { images: [{ id: "a" }], credits: 2, apiToken: "result-token-value", nested: { password: "nested-secret-value" }, info: "Bearer auth-token-value" });
  const content = await fs.readFile(path.join(directory, `${id}.json`), "utf8");
  for (const secret of ["input-must-not-be-stored", "input-secret-value", "metadata-secret-value", "header-secret-value", "nested-input-value", "result-token-value", "nested-secret-value", "auth-token-value"]) {
    assert.ok(!content.includes(secret));
  }
  const stored = JSON.parse(content);
  assert.equal(stored.metadata.upstreamTaskId, "external-1");
  assert.equal(stored.result.images[0].id, "a");
  assert.equal((await fs.stat(path.join(directory, `${id}.json`))).mode & 0o777, 0o600);
});

test("调用数据库完成接口前，完整结果已经写入原子日志", async (t) => {
  const { tracker, tasks, user, directory } = await setup(t);
  const id = await tracker.create(user.id);
  let inspected = false;
  tasks.completeTask = async (taskId, result, actualCost) => {
    const stored = JSON.parse(await fs.readFile(path.join(directory, `${taskId}.json`), "utf8"));
    assert.equal(stored.status, "done");
    assert.deepEqual(stored.result, result);
    assert.equal(actualCost, 0);
    inspected = true;
  };
  await tracker.finish(id, { image: { id: "durable-before-database" }, credits: 5 });
  assert.equal(inspected, true);
});

test("数据库直接创建的音频保持 running，后续轮询能够读到 done", async (t) => {
  const { tracker, tasks, user } = await setup(t);
  const id = await tasks.createTask({ userId: user.id, kind: "audio", maxCost: 0 });
  assert.equal((await tracker.get(id, user)).status, "running");
  await tasks.completeTask(id, { audio: { id: "audio-finished" }, credits: 5 }, 0);
  const completed = await tracker.get(id, user);
  assert.equal(completed.status, "done");
  assert.equal(completed.result.audio.id, "audio-finished");
  assert.equal(tasks.calls.filter((call) => call.name === "getTask").length, 2);
});

test("数据库 interrupted 不缓存，恢复完成后可读到最新结果", async (t) => {
  const { tracker, tasks, user } = await setup(t);
  const id = await tasks.createTask({ userId: user.id, kind: "audio", maxCost: 0 });
  tasks.records.get(id).status = "interrupted";
  assert.equal((await tracker.get(id, user)).status, "interrupted");
  await tasks.completeTask(id, { audio: { id: "audio-recovered" } }, 0);
  assert.equal((await tracker.get(id, user)).result.audio.id, "audio-recovered");
  assert.equal(tasks.calls.filter((call) => call.name === "getTask").length, 2);
});

test("本地日志恢复的 interrupted 不缓存，数据库恢复可见", async (t) => {
  const { tracker, tasks, options, user } = await setup(t);
  const id = await tracker.create(user.id);
  tasks.failures.add("getTask");
  const restarted = createTracker(options);
  assert.equal((await restarted.get(id, user)).status, "interrupted");
  tasks.failures.delete("getTask");
  await tasks.completeTask(id, { image: { id: "resolved" } }, 0);
  assert.equal((await restarted.get(id, user)).status, "done");
});

test("成功和失败缓存按 updatedAt 在十五分钟后懒淘汰，持久记录保留", async (t) => {
  let clock = Date.now();
  const { tracker, tasks, user, directory } = await setup(t, { now: () => clock });
  const completedId = await tracker.create(user.id);
  clock += 5 * 60 * 1000;
  await tracker.finish(completedId, { image: { id: "local" }, credits: 8 });
  const failedId = await tracker.create(user.id);
  await tracker.fail(failedId, "原失败信息");
  tasks.records.get(failedId).error = "数据库失败信息";
  clock += 15 * 60 * 1000 - 1;
  assert.equal((await tracker.get(completedId, user)).result.credits, 8);
  assert.equal((await tracker.get(failedId, user)).error, "原失败信息");
  assert.equal(tasks.calls.filter((call) => call.name === "getTask").length, 0);
  clock += 1;
  assert.equal((await tracker.get(completedId, user)).result.credits, 999);
  assert.equal((await tracker.get(failedId, user)).error, "数据库失败信息");
  assert.equal(tasks.calls.filter((call) => call.name === "getTask").length, 2);
  assert.equal(tasks.records.size, 2);
  assert.equal((await fs.readdir(directory)).filter((name) => name.endsWith(".json")).length, 2);
});

test("本机创建的运行中任务超过十五分钟仍保留即时内存状态", async (t) => {
  let clock = Date.now();
  const { tracker, tasks, user } = await setup(t, { now: () => clock });
  const id = await tracker.create(user.id);
  await tracker.pushImage(id, { id: "still-running" });
  clock += 60 * 60 * 1000;
  tasks.failures.add("getTask");
  const task = await tracker.get(id, user);
  assert.equal(task.status, "running");
  assert.equal(task.partial.images[0].id, "still-running");
  assert.equal(tasks.calls.filter((call) => call.name === "getTask").length, 0);
});
