"use strict";

// Agnes AI 生视频客户端：提交任务 -> 轮询状态 -> 拿 mp4 链接。零第三方依赖，用 Node 全局 fetch。
// 接口是异步的：POST /v1/videos 提交（拿 video_id），GET /agnesapi?video_id= 轮询。
// 纯 HTTP 逻辑与状态解析放这里，落盘/扣费/存库由 server.js 负责。

// 组装提交体（纯函数，便于测试）。images 为 data URL / base64 数组：
//   0 张 => 纯文生视频；1 张 => 普通图生视频（顶层 image）；
//   2–5 张 => 关键帧动画（extra_body.mode=keyframes + extra_body.image 数组，与 Agnes 文档一致）。
// ponytail: 关键帧同样传 data URL（与单图一致）；若 Agnes 关键帧只认公网 http URL 再改。
function buildSubmitBody({ model, prompt, images = [], width, height, numFrames, frameRate, negativePrompt = "", seed, steps }) {
  const body = { model, prompt, width, height, num_frames: numFrames, frame_rate: frameRate };
  const imgs = (Array.isArray(images) ? images : [images]).filter(Boolean);
  if (imgs.length === 1) {
    body.image = imgs[0];
  } else if (imgs.length >= 2) {
    body.extra_body = { mode: "keyframes", image: imgs };
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
  return body;
}

// 提交生视频任务。images 见 buildSubmitBody。返回 videoId。
async function submitVideo({ apiBase, apiKey, ...rest }) {
  const body = buildSubmitBody(rest);

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
  return parseVideoStatus(data);
}

function parseVideoStatus(data = {}) {
  const rawStatus = String(
    data.status || data.state || data.task_status || data.data?.status || data.data?.state || "",
  ).toLowerCase();
  const url =
    data.url ||
    data.video_url ||
    data.output_url ||
    data.data?.url ||
    data.data?.video_url ||
    data.data?.output_url ||
    data.output?.url ||
    data.output?.video_url ||
    "";
  const status = normalizeStatus(rawStatus, url);
  return {
    status,
    rawStatus,
    url,
    progress: Number(data.progress ?? data.data?.progress) || 0,
    seconds: data.seconds != null ? String(data.seconds) : data.data?.seconds != null ? String(data.data.seconds) : "",
    size: data.size || data.data?.size || "",
    error: pickError(data),
  };
}

function normalizeStatus(status, url) {
  if (["completed", "complete", "succeeded", "success", "done", "finished"].includes(status)) {
    return "completed";
  }
  if (["failed", "fail", "error", "errored", "canceled", "cancelled"].includes(status)) {
    return "failed";
  }
  if (["queued", "pending", "processing", "running", "generating", "in_progress", "created"].includes(status)) {
    return "running";
  }
  return url ? "completed" : status;
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

module.exports = { submitVideo, fetchVideoStatus, buildSubmitBody, parseVideoStatus };
