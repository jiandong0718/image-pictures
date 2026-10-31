"use strict";

// 真实 MySQL + HTTP 隔离验收。只允许本机；创建专用临时库和输出目录，退出时删除。
// node tests/service-center-mysql.js [--serve]；--serve 保留测试页面供浏览器验收，Ctrl+C 清理。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  spawn
} = require("node:child_process");
const http = require("node:http");
const mysql = require("mysql2/promise");
const {
  createServiceCenter,
  dayOf,
  dayStart
} = require("../lib/service-center");
require("../lib/env").loadEnv();
const appRoot = path.resolve(__dirname, "..");
const base = "http://127.0.0.1:4187";
const database = "service_center_test_" + Date.now();
const config = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  timezone: "Z"
};
if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) throw new Error("隔离验收仅允许本机 MySQL");
let admin;
let pool;
let child;
let upstream;
let directory;
let cleaned = false;
let log = "";
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
  if (pool) await pool.end();
  if (upstream) await new Promise(resolve => upstream.close(resolve));
  if (admin) {
    await admin.query("DROP DATABASE IF EXISTS `" + database + "`");
    await admin.end();
  }
  if (directory) await fs.rm(directory, {
    recursive: true,
    force: true
  });
}
async function request(route, {
  cookie,
  body,
  redirect = "manual",
  headers = {}
} = {}) {
  const response = await fetch(base + route, {
    redirect,
    method: body ? "POST" : "GET",
    headers: {
      ...(cookie ? {
        Cookie: cookie
      } : {}),
      ...(body ? {
        "Content-Type": "application/json"
      } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
  return {
    response,
    data,
    cookie: response.headers.get("set-cookie")?.split(";")[0]
  };
}
async function main() {
  admin = await mysql.createConnection(config);
  await admin.query("CREATE DATABASE `" + database + "` CHARACTER SET utf8mb4");
  await admin.query("CREATE TABLE `" + database + "`.app_settings (k VARCHAR(64) PRIMARY KEY, v TEXT NOT NULL)");
  await admin.query("INSERT INTO `" + database + "`.app_settings (k,v) VALUES ('video_api_key','legacy-local-key'),('video_model','legacy-video'),('prompt_api_base','http://127.0.0.1:4188/v1'),('prompt_api_key','legacy-prompt-key'),('prompt_model','legacy-vision')");
  await admin.query("CREATE TABLE `" + database + "`.creative_audio_config (id TINYINT UNSIGNED PRIMARY KEY, api_base VARCHAR(500) NOT NULL DEFAULT '', api_key VARCHAR(1000) NOT NULL DEFAULT '', model VARCHAR(100) NOT NULL DEFAULT '', characters_per_credit INT NOT NULL DEFAULT 1000, credits_per_unit INT NOT NULL DEFAULT 1)");
  await admin.query("INSERT INTO `" + database + "`.creative_audio_config VALUES (1,'http://127.0.0.1:4188/v1','legacy-audio-key','legacy-speech',20,3)");
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "service-center-http-"));
  await fs.copyFile(path.join(appRoot, "server.js"), path.join(directory, "server.js"));
  for (const name of ["lib", "public", "node_modules", "skills", "vendor"]) await fs.symlink(path.join(appRoot, name), path.join(directory, name));
  child = spawn(process.execPath, [path.join(directory, "server.js")], {
    cwd: directory,
    env: {
      ...process.env,
      DB_NAME: database,
      HOST: "127.0.0.1",
      PORT: "4187",
      ADMIN_USERNAME: "sc_admin",
      ADMIN_PASSWORD: "service-center-local-only",
      CUSTOM_IMAGE_API_KEY: "",
      CUSTOM_PROMPT_API_KEY: "",
      CUSTOM_VIDEO_API_KEY: "",
      VIDEO_API_BASE: "http://127.0.0.1:4188/v1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", chunk => {
    log += chunk.toString();
  });
  child.stderr.on("data", chunk => {
    log += chunk.toString();
  });
  for (let tries = 0; tries < 100; tries++) {
    if (child.exitCode !== null) throw new Error("隔离服务启动失败，退出码 " + child.exitCode);
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  pool = mysql.createPool({
    ...config,
    database
  });
  const login = await request("/api/auth/login", {
    body: {
      username: "sc_admin",
      password: "service-center-local-only"
    }
  });
  assert.equal(login.response.status, 200);
  const adminCookie = login.cookie;
  const signup = await request("/api/auth/register", {
    body: {
      username: "sc_user",
      password: "service-center-local-only",
      email: "service-center@example.test"
    }
  });
  assert.equal(signup.response.status, 200);
  const userCookie = signup.cookie;
  const userId = signup.data.user.id;
  const migratedVideo = (await request("/api/video-config", { cookie: adminCookie })).data;
  assert.equal(migratedVideo.endpoints.length, 1, "旧单组视频配置应自动迁移");
  assert.equal(migratedVideo.endpoints[0].model, "legacy-video");
  assert.doesNotMatch(JSON.stringify(migratedVideo), /legacy-local-key/);
  for (const [kind, model] of [["prompt", "legacy-vision"], ["audio", "legacy-speech"]]) {
    const data = (await request(`/api/${kind}-config`, { cookie: adminCookie })).data;
    assert.equal(data.endpoints.length, 1, `${kind} 旧配置应自动迁移`);
    assert.equal(data.endpoints[0].model, model);
    assert.doesNotMatch(JSON.stringify(data), /legacy-(prompt|audio)-key/);
    if (kind === "audio") { assert.equal(data.endpoints[0].charactersPerCredit, 20); assert.equal(data.endpoints[0].creditsPerUnit, 3); }
  }
  const center = createServiceCenter({
    getPool: () => pool
  });
  const today = dayOf();
  const start = dayStart(today);
  const yesterday = dayOf(start - 1);
  const now = Date.now();
  const range = `start=${yesterday}&end=${today}`;
  const observe = async task => center.observeTask({
    userId,
    kind: "image",
    createdAt: now,
    updatedAt: now,
    status: "done",
    ...task
  });
  await observe({
    id: "cross-midnight",
    createdAt: start - 1000,
    metadata: {
      analyticsModule: "image-image"
    },
    result: {
      images: [{
        id: "001/old.png",
        createdAt: new Date(start - 1000).toISOString()
      }, {
        id: "001/new.png",
        createdAt: new Date(start + 1000).toISOString()
      }]
    }
  });
  await observe({
    id: "cross-midnight",
    createdAt: start - 1000,
    metadata: {
      analyticsModule: "image-image"
    },
    result: {
      images: [{
        id: "001/old.png"
      }, {
        id: "001/new.png"
      }]
    }
  });
  await observe({
    id: "partial",
    metadata: {
      analyticsModule: "studio-hat"
    },
    result: {
      results: {
        main: {
          id: "001/product.png"
        }
      },
      errors: {
        detail: "模拟失败"
      }
    }
  });
  await observe({
    id: "failed-partial",
    status: "error",
    metadata: {
      analyticsModule: "text-image"
    },
    partial: {
      images: [{
        id: "001/partial.png"
      }]
    }
  });
  await observe({
    id: "audio",
    kind: "audio",
    result: {
      audio: {
        id: 9001
      }
    }
  });
  await observe({
    id: "video",
    kind: "video",
    input: {
      mode: "text"
    },
    result: {
      video: {
        id: "001/demo.mp4"
      }
    }
  });
  await observe({
    id: "sync-proxy",
    kind: "proxy-image",
    result: {
      generatedCount: 3
    }
  });
  await observe({
    id: "admin-output",
    userId: login.data.user.id,
    metadata: {
      analyticsModule: "retouch"
    },
    result: {
      image: {
        id: "001/admin.png"
      }
    }
  });
  await pool.query("INSERT INTO credit_transactions (user_id,amount,balance_after,type,note) VALUES (?, -12, 8, 'consume','隔离测试消费')", [userId]);

  // 回填同一个文件和上传文件，确认既不重复计数，也不把上传算作生成。
  await pool.query("INSERT INTO images (id,owner_user_id,filename) VALUES (?, ?, ?), (?, ?, ?)", ["001/new.png", userId, "playground-new.png", "001/uploaded.png", userId, "uploaded-main-test.png"]);
  await pool.query("DELETE FROM service_metrics_meta WHERE k='media_backfilled'");
  await center.backfill();
  await center.backfill();
  await pool.query("INSERT INTO images (id,owner_user_id,filename) VALUES (?,?,?)", ["001/late.png", userId, "generated-late.png"]);
  await center.backfillMedia();
  await observe({ id: "late-attribution", metadata: { analyticsModule: "retouch" }, result: { image: { id: "001/late.png" } } });
  const [[recovered]] = await pool.query("SELECT module,task_id FROM service_outputs WHERE output_id='001/late.png'");
  assert.equal(recovered.module, "retouch", "晚到的任务应修正可确认的历史入口");
  assert.equal(recovered.task_id, "late-attribution");
  await center.getDashboard({
    start: yesterday,
    end: today
  });
  const dashboard = await request("/api/service-center/dashboard?" + range, {
    cookie: adminCookie
  });
  assert.equal(dashboard.response.status, 200, JSON.stringify(dashboard.data));
  assert.equal(dashboard.data.today.users, 1);
  assert.equal(dashboard.data.today.activeUsers, 1);
  assert.equal(dashboard.data.today.image, 7); // 另含第二次回填发现的历史图片。
  assert.equal(dashboard.data.today.video, 1);
  assert.equal(dashboard.data.today.audio, 1);
  assert.equal(dashboard.data.today.credits, 12);
  assert.equal(dashboard.data.days[0].activeUsers, null, "历史活跃缺失不能补零");
  assert.equal(dashboard.data.days[0].image, 1, "零点前产出归到前一天");
  assert.equal(dashboard.data.services.find(s => s.id === "studio-hat").partial, 1);
  assert.equal(dashboard.data.services.find(s => s.id === "studio-hat").successRate, 0);
  assert.equal(dashboard.data.services.find(s => s.id === "text-image").failed, 1);
  const include = (await request("/api/service-center/dashboard?" + range + "&includeAdmins=true", {
    cookie: adminCookie
  })).data;
  assert.equal(include.today.users, 2);
  assert.equal(include.today.image, 8);
  assert.equal(include.today.activeUsers, 2);
  await request("/api/auth/me", {
    cookie: userCookie
  });
  assert.equal((await request("/api/service-center/dashboard?" + range, {
    cookie: adminCookie
  })).data.today.activeUsers, 1);
  const users = (await request("/api/service-center/users?" + range + "&keyword=sc_user&page=999", {
    cookie: adminCookie
  })).data;
  assert.equal(users.pagination.page, 1);
  assert.equal(users.items[0].image, 8, "两天合计包含零点前图片");
  assert.equal(users.items[0].audio, 1);
  assert.equal(users.items[0].consumed, 12);
  const tasks = (await request("/api/service-center/tasks?" + range + "&module=full-playground", {
    cookie: adminCookie
  })).data;
  assert.equal(tasks.items.length, 1);
  assert.equal(tasks.items[0].outputCount, 3);
  assert.equal(Object.hasOwn(tasks.items[0], "input"), false, "统计接口不返回提示词或凭据");
  for (const route of ["dashboard", "users", "tasks"]) {
    assert.equal((await request("/api/service-center/" + route)).response.status, 401);
    assert.equal((await request("/api/service-center/" + route, {
      cookie: userCookie
    })).response.status, 403);
  }
  assert.equal((await request("/service-center")).response.status, 302);
  assert.equal((await request("/service-center", {
    cookie: userCookie
  })).response.status, 302);
  assert.equal((await request("/service-center", {
    cookie: adminCookie
  })).response.status, 200);
  for (const query of ["start=2026-02-30", "start=2020-01-01", "start=2026-10-30&end=2026-10-01"]) assert.equal((await request("/api/service-center/dashboard?" + query, {
    cookie: adminCookie
  })).response.status, 400);
  await pool.query("DELETE FROM images");
  assert.equal((await request("/api/service-center/dashboard?" + range, {
    cookie: adminCookie
  })).data.today.image, 7, "删除作品不抹掉统计");

  // 实际走图片任务、同步代理和语音任务的 HTTP 生命周期；上游仅为本地模拟，无付费请求。
  const imageData = await fs.readFile(path.join(appRoot, "public/assets/editorial-crimson.jpg"));
  const wav = Buffer.alloc(48);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(40, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(4, 40);
  let videoSubmission;
  let wanSubmission;
  let h3Submission;
  let grsaiSubmission;
  let compatSubmission;
  let compatFormSubmission;
  let compatDownloadAuth;
  let promptSubmission;
  let audioSubmission;
  upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url.startsWith("/agnesapi?")) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "completed", url: "http://127.0.0.1:4188/mock.mp4", seconds: "15" })); return; }
    if (req.url === "/api/v1/tasks/wan-task") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ output: { task_status: "SUCCEEDED", video_url: "http://127.0.0.1:4188/mock.mp4" } })); return; }
    if (req.url === "/v2/query/video_generation/h3-task") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ task: { status: "succeeded", content: { url: "http://127.0.0.1:4188/mock.mp4" } } })); return; }
    if (req.url === "/v1/videos/compat-task") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "compat-task", status: "completed", seconds: "4", size: "1280x720", error: null })); return; }
    if (req.url === "/v1/videos/compat-task/content") { compatDownloadAuth = req.headers.authorization; res.writeHead(200, { "Content-Type": "video/mp4" }); res.end(Buffer.alloc(32)); return; }
    if (req.url === "/mock.mp4") { res.writeHead(200, { "Content-Type": "video/mp4" }); res.end(Buffer.alloc(32)); return; }
    if (req.url === "/v1/models") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "mock-video" }] })); return; }
    if (req.url === "/v1/audio/speech") {
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      audioSubmission = { model: payload.model, auth: req.headers.authorization };
      res.writeHead(200, {
        "Content-Type": "audio/wav"
      });
      res.end(wav);
      return;
    }
    if (req.url === "/v1/images/edits") {
      const body = Buffer.concat(chunks).toString();
      if (body.includes("failure-case")) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "测试失败" } })); return; }
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ data: [{ b64_json: imageData.toString("base64") }] })); return;
    }
    if (req.url === "/v1/videos" && /^multipart\/form-data/i.test(req.headers["content-type"] || "")) {
      compatFormSubmission = { body: Buffer.concat(chunks).toString(), auth: req.headers.authorization };
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "compat-task", status: "queued" })); return;
    }
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url === "/v1/video/veo") { grsaiSubmission = input; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ code: 0, data: { id: "grsai-task" } })); return; }
    if (req.url === "/v1/draw/result") { assert.equal(input.id, "grsai-task"); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ code: 0, data: { status: "succeeded", url: "http://127.0.0.1:4188/mock.mp4" } })); return; }
    if (req.url === "/api/v1/services/aigc/video-generation/video-synthesis") { wanSubmission = { input, asyncHeader: req.headers["x-dashscope-async"], auth: req.headers.authorization }; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ output: { task_id: "wan-task" } })); return; }
    if (req.url === "/v2/video_generation") { h3Submission = { input, auth: req.headers.authorization }; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ task_id: "h3-task" })); return; }
    if (req.url === "/v1/videos" && input.seconds) { compatSubmission = { input, auth: req.headers.authorization }; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "compat-task", status: "queued", error: null })); return; }
    if (req.url === "/v1/videos") { videoSubmission = { model: input.model, frames: input.num_frames, auth: req.headers.authorization }; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ video_id: "local-15s" })); return; }
    if (req.url === "/v1/chat/completions") { promptSubmission = { model: input.model, auth: req.headers.authorization }; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: "本机模拟提示词" } }] })); return; }
    res.writeHead(200, {
      "Content-Type": "application/json"
    });
    res.end(JSON.stringify({
      data: Array.from({
        length: input.n || 1
      }, () => ({
        b64_json: imageData.toString("base64")
      }))
    }));
  });
  await new Promise(resolve => upstream.listen(4188, "127.0.0.1", resolve));
  assert.equal((await request("/api/image-config", {
    cookie: adminCookie,
    body: {
      action: "add",
      apiBase: "http://127.0.0.1:4188/v1",
      apiKey: "local-mock-only",
      label: "本机隔离节点",
      model: "mock-image",
      models: ["mock-image"]
    }
  })).response.status, 200);
  async function waitTask(id, audio = false, allowError = false) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const {
        data
      } = await request((audio ? "/api/audio/tasks/" : "/api/tasks/") + id, {
        cookie: userCookie
      });
      if (data.status === "done") return data;
      if (data.status === "error") { if (allowError) return data; throw new Error("本机模拟生成失败：" + data.error); }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("本机模拟任务超时");
  }
  const generated = await request("/api/playground/images", {
    cookie: userCookie,
    headers: {
      Referer: base + "/playground"
    },
    body: {
      mode: "generate",
      prompt: "隔离验收",
      count: 2
    }
  });
  assert.equal(generated.response.status, 200, JSON.stringify(generated.data));
  await waitTask(generated.data.taskId);
  const sync = await request("/api/full-playground-proxy/images/generations", {
    cookie: userCookie,
    body: {
      prompt: "同步代理验收",
      n: 1
    }
  });
  assert.equal(sync.response.status, 200, JSON.stringify(sync.data));
  assert.equal((await request("/api/audio-config", {
    cookie: adminCookie,
    body: {
      apiBase: "http://127.0.0.1:4188/v1",
      apiKey: "local-mock-only",
      model: "mock-tts",
      charactersPerCredit: 1000,
      creditsPerUnit: 1
    }
  })).response.status, 200);
  const sound = await request("/api/audio", {
    cookie: userCookie,
    body: {
      prompt: "隔离语音验收",
      voice: "alloy",
      format: "wav",
      speed: 1
    }
  });
  assert.equal(sound.response.status, 202, JSON.stringify(sound.data));
  await waitTask(sound.data.taskId, true);
  const afterLive = (await request("/api/service-center/dashboard?" + range, {
    cookie: adminCookie
  })).data;
  assert.equal(afterLive.today.image, 10, "图片任务新增2张，同步代理新增1张");
  assert.equal(afterLive.today.audio, 2, "语音真实任务的统计钩子新增1条");
  assert.equal(afterLive.today.credits, 16, "业务消费仍由原结算逻辑记录");
  assert.equal(afterLive.services.find(s => s.id === "text-image").succeeded, 1);
  await center.backfill();
  assert.equal((await request("/api/service-center/dashboard?" + range, {
    cookie: adminCookie
  })).data.today.image, 10, "任务回填不能重复统计实时记录");
  const videoInput = { action: "add", apiBase: "http://127.0.0.1:4188/v1", apiKey: "second-local-key", label: "第二节点", model: "mock-video" };
  assert.equal((await request("/api/video-config", { cookie: userCookie, body: videoInput })).response.status, 403);
  assert.equal((await request("/api/video-config", { cookie: adminCookie, body: videoInput })).response.status, 200);
  const videoSettings = (await request("/api/video-config", { cookie: adminCookie })).data;
  const node = videoSettings.endpoints.find(item => item.label === "第二节点");
  assert.ok(node);
  assert.doesNotMatch(JSON.stringify(videoSettings), /second-local-key/);
  assert.equal((await request("/api/video-config", { cookie: adminCookie, body: { action: "set_default", id: node.id } })).response.status, 200);
  assert.equal((await request("/api/video-config", { cookie: adminCookie, body: { action: "update", id: node.id, apiBase: "http://127.0.0.1:9999/v1", model: "mock-video" } })).response.status, 400, "修改地址不能沿用密钥");
  const publicVideo = (await request("/api/video-config", { cookie: userCookie })).data;
  assert.equal(publicVideo.defaultId, String(node.id));
  assert.equal(publicVideo.endpoints, undefined);
  assert.doesNotMatch(JSON.stringify(publicVideo), /127\.0\.0\.1|local-key/);
  assert.equal((await request("/api/videos", { cookie: userCookie, body: { endpointId: String(node.id), prompt: "超出时长", quality: "720p", duration: "30s" } })).response.status, 400, "不支持的时长不能静默变为 5 秒");
  const submittedVideo = await request("/api/videos", { cookie: userCookie, body: { endpointId: String(node.id), mode: "text", prompt: "隔离视频", quality: "720p", duration: "15s" } });
  assert.equal(submittedVideo.response.status, 200, JSON.stringify(submittedVideo.data));
  await waitTask(submittedVideo.data.taskId);
  assert.deepEqual(videoSubmission, { model: "mock-video", frames: 361, auth: "Bearer second-local-key" });
  const videoDashboard = (await request("/api/service-center/dashboard?" + range, { cookie: adminCookie })).data;
  assert.equal(videoDashboard.today.video, 2);
  assert.equal(videoDashboard.services.find(s => s.id === "video-text").succeeded, 2);
  assert.equal((await request("/api/video-config", { cookie: adminCookie, body: { action: "toggle", id: node.id, enabled: false } })).response.status, 200);
  assert.equal((await request("/api/videos", { cookie: userCookie, body: { endpointId: String(node.id), prompt: "拒绝停用节点" } })).response.status, 400);
  const [legacyCredit] = await pool.query("INSERT INTO credit_transactions (user_id,amount,balance_after,type,note) VALUES (?, -1, 0, 'consume','提示词提取')", [userId]);
  await pool.query("UPDATE service_metrics_meta SET v=? WHERE k='prompt_credit_cutoff'", [String(legacyCredit.insertId)]);
  await center.backfill();
  assert.equal((await request("/api/prompt-config", { cookie: adminCookie, body: { apiBase: "http://127.0.0.1:4188/v1", apiKey: "prompt-local-key", model: "mock-vision" } })).response.status, 200);
  const invalidForm = new FormData();
  invalidForm.append("image", new Blob(["bad"], { type: "text/plain" }), "bad.txt");
  assert.equal((await fetch(base + "/api/prompts/extract", { method: "POST", headers: { Cookie: userCookie }, body: invalidForm })).status, 400);
  const form = new FormData();
  form.append("image", new Blob([imageData], { type: "image/png" }), "source.png");
  assert.equal((await fetch(base + "/api/prompts/extract", { method: "POST", headers: { Cookie: userCookie }, body: form })).status, 200);
  await center.backfill();
  const promptStats = (await request("/api/service-center/dashboard?" + range, { cookie: adminCookie })).data.services.find(s => s.id === "prompt-extract");
  assert.equal(promptStats.succeeded, 2, "历史扣费和实时成功各计一次");
  assert.equal(promptStats.failed, 1);
  await pool.query("UPDATE users SET credits=100 WHERE id=?", [userId]);
  for (const [kind, model, key] of [["prompt", "other-vision", "other-prompt-key"], ["audio", "other-speech", "other-audio-key"]]) {
    const body = { action: "add", apiBase: "http://127.0.0.1:4188/v1", apiKey: key, label: `第二${kind}节点`, model, charactersPerCredit: 2, creditsPerUnit: 3 };
    assert.equal((await request(`/api/${kind}-config`, { cookie: userCookie, body })).response.status, 403);
    assert.equal((await request(`/api/${kind}-config`, { cookie: adminCookie, body })).response.status, 200);
    const listed = (await request(`/api/${kind}-config`, { cookie: adminCookie })).data;
    assert.equal(listed.endpoints.length, 2);
    assert.doesNotMatch(JSON.stringify(listed), new RegExp(key));
    const selected = listed.endpoints.find(item => item.model === model);
    const visible = (await request(`/api/${kind}-config`, { cookie: userCookie })).data;
    assert.equal(visible.endpoints, undefined);
    assert.doesNotMatch(JSON.stringify(visible), /127\.0\.0\.1|other-(prompt|audio)-key/);
    assert.equal((await request(`/api/${kind}-config`, { cookie: adminCookie, body: { action: "update", id: selected.id, apiBase: "http://127.0.0.1:9999/v1", model } })).response.status, 400);
    if (kind === "prompt") {
      const upload = new FormData();
      upload.append("image", new Blob([imageData], { type: "image/png" }), "source.png");
      assert.equal((await fetch(`${base}/api/prompts/extract?endpointId=${selected.id}`, { method: "POST", headers: { Cookie: userCookie }, body: upload })).status, 200);
      assert.deepEqual(promptSubmission, { model, auth: `Bearer ${key}` });
    } else {
      const payload = { endpointId: selected.id, prompt: "四个汉字", voice: "alloy", format: "wav", speed: 1, expectedPricing: { endpointId: selected.id, charactersPerCredit: 2, creditsPerUnit: 1 } };
      const [[before]] = await pool.query("SELECT credits FROM users WHERE id=?", [userId]);
      const [[beforeTasks]] = await pool.query("SELECT COUNT(*) n FROM generation_tasks WHERE kind='audio' AND user_id=?", [userId]);
      assert.equal((await request("/api/audio", { cookie: userCookie, body: payload })).response.status, 409, "计费变化必须在创建任务前拒绝");
      const [[after]] = await pool.query("SELECT credits FROM users WHERE id=?", [userId]);
      const [[afterTasks]] = await pool.query("SELECT COUNT(*) n FROM generation_tasks WHERE kind='audio' AND user_id=?", [userId]);
      assert.equal(after.credits, before.credits);
      assert.equal(afterTasks.n, beforeTasks.n);
      payload.expectedPricing.creditsPerUnit = 3;
      const submitted = await request("/api/audio", { cookie: userCookie, body: payload });
      assert.equal(submitted.response.status, 202, JSON.stringify(submitted.data));
      assert.equal(submitted.data.estimatedCost, 6);
      await waitTask(submitted.data.taskId, true);
      assert.deepEqual(audioSubmission, { model, auth: `Bearer ${key}` });
    }
    assert.equal((await request(`/api/${kind}-config`, { cookie: adminCookie, body: { action: "set_default", id: selected.id } })).response.status, 200);
    assert.equal((await request(`/api/${kind}-config`, { cookie: userCookie })).data.defaultId, String(selected.id));
    assert.equal((await request(`/api/${kind}-config`, { cookie: adminCookie, body: { action: "toggle", id: selected.id, enabled: false } })).response.status, 200);
  }
  const wanNode = { action: "add", protocol: "wan3", label: "本机万相", apiBase: "http://127.0.0.1:4188/api/v1", apiKey: "wan-mock-key", model: "wan3.0-video", creditsPerSecond: 2 };
  const h3Node = { action: "add", protocol: "minimax_h3", label: "本机 H3", apiBase: "http://127.0.0.1:4188", apiKey: "h3-mock-key", model: "MiniMax-H3", creditsPerSecond: 3 };
  const grsaiNode = { action: "add", protocol: "grsai_veo", label: "本机 Grsai", apiBase: "http://127.0.0.1:4188", apiKey: "grsai-mock-key", model: "veo3.1-fast", creditsPerSecond: 7 };
  for (const body of [wanNode, h3Node, grsaiNode]) assert.equal((await request("/api/video-config", { cookie: adminCookie, body })).response.status, 200);
  const available = (await request("/api/video-config", { cookie: userCookie })).data.nodes;
  const wan = available.find(item => item.protocol === "wan3");
  const h3 = available.find(item => item.protocol === "minimax_h3");
  const grsai = available.find(item => item.protocol === "grsai_veo");
  assert.ok(wan.capabilities.durations.includes(30));
  assert.deepEqual(h3.capabilities.qualities, ["768p", "2k"]);
  const upload = new FormData();
  upload.append("image", new Blob([imageData], { type: "image/png" }), "product.png");
  const sourceResponse = await fetch(base + "/api/videos/source", { method: "POST", headers: { Cookie: userCookie }, body: upload });
  assert.equal(sourceResponse.status, 200);
  const source = (await sourceResponse.json()).image;
  const wanBody = { endpointId: wan.id, mode: "image", prompt: "商品展示", quality: "720p", duration: "20s", ratio: "16:9", sourceImageIds: [source.id], expectedPricing: { endpointId: wan.id, creditsPerSecond: 1 } };
  assert.equal((await request("/api/videos", { cookie: userCookie, body: wanBody })).response.status, 409);
  wanBody.expectedPricing.creditsPerSecond = 2;
  const wanTask = await request("/api/videos", { cookie: userCookie, body: wanBody });
  assert.equal(wanTask.response.status, 200, JSON.stringify(wanTask.data));
  const wanResult = await waitTask(wanTask.data.taskId);
  assert.equal(wanResult.result.video.seconds, "20");
  assert.equal(wanSubmission.input.model, "wan3.0-video");
  assert.equal(wanSubmission.input.parameters.duration, 20);
  assert.equal(wanSubmission.input.input.media[0].type, "first_frame");
  assert.match(wanSubmission.input.input.media[0].url, /^data:image\/png;base64,/);
  assert.equal(wanSubmission.asyncHeader, "enable");
  const h3Task = await request("/api/videos", { cookie: userCookie, body: { endpointId: h3.id, mode: "text", prompt: "产品展示", quality: "768p", duration: "8s", ratio: "16:9", expectedPricing: { endpointId: h3.id, creditsPerSecond: 3 } } });
  assert.equal(h3Task.response.status, 200, JSON.stringify(h3Task.data));
  await waitTask(h3Task.data.taskId);
  assert.equal(h3Submission.input.model, "MiniMax-H3");
  assert.equal(h3Submission.input.resolution, "768P");
  assert.equal(h3Submission.input.duration, 8);
  assert.equal(h3Submission.auth, "Bearer h3-mock-key");
  const [[beforeGrsai]] = await pool.query("SELECT credits FROM users WHERE id=?", [userId]);
  const grsaiTask = await request("/api/videos", { cookie: userCookie, body: { endpointId: grsai.id, mode: "image", prompt: "产品展示", quality: "auto", duration: "8s", ratio: "16:9", sourceImageUrls: ["https://example.com/first.png", "https://example.com/last.png"], expectedPricing: { endpointId: grsai.id, creditsPerSecond: 7 } } });
  assert.equal(grsaiTask.response.status, 200, JSON.stringify(grsaiTask.data));
  const grsaiResult = await waitTask(grsaiTask.data.taskId);
  const [[afterGrsai]] = await pool.query("SELECT credits FROM users WHERE id=?", [userId]);
  assert.equal(beforeGrsai.credits - afterGrsai.credits, 7, "Grsai 计价应按次而非时长乘价");
  assert.equal(grsaiResult.result.video.seconds, "");
  assert.equal(grsaiSubmission.firstFrameUrl, "https://example.com/first.png");
  assert.equal(grsaiSubmission.lastFrameUrl, "https://example.com/last.png");
  assert.equal(grsaiSubmission.webHook, "-1");
  const discovery = await request("/api/image-config", { cookie: adminCookie, body: { action: "discover_models", sourceType: "video", apiBase: "http://127.0.0.1:4188/v1", apiKey: "compat-mock-key" } });
  assert.equal(discovery.response.status, 200);
  assert.ok(discovery.data.models.includes("mock-video"));
  const compatNode = { action: "add", protocol: "openai_video", label: "通用视频", apiBase: "http://127.0.0.1:4188/v1", apiKey: "compat-mock-key", model: "mock-video", creditsPerSecond: 2 };
  assert.equal((await request("/api/video-config", { cookie: adminCookie, body: compatNode })).response.status, 200);
  const compat = (await request("/api/video-config", { cookie: userCookie })).data.nodes.find(item => item.protocol === "openai_video");
  const incompatibleImage = await request("/api/videos", { cookie: userCookie, body: { endpointId: compat.id, mode: "image", prompt: "展示", quality: "720p", duration: "4s", ratio: "16:9", sourceImageIds: [source.id], expectedPricing: { endpointId: compat.id, creditsPerSecond: 2 } } });
  assert.equal(incompatibleImage.response.status, 200);
  const rejectedImage = await waitTask(incompatibleImage.data.taskId, false, true);
  assert.equal(rejectedImage.status, "error");
  assert.match(rejectedImage.error, /1280x720/);
  const compatTask = await request("/api/videos", { cookie: userCookie, body: { endpointId: compat.id, mode: "text", prompt: "商品展示", quality: "720p", duration: "4s", ratio: "16:9", expectedPricing: { endpointId: compat.id, creditsPerSecond: 2 } } });
  assert.equal(compatTask.response.status, 200, JSON.stringify(compatTask.data));
  const compatResult = await waitTask(compatTask.data.taskId);
  assert.equal(compatResult.result.video.seconds, "4");
  assert.equal(compatSubmission.input.model, "mock-video");
  assert.equal(compatSubmission.input.size, "1280x720");
  assert.equal(compatDownloadAuth, "Bearer compat-mock-key");
  assert.equal((await request("/api/video-config", { cookie: adminCookie, body: { ...compatNode, protocol: "openai_video_form", label: "通用表单视频" } })).response.status, 200);
  const compatForm = (await request("/api/video-config", { cookie: userCookie })).data.nodes.find(item => item.protocol === "openai_video_form");
  assert.ok(compatForm);
  const formTask = await request("/api/videos", { cookie: userCookie, body: { endpointId: compatForm.id, mode: "text", prompt: "商品展示", quality: "720p", duration: "4s", ratio: "16:9", expectedPricing: { endpointId: compatForm.id, creditsPerSecond: 2 } } });
  assert.equal(formTask.response.status, 200, JSON.stringify(formTask.data));
  assert.equal((await waitTask(formTask.data.taskId)).status, "done");
  assert.match(compatFormSubmission.body, /name="model"\r\n\r\nmock-video/);
  assert.equal(compatFormSubmission.auth, "Bearer compat-mock-key");
  const productUpload = new FormData();
  productUpload.append("image", new Blob([imageData], { type: "image/jpeg" }), "product.jpg");
  const productSourceResponse = await fetch(base + "/api/product-sets/source", { method: "POST", headers: { Cookie: userCookie }, body: productUpload });
  assert.equal(productSourceResponse.status, 200);
  const productSource = (await productSourceResponse.json()).image;
  const productBody = { templateId: "clean", imageSetId: productSource.imageSetId, mainImageId: productSource.id, types: ["whiteBackground", "detail", "scene", "sellingPoints"], prompts: { whiteBackground: "独立白底主图", detail: "独立细节图", scene: "failure-case", sellingPoints: "独立卖点图" }, imageSpec: { sizeMode: "preset", sizePreset: "1k", ratioPreset: "1:1" } };
  assert.equal((await request("/api/product-sets/generate", { body: productBody })).response.status, 401);
  const [[beforeProduct]] = await pool.query("SELECT credits FROM users WHERE id=?", [userId]);
  const productTask = await request("/api/product-sets/generate", { cookie: userCookie, headers: { Referer: base + "/product-sets" }, body: productBody });
  assert.equal(productTask.response.status, 200, JSON.stringify(productTask.data));
  const [[productReserved]] = await pool.query("SELECT reserved_cost FROM generation_tasks WHERE id=?", [productTask.data.taskId]);
  assert.equal(productReserved.reserved_cost, 4);
  const productResult = await waitTask(productTask.data.taskId);
  assert.equal(Object.keys(productResult.result.results).length, 3);
  assert.ok(productResult.result.errors.scene);
  assert.equal(productResult.partial.total, 4);
  assert.equal(productResult.partial.images.length, 3);
  const [[afterProduct]] = await pool.query("SELECT credits FROM users WHERE id=?", [userId]);
  assert.equal(beforeProduct.credits - afterProduct.credits, 3, "四张中三张成功，应结算三积分并退回一积分");
  const [[productMetric]] = await pool.query("SELECT module FROM service_tasks WHERE id=?", [productTask.data.taskId]);
  assert.equal(productMetric.module, "product-sets");
  assert.equal((await request("/api/product-sets/generate", { cookie: userCookie, body: { ...productBody, imageSetId: "999999" } })).response.status, 400);
  await observe({ id: "same-second-restart", status: "running", updatedAt: Math.floor(now / 1000) * 1000 + 900 });
  await observe({ id: "same-second-restart", status: "interrupted", updatedAt: Math.floor(now / 1000) * 1000 });
  const [[interrupted]] = await pool.query("SELECT status FROM service_tasks WHERE id='same-second-restart'");
  assert.equal(interrupted.status, "interrupted", "秒级数据库时间不能阻止重启后状态从运行转为中断");
  await observe({ id: "known-success", result: { image: { id: "001/preserved.png" } } });
  await observe({ id: "known-success", status: "interrupted", updatedAt: now + 10000 });
  const [[preserved]] = await pool.query("SELECT status FROM service_tasks WHERE id='known-success'");
  assert.equal(preserved.status, "done", "已经确认的成功不能被兼容表中的重启中断状态覆盖");
  assert.doesNotMatch(log, /统计记录失败|请求处理异常|数据库初始化失败/);
  console.log(JSON.stringify({
    passed: true,
    checks: ["真实MySQL聚合", "北京时间跨日", "历史回填与归类修正", "上传排除", "管理员筛选", "活跃去重", "权限", "实际图片与语音统计", "提示词成功失败统计", "旧服务迁移", "视频视觉语音多服务与密钥隔离", "Agnes与万相3及MiniMax H3模拟任务", "20秒首帧图生", "语音和视频按节点计价及价格变更拒绝", "重启状态同步"],
    base
  }));
  if (process.argv.includes("--serve")) {
    console.log("浏览器验收账号：sc_admin / service-center-local-only（隔离测试库，无真实模型调用）");
    process.on("SIGINT", () => cleanup().then(() => process.exit()));
    process.on("SIGTERM", () => cleanup().then(() => process.exit()));
    await new Promise(() => {});
  }
}
main().catch(error => {
  console.error("隔离验收失败：", error.message);
  process.exitCode = 1;
}).finally(cleanup);
