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
      CUSTOM_VIDEO_API_KEY: ""
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
  assert.equal(dashboard.data.today.image, 6); // 跨日1 + 部分成功1 + 失败产出1 + 同步代理3。
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
  assert.equal(include.today.image, 7);
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
  assert.equal(users.items[0].image, 7, "两天合计包含零点前图片");
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
  })).data.today.image, 6, "删除作品不抹掉统计");

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
  upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url === "/v1/audio/speech") {
      res.writeHead(200, {
        "Content-Type": "audio/wav"
      });
      res.end(wav);
      return;
    }
    const input = JSON.parse(Buffer.concat(chunks).toString());
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
  async function waitTask(id, audio = false) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const {
        data
      } = await request((audio ? "/api/audio/tasks/" : "/api/tasks/") + id, {
        cookie: userCookie
      });
      if (data.status === "done") return data;
      if (data.status === "error") throw new Error("本机模拟生成失败：" + data.error);
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
  assert.equal(afterLive.today.image, 9, "图片任务新增2张，同步代理新增1张");
  assert.equal(afterLive.today.audio, 2, "语音真实任务的统计钩子新增1条");
  assert.equal(afterLive.today.credits, 16, "业务消费仍由原结算逻辑记录");
  assert.equal(afterLive.services.find(s => s.id === "text-image").succeeded, 1);
  await center.backfill();
  assert.equal((await request("/api/service-center/dashboard?" + range, {
    cookie: adminCookie
  })).data.today.image, 9, "任务回填不能重复统计实时记录");
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
    checks: ["真实MySQL聚合", "北京时间跨日", "批量与部分成功", "历史回填去重", "上传排除", "管理员筛选", "每日活跃去重", "分页", "权限", "不返回生成输入", "删除作品后保留统计", "实际生图任务钩子", "同步代理钩子", "实际语音任务钩子", "原结算逻辑", "重启状态同步", "确认终态保留"],
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
