"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { capabilities, validateVideo, buildRequest } = require("../lib/video-providers");
const client = require("../lib/video-provider-client");

const text = { mode: "text", prompt: "商品展示", ratio: "16:9", quality: "720p", duration: "10s" };
const wan = { protocol: "wan26", model: "wan2.6-t2v", apiBase: "https://wan.example/api/v1", apiKey: "test-key" };
const h3 = { protocol: "minimax_h3", model: "MiniMax-H3", apiBase: "https://minimax.example", apiKey: "test-key" };
const grsai = { protocol: "grsai_veo", model: "veo3.1-fast", apiBase: "https://grsai.example", apiKey: "test-key" };
const compat = { protocol: "openai_video", model: "custom-video-model", apiBase: "https://gateway.example/v1", apiKey: "test-key" };

test("通用视频接口使用自定义模型、标准尺寸和参考图参数", () => {
  const input = { ...text, mode: "image", duration: "8s", sourceImageIds: ["source"] };
  assert.deepEqual(buildRequest(compat, input, ["data:image/png;base64,AA=="]), { model: "custom-video-model", prompt: input.prompt, seconds: "8", size: "1280x720", input_reference: { image_url: "data:image/png;base64,AA==" } });
  assert.equal(buildRequest(compat, { ...text, duration: "4s", ratio: "9:16" }).size, "720x1280");
  assert.throws(() => validateVideo(compat, { ...input, duration: "15s" }), /不支持该视频时长/);
  assert.throws(() => validateVideo(compat, { ...input, sourceImageIds: ["a", "b"] }), /1 至 1/);
  assert.throws(() => buildRequest(compat, input, []), /参考图/);
});

test("通用视频接口提交、查询和认证下载地址符合兼容格式", async () => {
  const original = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url, options });
    if (options.method === "POST") return Response.json({ id: "video_123", status: "queued", error: null });
    if (seen.length === 2) return Response.json({ id: "video_123", status: "in_progress", error: null });
    if (seen.length === 3) return Response.json({ id: "video_123", status: "completed", size: "1280x720", seconds: "8", error: null });
    if (seen.length === 4) return Response.json({ id: "video_123", status: "completed", video_url: "https://cdn.example/video.mp4" });
    return Response.json({ id: "video_123", status: "failed", error: { message: "failed" } });
  };
  try {
    const submitted = await client.submitVideo(compat, { ...text, duration: "8s" }, []);
    assert.equal(submitted.videoId, "video_123");
    assert.equal(seen[0].url, "https://gateway.example/v1/videos");
    assert.equal(seen[0].options.headers.Authorization, "Bearer test-key");
    assert.equal((await client.fetchVideoStatus(compat, submitted.videoId)).status, "running");
    const done = await client.fetchVideoStatus(compat, submitted.videoId);
    assert.equal(done.url, "https://gateway.example/v1/videos/video_123/content");
    assert.equal(done.authenticated, true);
    const external = await client.fetchVideoStatus(compat, submitted.videoId);
    assert.equal(external.url, "https://cdn.example/video.mp4");
    assert.equal(external.authenticated, false);
    assert.equal((await client.fetchVideoStatus(compat, submitted.videoId)).status, "failed");
  } finally { global.fetch = original; }
});

test("视频服务 400 错误说明可识别原因且不泄露上游响应或密钥", async () => {
  const original = global.fetch;
  const input = { ...text, duration: "12s" };
  try {
    global.fetch = async () => Response.json({ error: { message: "invalid model name secret-api-key" } }, { status: 400 });
    await assert.rejects(client.submitVideo(compat, input, []), error => {
      assert.match(error.message, /模型不可用/);
      assert.doesNotMatch(error.message, /secret-api-key/);
      assert.equal(error.uncertain, false);
      return true;
    });
    global.fetch = async () => Response.json({ error: { message: "unsupported duration for model" } }, { status: 400 });
    await assert.rejects(client.submitVideo(compat, input, []), /时长不被当前服务支持/);
    global.fetch = async () => new Response("bad request", { status: 400 });
    await assert.rejects(client.submitVideo(compat, input, []), error => {
      assert.match(error.message, /检查模型、时长、比例和接口协议/);
      assert.equal(error.uncertain, false);
      return true;
    });
    global.fetch = async () => new Response("gateway failure", { status: 502 });
    await assert.rejects(client.submitVideo(compat, input, []), error => error.uncertain === true);
  } finally { global.fetch = original; }
});

