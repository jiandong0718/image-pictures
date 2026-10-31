"use strict";

const { buildRequest } = require("./video-providers");

function apiRoot(apiBase) { return String(apiBase).replace(/\/+$/, ""); }
function pickError(data) { return data?.error?.message || data?.message || data?.msg || data?.code || "上游视频服务请求失败"; }
async function requestJson(url, options, queryOnly = false, allowJobError = false) {
  let response;
  try { response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(30000) }); }
  catch (error) { const failure = new Error("视频服务连接失败或请求超时"); failure.retryable = options.method === "GET" || queryOnly; failure.uncertain = options.method === "POST" && !queryOnly; throw failure; }
  let data;
  try { data = await response.json(); } catch { throw Object.assign(new Error(`视频服务返回无效 JSON（HTTP ${response.status}）`), { uncertain: options.method === "POST" }); }
  if (!response.ok || (!allowJobError && data?.error) || data?.code) {
    const error = new Error(response.ok ? pickError(data) : `视频服务返回 HTTP ${response.status}`);
    error.retryable = (options.method === "GET" || queryOnly) && (response.status === 429 || response.status >= 500);
    error.uncertain = options.method === "POST" && !queryOnly && response.status >= 500;
    throw error;
  }
  return data;
}
async function submitVideo(config, input, images) {
  const root = apiRoot(config.apiBase);
  const isWan = ["wan26", "wan3"].includes(config.protocol);
  const url = config.protocol === "openai_video" ? `${root}/videos` : config.protocol === "grsai_veo" ? `${root}/v1/video/veo` : isWan ? `${root}/services/aigc/video-generation/video-synthesis` : `${root}/v2/video_generation`;
  const body = buildRequest(config, input, images);
  const data = await requestJson(url, { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", ...(isWan ? { "X-DashScope-Async": "enable" } : {}) }, body: JSON.stringify(body) });
  const videoId = config.protocol === "openai_video" ? data.id : config.protocol === "grsai_veo" ? data.data?.id : isWan ? data.output?.task_id : data.task_id;
  if (!videoId || !/^[a-zA-Z0-9_-]{1,128}$/.test(String(videoId))) throw Object.assign(new Error("视频服务未返回有效任务编号"), { uncertain: true });
  return { videoId: String(videoId) };
}
async function fetchVideoStatus(config, videoId) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(String(videoId))) throw new Error("视频任务编号无效");
  const root = apiRoot(config.apiBase);
  const isWan = ["wan26", "wan3"].includes(config.protocol);
  if (config.protocol === "openai_video") {
    const endpoint = `${root}/videos/${encodeURIComponent(videoId)}`;
    const info = await requestJson(endpoint, { method: "GET", headers: { Authorization: `Bearer ${config.apiKey}` } }, true, true);
    const status = String(info.status || "").toLowerCase();
    if (status === "completed") {
      const externalUrl = info.video_url || info.url || "";
      if (externalUrl && !/^https?:\/\//i.test(externalUrl)) throw new Error("视频已完成但下载地址无效");
      return { status: "completed", url: externalUrl || `${endpoint}/content`, authenticated: !externalUrl, seconds: String(info.seconds || ""), size: String(info.size || "") };
    }
    if (["failed", "cancelled", "canceled"].includes(status)) return { status: "failed", error: "上游视频任务失败或已取消" };
    if (["queued", "pending", "running", "processing", "in_progress"].includes(status)) return { status: "running" };
    throw new Error("上游返回未知视频任务状态，无法确认结果");
  }
  if (config.protocol === "grsai_veo") {
    const data = await requestJson(`${root}/v1/draw/result`, { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: videoId }) }, true);
    const info = data.data || {};
    if (info.status === "succeeded") {
      if (!/^https?:\/\//i.test(info.url || "")) throw new Error("视频已完成但没有有效下载地址");
      return { status: "completed", url: info.url, seconds: "", size: "" };
    }
    if (info.status === "failed") return { status: "failed", error: "上游视频任务失败" };
    if (["running", "pending", "queued"].includes(info.status)) return { status: "running" };
    throw new Error("上游返回未知视频任务状态，无法确认结果");
  }
  const url = isWan ? `${root}/tasks/${encodeURIComponent(videoId)}` : `${root}/v2/query/video_generation/${encodeURIComponent(videoId)}`;
  const data = await requestJson(url, { method: "GET", headers: { Authorization: `Bearer ${config.apiKey}` } });
  const info = isWan ? data.output || {} : data.task || {};
  const raw = String(isWan ? info.task_status || "" : info.status || "").toLowerCase();
  if (["succeeded", "success", "completed"].includes(raw)) {
    const videoUrl = isWan ? info.video_url : info.content?.url;
    if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) throw new Error("视频已完成但没有有效下载地址");
    return { status: "completed", url: videoUrl, seconds: "", size: "" };
  }
  if (["failed", "cancelled", "canceled"].includes(raw)) return { status: "failed", error: "上游视频任务失败或已取消" };
  if (["pending", "running", "preparing", "processing", "queued", "queueing", "created"].includes(raw)) return { status: "running" };
  throw new Error("上游返回未知视频任务状态，无法确认结果");
}
module.exports = { submitVideo, fetchVideoStatus };
