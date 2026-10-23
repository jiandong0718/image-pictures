"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable, Writable } = require("node:stream");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createCreativeApi, validateUpload, parseRange, readAssetUpload } = require("../lib/api-creative");
const { inputError } = require("../lib/audio-client");

class ResponseMock extends Writable {
  constructor() { super(); this.headers = {}; this.chunks = []; this.statusCode = 200; this.headersSent = false; }
  _write(chunk, encoding, done) { this.chunks.push(Buffer.from(chunk)); done(); }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  writeHead(status, headers) { this.statusCode = status; this.headersSent = true; for (const [name, value] of Object.entries(headers || {})) this.setHeader(name, value); }
  json() { return JSON.parse(Buffer.concat(this.chunks).toString()); }
}

async function harness(t, overrides = {}) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "creative-api-test-"));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  const calls = { created: [], completed: [], failed: [], metadata: [], writes: 0, generation: 0 };
  const assets = new Map();
  const taskRows = new Map();
  let credits = 100;
  let settlements = 0;
  let config = { apiBase: "https://voice.example/v1", apiKey: "not-for-client", model: "voice", charactersPerCredit: 1000, creditsPerUnit: 1 };
  const resources = {
    getAudioConfig: async () => config,
    saveAudioConfig: async (input) => { calls.writes++; config = { ...config, ...input }; return config; },
    getAsset: async (userId, id) => { const asset = assets.get(Number(id)); if (!asset || asset.ownerUserId !== userId) throw inputError("素材不存在", 404); return asset; },
    findAssetByTask: async (userId, taskId) => [...assets.values()].find((asset) => asset.ownerUserId === userId && asset.generationTaskId === taskId) || null,
    getOwnedMedia: async (userId, kind, mediaId) => { if (userId !== 1) throw inputError("媒体不存在", 404); return { id: mediaId, image_set_id: "001" }; },
    createAsset: async (userId, raw, file) => {
      const id = assets.size + 1;
      const asset = { id, ownerUserId: userId, ...raw, storagePath: file?.storagePath || "", generationTaskId: file?.taskId || "", mime: file?.mime || "", size: file?.size || 0, url: `/api/assets/file/${id}`, imageId: raw.kind === "image" ? raw.mediaId || `asset:${id}` : "" };
      assets.set(id, asset); return asset;
    },
    deleteAsset: async (userId, id) => { const asset = await resources.getAsset(userId, id); assets.delete(Number(id)); return asset; },
    listAssets: async (userId, query) => ({ items: [...assets.values()].filter((asset) => asset.ownerUserId === userId && (!query.kind || query.kind === asset.kind)), total: assets.size, page: 1, pageSize: 10 }),
    ...overrides.resources,
  };
  const sendJson = (res, code, value) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  const sendError = (res, code, message) => sendJson(res, code, { ok: false, error: message });
  const tasks = {
    createTask: async (input) => {
      calls.created.push(input);
      const id = `audio-task-${calls.created.length}`;
      credits -= input.maxCost;
      taskRows.set(id, { id, userId: input.userId, kind: input.kind, status: "running", input: input.input, maxCost: input.maxCost, metadata: {}, result: null, settled: false });
      return id;
    },
    getTask: async (id, user) => {
      const row = taskRows.get(id);
      return row && (row.userId === user.id || user.role === "admin") ? structuredClone(row) : null;
    },
    completeTask: async (...args) => {
      calls.completed.push(args);
      const [id, result, actualCost] = args;
      const row = taskRows.get(id);
      if (row.settled) return row.result;
      credits += row.maxCost - actualCost;
      settlements++;
      Object.assign(row, { status: "done", result: { ...result, credits }, credits, actualCost, settled: true });
      return row.result;
    },
    failTask: async (...args) => {
      calls.failed.push(args);
      const [id, error, options] = args;
      const row = taskRows.get(id);
      if (row.settled) return row.result;
      if (options.uncertain) { Object.assign(row, { status: "interrupted", error }); return row; }
      credits += row.maxCost - options.actualCost;
      settlements++;
      Object.assign(row, { status: "error", error, result: { ...options.result, credits }, credits, actualCost: options.actualCost, settled: true });
      return row.result;
    },
    updateTaskMetadata: async (...args) => { calls.metadata.push(args); Object.assign(taskRows.get(args[0]).metadata, args[1]); },
    ...overrides.tasks,
  };
  const dependencies = {
    outputDir, resources, tasks, sendJson, sendError,
    previewCache: overrides.previewCache,
    ensureThumbnail: overrides.ensureThumbnail,
    readJson: async (req) => req.payload,
    readMultipartFile: overrides.readMultipartFile,
    resolveOutputFile: (id) => path.join(outputDir, id),
    accountApi: {
      requireUser: async (req, res) => { if (!req.user) { sendError(res, 401, "请先登录"); return null; } return req.user; },
      requireAdmin: async (req, res) => { if (req.user?.role !== "admin") { sendError(res, 403, "需要管理员权限"); return null; } return req.user; },
    },
    generateSpeech: overrides.generateSpeech || (async () => { calls.generation++; return { data: Buffer.from("ID3audio-output"), mime: "audio/mpeg", ext: "mp3" }; }),
  };
  let api = createCreativeApi(dependencies);
  const request = async (method, url, payload = {}, user = { id: 1, role: "user" }, headers = {}, body = []) => {
    const parsed = new URL(url, "http://localhost");
    const req = Readable.from(body);
    Object.assign(req, { method, headers, payload, user });
    const res = new ResponseMock();
    const handled = await api(req, res, parsed.pathname, parsed.searchParams);
    return { handled, res };
  };
  return { get api() { return api; }, restart: () => { api = createCreativeApi(dependencies); }, request, calls, assets, outputDir, tasks, taskRows, getCredits: () => credits, getSettlements: () => settlements, setConfig: (value) => { config = value; } };
}