test("OpenAI 兼容表单模式发送文件而不是 JSON，查询与下载沿用兼容接口", async () => {
  const original = global.fetch;
  const config = { ...compat, protocol: "openai_video_form" };
  const input = { ...text, mode: "image", duration: "8s", sourceImageIds: ["source"] };
  try {
    global.fetch = async (url, options) => {
      if (options.method === "POST") {
        assert.equal(url, "https://gateway.example/v1/videos");
        assert.equal(options.headers["Content-Type"], undefined);
        assert.ok(options.body instanceof FormData);
        assert.equal(options.body.get("model"), config.model);
        assert.equal(options.body.get("seconds"), "8");
        assert.equal(options.body.get("size"), "1280x720");
        const file = options.body.get("input_reference");
        assert.equal(file.type, "image/png");
        assert.equal(Buffer.from(await file.arrayBuffer()).toString("hex"), "0001");
        return Response.json({ id: "video_form_123" });
      }
      return Response.json({ status: "completed" });
    };
    const { videoId } = await client.submitVideo(config, input, ["data:image/png;base64,AAE="]);
    const done = await client.fetchVideoStatus(config, videoId);
    assert.equal(done.authenticated, true);
    assert.equal(done.url, "https://gateway.example/v1/videos/video_form_123/content");
    await assert.rejects(client.submitVideo(config, input, ["data:image/svg+xml;base64,AAE="]), /格式不受支持/);
  } finally { global.fetch = original; }
});

test("万相文生和首帧图生按模型校验并构建官方协议", () => {
  assert.deepEqual(buildRequest(wan, text), { model: "wan2.6-t2v", input: { prompt: "商品展示" }, parameters: { duration: 10, prompt_extend: false, watermark: false, size: "1280*720" } });
  assert.throws(() => validateVideo(wan, { ...text, mode: "image", sourceImageIds: ["a"] }), /不支持图生/);
  const image = { ...text, mode: "image", sourceImageIds: ["a"], quality: "1080p", duration: "15s" };
  const request = buildRequest({ ...wan, model: "wan2.6-i2v" }, image, ["data:image/png;base64,AA"]);
  assert.equal(request.input.img_url, "data:image/png;base64,AA");
  assert.equal(request.parameters.resolution, "1080P");
  assert.equal(request.parameters.duration, 15);
  assert.throws(() => validateVideo({ ...wan, model: "wan2.6-i2v" }, { ...image, sourceImageIds: ["a", "b"] }), /1 至 1/);
  assert.throws(() => validateVideo(wan, { ...text, duration: "16s" }), /不支持该视频时长/);
  assert.throws(() => capabilities("wan26", "wan3"), /目前支持/);
});

test("MiniMax H3 按首尾帧和不同模型规格构建请求", () => {
  const image = { ...text, mode: "image", quality: "2k", duration: "15s", sourceImageIds: ["a", "b"] };
  const request = buildRequest(h3, image, ["first", "last"]);
  assert.deepEqual(request.content, [{ type: "text", text: "商品展示" }, { type: "image_url", image_url: { url: "first" }, role: "first_frame" }, { type: "image_url", image_url: { url: "last" }, role: "last_frame" }]);
  assert.equal(request.ratio, undefined);
  assert.equal(request.resolution, "2K");
  assert.equal(buildRequest(h3, { ...text, quality: "768p", duration: "4s" }).ratio, "16:9");
  assert.throws(() => validateVideo({ ...h3, model: "MiniMax-H3-Lite" }, image), /不支持该清晰度/);
  assert.throws(() => validateVideo({ ...h3, model: "MiniMax-H3-Max" }, { ...text, quality: "768p", duration: "4s" }), /不支持该视频时长/);
  assert.throws(() => validateVideo(h3, { ...text, quality: "768p", negativePrompt: "文字" }), /负向提示词/);
});

