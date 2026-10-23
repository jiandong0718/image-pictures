"use strict";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const AUDIO_FORMATS = Object.freeze({ mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/ogg", aac: "audio/aac", flac: "audio/flac" });
const AUDIO_RESPONSE_FORMATS = Object.freeze({
  "audio/mpeg": { mime: "audio/mpeg", ext: "mp3" },
  "audio/mp3": { mime: "audio/mpeg", ext: "mp3" },
  "audio/wav": { mime: "audio/wav", ext: "wav" },
  "audio/x-wav": { mime: "audio/wav", ext: "wav" },
  "audio/ogg": { mime: "audio/ogg", ext: "ogg" },
  "audio/opus": { mime: "audio/ogg", ext: "ogg" },
  "audio/aac": { mime: "audio/aac", ext: "aac" },
  "audio/flac": { mime: "audio/flac", ext: "flac" },
  "audio/x-flac": { mime: "audio/flac", ext: "flac" },
});

function inputError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanText(value, label, maxLength, required = false) {
  if (value !== undefined && typeof value !== "string") throw inputError(`${label}格式不正确`);
  const text = (value || "").trim();
  if ((required && !text) || text.length > maxLength) throw inputError(`${label}${required ? "不能为空，且" : ""}不能超过 ${maxLength} 字符`);
  return text;
}

function normalizeAudioInput(raw = {}) {
  const prompt = cleanText(raw.prompt, "朗读文本", 4096, true);
  const voice = cleanText(raw.voice || "alloy", "音色", 100, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(voice)) throw inputError("音色名称格式不正确");
  const format = raw.format || "mp3";
  if (!Object.hasOwn(AUDIO_FORMATS, format)) throw inputError("仅支持 MP3、WAV、Opus、AAC 或 FLAC 音频");
  const speed = raw.speed === undefined ? 1 : Number(raw.speed);
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw inputError("语速需介于 0.25 和 4 之间");
  return { prompt, voice, format, speed, instructions: cleanText(raw.instructions, "声音指导", 2000) };
}

function normalizeAudioConfig(raw = {}, previous = {}) {
  const apiBase = cleanText(raw.apiBase === undefined ? previous.apiBase : raw.apiBase, "音频 API 地址", 500);
  if (apiBase) {
    let parsed;
    try { parsed = new URL(apiBase); } catch { throw inputError("音频 API 地址格式不正确"); }
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw inputError("音频 API 地址需为不含凭据和查询参数的 HTTP(S) 地址");
  }
  // 留空沿用原密钥；clearKey 显式清除，可用于停用。
  const suppliedKey = cleanText(raw.apiKey === undefined ? raw.key : raw.apiKey, "音频 API Key", 1000);
  const apiKey = raw.clearKey === true ? "" : suppliedKey || previous.apiKey || "";
  if (/[\r\n]/.test(apiKey)) throw inputError("音频 API Key 格式不正确");
  const model = cleanText(raw.model === undefined ? previous.model : raw.model, "音频模型", 100);
  const charactersPerCredit = Number(raw.charactersPerCredit ?? previous.charactersPerCredit ?? 1000);
  const creditsPerUnit = Number(raw.creditsPerUnit ?? previous.creditsPerUnit ?? 1);
  if (!Number.isSafeInteger(charactersPerCredit) || charactersPerCredit < 1 || charactersPerCredit > 100000) throw inputError("每档字符数需为 1 到 100000 的整数");
  if (!Number.isSafeInteger(creditsPerUnit) || creditsPerUnit < 1 || creditsPerUnit > 100000) throw inputError("每档积分需为 1 到 100000 的整数");
  return { apiBase: apiBase.replace(/\/+$/, ""), apiKey, model, charactersPerCredit, creditsPerUnit };
}

function isConfigured(config) {
  return Boolean(config?.apiBase && config?.apiKey && config?.model);
}

function publicAudioConfig(config) {
  return { apiBase: config.apiBase || "", model: config.model || "", hasKey: Boolean(config.apiKey), configured: isConfigured(config), charactersPerCredit: config.charactersPerCredit ?? 1000, creditsPerUnit: config.creditsPerUnit ?? 1 };
}

function calculateAudioCost(prompt, config = {}) {
  const characterCount = Array.from(String(prompt || "").trim()).length;
  const charactersPerCredit = Number(config.charactersPerCredit ?? 1000);
  const creditsPerUnit = Number(config.creditsPerUnit ?? 1);
  const estimatedCost = Math.ceil(characterCount / charactersPerCredit) * creditsPerUnit;
  return { characterCount, estimatedCost, charactersPerCredit, creditsPerUnit };
}

async function readLimitedBody(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw inputError("响应文件超过 20MB", 502);
  }
  const chunks = [];
  let length = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maxBytes) throw inputError("响应文件超过大小限制", 502);
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks, length);
}

async function generateSpeech(config, rawInput, { fetchImpl = globalThis.fetch, timeoutMs = 120000 } = {}) {
  if (!isConfigured(config)) throw inputError("请先由管理员配置音频 API 地址、密钥和模型", 503);
  const input = normalizeAudioInput(rawInput);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${config.apiBase.replace(/\/+$/, "")}/audio/speech`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input: input.prompt, voice: input.voice, response_format: input.format, speed: input.speed, ...(input.instructions ? { instructions: input.instructions } : {}) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      // 上游错误体可能回显密钥、输入或内部地址，不直接对用户和任务日志透传。
      throw inputError(`音频服务返回 HTTP ${response.status}，请检查模型与配置`, 502);
    }
    const mime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (mime !== "application/octet-stream" && !Object.hasOwn(AUDIO_RESPONSE_FORMATS, mime)) {
      await response.body?.cancel();
      throw inputError("音频服务未返回音频文件", 502);
    }
    const data = await readLimitedBody(response, MAX_AUDIO_BYTES);
    if (!data.length) throw inputError("音频服务返回了空文件", 502);
    // 实际响应可能不遵循请求格式；只有未指明音频类型时才回退到请求格式。
    const actualFormat = AUDIO_RESPONSE_FORMATS[mime] || { ext: input.format === "opus" ? "ogg" : input.format, mime: AUDIO_FORMATS[input.format] };
    return { data, ...actualFormat, input };
  } catch (error) {
    if (error.statusCode) throw error;
    throw inputError(controller.signal.aborted ? "音频生成超时，请稍后查看任务状态" : "音频服务连接失败，请检查配置或稍后重试", 502);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { AUDIO_FORMATS, MAX_AUDIO_BYTES, inputError, cleanText, normalizeAudioInput, normalizeAudioConfig, publicAudioConfig, isConfigured, calculateAudioCost, readLimitedBody, generateSpeech };
