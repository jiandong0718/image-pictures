"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  dayOf,
  dayStart,
  rangeOf,
  taskOutputs,
  taskState,
  moduleFromRequest,
  activityRequest,
  createServiceCenter
} = require("../lib/service-center");
test("北京时间零点正确切日，日期范围拒绝不存在日期及超长查询", () => {
  assert.equal(dayOf(Date.parse("2026-10-29T15:59:59Z")), "2026-10-29");
  assert.equal(dayOf(Date.parse("2026-10-29T16:00:00Z")), "2026-10-30");
  assert.equal(dayStart("2026-10-30"), Date.parse("2026-10-29T16:00:00Z"));
  assert.throws(() => dayStart("2026-02-30"), /不存在/);
  assert.throws(() => rangeOf({
    start: "2025-01-01",
    end: "2026-10-30"
  }, Date.parse("2026-10-30")), /366/);
  assert.throws(() => rangeOf({
    start: "2026-10-30",
    end: "2026-10-29"
  }), /先后/);
  assert.throws(() => rangeOf({
    end: "2026-11-01"
  }, Date.parse("2026-10-30")), /晚于/);
});
test("批次结果和进度中的同一张图只算一次，失败仍保留已知产出", () => {
  const task = {
    kind: "image",
    status: "error",
    result: {
      images: [{
        url: "/api/images/file/001%2Fa.png"
      }]
    },
    partial: {
      images: [{
        id: "001/a.png"
      }, {
        id: "001/b.png"
      }]
    }
  };
  assert.deepEqual(taskOutputs(task).map(r => r.id), ["001/a.png", "001/b.png"]);
  assert.equal(taskState(task, 2), "error");
  assert.equal(taskState({
    status: "done",
    result: {
      errors: {
        detail: "失败"
      }
    }
  }, 1), "partial");
  assert.equal(taskState({
    status: "done"
  }, 0), "error");
  assert.equal(taskOutputs({
    kind: "image",
    result: {
      results: {
        main: {
          id: "a"
        },
        scene: {
          id: "b"
        }
      }
    }
  }).length, 2);
});
test("提示词提取按成功次数统计，不作为图片产出", () => {
  const task = { kind: "prompt", status: "done", result: {} };
  assert.deepEqual(taskOutputs(task), []);
  assert.equal(taskState(task, 0), "done");
});
test("代理输出可幂等计数，视频和语音不会混入图片；外部签名链接不落库", () => {
  assert.equal(taskOutputs({
    id: "sync",
    kind: "proxy-image",
    result: {
      generatedCount: 4
    }
  }).length, 4);
  assert.deepEqual(taskOutputs({
    kind: "audio",
    result: {
      audio: {
        id: 12
      }
    }
  }), [{
    id: "asset:12",
    kind: "audio",
    at: 0
  }]);
  assert.equal(taskOutputs({
    kind: "video",
    result: {
      video: {
        id: "a.mp4"
      }
    }
  })[0].kind, "video");
  const external = taskOutputs({
    kind: "image",
    result: {
      images: [{
        url: "https://example.test/a.png?secret=sensitive"
      }]
    }
  })[0];
  assert.match(external.id, /^external:[a-f0-9]{64}$/);
});
test("生图入口归类有白名单，无来源保留未知分类；轮询和文件请求不产生活跃", () => {
  const request = pathname => ({
    headers: {
      referer: "http://127.0.0.1:4174" + pathname
    }
  });
  assert.equal(moduleFromRequest(request("/playground"), "image", {
    mode: "edit"
  }), "image-image");
  assert.equal(moduleFromRequest(request("/retouch")), "retouch");
  assert.equal(moduleFromRequest(request("/studio/print")), "studio-print");
  for (const [route, expected] of [["/workbench", "workbench"], ["/studio/hat", "studio-hat"], ["/studio/bag", "studio-bag"], ["/studio/3d", "studio-3d"]]) assert.equal(moduleFromRequest(request(route)), expected);
  assert.equal(moduleFromRequest(request("/playground"), "image", { mode: "generate" }), "text-image");
  assert.equal(moduleFromRequest(request("/full-playground"), "proxy-image"), "full-playground");
  assert.equal(moduleFromRequest(request("/video"), "video", { mode: "image" }), "video-image");
  assert.equal(moduleFromRequest(request("/video"), "video", { mode: "text" }), "video-text");
  assert.equal(moduleFromRequest({
    headers: {}
  }), "legacy-image");
  for (const url of ["/api/tasks/id", "/api/audio/tasks/id", "/api/images/file/id", "/shared/layout.js"]) assert.equal(activityRequest({
    method: "GET",
    url
  }), false);
  assert.equal(activityRequest({
    method: "GET",
    url: "/api/auth/me"
  }), true);
  assert.equal(activityRequest({
    method: "GET",
    url: "/workbench"
  }), true);
  assert.equal(activityRequest({
    method: "GET",
    url: "/api/gallery?page=2"
  }), true);
});
test("已保存但尚待结算的语音按产出时间记录，不用之后的结算时间替代", () => {
  const at = Date.parse("2026-10-29T15:59:59Z");
  const outputs = taskOutputs({
    kind: "audio",
    status: "interrupted",
    metadata: {
      result: {
        audio: {
          id: 8
        }
      },
      outputCompletedAt: at
    }
  });
  assert.equal(outputs[0].at, at);
  assert.equal(dayOf(outputs[0].at), "2026-10-29");
  assert.equal(taskOutputs({ kind: "video", status: "error", result: { images: [] }, metadata: { result: { video: { id: "saved.mp4" } } } }).length, 1);
});
test("保持登录的活跃按日去重，跨日立即写入；写入失败可重试", async () => {
  let ms = Date.parse("2026-10-29T15:59:59Z");
  const writes = [];
  let fail = false;
  const pool = {
    async query(sql, params) {
      if (sql.startsWith("SELECT v")) return [[{
        v: String(ms)
      }]];
      if (sql.startsWith("INSERT INTO service_user_activity")) {
        if (fail) throw new Error("offline");
        writes.push(params);
      }
      return [[]];
    }
  };
  const center = createServiceCenter({
    getPool: () => pool,
    now: () => ms,
    logger: {
      error() {}
    }
  });
  await center.recordActivity(7);
  await center.recordActivity(7);
  assert.equal(writes.length, 1);
  ms += 1000;
  await center.recordActivity(7);
  assert.deepEqual(writes.map(p => p[1]), ["2026-10-29", "2026-10-30"]);
  ms += 61000;
  fail = true;
  await center.recordActivity(7);
  fail = false;
  await center.recordActivity(7);
  assert.equal(writes.length, 3);
});
