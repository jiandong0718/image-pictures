"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/pages/video/video.js"), "utf8");
const taskFunction = source.slice(source.indexOf("async function awaitTask("), source.indexOf("\nasync function generate("));

function harness(apiGet) {
  const state = { apiGet, pendingTask: "task-1", loading: false, canUnlinkTask: false, result: null, Date, setTimeout, encodeURIComponent,
    renderState() {}, renderStage() {}, save() {}, setCredits() {}, loadRecent() {}, setMsg(message) { state.message = message; } };
  vm.createContext(state);
  vm.runInContext(taskFunction, state);
  return state;
}

test("视频查询暂时失败时保留任务，避免直接重复提交", async () => {
  const state = harness(async () => { throw new Error("连接中断"); });
  await state.awaitTask("task-1");
  assert.equal(state.pendingTask, "task-1");
  assert.equal(state.canUnlinkTask, false);
  assert.equal(state.loading, false);
  assert.equal(state.message, "连接中断");
});

test("不确定结果可供人工解除关联，明确失败则清理任务", async () => {
  const interrupted = harness(async () => ({ status: "interrupted", error: "请检查上游" }));
  await interrupted.awaitTask("task-1");
  assert.equal(interrupted.pendingTask, "task-1");
  assert.equal(interrupted.canUnlinkTask, true);
  const failed = harness(async () => ({ status: "error", error: "任务失败" }));
  await failed.awaitTask("task-1");
  assert.equal(failed.pendingTask, null);
  assert.equal(failed.message, "任务失败");
});

test("视频成功后保留结果并清理待查询任务", async () => {
  const state = harness(async () => ({ status: "done", result: { video: { url: "/test.mp4" }, credits: 3 } }));
  await state.awaitTask("task-1");
  assert.equal(state.pendingTask, null);
  assert.equal(state.result.url, "/test.mp4");
  assert.equal(state.message, "视频生成完成");
});
