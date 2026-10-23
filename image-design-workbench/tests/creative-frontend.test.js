const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

let utils;
test.before(async () => {
  const source = await fs.readFile(path.join(__dirname, "../public/shared/creative-utils.js"), "utf8");
  utils = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
});

test("音频预计费用按 Unicode 字符计数，忽略首尾空白并向上取整", () => {
  assert.deepEqual(utils.audioCost(`  ${"😀".repeat(1000)}  `), { characterCount: 1000, estimatedCost: 1, charactersPerCredit: 1000, creditsPerUnit: 1 });
  assert.equal(utils.audioCost(`${"中".repeat(1000)}文`).estimatedCost, 2);
  assert.equal(utils.audioCost("   ").estimatedCost, 0);
  assert.equal(utils.audioCost("abc", { charactersPerCredit: 2, creditsPerUnit: 3 }).estimatedCost, 6);
});

test("新生成与任务更新保留之前所有批次并避免重复插入", () => {
  const first = { id: "a", prompt: "上一批", images: [{ id: "old.png" }] };
  const second = { id: "b", prompt: "新一批", status: "pending" };
  const history = utils.mergeBatch([first], second);
  const completed = utils.mergeBatch(history, { id: "b", status: "done", images: [{ id: "new.png" }] });
  assert.equal(completed.length, 2);
  assert.deepEqual(completed[1], first);
  assert.equal(completed[0].prompt, "新一批");
  assert.equal(completed[0].status, "done");
  assert.equal(history[0].status, "pending");
});

test("草稿键按账户隔离，缺少账户时拒绝写共享空间", () => {
  assert.notEqual(utils.storageKey(1, "draft"), utils.storageKey(2, "draft"));
  assert.notEqual(utils.storageKey(1, "draft"), utils.storageKey(1, "audioDraft"));
  assert.throws(() => utils.storageKey(null, "draft"), /用户/);
});

test("媒体链接拒绝脚本与内嵌数据，预览添加缩略图参数且保留鉴权路径", () => {
  for (const value of ["javascript:alert(1)", "data:image/png;base64,AAAA", "//evil.example/x", "/\\evil.example/x"]) assert.equal(utils.safeMediaUrl(value), "");
  assert.equal(utils.thumbnailUrl({ id: 12, url: "/api/assets/file/12" }), "/api/assets/file/12?thumb=1");
  assert.equal(utils.thumbnailUrl({ url: "/api/images/file/a.png?x=1" }), "/api/images/file/a.png?x=1&thumb=1");
  assert.equal(utils.thumbnailUrl({ url: "/api/images/file/a.png?thumb=1&t=22" }), "/api/images/file/a.png?thumb=1");
  assert.equal(utils.mediaUrl({ id: 12, url: "/api/assets/file/12" }), "/api/assets/file/12");
});

test("分页兼容真实 API 的 pagination 包装和顶层分页字段", () => {
  assert.equal(utils.listTotal({ pagination: { total: 36 } }), 36);
  assert.equal(utils.listTotal({ total: 20 }), 20);
  assert.equal(utils.listTotal({ items: [] }), 0);
});

test("素材引用去掉重复前缀，来源文字与标签安全转义", () => {
  assert.equal(utils.referenceToken("asset:123"), "@[asset:123]");
  assert.equal(utils.escapeHtml('<script src="x">'), "&lt;script src=&quot;x&quot;&gt;");
  assert.deepEqual(utils.parseTags("摄影， 产品,摄影,, "), ["摄影", "产品"]);
});

test("方案与历史快照复制嵌套引用，创建及载入后的编辑互不污染", () => {
  const current = { prompt: "产品图", assetIds: ["1"], assetNames: { 1: "主图" }, model: "image-model", extra: { tags: ["商品"] } };
  const batch = utils.cloneCreativeDraft(current);
  const scheme = utils.cloneCreativeDraft(current);
  current.assetIds.push("2"); current.assetNames[1] = "改名"; current.extra.tags.push("新标签");
  assert.deepEqual(batch.assetIds, ["1"]);
  assert.equal(scheme.assetNames[1], "主图");
  assert.deepEqual(scheme.extra.tags, ["商品"]);
  const loaded = utils.cloneCreativeDraft(scheme);
  loaded.assetIds.push("3"); loaded.assetNames[1] = "载入后修改";
  assert.deepEqual(scheme.assetIds, ["1"]);
  assert.equal(scheme.assetNames[1], "主图");
});

test("音频下载扩展名由实际 MIME 确定，兼容全部生成格式与 M4A 上传", () => {
  for (const [mime, extension] of Object.entries({ "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/aac": "aac", "audio/flac": "flac", "audio/mp4": "m4a" })) {
    assert.equal(utils.audioFilename({ title: "旁白", mime }), `旁白.${extension}`);
  }
  assert.equal(utils.audioFilename({ title: "旁白.mp3", mime: "Audio/WAV; charset=binary", format: "mp3" }), "旁白.wav");
  assert.equal(utils.audioFilename({ title: "旁白", format: "opus" }), "旁白.ogg");
  assert.equal(utils.audioFilename({ title: "../旁白", mime: "audio/wav" }), "..-旁白.wav");
});

