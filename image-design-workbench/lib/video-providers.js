"use strict";

// 按供应商及模型声明实际支持的参数，不把一个渠道的帧数协议套给另一渠道。
const H3_MODELS = new Set(["MiniMax-H3", "MiniMax-H3-Highspeed", "MiniMax-H3-Lite", "MiniMax-H3-Max"]);
const WAN_MODELS = new Set(["wan2.6-t2v", "wan2.6-i2v", "wan2.6-i2v-flash"]);
const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const WAN_SIZES = {
  "720p": { "16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960", "4:3": "1088*832", "3:4": "832*1088" },
  "1080p": { "16:9": "1920*1080", "9:16": "1080*1920", "1:1": "1440*1440", "4:3": "1632*1248", "3:4": "1248*1632" },
};
function capabilities(protocol = "agnes", model = "") {
  if (protocol === "agnes") return { protocol, modes: ["text", "image"], qualities: ["480p", "720p", "1080p"], durations: [3, 5, 10, 15], maxImages: 5, ratios: RATIOS, negativePrompt: true, seed: true, steps: true };
  if (["openai_video", "openai_video_form"].includes(protocol)) return { protocol, modes: ["text", "image"], qualities: ["720p"], durations: [4, 8, 12], maxImages: 1, ratios: ["16:9", "9:16"], negativePrompt: false, seed: false, steps: false, imageSizeMustMatch: true };
  if (protocol === "grsai_veo") {
    if (!["veo3.1-fast", "veo3.1-pro"].includes(model)) throw new Error("Grsai Veo 协议支持 veo3.1-fast 和 veo3.1-pro");
    return { protocol, modes: ["text", "image"], qualities: ["auto"], durations: [8], maxImages: 2, ratios: ["16:9", "9:16"], negativePrompt: false, seed: false, steps: false, externalFrames: true, providerParameters: true, billingUnit: "task" };
  }
  if (protocol === "wan26") {
    if (!WAN_MODELS.has(model)) throw new Error("百炼万相目前支持 wan2.6-t2v、wan2.6-i2v 和 wan2.6-i2v-flash，请选择对应模型");
    return { protocol, modes: [model === "wan2.6-t2v" ? "text" : "image"], qualities: ["720p", "1080p"], durations: Array.from({ length: 14 }, (_, i) => i + 2), maxImages: 1, ratios: RATIOS, negativePrompt: true, seed: true, steps: false, imageRatio: true };
  }
  if (protocol === "wan3") {
    if (!["wan3.0-video", "wan3.0-video-prime"].includes(model)) throw new Error("万相 3.0 协议仅支持 wan3.0-video 或 wan3.0-video-prime");
    return { protocol, modes: ["text", "image"], qualities: ["480p", "720p", "1080p"], durations: Array.from({ length: 29 }, (_, i) => i + 2), maxImages: 2, ratios: RATIOS, negativePrompt: false, seed: true, steps: false, imageRatio: true };
  }
  if (protocol === "minimax_h3") {
    if (!H3_MODELS.has(model)) throw new Error("MiniMax H3 协议仅支持 H3、Highspeed、Lite 和 Max 模型");
    return { protocol, modes: ["text", "image"], qualities: model === "MiniMax-H3" ? ["768p", "2k"] : ["480p", "768p"], durations: Array.from({ length: model === "MiniMax-H3-Max" ? 11 : 12 }, (_, i) => i + (model === "MiniMax-H3-Max" ? 5 : 4)), maxImages: 2, ratios: RATIOS, negativePrompt: false, seed: false, steps: false, imageRatio: true };
  }
  throw new Error("未知视频服务协议");
}
function validateVideo(config, input = {}) {
  const caps = capabilities(config.protocol, config.model);
  const mode = input.mode === "image" ? "image" : "text";
  if (!caps.modes.includes(mode)) throw new Error(`该模型不支持${mode === "image" ? "图生视频" : "文生视频"}，请切换视频服务`);
  const durationText = input.duration == null || input.duration === "" ? "5s" : String(input.duration);
  if (!/^\d+s$/.test(durationText)) throw new Error("视频时长格式不正确");
  const duration = Number(durationText.slice(0, -1));
  if (!caps.durations.includes(duration)) throw new Error("当前模型不支持该视频时长");
  const quality = String(input.quality || (caps.qualities.includes("720p") ? "720p" : caps.qualities.includes("768p") ? "768p" : caps.qualities[0])).toLowerCase();
  if (!caps.qualities.includes(quality)) throw new Error("当前模型不支持该清晰度");
  const ratio = input.ratio || "16:9";
  if (!caps.ratios.includes(ratio)) throw new Error("当前模型不支持该画面比例");
  const ids = caps.externalFrames ? (Array.isArray(input.sourceImageUrls) ? input.sourceImageUrls.map(value => String(value).trim()).filter(Boolean) : []) : Array.isArray(input.sourceImageIds) ? input.sourceImageIds.filter(Boolean) : input.sourceImageId ? [input.sourceImageId] : [];
  if (mode === "image" && (!ids.length || ids.length > caps.maxImages)) throw new Error(`该模型的图生视频需要 1 至 ${caps.maxImages} 张参考图`);
  if (caps.externalFrames && mode === "image") for (const value of ids) {
    let url;
    try { url = new URL(value); } catch { throw new Error("首尾帧必须是可公开访问的 HTTPS 图片地址"); }
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw new Error("首尾帧必须是可公开访问的 HTTPS 图片地址");
  }
  if (config.protocol === "agnes" && quality === "1080p" && duration > 10) throw new Error("1080p 最长支持 10 秒视频，请缩短时长或降低清晰度");
  if (!caps.negativePrompt && String(input.negativePrompt || "").trim()) throw new Error("该视频模型不支持单独的负向提示词，请写入提示词正文");
  if (!caps.seed && String(input.seed ?? "").trim()) throw new Error("该视频模型不支持此种子参数");
  if (["wan26", "wan3"].includes(config.protocol) && String(input.seed ?? "").trim() && (!Number.isInteger(Number(input.seed)) || Number(input.seed) < 0 || Number(input.seed) > 2147483647)) throw new Error("万相随机种子需为 0 到 2147483647 的整数");
  if (!caps.steps && String(input.steps ?? "").trim()) throw new Error("该视频模型不支持推理步数参数");
  return { mode, duration, quality, ratio, ids, caps };
}
function buildRequest(config, input, images = []) {
  const { mode, duration, quality, ratio } = validateVideo(config, input);
  if (["openai_video", "openai_video_form"].includes(config.protocol)) {
    if (mode === "image" && (!images[0] || images[0].length > 20971520)) throw new Error("兼容视频接口的参考图编码不能超过 20 MiB");
    return { model: config.model, prompt: input.prompt, seconds: String(duration), size: ratio === "16:9" ? "1280x720" : "720x1280", ...(mode === "image" ? { input_reference: { image_url: images[0] } } : {}) };
  }
  if (config.protocol === "grsai_veo") return { model: config.model, prompt: input.prompt, aspectRatio: ratio, webHook: "-1", ...(mode === "image" ? { firstFrameUrl: images[0], ...(images[1] ? { lastFrameUrl: images[1] } : {}) } : {}) };
  if (config.protocol === "wan26") {
    const body = { model: config.model, input: { prompt: input.prompt }, parameters: { duration, prompt_extend: false, watermark: false } };
    if (input.negativePrompt) body.input.negative_prompt = input.negativePrompt;
    if (mode === "image") { body.input.img_url = images[0]; body.parameters.resolution = quality.toUpperCase(); }
    else body.parameters.size = WAN_SIZES[quality][ratio];
    if (String(input.seed ?? "").trim()) body.parameters.seed = Number(input.seed);
    return body;
  }
  if (config.protocol === "wan3") {
    const body = { model: config.model, input: { prompt: input.prompt }, parameters: { duration, resolution: quality.toUpperCase(), ratio: mode === "image" ? "adaptive" : ratio, prompt_extend: false, watermark: false } };
    if (images.length) body.input.media = images.map((image, i) => ({ type: i === 0 ? "first_frame" : "last_frame", url: image }));
    if (String(input.seed ?? "").trim()) body.parameters.seed = Number(input.seed);
    return body;
  }
  if (config.protocol === "minimax_h3") {
    const content = [{ type: "text", text: input.prompt }];
    for (const [i, image] of images.entries()) content.push({ type: "image_url", image_url: { url: image }, role: i === 0 ? "first_frame" : "last_frame" });
    return { model: config.model, content, duration, resolution: quality.toUpperCase(), ...(mode === "text" ? { ratio } : {}) };
  }
  throw new Error("该协议使用已有 Agnes 客户端");
}
module.exports = { H3_MODELS, WAN_MODELS, capabilities, validateVideo, buildRequest };