async function interruptedAudio(h, { output = false, ...overrides } = {}) {
  const input = { prompt: "你".repeat(1001), characterCount: 1001, estimatedCost: 2, charactersPerCredit: 1000, creditsPerUnit: 1 };
  const id = await h.tasks.createTask({ userId: 1, kind: "audio", input, maxCost: 2 });
  Object.assign(h.taskRows.get(id), { status: "interrupted", ...overrides });
  if (output) {
    const storagePath = "1/aaaaaaaa.mp3";
    const file = path.join(h.outputDir, ".creative-assets", storagePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "ID3existing-audio");
    h.assets.set(1, { id: 1, ownerUserId: 1, kind: "audio", mime: "audio/mpeg", generationTaskId: id, storagePath, url: "/api/assets/file/1", title: "已生成声音" });
    h.taskRows.get(id).metadata = { result: { audio: { id: 1 } } };
  }
  return id;
}

test("音频接口要求登录、管理配置要求管理员、密钥不回传", async (t) => {
  const h = await harness(t);
  assert.equal((await h.request("GET", "/api/audio-config", {}, null)).res.statusCode, 401);
  assert.equal((await h.request("POST", "/api/audio-config", { apiKey: "new" })).res.statusCode, 403);
  assert.equal(h.calls.writes, 0);
  const result = (await h.request("GET", "/api/audio-config")).res.json();
  assert.equal(result.config.configured, true);
  assert.equal(result.config.charactersPerCredit, 1000);
  assert.equal(JSON.stringify(result).includes("not-for-client"), false);
  assert.equal((await h.request("POST", "/api/audio-config", { model: "new" }, { id: 2, role: "admin" })).res.statusCode, 200);
  assert.equal(h.calls.writes, 1);
  assert.equal((await h.request("POST", "/api/prompts/extract")).handled, false);
});

test("无音频配置时不创建任务、不冻结积分或调用模型", async (t) => {
  const h = await harness(t);
  h.setConfig({ charactersPerCredit: 1000, creditsPerUnit: 1 });
  const { res } = await h.request("POST", "/api/audio", { prompt: "你好" });
  assert.equal(res.statusCode, 503);
  assert.equal(h.calls.created.length, 0);
  assert.equal(h.calls.generation, 0);
});

test("音频任务异步返回、按字符预占并生成私有素材后按原价格结算", async (t) => {
  const h = await harness(t);
  const { res } = await h.request("POST", "/api/audio", { prompt: "🙂".repeat(1001) });
  assert.equal(res.statusCode, 202);
  assert.equal(res.json().characterCount, 1001);
  assert.equal(res.json().estimatedCost, 2);
  assert.equal(h.calls.created[0].maxCost, 2);
  assert.equal(JSON.stringify(h.calls.created).includes("not-for-client"), false);
  h.setConfig({ apiBase: "other", apiKey: "other", model: "other", charactersPerCredit: 1, creditsPerUnit: 100 });
  await h.api.waitForAudioTasks();
  assert.equal(h.calls.completed.length, 1);
  assert.equal(h.calls.completed[0][2], 2);
  assert.equal(h.calls.failed.length, 0);
  const result = h.calls.completed[0][1];
  assert.equal(result.audio.storagePath, undefined);
  assert.equal(result.audio.ownerUserId, undefined);
  assert.equal(h.calls.metadata[0][1].result.audio.url, result.audio.url);
  const file = await h.request("GET", result.audio.url);
  assert.equal(file.res.statusCode, 200);
  assert.equal(Buffer.concat(file.res.chunks).toString(), "ID3audio-output");
});

