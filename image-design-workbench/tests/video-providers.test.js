"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { capabilities, validateVideo, buildRequest } = require("../lib/video-providers");
const client = require("../lib/video-provider-client");

const text = { mode: "text", prompt: "商品展示", ratio: "16:9", quality: "720p", duration: "10s" };
const wan = { protocol: "wan26", model: "wan2.6-t2v", apiBase: "https://wan.example/api/v1", apiKey: "test-key" };
const h3 = { protocol: "minimax_h3", model: "MiniMax-H3", apiBase: "https://minimax.example", apiKey: "test-key" };
const grsai = { protocol: "grsai_veo", model: "veo3.1-fast", apiBase: "https://grsai.example", apiKey: "test-key" };

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