async function pageHarness(filename, overrides = {}) {
  const source = await fs.readFile(path.join(__dirname, `../public/pages/${filename}`), "utf8");
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: id === "prompt" ? "测试朗读" : "", options: [], hidden: false, disabled: false, textContent: "", innerHTML: "", dataset: {}, setAttribute() {}, removeAttribute() {}, scrollIntoView() {}, focus() {} });
    return elements.get(id);
  }
  const writes = [];
  const credits = [];
  const posts = [];
  const context = vm.createContext({
    ...utils, document: { getElementById: element },
    setStatus: (target, text, kind = "") => { target.textContent = text; target.kind = kind; },
    setCredits: (value) => credits.push(value),
    writeStored: (userId, name, value) => { writes.push({ userId, name, value }); return true; },
    emptyHtml: (title) => title,
    setTimeout: (fn) => { fn(); return 1; },
    apiGet: async () => ({ items: [], pagination: { total: 0 } }),
    apiPost: async (url, body) => { posts.push({ url, body }); return {}; },
    ...overrides,
  });
  vm.runInContext(source.replace(/^import .*;\s*$/gm, "").replace(/^main\(\)\.catch.*$/m, ""), context, { filename });
  return { context, element, writes, credits, posts, run: (code) => vm.runInContext(code, context) };
}

test("工作台实际 draft/applyDraft 对历史与方案双向隔离", async () => {
  const page = await pageHarness("workbench/workbench.js");
  for (const [id, value] of Object.entries({ model: "", count: "1", resolution: "1k", ratio: "1:1" })) { page.element(id).value = value; page.element(id).options = [{ value }]; }
  page.run('user = {id: 7}; assetIds = ["1"]; assetNames = {1: "图1"}; const saved = draft(); assetIds.push("2"); assetNames[1] = "改名";');
  assert.deepEqual(JSON.parse(page.run("JSON.stringify(saved.assetIds)")), ["1"]);
  assert.equal(page.run("saved.assetNames[1]"), "图1");
  page.run('applyDraft(saved); assetIds.push("3"); assetNames[1] = "载入后改名";');
  assert.deepEqual(JSON.parse(page.run("JSON.stringify(saved.assetIds)")), ["1"]);
  assert.equal(page.run("saved.assetNames[1]"), "图1");
});

test("图片任务待生成或待核对时保持提交入口禁用，终态才恢复", async () => {
  const page = await pageHarness("workbench/workbench.js");
  page.element("generate").textContent = "开始生成";
  page.run('configured = true; history = [{ id: "pending", status: "pending" }]; syncGenerateButton();');
  assert.equal(page.element("generate").disabled, true);
  assert.equal(page.element("generate").textContent, "正在生成…");
  assert.equal(page.element("generate").hidden, true);
  page.run('history = [{ id: "paused", status: "paused" }]; syncGenerateButton();');
  assert.equal(page.element("generate").disabled, true);
  page.run('history = [{ id: "done", status: "done" }]; syncGenerateButton();');
  assert.equal(page.element("generate").disabled, false);
  assert.equal(page.element("generate").textContent, "开始生成");
  assert.equal(page.element("generate").hidden, false);
});

test("工作台为最新生成记录提供直达进度或结果的入口", async () => {
  const page = await pageHarness("workbench/workbench.js");
  page.run('history = [{ id: "pending", status: "pending", images: [] }]; syncHistoryLink();');
  assert.equal(page.element("viewHistory").hidden, false);
  assert.equal(page.element("viewHistory").textContent, "查看进度");
  assert.equal(page.element("generationProgress").hidden, false);
  assert.equal(page.element("generationProgressTitle").textContent, "正在生成");
  page.run('history = [{ id: "done", status: "done", images: [{ id: "image.png" }] }]; syncHistoryLink();');
  assert.equal(page.element("viewHistory").textContent, "查看结果");
  assert.equal(page.element("generationProgressTitle").textContent, "已生成 1 张图片");
});

for (const status of [403, 404]) {
  test(`音频任务 ${status} 可显式解除本地关联，不修改服务端任务或账单`, async () => {
    const page = await pageHarness("audio/audio.js", { apiGet: async () => { throw Object.assign(new Error("任务不可访问"), { status }); } });
    page.run('user = {id: 7}; config = {configured: true}; pendingTask = "old-task";');
    await page.run("pollAudio()");
    assert.equal(page.element("clearTask").hidden, false);
    assert.equal(page.element("generate").disabled, true);
    assert.equal(page.run("pendingTask"), "old-task");
    page.run("clearInvalidTask()");
    assert.equal(page.run("pendingTask"), null);
    assert.equal(page.element("generate").disabled, false);
    assert.equal(page.writes.at(-1).name, "audioTask");
    assert.equal(page.writes.at(-1).value, null);
    assert.equal(page.posts.length, 0);
    assert.match(page.element("status").textContent, /账单未作修改/);
  });
}