test("音频模型失败退还全部预占；结算异常保留输出等待确认", async (t) => {
  const failed = await harness(t, { generateSpeech: async () => { throw inputError("音频服务返回 HTTP 500", 502); } });
  await failed.request("POST", "/api/audio", { prompt: "你好" });
  await failed.api.waitForAudioTasks();
  assert.equal(failed.calls.failed.length, 1);
  assert.deepEqual(failed.calls.failed[0][2], { actualCost: 0, uncertain: false });
  assert.equal(failed.assets.size, 0);
  const settlement = await harness(t, { tasks: { completeTask: async () => { throw new Error("db unavailable"); } } });
  await settlement.request("POST", "/api/audio", { prompt: "你好" });
  await settlement.api.waitForAudioTasks();
  assert.deepEqual(settlement.calls.failed[0][2], { actualCost: 0, uncertain: true });
  assert.equal(settlement.assets.size, 1);
  assert.equal(settlement.calls.metadata.length, 1);
});

test("受保护音频文件支持 Range 并拒绝其他用户和不可满足范围", async (t) => {
  const h = await harness(t);
  await h.request("POST", "/api/audio", { prompt: "你好" });
  await h.api.waitForAudioTasks();
  const range = (await h.request("GET", "/api/assets/file/1", {}, undefined, { range: "bytes=3-7" })).res;
  assert.equal(range.statusCode, 206);
  assert.equal(range.headers["content-range"], "bytes 3-7/15");
  assert.equal(Buffer.concat(range.chunks).toString(), "audio");
  assert.equal((await h.request("GET", "/api/assets/file/1", {}, { id: 2, role: "admin" })).res.statusCode, 404);
  const invalid = (await h.request("GET", "/api/assets/file/1", {}, undefined, { range: "bytes=999-" })).res;
  assert.equal(invalid.statusCode, 416);
  assert.equal(invalid.headers["content-range"], "bytes */15");
});

test("删除图库素材只删引用，独占上传删除文件，素材图片解析受保护", async (t) => {
  const h = await harness(t);
  await fs.mkdir(path.join(h.outputDir, "001"));
  const galleryFile = path.join(h.outputDir, "001", "product.png");
  await fs.writeFile(galleryFile, Buffer.from("gallery-image"));
  h.assets.set(1, { id: 1, ownerUserId: 1, kind: "image", title: "商品", mediaId: "001/product.png", imageId: "001/product.png", storagePath: "" });
  assert.equal((await h.api.resolveAssetImages({ id: 1 }, ["asset:1"]))[0].filePath, await fs.realpath(galleryFile));
  await assert.rejects(h.api.resolveAssetImages({ id: 2 }, [1]), (error) => error.statusCode === 404);
  assert.equal((await h.request("DELETE", "/api/assets/1")).res.statusCode, 200);
  assert.equal((await fs.readFile(galleryFile)).toString(), "gallery-image");
  await h.request("POST", "/api/audio", { prompt: "你好" });
  await h.api.waitForAudioTasks();
  const audioAsset = h.assets.get(1);
  const uploadedFile = path.join(h.outputDir, ".creative-assets", audioAsset.storagePath);
  await h.request("DELETE", "/api/assets/1");
  await assert.rejects(fs.access(uploadedFile), (error) => error.code === "ENOENT");
});

