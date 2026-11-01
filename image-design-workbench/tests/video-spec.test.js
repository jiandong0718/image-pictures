"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeVideoSize,
  getVideoFrames,
  VIDEO_DURATIONS,
  videoCost,
  videoDurationSeconds,
  friendlyGenerationError,
} = require("../server");

test("friendlyGenerationError 屏蔽 traceback/技术细节，保留业务短提示", () => {
  const traceback = `Traceback (most recent call last):
  File "/opt/.../image_generator.py", line 269, in post_json
    with request.urlopen(req, timeout=timeout) as response:
TimeoutError: The read operation timed out`;
  assert.equal(friendlyGenerationError(traceback), "生成失败，请稍后重试");
  assert.equal(friendlyGenerationError("TimeoutError: The read operation timed out"), "生成失败，请稍后重试");
  assert.equal(friendlyGenerationError(""), "生成失败，请稍后重试");
  assert.equal(friendlyGenerationError(undefined), "生成失败，请稍后重试");
  // 业务类短提示原样保留，用户能据此纠正
  assert.equal(friendlyGenerationError("积分不足，请充值"), "积分不足，请充值");
  assert.equal(friendlyGenerationError("请先在配置中心添加生图 API 端点"), "请先在配置中心添加生图 API 端点");
  const poolUnavailable = "[ERROR] 所有端点都失败了：\n- https://example.test/v1/images/generations [503]: 无可用账号，请稍后重试";
  assert.equal(friendlyGenerationError(poolUnavailable), "生图服务暂无可用账号，请稍后重试或切换其他可用节点");
  assert.equal(friendlyGenerationError(poolUnavailable + "\n- https://other.test/v1/images/generations [401]: invalid API key"), "生成失败，请稍后重试");
  assert.equal(friendlyGenerationError("[ERROR] 所有端点都失败了：\n- https://example.test [503]: service unavailable"), "生成失败，请稍后重试");
});

test("computeVideoSize 长边取该档基准，短边按比例，且宽高均为 8 的倍数", () => {
  const l720 = computeVideoSize("16:9", "720p");
  assert.equal(l720.width, 1280);
  assert.equal(l720.height, 720);

  const p720 = computeVideoSize("9:16", "720p");
  assert.equal(p720.width, 720);
  assert.equal(p720.height, 1280);

  const sq = computeVideoSize("1:1", "480p");
  assert.equal(sq.width, sq.height);

  for (const ratio of ["16:9", "9:16", "1:1", "4:3", "3:4"]) {
    for (const q of ["480p", "720p", "1080p"]) {
      const { width, height } = computeVideoSize(ratio, q);
      assert.equal(width % 8, 0, `${ratio}/${q} 宽非 8 倍数`);
      assert.equal(height % 8, 0, `${ratio}/${q} 高非 8 倍数`);
    }
  }
});

test("未知比例/清晰度回退默认，不抛错", () => {
  const fallback = computeVideoSize("bogus", "bogus");
  assert.equal(fallback.width, 1280);
  assert.equal(fallback.height, 720);
});

test("当前时长档的帧数满足 8n+1 规则", () => {
  for (const [label, frames] of Object.entries(VIDEO_DURATIONS)) {
    assert.equal((frames - 1) % 8, 0, `${label}=${frames} 不满足 8n+1`);
  }
  assert.equal(VIDEO_DURATIONS["15s"], 361); // 15s 支持
  assert.equal(VIDEO_DURATIONS["30s"], undefined); // 当前应用未提供 30 秒
});

test("视频帧数遵守各清晰度的上游限制", () => {
  assert.equal(getVideoFrames("15s", "720p"), 361);
  assert.equal(getVideoFrames("10s", "1080p"), 241);
  assert.throws(() => getVideoFrames("15s", "1080p"), /1080p 最长支持 10 秒/);
  assert.throws(() => getVideoFrames("unknown", "1080p"), /当前支持/);
});

test("按时长计费：1 秒 1 积分，未知时长明确拒绝", () => {
  assert.equal(videoDurationSeconds("3s"), 3);
  assert.equal(videoDurationSeconds("15s"), 15);
  assert.throws(() => videoDurationSeconds("99s"), /当前支持/);
  assert.equal(videoDurationSeconds(undefined), 5);
  assert.equal(videoCost("3s"), 3);
  assert.equal(videoCost("10s"), 10);
  assert.equal(videoCost("15s"), 15);
});

test("buildSubmitBody：0 张纯文生、1 张普通图生、2–5 张走关键帧", () => {
  const { buildSubmitBody } = require("../lib/video-client");
  const base = { model: "agnes-video-v2.0", prompt: "x", width: 1280, height: 720, numFrames: 121, frameRate: 24 };

  const text = buildSubmitBody({ ...base, images: [] });
  assert.equal(text.image, undefined);
  assert.equal(text.extra_body, undefined);

  const single = buildSubmitBody({ ...base, images: ["data:image/png;base64,AAA"] });
  assert.equal(single.image, "data:image/png;base64,AAA");
  assert.equal(single.extra_body, undefined);

  const keyframes = buildSubmitBody({ ...base, images: ["a", "b", "c"] });
  assert.equal(keyframes.image, undefined);
  assert.deepEqual(keyframes.extra_body, { mode: "keyframes", image: ["a", "b", "c"] });

  // 空值被过滤
  assert.deepEqual(buildSubmitBody({ ...base, images: ["a", "", null, "b"] }).extra_body.image, ["a", "b"]);
});

test("parseVideoStatus 兼容常见上游状态名和嵌套视频地址", () => {
  const { parseVideoStatus } = require("../lib/video-client");

  assert.deepEqual(
    parseVideoStatus({ status: "succeeded", data: { video_url: "https://cdn.example/video.mp4", seconds: 5 } }),
    {
      status: "completed",
      rawStatus: "succeeded",
      url: "https://cdn.example/video.mp4",
      progress: 0,
      seconds: "5",
      size: "",
      error: "",
    },
  );
  assert.equal(parseVideoStatus({ state: "done", output: { url: "https://cdn.example/out.mp4" } }).status, "completed");
  assert.equal(parseVideoStatus({ task_status: "processing" }).status, "running");
  assert.equal(parseVideoStatus({ data: { url: "https://cdn.example/no-status.mp4" } }).status, "completed");
  assert.equal(parseVideoStatus({ status: "error", message: "quota exceeded" }).error, "quota exceeded");
});
