const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function processHarness() {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const signals = [];
  child.kill = (signal) => signals.push(signal);
  const timers = [];
  const cleared = [];
  const runProcess = vm.runInNewContext(
    source.slice(source.indexOf("function runProcess("), source.indexOf("async function runPythonProcess(")) + "\nrunProcess;",
    {
      spawn: () => child,
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
      clearTimeout: (id) => cleared.push(id),
    },
  );
  return { child, signals, timers, cleared, run: () => runProcess("python", [], "/tmp", {}) };
}

test("生图子进程允许运行 360 秒，到期终止并报告超时", async () => {
  const h = processHarness();
  const pending = h.run();
  assert.equal(h.timers[0].delay, 360000);
  assert.deepEqual(h.signals, []);
  const rejected = assert.rejects(pending, /生图请求超时/);
  h.timers[0].callback();
  await rejected;
  assert.deepEqual(h.signals, ["SIGTERM"]);
});

test("生图提前完成会清除超时定时器并保留输出", async () => {
  const h = processHarness();
  const pending = h.run();
  h.child.stdout.emit("data", Buffer.from("image.png"));
  h.child.emit("close", 0);
  const result = await pending;
  assert.equal(result.stdout, "image.png");
  assert.equal(result.stderr, "");
  assert.deepEqual(h.cleared, [1]);
  assert.deepEqual(h.signals, []);
});

function pollingHarness(statusAt) {
  const source = fs.readFileSync(path.join(__dirname, "../public/shared/api.js"), "utf8");
  let elapsed = 0;
  const context = vm.createContext({
    Date: { now: () => elapsed },
    setTimeout: (callback, delay) => { elapsed += delay; callback(); },
    fetch: async () => ({ ok: true, status: 200, json: async () => statusAt(elapsed) }),
  });
  vm.runInContext(source.replace(/^export /gm, ""), context);
  return { poll: (options) => context.pollTask("task-id", options), elapsed: () => elapsed };
}

test("前端超过原 300 秒仍可等待并接收 360 秒内完成的图片", async () => {
  const h = pollingHarness((elapsed) => elapsed >= 358000
    ? { status: "done", result: { image: "image.png" } }
    : { status: "running" });
  assert.equal((await h.poll()).image, "image.png");
  assert.equal(h.elapsed(), 358000);
});

test("前端保留七分钟等待上限，也立即传递后端超时错误", async () => {
  const running = pollingHarness(() => ({ status: "running" }));
  await assert.rejects(running.poll(), /生成超时/);
  assert.equal(running.elapsed(), 422000);

  const failed = pollingHarness((elapsed) => elapsed >= 360000
    ? { status: "error", error: "生图请求超时" }
    : { status: "running" });
  await assert.rejects(failed.poll(), /生图请求超时/);
  assert.equal(failed.elapsed(), 360000);
});