test("素材缩略图在归属校验后生成或返回 304，原件继续用于生成引用", async (t) => {
  let previewCalls = 0;
  let previewFile;
  const h = await harness(t, { ensureThumbnail: async () => { previewCalls++; return previewFile; } });
  await fs.mkdir(path.join(h.outputDir, "001"));
  const original = path.join(h.outputDir, "001", "product.png");
  previewFile = path.join(h.outputDir, "preview.webp");
  await fs.writeFile(original, "full-image");
  await fs.writeFile(previewFile, "small-webp");
  h.assets.set(1, { id: 1, ownerUserId: 1, kind: "image", title: "商品", mediaId: "001/product.png", imageId: "001/product.png", storagePath: "" });
  const first = (await h.request("GET", "/api/assets/file/1?thumb=1")).res;
  assert.equal(first.headers["content-type"], "image/webp");
  assert.equal(Buffer.concat(first.chunks).toString(), "small-webp");
  assert.equal(previewCalls, 1);
  const cached = (await h.request("GET", "/api/assets/file/1?thumb=1", {}, undefined, { "if-none-match": first.headers.etag })).res;
  assert.equal(cached.statusCode, 304);
  const denied = (await h.request("GET", "/api/assets/file/1?thumb=1", {}, { id: 2 }, { "if-none-match": "*" })).res;
  assert.equal(denied.statusCode, 404);
  assert.equal(previewCalls, 2);
  assert.equal((await h.api.resolveAssetImages({ id: 1 }, [1]))[0].filePath, await fs.realpath(original));
});