test("running 或暂时查询失败的音频任务不可清除或核对，不自动重复提交", async () => {
  let calls = 0;
  const page = await pageHarness("audio/audio.js", { apiGet: async () => { if (++calls === 1) return { status: "running" }; throw Object.assign(new Error("网络中断"), { status: 503 }); } });
  page.run('user = {id: 7}; config = {configured: true}; pendingTask = "running-task";');
  await page.run("pollAudio()");
  assert.equal(page.element("clearTask").hidden, true);
  assert.equal(page.element("recoverTask").hidden, true);
  assert.equal(page.element("resumeTask").hidden, false);
  page.run("clearInvalidTask()"); await page.run("recoverAudio()");
  assert.equal(page.run("pendingTask"), "running-task");
  assert.equal(page.element("generate").disabled, true);
  assert.equal(page.posts.length, 0);
});

for (const status of ["done", "error"]) {
  test(`中断任务核对为 ${status} 后刷新音频和余额，恢复生成且不重发模型请求`, async () => {
    const posts = [];
    const gets = [];
    const page = await pageHarness("audio/audio.js", {
      apiGet: async (url) => { gets.push(url); return url.startsWith("/api/audio/tasks/") ? { status: "interrupted", error: "服务已重启" } : { items: [], pagination: { total: 0 } }; },
      apiPost: async (url, body) => { posts.push({ url, body }); return { ok: true, taskId: "interrupted-task", status, result: status === "done" ? { credits: 42 } : { assets: [] }, credits: 42, recovered: true, resubmitted: false }; },
    });
    page.run('user = {id: 7}; config = {configured: true}; pendingTask = "interrupted-task";');
    await page.run("pollAudio()");
    assert.equal(page.element("recoverTask").hidden, false);
    assert.equal(page.element("clearTask").hidden, true);
    assert.equal(page.element("generate").disabled, true);
    assert.equal(gets[0], "/api/audio/tasks/interrupted-task");
    await page.run("recoverAudio()");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "/api/audio/tasks/interrupted-task/recover");
    assert.deepEqual(Object.keys(posts[0].body), []);
    assert.equal(page.run("pendingTask"), null);
    assert.equal(page.element("generate").disabled, false);
    assert.deepEqual(page.credits, [42]);
    assert.ok(gets.some((url) => url.startsWith("/api/audio?")));
    assert.equal(page.element("recoverTask").hidden, true);
  });
}

test("中断任务核对失败保留原关联与核对入口", async () => {
  const page = await pageHarness("audio/audio.js", { apiPost: async () => { throw new Error("结算暂不可用"); } });
  page.run('user = {id: 7}; config = {configured: true}; pendingTask = "interrupted-task"; taskState = "interrupted";');
  await page.run("recoverAudio()");
  assert.equal(page.run("pendingTask"), "interrupted-task");
  assert.equal(page.element("generate").disabled, true);
  assert.equal(page.element("recoverTask").hidden, false);
  assert.equal(page.element("recoverTask").disabled, false);
  assert.equal(page.writes.length, 0);
  assert.match(page.element("status").textContent, /核对失败.*原任务关联已保留/);
});

test("恢复接口拒绝运行中任务时保持关联，不能解除阻止或再次提交", async () => {
  const page = await pageHarness("audio/audio.js", { apiPost: async () => { throw Object.assign(new Error("任务仍在处理中"), { status: 409 }); } });
  page.run('user = {id: 7}; config = {configured: true}; pendingTask = "task"; taskState = "interrupted";');
  await page.run("recoverAudio()");
  page.run("clearInvalidTask()");
  assert.equal(page.run("pendingTask"), "task");
  assert.equal(page.element("generate").disabled, true);
  assert.equal(page.element("clearTask").hidden, true);
  assert.equal(page.writes.length, 0);
});

test("核对完成但列表仍在刷新时，不能提前启动另一段音频", async () => {
  let releaseList;
  const page = await pageHarness("audio/audio.js", { apiPost: async () => ({ task: { status: "done", result: { credits: 40 } } }), apiGet: () => new Promise((resolve) => { releaseList = resolve; }) });
  page.run('user = {id: 7}; config = {configured: true}; pendingTask = "interrupted-task"; taskState = "interrupted";');
  const recovery = page.run("recoverAudio()");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.run("pendingTask"), null);
  assert.equal(page.element("generate").disabled, true);
  releaseList({ items: [], pagination: { total: 0 } });
  await recovery;
  assert.equal(page.element("generate").disabled, false);
});