test("万相 3.0 支持最长 30 秒及首尾帧，并使用新的 media 参数", () => {
  const config = { ...wan, protocol: "wan3", model: "wan3.0-video" };
  const input = { ...text, duration: "30s", quality: "1080p", mode: "image", sourceImageIds: ["a", "b"] };
  const request = buildRequest(config, input, ["first", "last"]);
  assert.equal(request.parameters.duration, 30);
  assert.equal(request.parameters.resolution, "1080P");
  assert.equal(request.parameters.ratio, "adaptive");
  assert.deepEqual(request.input.media, [{ type: "first_frame", url: "first" }, { type: "last_frame", url: "last" }]);
  assert.throws(() => validateVideo(config, { ...input, duration: "31s" }), /不支持该视频时长/);
});

test("Grsai Veo 首尾帧采用公网地址，不伪造时长和清晰度请求参数", () => {
  const input = { ...text, mode: "image", duration: "8s", quality: "auto", sourceImageUrls: ["https://example.com/first.png", "https://example.com/last.png"] };
  assert.equal(validateVideo(grsai, input).caps.billingUnit, "task");
  assert.deepEqual(buildRequest(grsai, input, input.sourceImageUrls), { model: "veo3.1-fast", prompt: input.prompt, aspectRatio: "16:9", webHook: "-1", firstFrameUrl: input.sourceImageUrls[0], lastFrameUrl: input.sourceImageUrls[1] });
  assert.throws(() => validateVideo(grsai, { ...input, sourceImageUrls: ["http://127.0.0.1/secret"] }), /公开访问/);
  assert.throws(() => validateVideo(grsai, { ...input, ratio: "1:1" }), /画面比例/);
  assert.throws(() => capabilities("grsai_veo", "unrelated"), /支持 veo3/);
});

test("Grsai Veo 以 POST 查询任务并处理成功和失败状态", async () => {
  const original = global.fetch;
  let count = 0;
  global.fetch = async (url, options) => {
    count++;
    if (url.endsWith("/v1/video/veo")) {
      assert.equal(JSON.parse(options.body).webHook, "-1");
      return Response.json({ code: 0, msg: "success", data: { id: "task-123" } });
    }
    assert.ok(url.endsWith("/v1/draw/result"));
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { id: "task-123" });
    if (count === 2) return Response.json({ code: 0, data: { status: "succeeded", url: "https://example.com/video.mp4" } });
    if (count === 3) return Response.json({ code: 0, data: { status: "failed" } });
    return Response.json({ code: -22, msg: "任务不存在" });
  };
  try {
    const input = { ...text, duration: "8s", quality: "auto" };
    const { videoId } = await client.submitVideo(grsai, input, []);
    assert.equal(videoId, "task-123");
    assert.equal((await client.fetchVideoStatus(grsai, videoId)).url, "https://example.com/video.mp4");
    assert.equal((await client.fetchVideoStatus(grsai, videoId)).status, "failed");
    await assert.rejects(client.fetchVideoStatus(grsai, videoId), /任务不存在/);
  } finally { global.fetch = original; }
});

test("官方视频协议提交后按各自接口轮询，成功和失败状态不混淆", async () => {
  const original = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/video-synthesis")) return Response.json({ output: { task_id: "wan-task" } });
    if (url.endsWith("/tasks/wan-task")) return Response.json({ output: { task_status: "SUCCEEDED", video_url: "https://example.com/wan.mp4" } });
    if (url.endsWith("/v2/video_generation")) return Response.json({ task_id: "h3-task" });
    if (url.endsWith("/v2/query/video_generation/h3-task")) return Response.json({ task: { status: "succeeded", content: { url: "https://example.com/h3.mp4" } } });
    throw new Error("unexpected request");
  };
  try {
    const wt = await client.submitVideo(wan, text, []);
    assert.equal(wt.videoId, "wan-task");
    assert.equal(requests[0].options.headers["X-DashScope-Async"], "enable");
    assert.equal((await client.fetchVideoStatus(wan, wt.videoId)).url, "https://example.com/wan.mp4");
    const ht = await client.submitVideo(h3, { ...text, quality: "768p" }, []);
    assert.equal(ht.videoId, "h3-task");
    assert.equal((await client.fetchVideoStatus(h3, ht.videoId)).url, "https://example.com/h3.mp4");
    await assert.rejects(client.fetchVideoStatus(h3, "../../bad"), /编号无效/);
  } finally { global.fetch = original; }
});