test("远程导入和假图片被拒绝，合法上传表单保留标题", async (t) => {
  const h = await harness(t);
  assert.equal((await h.request("POST", "/api/assets", { kind: "image", title: "x", url: "http://127.0.0.1/internal" })).res.statusCode, 400);
  assert.throws(() => validateUpload({ data: Buffer.from("<script>alert(1)</script>"), mime: "image/png" }));
  assert.throws(() => validateUpload({ data: Buffer.from("<svg/>"), mime: "image/svg+xml" }));
  assert.throws(() => validateUpload({ data: Buffer.alloc(21 * 1024 * 1024), mime: "video/mp4" }), (error) => error.statusCode === 413);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  assert.equal(validateUpload({ data: png, mime: "image/png" }).kind, "image");
  const body = Buffer.concat([Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="title"\r\n\r\n我的素材\r\n--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n'), png, Buffer.from("\r\n--test-boundary--\r\n")]);
  const req = Readable.from([body]);
  req.headers = { "content-type": "multipart/form-data; boundary=test-boundary" };
  const result = await readAssetUpload(req, async (replay, fieldName) => {
    assert.equal(fieldName, "file");
    const chunks = []; for await (const part of replay) chunks.push(part);
    assert.deepEqual(Buffer.concat(chunks), body);
    return { filename: "a.png", mime: "image/png", data: png };
  });
  assert.equal(result.title, "我的素材");
});

test("单段媒体范围支持前缀、后缀和开放结束，拒绝多范围及数字溢出", () => {
  assert.deepEqual(parseRange("bytes=1-3", 10), { start: 1, end: 3 });
  assert.deepEqual(parseRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange("bytes=3-", 10), { start: 3, end: 9 });
  assert.deepEqual(parseRange("bytes=1-100", 10), { start: 1, end: 9 });
  for (const range of ["bytes=0-1,3-4", "bytes=-0", "bytes=4-2", "bytes=9007199254740993-", "items=1-2"]) assert.throws(() => parseRange(range, 10), (error) => error.statusCode === 416);
});

test("音频恢复只处理自己的音频中断任务，拒绝正在运行和客户端费用结果", async (t) => {
  const h = await harness(t);
  const id = await interruptedAudio(h);
  const url = `/api/audio/tasks/${id}/recover`;
  assert.equal((await h.request("POST", url, {}, null)).res.statusCode, 401);
  for (const role of ["user", "admin"]) assert.equal((await h.request("POST", url, {}, { id: 2, role })).res.statusCode, 404);
  for (const payload of [{ actualCost: 0 }, { result: { audio: { id: 1 } } }, { prompt: "重放" }]) assert.equal((await h.request("POST", url, payload)).res.statusCode, 400);
  h.taskRows.get(id).status = "running";
  assert.equal((await h.request("POST", url)).res.statusCode, 409);
  h.taskRows.get(id).status = "interrupted";
  h.taskRows.get(id).kind = "image";
  assert.equal((await h.request("POST", url)).res.statusCode, 404);
  assert.equal(h.getCredits(), 98);
  assert.equal(h.getSettlements(), 0);
  assert.equal(h.calls.generation, 0);
});

test("中断音频有可用输出时按原价恢复，重复及并发核对只结算一次", async (t) => {
  const h = await harness(t);
  const id = await interruptedAudio(h, { output: true });
  const url = `/api/audio/tasks/${id}/recover`;
  // 通用任务存储可能已脱敏输入，计费仍以原字符数快照为准。
  h.taskRows.get(id).input.prompt = "Bearer [redacted]";
  h.setConfig({ charactersPerCredit: 1, creditsPerUnit: 999 });
  const responses = await Promise.all([h.request("POST", url), h.request("POST", url)]);
  for (const { res } of responses) {
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "done");
    assert.equal(res.json().credits, 98);
    assert.equal(res.json().resubmitted, false);
    assert.equal(res.json().result.audio.url, "/api/assets/file/1");
  }
  assert.equal(h.getSettlements(), 1);
  assert.equal(h.getCredits(), 98);
  const callsBefore = h.calls.completed.length;
  const repeated = (await h.request("POST", url)).res.json();
  assert.equal(repeated.recovered, false);
  assert.equal(repeated.status, "done");
  assert.equal(h.calls.completed.length, callsBefore);
  assert.equal(h.calls.generation, 0);
});

test("中断音频无输出或文件缺失时释放预占，重复请求不重复退款", async (t) => {
  for (const situation of ["no-output", "missing-row", "missing-file", "wrong-kind"]) {
    const h = await harness(t);
    const id = await interruptedAudio(h, { output: situation !== "no-output" });
    if (situation === "missing-row") h.assets.clear();
    if (situation === "missing-file") await fs.unlink(path.join(h.outputDir, ".creative-assets/1/aaaaaaaa.mp3"));
    if (situation === "wrong-kind") h.assets.get(1).kind = "image";
    const url = `/api/audio/tasks/${id}/recover`;
    const result = (await h.request("POST", url)).res.json();
    assert.equal(result.status, "error", situation);
    assert.equal(result.credits, 100, situation);
    assert.equal(result.resubmitted, false);
    assert.match(result.error, /已释放预占积分/);
    await h.request("POST", url);
    assert.equal(h.getCredits(), 100);
    assert.equal(h.getSettlements(), 1);
    assert.equal(h.calls.generation, 0);
  }
});

test("恢复时计费快照不一致不能扣款，文件检查异常不能误退款", async (t) => {
  const mismatch = await harness(t);
  const id = await interruptedAudio(mismatch, { output: true });
  mismatch.taskRows.get(id).input.estimatedCost = 1;
  assert.equal((await mismatch.request("POST", `/api/audio/tasks/${id}/recover`)).res.statusCode, 409);
  assert.equal(mismatch.getSettlements(), 0);
  assert.equal(mismatch.getCredits(), 98);
  const unavailable = await harness(t, { resources: { findAssetByTask: async () => { throw new Error("db unavailable"); } } });
  const otherId = await interruptedAudio(unavailable, { output: true });
  assert.equal((await unavailable.request("POST", `/api/audio/tasks/${otherId}/recover`)).res.statusCode, 503);
  assert.equal(unavailable.getSettlements(), 0);
  assert.equal(unavailable.getCredits(), 98);
});

test("音频结果登记瞬时失败重试保存 metadata，持续失败不能报告成功", async (t) => {
  for (const permanent of [false, true]) {
    let attempts = 0;
    let h;
    h = await harness(t, { tasks: { updateTaskMetadata: async (id, metadata) => {
      attempts++;
      if (permanent || attempts === 1) throw new Error("metadata write failed");
      Object.assign(h.taskRows.get(id).metadata, metadata);
    } } });
    await h.request("POST", "/api/audio", { prompt: "你好" });
    await h.api.waitForAudioTasks();
    const task = h.taskRows.get("audio-task-1");
    assert.equal(attempts, 2);
    assert.equal(task.status, "interrupted");
    assert.equal(h.calls.completed.length, 0);
    assert.equal(h.calls.generation, 1);
    if (permanent) {
      assert.equal(task.metadata.result, undefined);
      assert.match(task.error, /任务结果登记失败/);
    } else assert.equal(task.metadata.result.audio.id, 1);
  }
});

test("退款写库首次失败后专用查询允许原地核对，不需重启也不重复请求模型", async (t) => {
  const h = await harness(t, { generateSpeech: async () => { throw inputError("音频服务失败", 502); } });
  const failTask = h.tasks.failTask;
  let failedOnce = false;
  h.tasks.failTask = async (...args) => { if (!failedOnce) { failedOnce = true; throw new Error("transient refund failure"); } return failTask(...args); };
  const submitted = (await h.request("POST", "/api/audio", { prompt: "你好" })).res.json();
  await h.api.waitForAudioTasks();
  assert.equal(h.taskRows.get(submitted.taskId).status, "running");
  const url = `/api/audio/tasks/${submitted.taskId}`;
  const status = (await h.request("GET", url)).res.json();
  assert.equal(status.status, "interrupted");
  assert.equal(h.getCredits(), 99);
  assert.equal((await h.request("GET", url, {}, { id: 2, role: "admin" })).res.statusCode, 404);
  const recovered = (await h.request("POST", `${url}/recover`)).res.json();
  assert.equal(recovered.status, "error");
  assert.equal(recovered.credits, 100);
  assert.equal(h.getSettlements(), 1);
  assert.equal((await h.request("GET", url)).res.json().status, "error");
  await h.request("POST", `${url}/recover`);
  assert.equal(h.getSettlements(), 1);
});

test("素材已存但 metadata 丢失，重建处理器后仍按持久任务关联结算原价", async (t) => {
  const h = await harness(t, { tasks: { updateTaskMetadata: async () => { throw new Error("metadata unavailable"); } } });
  const submitted = (await h.request("POST", "/api/audio", { prompt: "你好" })).res.json();
  await h.api.waitForAudioTasks();
  const task = h.taskRows.get(submitted.taskId);
  assert.equal(task.metadata.result, undefined);
  assert.equal(task.status, "interrupted");
  assert.equal(h.assets.get(1).generationTaskId, submitted.taskId);
  h.restart();
  const recovered = (await h.request("POST", `/api/audio/tasks/${submitted.taskId}/recover`)).res.json();
  assert.equal(recovered.status, "done");
  assert.equal(recovered.credits, 99);
  assert.equal(recovered.result.audio.id, 1);
  assert.equal(recovered.result.audio.generationTaskId, undefined);
  assert.equal(h.taskRows.get(submitted.taskId).actualCost, 1);
  assert.equal(h.calls.generation, 1);
  assert.equal(h.calls.failed.length, 1);
});

test("无 metadata 时关联查询失败必须保留预占，不能把故障当作没有输出", async (t) => {
  const h = await harness(t, { resources: { findAssetByTask: async () => { throw new Error("association lookup failed"); } } });
  const id = await interruptedAudio(h);
  const { res } = await h.request("POST", `/api/audio/tasks/${id}/recover`);
  assert.equal(res.statusCode, 503);
  assert.equal(h.getCredits(), 98);
  assert.equal(h.getSettlements(), 0);
  assert.equal(h.calls.failed.length, 0);
});

test("活动 job 即使已有待结算标记仍不可核对，只有 job 结束后允许重试", async (t) => {
  const h = await harness(t, { generateSpeech: async () => { throw inputError("模型失败", 502); } });
  const originalFail = h.tasks.failTask;
  let rejectWrite;
  let notify;
  const started = new Promise((resolve) => { notify = resolve; });
  h.tasks.failTask = async (...args) => {
    if (rejectWrite) return originalFail(...args);
    return new Promise((resolve, reject) => { rejectWrite = reject; notify(); });
  };
  const submitted = (await h.request("POST", "/api/audio", { prompt: "你好" })).res.json();
  await started;
  const url = `/api/audio/tasks/${submitted.taskId}`;
  assert.equal((await h.request("GET", url)).res.json().status, "running");
  assert.equal((await h.request("POST", `${url}/recover`)).res.statusCode, 409);
  rejectWrite(new Error("write failed"));
  await h.api.waitForAudioTasks();
  assert.equal((await h.request("GET", url)).res.json().status, "interrupted");
  assert.equal((await h.request("POST", `${url}/recover`)).res.json().credits, 100);
  assert.equal(h.getSettlements(), 1);
});

test("公共提示词刷新接口支持 all 与 force，客户端不能提供任意 URL", async (t) => {
  const refreshes = [];
  const h = await harness(t, { resources: {
    refreshAllSources: async (options) => { refreshes.push({ all: true, options }); return { sourceId: "all", count: 7, results: [] }; },
    refreshPromptSource: async (id, options) => { refreshes.push({ id, options }); if (id === "https://invalid.example") throw inputError("提示词来源不存在", 404); return { count: 1 }; },
  } });
  const result = (await h.request("POST", "/api/prompt-sources/refresh", { sourceId: "all", force: true })).res;
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().count, 7);
  assert.deepEqual(refreshes[0], { all: true, options: { force: true } });
  assert.equal((await h.request("POST", "/api/prompt-sources/refresh", { sourceId: "all", force: "true" })).res.statusCode, 400);
  assert.equal((await h.request("POST", "/api/prompt-sources/refresh", { sourceId: "https://invalid.example" })).res.statusCode, 404);
});
