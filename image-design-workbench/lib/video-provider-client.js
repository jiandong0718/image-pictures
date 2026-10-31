"use strict";

const { buildRequest } = require("./video-providers");

function apiRoot(apiBase) { return String(apiBase).replace(/\/+$/, ""); }
function pickError(data) { return (typeof data?.error === "string" ? data.error : data?.error?.message) || data?.message || data?.msg || data?.detail || data?.base_resp?.status_msg || data?.code || "上游视频服务请求失败"; }
// 上游错误可能包含提示词、地址或密钥；只映射可识别的原因，不透传响应正文。
function describeHttpError(status, data) {
  const raw = String(pickError(data)).toLowerCase();
  if (status === 401 || /invalid.?api.?key|unauthorized|authentication|鉴权|密钥无效/.test(raw)) return "视频服务鉴权失败，请检查 API Key";
  if (/insufficient|quota|balance|credit|余额不足|额度不足|积分不足/.test(raw)) return "视频服务额度不足，请检查服务商账户余额";
  if (/no.{0,20}(available|usable).{0,20}channel|channel.{0,30}(unavailable|not available|not found|disabled)|无可用渠道|渠道.{0,20}(不存在|不可用|禁用)|当前分组.{0,20}(无|不可用|不支持)/.test(raw)) return "服务商没有可用的视频模型渠道，请检查分组或联系服务商";
  if (/model.{0,40}(not found|not exist|unavailable|unsupported|invalid)|invalid.{0,20}model|模型.{0,20}(不存在|不支持|不可用)/.test(raw)) return "视频模型不可用，请检查模型名称和服务商权限";
  if (/duration|seconds|时长/.test(raw)) return "视频时长不被当前服务支持，请调整时长";
  if (/resolution|aspect.?ratio|image.?size|invalid.{0,20}size|分辨率|画面比例|图片尺寸/.test(raw)) return "视频尺寸或画面比例不被当前服务支持，请调整参数";
  if (/input_reference|first.?frame|image.?url|reference.?image|参考图|首帧/.test(raw)) return "视频服务无法接受参考图，请检查图片和接口要求";
  if (/content.?policy|moderation|safety|内容审核|安全审核/.test(raw)) return "视频内容未通过服务商审核，请调整提示词或参考图";
  if (/content.?type|multipart|request.?format|请求格式/.test(raw)) return "视频请求格式与服务商接口不匹配，请检查协议配置";
  if (status === 403) return "视频服务拒绝访问，请检查模型权限和账户状态";
  if (status === 404) return "视频接口地址不存在，请检查 API 地址和协议";
  if (status === 429) return "视频服务请求过于频繁，请稍后查询或重试";
  if (status === 400 || status === 422) return "视频服务拒绝请求，请检查模型、时长、比例和接口协议";
  return `视频服务请求失败（HTTP ${status}）`;
}
async function requestJson(url, options, queryOnly = false, allowJobError = false) {
  let response;
  try { response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(30000) }); }
  catch (error) { const failure = new Error("视频服务连接失败或请求超时"); failure.retryable = options.method === "GET" || queryOnly; failure.uncertain = options.method === "POST" && !queryOnly; throw failure; }
  let data;
  try { data = await response.json(); } catch { throw Object.assign(new Error(response.ok ? "视频服务返回无法识别的结果，请确认任务状态" : describeHttpError(response.status, {})), { uncertain: options.method === "POST" && !queryOnly && (response.ok || response.status >= 500) }); }
  if (!response.ok || (!allowJobError && data?.error) || data?.code) {
    const error = new Error(response.ok ? pickError(data) : describeHttpError(response.status, data));
    error.retryable = (options.method === "GET" || queryOnly) && (response.status === 429 || response.status >= 500);
    error.uncertain = options.method === "POST" && !queryOnly && response.status >= 500;
    throw error;
  }
  return data;
}
async function submitVideo(config, input, images) {
  const root = apiRoot(config.apiBase);
  const isWan = ["wan26", "wan3"].includes(config.protocol);
  const compatible = ["openai_video", "openai_video_form"].includes(config.protocol);
  const url = compatible ? `${root}/videos` : config.protocol === "grsai_veo" ? `${root}/v1/video/veo` : isWan ? `${root}/services/aigc/video-generation/video-synthesis` : `${root}/v2/video_generation`;
  const body = buildRequest(config, input, images);
  let requestBody = JSON.stringify(body);
  const headers = { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", ...(isWan ? { "X-DashScope-Async": "enable" } : {}) };
  if (config.protocol === "openai_video_form") {
    requestBody = new FormData();
    for (const key of ["model", "prompt", "seconds", "size"]) requestBody.append(key, body[key]);
    if (body.input_reference) {
      const match = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i.exec(body.input_reference.image_url);
      if (!match) throw new Error("参考图格式不受支持，请使用 PNG、JPG 或 WEBP 图片");
      const type = match[1].toLowerCase();
      requestBody.append("input_reference", new Blob([Buffer.from(match[2], "base64")], { type: `image/${type}` }), `reference.${type === "jpeg" ? "jpg" : type}`);
    }
    delete headers["Content-Type"];
  }
  const data = await requestJson(url, { method: "POST", headers, body: requestBody });
  const videoId = compatible ? data.id : config.protocol === "grsai_veo" ? data.data?.id : isWan ? data.output?.task_id : data.task_id;
  if (!videoId || !/^[a-zA-Z0-9_-]{1,128}$/.test(String(videoId))) throw Object.assign(new Error("视频服务未返回有效任务编号"), { uncertain: true });
  return { videoId: String(videoId) };
}
async function fetchVideoStatus(config, videoId) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(String(videoId))) throw new Error("视频任务编号无效");
  const root = apiRoot(config.apiBase);
  const isWan = ["wan26", "wan3"].includes(config.protocol);
  if (["openai_video", "openai_video_form"].includes(config.protocol)) {
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
