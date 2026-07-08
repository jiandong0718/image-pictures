"use strict";

// Agnes AI 生视频客户端：提交任务 -> 轮询状态 -> 拿 mp4 链接。零第三方依赖，用 Node 全局 fetch。
// 接口是异步的：POST /v1/videos 提交（拿 video_id），GET /agnesapi?video_id= 轮询。
// 纯 HTTP 逻辑与状态解析放这里，落盘/扣费/存库由 server.js 负责。

// 提交生视频任务。传 image（data URL 或 base64）即变「图生视频」。返回 videoId。
async function submitVideo({
  apiBase,
  apiKey,
  model,
  prompt,
  image = "",
  width,
  height,
  numFrames,
  frameRate,
  negativePrompt = "",
  seed,
  steps,
}) {
  const body = { model, prompt, width, height, num_frames: numFrames, frame_rate: frameRate };
  if (image) {
    body.image = image; // 传图 => 图生视频
  }
  if (negativePrompt) {
    body.negative_prompt = negativePrompt;
  }
  if (Number.isFinite(seed)) {
    body.seed = seed;
  }
  if (Number.isFinite(steps)) {
    body.num_inference_steps = steps;
  }

  const res = await fetch(`${apiBase}/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = parseJson(text);
  if (!res.ok) {
    throw new Error(pickError(data) || `提交生视频任务失败（HTTP ${res.status}）`);
  }
  const videoId = data.video_id || data.id || data.data?.video_id || data.task_id || "";
  if (!videoId) {
    throw new Error("生视频接口未返回 video_id");
  }
  return { videoId };
}

// 轮询一次状态。轮询端点在 /agnesapi（不在 /v1 下），所以取 origin 拼。
async function fetchVideoStatus({ apiBase, apiKey, videoId }) {
  const url = `${new URL(apiBase).origin}/agnesapi?video_id=${encodeURIComponent(videoId)}`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (netErr) {
    netErr.retryable = true; // 网络抖动：可重试
    throw netErr;
  }
  const text = await res.text();
  const data = parseJson(text);
  if (!res.ok) {
    const err = new Error(pickError(data) || `查询生视频状态失败（HTTP ${res.status}）`);
    // 429 限频、5xx 网关抖动都是临时的：标记为可重试，让轮询退避后再查，别把整个任务判失败。
    err.retryable = res.status === 429 || res.status >= 500;
    err.status = res.status;
    throw err;
  }
  return {
    status: data.status || "",
    url: data.url || data.video_url || data.data?.url || "",
    progress: Number(data.progress) || 0,
    seconds: data.seconds != null ? String(data.seconds) : "",
    size: data.size || "",
    error: data.error || "",
  };
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { _raw: text };
  }
}

function pickError(data) {
  if (!data || typeof data !== "object") {
    return "";
  }
  if (typeof data.error === "string") {
    return data.error;
  }
  return data.error?.message || data.message || data._raw || "";
}

module.exports = { submitVideo, fetchVideoStatus };
