const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// 在求值任何依赖 process.env 的常量之前，先加载 .env。
require("./lib/env").loadEnv();

const db = require("./lib/db");
const accounts = require("./lib/accounts");
const auth = require("./lib/auth");
const imageConfig = require("./lib/image-config");
const { createAccountApi } = require("./lib/api-accounts");

const ROOT_DIR = __dirname;
const PROJECT_ROOT_DIR = path.resolve(ROOT_DIR, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const GPT_IMAGE_PLAYGROUND_BASE_PATH = "/gpt-image-playground/";
const GPT_IMAGE_PLAYGROUND_DIST_DIR = path.join(
  ROOT_DIR,
  "vendor",
  "gpt-image-playground",
  "dist",
);
const OUTPUT_DIR = path.join(ROOT_DIR, "generated-images", "product-design");
const EMBEDDED_SKILL_SCRIPT = path.join(
  ROOT_DIR,
  "skills",
  "custom-image-generator",
  "scripts",
  "image_generator.py",
);
const WORKSPACE_SKILL_SCRIPT = path.join(
  PROJECT_ROOT_DIR,
  "skills",
  "custom-image-generator",
  "scripts",
  "image_generator.py",
);
const HOME_SKILL_SCRIPT = path.join(
  os.homedir(),
  ".codex",
  "skills",
  "custom-image-generator",
  "scripts",
  "image_generator.py",
);
const ENV_SKILL_SCRIPT_RAW = cleanPrompt(process.env.CUSTOM_IMAGE_SKILL_SCRIPT || "");
const ENV_SKILL_SCRIPT = ENV_SKILL_SCRIPT_RAW
  ? path.resolve(ROOT_DIR, ENV_SKILL_SCRIPT_RAW)
  : "";
const SKILL_SCRIPT_CANDIDATES = [
  ENV_SKILL_SCRIPT,
  EMBEDDED_SKILL_SCRIPT,
  WORKSPACE_SKILL_SCRIPT,
  HOME_SKILL_SCRIPT,
].filter(Boolean);
const SKILL_SCRIPT =
  SKILL_SCRIPT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ||
  SKILL_SCRIPT_CANDIDATES[0];
const PYTHON_COMMANDS = [
  process.env.CUSTOM_IMAGE_PYTHON,
  process.env.PYTHON,
  "python",
  "python3",
].filter(Boolean);
const IMAGE_NORMALIZER_COMMAND =
  process.env.IMAGE_NORMALIZER || (process.platform === "darwin" ? "sips" : "magick");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4174);
const PREFERRED_IMAGE_WIDTH = 1024;
const PREFERRED_IMAGE_HEIGHT = 1024;
const PREFERRED_IMAGE_SIZE = `${PREFERRED_IMAGE_WIDTH}x${PREFERRED_IMAGE_HEIGHT}`;
const IMAGE_SIZE_PRESETS = {
  "1k": 1024,
  "2k": 2048,
  "4k": 4096,
};
const IMAGE_RATIO_PRESETS = {
  "1:1": [1, 1],
  "3:2": [3, 2],
  "2:3": [2, 3],
  "16:9": [16, 9],
  "9:16": [9, 16],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "21:9": [21, 9],
};
const IMAGE_API_BASE_ENV_KEY = "CUSTOM_IMAGE_API_BASE";
const IMAGE_API_KEY_ENV_KEY = "CUSTOM_IMAGE_API_KEY";
const PROMPT_API_BASE_ENV_KEY = "CUSTOM_PROMPT_API_BASE";
const PROMPT_API_KEY_ENV_KEY = "CUSTOM_PROMPT_API_KEY";
const PROMPT_EXTRACT_MODEL_ENV_KEY = "CUSTOM_PROMPT_EXTRACT_MODEL";
const FALLBACK_IMAGE_API_BASE = "https://colorflowai.com/v1";
const FIXED_IMAGE_API_BASE = resolveFixedImageApiBase();
const FALLBACK_PROMPT_EXTRACT_MODEL = "gpt-4o-mini";
const PROMPT_EXTRACTION_TIMEOUT_MS = 120000;
const PROMPT_EXTRACTION_INSTRUCTION =
  "请分析这张图片，并提取一段可直接用于 AI 生图的中文详细提示词。输出只需要提示词正文，不要解释。请覆盖主体、构图、视角、背景、光线、材质、颜色、细节、风格、镜头/渲染质感、画面氛围，并在最后补充适合电商或设计复刻的质量描述。";
const MIN_IMAGE_SPEC_SIZE = 256;
const MAX_IMAGE_SPEC_SIZE = 4096;
const PLAYGROUND_IMAGE_COUNT_MIN = 1;
const PLAYGROUND_IMAGE_COUNT_MAX = 4;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_PROXY_UPLOAD_BYTES = 80 * 1024 * 1024;
const UPLOAD_MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const IMAGE_TYPES = {
  playground: {
    label: "自由生图",
    prefix: "playground",
    endpoint: "generations",
  },
  main: {
    label: "主图",
    prefix: "main",
    endpoint: "generations",
  },
  derived: {
    label: "衍生图",
    prefix: "derived",
    endpoint: "edits",
  },
  whiteBackground: {
    label: "白色背景图",
    prefix: "white-background",
    endpoint: "edits",
  },
  dimensions: {
    label: "尺寸标注图",
    prefix: "dimensions",
    endpoint: "edits",
  },
  detail: {
    label: "局部放大图",
    prefix: "detail",
    endpoint: "edits",
  },
  worn: {
    label: "人物穿戴图",
    prefix: "worn",
    endpoint: "edits",
  },
  scene: {
    label: "场景展示图",
    prefix: "scene",
    endpoint: "edits",
  },
  sellingPoints: {
    label: "卖点展示图",
    prefix: "selling-points",
    endpoint: "edits",
  },
  shoulderBagStrap: {
    label: "部位1图",
    prefix: "shoulder-bag-strap",
    endpoint: "edits",
  },
  shoulderBagBody: {
    label: "部位2图",
    prefix: "shoulder-bag-body",
    endpoint: "edits",
  },
};

const HAT_BATCH_DERIVED_TYPES = [
  "whiteBackground",
  "dimensions",
  "detail",
  "worn",
  "scene",
  "sellingPoints",
];
const DERIVED_TYPES = Object.keys(IMAGE_TYPES).filter((type) => !["main", "playground"].includes(type));
const IMAGE_SET_ID_PATTERN = /^\d{3,}$/;
const IMAGE_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp|gif)$/i;
let imageSetAllocationQueue = Promise.resolve();
// 生图端点（多组 key+url）与提示词配置已迁移到 MySQL，见 lib/image-config.js。

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml; charset=utf-8",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res, statusCode, message, details = "") {
  sendJson(res, statusCode, { ok: false, error: message, details });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function readRequestBuffer(req, maxBytes = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error("上传图片不能超过 20MB"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readRequestBody(req);
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const wrapped = new Error("请求 JSON 格式不正确");
    wrapped.cause = error;
    throw wrapped;
  }
}

function cleanPrompt(value) {
  return typeof value === "string" ? value.trim() : "";
}

// 账户 / 认证 / 管理员相关接口，复用本文件的响应工具。
const accountApi = createAccountApi({ sendJson, sendError, readJson });

function parseEnvLine(line) {
  const stripped = line.trim();
  if (!stripped || stripped.startsWith("#")) {
    return null;
  }
  const normalized = stripped.startsWith("export ") ? stripped.slice(7).trim() : stripped;
  const separator = normalized.indexOf("=");
  if (separator === -1) {
    return null;
  }
  const key = normalized.slice(0, separator).trim();
  let value = normalized.slice(separator + 1).trim();
  if (!key) {
    return null;
  }
  if (value.length >= 2 && value[0] === value[value.length - 1] && ['"', "'"].includes(value[0])) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

function readEnvValueFromFile(filePath, key) {
  try {
    if (!fs.existsSync(filePath)) {
      return "";
    }
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseEnvLine(line);
      if (parsed && parsed[0] === key) {
        return cleanPrompt(parsed[1]);
      }
    }
  } catch {
    return "";
  }
  return "";
}

function resolveFixedImageApiBase() {
  return (
    cleanPrompt(process.env[IMAGE_API_BASE_ENV_KEY] || "") ||
    readEnvValueFromFile(path.join(ROOT_DIR, ".env"), IMAGE_API_BASE_ENV_KEY) ||
    readEnvValueFromFile(path.join(PROJECT_ROOT_DIR, "skills", "custom-image-generator", ".env"), IMAGE_API_BASE_ENV_KEY) ||
    FALLBACK_IMAGE_API_BASE
  );
}

function resolveImageApiKey() {
  return (
    cleanPrompt(process.env[IMAGE_API_KEY_ENV_KEY] || "") ||
    readEnvValueFromFile(path.join(ROOT_DIR, ".env"), IMAGE_API_KEY_ENV_KEY) ||
    readEnvValueFromFile(path.join(PROJECT_ROOT_DIR, "skills", "custom-image-generator", ".env"), IMAGE_API_KEY_ENV_KEY)
  );
}

function resolvePromptApiBase() {
  return (
    cleanPrompt(process.env[PROMPT_API_BASE_ENV_KEY] || "") ||
    readEnvValueFromFile(path.join(ROOT_DIR, ".env"), PROMPT_API_BASE_ENV_KEY)
  );
}

function resolvePromptApiKey() {
  return (
    cleanPrompt(process.env[PROMPT_API_KEY_ENV_KEY] || "") ||
    readEnvValueFromFile(path.join(ROOT_DIR, ".env"), PROMPT_API_KEY_ENV_KEY)
  );
}

// 嵌入版绘图聚集地（React）拉的配置：通过服务端代理出去，key 不下发到前端。
// uploaded 取决于 DB 里是否已配置生图端点。
async function getRuntimePlaygroundConfig() {
  return {
    uploaded: (await imageConfig.countEndpoints()) > 0,
    apiBase: "/api/full-playground-proxy",
    apiKey: "workbench-proxy",
    model: "gpt-image-2",
  };
}

function buildImageGeneratorEnv(baseEnv, apiConfig) {
  return {
    ...baseEnv,
    [IMAGE_API_BASE_ENV_KEY]: apiConfig.apiBase,
    [IMAGE_API_KEY_ENV_KEY]: apiConfig.apiKey,
  };
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function normalizePlaygroundRequest(rawRequest = {}) {
  const prompt = cleanPrompt(rawRequest.prompt);
  if (!prompt) {
    throw new Error("自由生图提示词不能为空");
  }

  const mode = rawRequest.mode === "edit" ? "edit" : "generate";
  const count = clampInteger(
    rawRequest.count,
    PLAYGROUND_IMAGE_COUNT_MIN,
    PLAYGROUND_IMAGE_COUNT_MIN,
    PLAYGROUND_IMAGE_COUNT_MAX,
  );
  const background = cleanPrompt(rawRequest.background);
  const system = cleanPrompt(rawRequest.system);

  return {
    mode,
    prompt,
    count,
    background,
    system,
    imageSpec: normalizeImageSpec(rawRequest.imageSpec),
    referenceImageId: cleanPrompt(rawRequest.referenceImageId),
  };
}

function buildImageGeneratorArgs({
  skillScript,
  prompt,
  endpoint,
  outputDir,
  filenamePrefix,
  requestSize,
  count = 1,
  background = "",
  system = "",
}) {
  const args = [
    skillScript,
    prompt,
    "--endpoint",
    endpoint,
    "--output-dir",
    outputDir,
    "--filename-prefix",
    filenamePrefix,
    "--n",
    String(clampInteger(count, 1, 1, PLAYGROUND_IMAGE_COUNT_MAX)),
    "--size",
    requestSize,
    "--timeout",
    "180",
  ];
  if (background) {
    args.push("--background", background);
  }
  if (system) {
    args.push("--system", system);
  }
  return [
    ...args,
  ];
}

function getPromptExtractModel() {
  return cleanPrompt(process.env[PROMPT_EXTRACT_MODEL_ENV_KEY] || "") || FALLBACK_PROMPT_EXTRACT_MODEL;
}

function getUploadedImageMime(upload) {
  const ext = inferUploadedImageExt(upload.data, upload.mime);
  if (!ext) {
    throw new Error("只支持上传 PNG、JPG、WEBP 或 GIF 图片");
  }
  const mimeByExt = {
    png: "image/png",
    jpg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  };
  return mimeByExt[ext] || upload.mime;
}

function buildApiEndpoint(apiBase, endpointPath) {
  const base = cleanPrompt(apiBase);
  if (!base) {
    throw new Error("API URL 未配置");
  }
  return new URL(endpointPath.replace(/^\/+/, ""), base.endsWith("/") ? base : `${base}/`).toString();
}

function normalizeProxyPath(pathname) {
  return pathname.replace(/^\/api\/full-playground-proxy\/?/, "").replace(/^\/+/, "");
}

function hasImageValue(item) {
  if (!item || typeof item !== "object") {
    return false;
  }
  return Boolean(
    item.url ||
    item.b64_json ||
    item.image_url ||
    item.image ||
    item.result ||
    item.data_url ||
    item.base64,
  );
}

function countImagesInNestedValue(value) {
  if (!value) return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countImagesInNestedValue(item), 0);
  }
  if (typeof value !== "object") {
    return 0;
  }
  if (hasImageValue(value)) {
    return 1;
  }
  const record = value;
  let count = 0;
  for (const key of ["content", "output", "images", "data"]) {
    if (Array.isArray(record[key])) {
      count += countImagesInNestedValue(record[key]);
    }
  }
  return count;
}

function countImagesInApiResponse(payload) {
  if (!payload || typeof payload !== "object") {
    return 0;
  }
  const data = payload.data;
  if (Array.isArray(data)) {
    return countImagesInNestedValue(data);
  }
  const output = payload.output;
  if (Array.isArray(output)) {
    return countImagesInNestedValue(output);
  }
  return countImagesInNestedValue(payload);
}

function requestedImageCountFromJson(payload) {
  const n = Number(payload?.n);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 16) : 1;
}

function parseMultipartTextFields(buffer, contentType) {
  const boundaryMatch = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    return {};
  }
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const fields = {};
  let cursor = buffer.indexOf(boundary);
  while (cursor !== -1) {
    const partStart = cursor + boundary.length;
    const next = buffer.indexOf(boundary, partStart);
    if (next === -1) break;
    let part = buffer.subarray(partStart, next);
    if (part.length >= 2 && part[0] === 13 && part[1] === 10) {
      part = part.subarray(2);
    }
    part = trimMultipartCrlf(part);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString("utf8");
      const body = part.subarray(headerEnd + 4);
      const headers = {};
      for (const line of headerText.split("\r\n")) {
        const separator = line.indexOf(":");
        if (separator !== -1) {
          headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
        }
      }
      const disposition = headers["content-disposition"] || "";
      const dispositionValues = parseContentDisposition(disposition);
      if (dispositionValues.name && !dispositionValues.filename) {
        fields[dispositionValues.name] = body.toString("utf8");
      }
    }
    cursor = next;
  }
  return fields;
}

function requestedImageCountFromMultipart(buffer, contentType) {
  return requestedImageCountFromJson(parseMultipartTextFields(buffer, contentType));
}

function buildPromptExtractionRequest({ imageData, mime, model = getPromptExtractModel() }) {
  if (!Buffer.isBuffer(imageData) || !imageData.length) {
    throw new Error("上传图片不能为空");
  }
  if (!mime || !mime.startsWith("image/")) {
    throw new Error("上传文件必须是图片");
  }

  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: PROMPT_EXTRACTION_INSTRUCTION,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mime};base64,${imageData.toString("base64")}`,
            },
          },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 1800,
  };
}

function extractTextContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (typeof item?.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function parsePromptExtractionResponse(data) {
  const chatContent = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
  const outputText = data?.output_text;
  const responseOutput = Array.isArray(data?.output)
    ? data.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .map((item) => item?.text || "")
        .filter(Boolean)
        .join("\n")
    : "";
  const prompt = cleanPrompt(extractTextContent(chatContent) || outputText || responseOutput);
  if (!prompt) {
    throw new Error("API 未返回提示词内容");
  }
  return prompt;
}

function getApiErrorMessage(data, fallback = "") {
  return (
    cleanPrompt(data?.error?.message) ||
    cleanPrompt(data?.error) ||
    cleanPrompt(data?.message) ||
    cleanPrompt(fallback)
  );
}

async function callPromptExtractionApi({ upload, apiConfig, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("当前 Node.js 版本不支持 fetch，请升级到 Node.js 18 或更高版本");
  }

  const mime = getUploadedImageMime(upload);
  const endpoint = buildApiEndpoint(apiConfig.apiBase, "chat/completions");
  const requestBody = buildPromptExtractionRequest({
    imageData: upload.data,
    mime,
    model: apiConfig.model || getPromptExtractModel(),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROMPT_EXTRACTION_TIMEOUT_MS);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : {};
    if (!response.ok) {
      throw new Error(getApiErrorMessage(data, raw) || `API 请求失败：${response.status}`);
    }
    return {
      prompt: parsePromptExtractionResponse(data),
      model: requestBody.model,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("提示词提取请求超时");
    }
    if (error instanceof SyntaxError) {
      throw new Error("API 响应不是有效 JSON");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function trimMultipartCrlf(buffer) {
  let end = buffer.length;
  if (end >= 2 && buffer[end - 2] === 13 && buffer[end - 1] === 10) {
    end -= 2;
  }
  return buffer.subarray(0, end);
}

function parseContentDisposition(value) {
  const result = {};
  for (const item of value.split(";").map((part) => part.trim())) {
    const [key, rawValue] = item.split("=");
    if (!rawValue) {
      continue;
    }
    result[key.toLowerCase()] = rawValue.replace(/^"|"$/g, "");
  }
  return result;
}

async function readMultipartFile(req, fieldName) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw new Error("上传请求缺少 boundary");
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const raw = await readRequestBuffer(req);
  let cursor = raw.indexOf(boundary);

  while (cursor !== -1) {
    const partStart = cursor + boundary.length;
    const next = raw.indexOf(boundary, partStart);
    if (next === -1) {
      break;
    }

    let part = raw.subarray(partStart, next);
    if (part.length >= 2 && part[0] === 13 && part[1] === 10) {
      part = part.subarray(2);
    }
    part = trimMultipartCrlf(part);

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString("utf8");
      const body = part.subarray(headerEnd + 4);
      const headers = {};
      for (const line of headerText.split("\r\n")) {
        const separator = line.indexOf(":");
        if (separator === -1) {
          continue;
        }
        headers[line.slice(0, separator).trim().toLowerCase()] = line
          .slice(separator + 1)
          .trim();
      }

      const disposition = headers["content-disposition"] || "";
      const dispositionValues = parseContentDisposition(disposition);
      if (dispositionValues.name === fieldName && dispositionValues.filename) {
        return {
          filename: dispositionValues.filename,
          mime: headers["content-type"] || "application/octet-stream",
          data: body,
        };
      }
    }

    cursor = next;
  }

  throw new Error("没有找到上传图片");
}

function inferUploadedImageExt(data, mime) {
  if (UPLOAD_MIME_EXT[mime]) {
    return UPLOAD_MIME_EXT[mime];
  }
  if (bufferStartsWith(data, Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return "png";
  }
  if (bufferStartsWith(data, Buffer.from([0xff, 0xd8, 0xff]))) {
    return "jpg";
  }
  if (bufferStartsWith(data, Buffer.from("RIFF")) && data.subarray(8, 12).equals(Buffer.from("WEBP"))) {
    return "webp";
  }
  if (bufferStartsWith(data, Buffer.from("GIF87a")) || bufferStartsWith(data, Buffer.from("GIF89a"))) {
    return "gif";
  }
  return "";
}

function bufferStartsWith(data, signature) {
  return data.length >= signature.length && data.subarray(0, signature.length).equals(signature);
}

function readPngDimensions(data) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (data.length < 24 || !data.subarray(0, 8).equals(signature)) {
    return null;
  }
  if (data.subarray(12, 16).toString("ascii") !== "IHDR") {
    return null;
  }
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

function readGifDimensions(data) {
  if (
    data.length < 10 ||
    (!bufferStartsWith(data, Buffer.from("GIF87a")) && !bufferStartsWith(data, Buffer.from("GIF89a")))
  ) {
    return null;
  }
  return {
    width: data.readUInt16LE(6),
    height: data.readUInt16LE(8),
  };
}

function isJpegSofMarker(marker) {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function readJpegDimensions(data) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (data[offset] === 0xff) {
      offset += 1;
    }
    const marker = data[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      continue;
    }
    if (offset + 2 > data.length) {
      return null;
    }
    const length = data.readUInt16BE(offset);
    if (length < 2) {
      return null;
    }
    const segmentStart = offset + 2;
    const segmentEnd = offset + length;
    if (segmentEnd > data.length) {
      return null;
    }
    if (isJpegSofMarker(marker) && segmentStart + 5 <= data.length) {
      return {
        width: data.readUInt16BE(segmentStart + 3),
        height: data.readUInt16BE(segmentStart + 1),
      };
    }
    offset = segmentEnd;
  }

  return null;
}

function readWebpDimensions(data) {
  if (
    data.length < 30 ||
    data.subarray(0, 4).toString("ascii") !== "RIFF" ||
    data.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= data.length) {
    const chunkType = data.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = data.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > data.length) {
      return null;
    }

    if (chunkType === "VP8X" && chunkSize >= 10) {
      return {
        width: data.readUIntLE(chunkStart + 4, 3) + 1,
        height: data.readUIntLE(chunkStart + 7, 3) + 1,
      };
    }
    if (
      chunkType === "VP8 " &&
      chunkSize >= 10 &&
      data[chunkStart + 3] === 0x9d &&
      data[chunkStart + 4] === 0x01 &&
      data[chunkStart + 5] === 0x2a
    ) {
      return {
        width: data.readUInt16LE(chunkStart + 6) & 0x3fff,
        height: data.readUInt16LE(chunkStart + 8) & 0x3fff,
      };
    }
    if (chunkType === "VP8L" && chunkSize >= 5 && data[chunkStart] === 0x2f) {
      const bits = data.readUInt32LE(chunkStart + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  return null;
}

function readImageDimensions(data) {
  if (!Buffer.isBuffer(data)) {
    return null;
  }
  return (
    readPngDimensions(data) ||
    readGifDimensions(data) ||
    readJpegDimensions(data) ||
    readWebpDimensions(data)
  );
}

function normalizeImageSpec(rawSpec = {}) {
  const legacyMode = rawSpec?.mode === "fixed" ? "fixed" : rawSpec?.mode === "square" ? "square" : "";
  const legacySize = Number(rawSpec?.size);
  const sizeMode =
    rawSpec?.sizeMode === "custom" || (legacyMode === "fixed" && !Object.values(IMAGE_SIZE_PRESETS).includes(legacySize))
      ? "custom"
      : "preset";
  const sizePreset =
    typeof rawSpec?.sizePreset === "string" && Object.hasOwn(IMAGE_SIZE_PRESETS, rawSpec.sizePreset)
      ? rawSpec.sizePreset
      : Object.entries(IMAGE_SIZE_PRESETS).find(([, value]) => value === legacySize)?.[0] || "1k";
  const customSize = Number.isInteger(Number(rawSpec?.customSize))
    ? clampInteger(rawSpec.customSize, PREFERRED_IMAGE_WIDTH, MIN_IMAGE_SPEC_SIZE, MAX_IMAGE_SPEC_SIZE)
    : Number.isInteger(legacySize)
      ? clampInteger(legacySize, PREFERRED_IMAGE_WIDTH, MIN_IMAGE_SPEC_SIZE, MAX_IMAGE_SPEC_SIZE)
      : PREFERRED_IMAGE_WIDTH;
  const size = sizeMode === "custom" ? customSize : IMAGE_SIZE_PRESETS[sizePreset];
  const legacyRatio = typeof rawSpec?.ratio === "string" ? rawSpec.ratio.trim() : "";
  const ratioPreset =
    typeof rawSpec?.ratioPreset === "string" && (Object.hasOwn(IMAGE_RATIO_PRESETS, rawSpec.ratioPreset) || rawSpec.ratioPreset === "custom")
      ? rawSpec.ratioPreset
      : Object.hasOwn(IMAGE_RATIO_PRESETS, legacyRatio)
        ? legacyRatio
        : "1:1";
  const legacyRatioParts = legacyRatio.split(":").map((value) => Number(value));
  const customRatioWidth = Number.isInteger(Number(rawSpec?.customRatioWidth)) && Number(rawSpec.customRatioWidth) > 0
    ? Math.min(Number(rawSpec.customRatioWidth), 99)
    : Number.isInteger(legacyRatioParts[0]) && legacyRatioParts[0] > 0
      ? Math.min(legacyRatioParts[0], 99)
      : 1;
  const customRatioHeight = Number.isInteger(Number(rawSpec?.customRatioHeight)) && Number(rawSpec.customRatioHeight) > 0
    ? Math.min(Number(rawSpec.customRatioHeight), 99)
    : Number.isInteger(legacyRatioParts[1]) && legacyRatioParts[1] > 0
      ? Math.min(legacyRatioParts[1], 99)
      : 1;
  const [ratioWidth, ratioHeight] = ratioPreset === "custom"
    ? [customRatioWidth, customRatioHeight]
    : IMAGE_RATIO_PRESETS[ratioPreset] || IMAGE_RATIO_PRESETS["1:1"];
  let width = size;
  let height = size;
  if (ratioWidth > ratioHeight) {
    height = Math.max(1, Math.round((size * ratioHeight) / ratioWidth));
  } else if (ratioHeight > ratioWidth) {
    width = Math.max(1, Math.round((size * ratioWidth) / ratioHeight));
  }
  const ratio = `${ratioWidth}:${ratioHeight}`;
  return {
    sizeMode,
    sizePreset,
    customSize,
    ratioPreset,
    customRatioWidth,
    customRatioHeight,
    size,
    width,
    height,
    requestSize: `${width}x${height}`,
    ratio,
  };
}

function getImageTypeConfig(type) {
  return IMAGE_TYPES[type] || null;
}

function getDerivedImageTypes() {
  return [...DERIVED_TYPES];
}

function normalizeBatchDerivedTypes(types) {
  const uniqueTypes = [...new Set(Array.isArray(types) ? types : HAT_BATCH_DERIVED_TYPES)];
  if (!uniqueTypes.length) {
    throw new Error("没有可生成的衍生图类型");
  }
  for (const type of uniqueTypes) {
    if (!DERIVED_TYPES.includes(type)) {
      throw new Error("未知衍生图类型");
    }
  }
  return uniqueTypes;
}

function getBatchDerivedTypes(types) {
  if (typeof types === "undefined") {
    return [...HAT_BATCH_DERIVED_TYPES];
  }
  return normalizeBatchDerivedTypes(types);
}

function describeImageSpec(spec) {
  const normalized = normalizeImageSpec(spec);
  return `${normalized.width}x${normalized.height}（${normalized.ratio}）`;
}

function imageSpecFromSearchParams(searchParams) {
  return normalizeImageSpec({
    sizeMode: searchParams.get("imageSpecSizeMode"),
    sizePreset: searchParams.get("imageSpecSizePreset"),
    customSize: searchParams.get("imageSpecCustomSize"),
    ratioPreset: searchParams.get("imageSpecRatioPreset"),
    customRatioWidth: searchParams.get("imageSpecCustomRatioWidth"),
    customRatioHeight: searchParams.get("imageSpecCustomRatioHeight"),
  });
}

function assertImageSpecDimensions(data, spec = normalizeImageSpec(), label = "图片") {
  const normalized = normalizeImageSpec(spec);
  const dimensions = readImageDimensions(data);
  if (!dimensions) {
    throw new Error(`${label}无法读取图片尺寸，请使用 PNG、JPG、WEBP 或 GIF 图片`);
  }
  if (dimensions.width !== normalized.width || dimensions.height !== normalized.height) {
    throw new Error(
      `${label}尺寸必须是 ${normalized.width}x${normalized.height}（${normalized.ratio}），` +
        `当前是 ${dimensions.width}x${dimensions.height}`,
    );
  }
  return dimensions;
}

async function assertImageSpecFile(filePath, spec, label) {
  const data = await fsp.readFile(filePath);
  return assertImageSpecDimensions(data, spec, label);
}

function getImageNormalizationPlan(dimensions, spec = normalizeImageSpec()) {
  const normalized = normalizeImageSpec(spec);
  if (!dimensions) {
    return {
      needsNormalization: false,
      cropWidth: 0,
      cropHeight: 0,
      targetWidth: 0,
      targetHeight: 0,
    };
  }
  const currentRatio = dimensions.width / dimensions.height;
  const targetRatio = normalized.width / normalized.height;
  let cropWidth = dimensions.width;
  let cropHeight = dimensions.height;
  if (Math.abs(currentRatio - targetRatio) > 0.0001) {
    if (currentRatio > targetRatio) {
      cropWidth = Math.max(1, Math.round(dimensions.height * targetRatio));
    } else {
      cropHeight = Math.max(1, Math.round(dimensions.width / targetRatio));
    }
  }
  const needsCrop = cropWidth !== dimensions.width || cropHeight !== dimensions.height;
  const needsResize = cropWidth !== normalized.width || cropHeight !== normalized.height;
  return {
    needsNormalization: needsCrop || needsResize,
    cropWidth: needsCrop ? cropWidth : 0,
    cropHeight: needsCrop ? cropHeight : 0,
    targetWidth: needsResize ? normalized.width : 0,
    targetHeight: needsResize ? normalized.height : 0,
  };
}

function getImageNormalizerCommands(command, plan, filePath) {
  const commandName = path.basename(command).toLowerCase();
  const commands = [];
  const isImageMagick = commandName === "convert" || commandName === "magick";

  if (plan.cropWidth && plan.cropHeight) {
    if (isImageMagick) {
      commands.push({
        command,
        args: [
          filePath,
          "-gravity",
          "center",
          "-crop",
          `${plan.cropWidth}x${plan.cropHeight}+0+0`,
          "+repage",
          filePath,
        ],
      });
    } else {
      commands.push({
        command,
        args: ["--cropToHeightWidth", String(plan.cropHeight), String(plan.cropWidth), filePath],
      });
    }
  }

  if (plan.targetWidth && plan.targetHeight) {
    if (isImageMagick) {
      commands.push({
        command,
        args: [filePath, "-resize", `${plan.targetWidth}x${plan.targetHeight}!`, filePath],
      });
    } else {
      commands.push({
        command,
        args: [
          "--resampleHeightWidth",
          String(plan.targetHeight),
          String(plan.targetWidth),
          filePath,
        ],
      });
    }
  }

  return commands;
}

async function normalizeGeneratedImageFile(filePath, spec, label) {
  const normalized = normalizeImageSpec(spec);
  const originalData = await fsp.readFile(filePath);
  const originalDimensions = readImageDimensions(originalData);
  if (!originalDimensions) {
    throw new Error(`${label}无法读取图片尺寸，请使用 PNG、JPG、WEBP 或 GIF 图片`);
  }

  const plan = getImageNormalizationPlan(originalDimensions, normalized);
  if (!plan.needsNormalization) {
    return originalDimensions;
  }

  try {
    for (const command of getImageNormalizerCommands(IMAGE_NORMALIZER_COMMAND, plan, filePath)) {
      await runProcess(command.command, command.args, ROOT_DIR);
    }
  } catch (error) {
    throw new Error(
      `${label}尺寸是 ${originalDimensions.width}x${originalDimensions.height}，` +
        `自动处理为 ${describeImageSpec(normalized)} 失败：${error.message}`,
    );
  }

  return assertImageSpecFile(filePath, normalized, label);
}

function normalizeImageSetId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) {
    return "";
  }
  if (!IMAGE_SET_ID_PATTERN.test(id)) {
    throw new Error("套图 ID 不正确");
  }
  return id;
}

function getImageSetIdFromImageId(id) {
  if (typeof id !== "string") {
    return "";
  }
  const parts = id.split(/[\\/]/).filter(Boolean);
  return parts.length === 2 && IMAGE_SET_ID_PATTERN.test(parts[0]) ? parts[0] : "";
}

function resolveImageSetDir(imageSetId) {
  const normalized = normalizeImageSetId(imageSetId);
  if (!normalized) {
    throw new Error("缺少套图 ID");
  }
  const filePath = path.resolve(OUTPUT_DIR, normalized);
  const root = path.resolve(OUTPUT_DIR);
  if (path.dirname(filePath) !== root) {
    throw new Error("套图路径不正确");
  }
  return filePath;
}

function makeImageId(filePath) {
  const root = path.resolve(OUTPUT_DIR);
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("图片输出路径不正确");
  }
  return relative.split(path.sep).join("/");
}

function resolveOutputFile(id) {
  if (typeof id !== "string") {
    throw new Error("图片 ID 不正确");
  }

  const parts = id.split(/[\\/]/).filter(Boolean);
  if (parts.length === 1) {
    if (!IMAGE_FILE_PATTERN.test(parts[0])) {
      throw new Error("图片 ID 不正确");
    }
    const filePath = path.resolve(OUTPUT_DIR, parts[0]);
    if (path.dirname(filePath) !== path.resolve(OUTPUT_DIR)) {
      throw new Error("图片路径不正确");
    }
    return filePath;
  }

  if (
    parts.length !== 2 ||
    !IMAGE_SET_ID_PATTERN.test(parts[0]) ||
    !IMAGE_FILE_PATTERN.test(parts[1])
  ) {
    throw new Error("图片 ID 不正确");
  }

  const filePath = path.resolve(OUTPUT_DIR, parts[0], parts[1]);
  if (path.dirname(filePath) !== path.resolve(OUTPUT_DIR, parts[0])) {
    throw new Error("图片路径不正确");
  }
  return filePath;
}

async function allocateImageSetNow() {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  const entries = await fsp.readdir(OUTPUT_DIR, { withFileTypes: true }).catch(() => []);
  const maxOrder = entries.reduce((max, entry) => {
    if (!entry.isDirectory() || !IMAGE_SET_ID_PATTERN.test(entry.name)) {
      return max;
    }
    return Math.max(max, Number(entry.name));
  }, 0);
  const order = maxOrder + 1;
  const folderName = String(order).padStart(3, "0");
  const dir = resolveImageSetDir(folderName);
  await fsp.mkdir(dir, { recursive: true });
  return {
    id: folderName,
    order,
    folderName,
    outputDir: dir,
    createdAt: new Date().toISOString(),
  };
}

function allocateImageSet() {
  const allocation = imageSetAllocationQueue.then(allocateImageSetNow, allocateImageSetNow);
  imageSetAllocationQueue = allocation.catch(() => {});
  return allocation;
}

async function clearOutputDirContents(outputDir = OUTPUT_DIR) {
  const root = path.resolve(outputDir);
  if (root === path.parse(root).root) {
    throw new Error("拒绝清空系统根目录");
  }
  await fsp.mkdir(root, { recursive: true });
  const entries = await fsp.readdir(root, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      fsp.rm(path.join(root, entry.name), {
        recursive: true,
        force: true,
      }),
    ),
  );
  return entries.length;
}

async function resetImageSets() {
  const reset = imageSetAllocationQueue.then(
    async () => {
      const removedCount = await clearOutputDirContents(OUTPUT_DIR);
      const imageSet = await allocateImageSetNow();
      return { removedCount, imageSet };
    },
    async () => {
      const removedCount = await clearOutputDirContents(OUTPUT_DIR);
      const imageSet = await allocateImageSetNow();
      return { removedCount, imageSet };
    },
  );
  imageSetAllocationQueue = reset.catch(() => {});
  return reset;
}

function parseGeneratedImagePath(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => /\.(png|jpg|jpeg|webp|gif)$/i.test(line)) || "";
}

function parseGeneratedImagePaths(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.filter((line) => /\.(png|jpg|jpeg|webp|gif)$/i.test(line));
}

function makeImageRecord(filePath, type, prompt, sourceMainId = "") {
  const id = makeImageId(filePath);
  const filename = path.basename(filePath);
  const imageSetId = getImageSetIdFromImageId(id);
  const imageTypeConfig = IMAGE_TYPES[type] || IMAGE_TYPES.playground;
  return {
    id,
    type,
    label: imageTypeConfig.label,
    prompt,
    sourceMainId,
    imageSetId,
    folderName: imageSetId,
    filename,
    url: `/api/images/file/${encodeURIComponent(id)}`,
    downloadUrl: `/api/images/download/${encodeURIComponent(id)}`,
    createdAt: new Date().toISOString(),
  };
}

async function generatePlaygroundImages(rawRequest = {}) {
  const request = normalizePlaygroundRequest(rawRequest);
  if (!SKILL_SCRIPT || !fs.existsSync(SKILL_SCRIPT)) {
    throw new Error(
      `找不到生图脚本：${SKILL_SCRIPT || "未配置"}。` +
        "请确认 CUSTOM_IMAGE_SKILL_SCRIPT 或 skills/custom-image-generator/scripts/image_generator.py",
    );
  }

  const endpoint = request.mode === "edit" ? "edits" : "generations";
  let sourceMainId = "";
  let sourcePath = "";
  if (endpoint === "edits") {
    if (!request.referenceImageId) {
      throw new Error("编辑模式需要先选择参考图");
    }
    sourcePath = resolveOutputFile(request.referenceImageId);
    await fsp.access(sourcePath, fs.constants.R_OK);
    sourceMainId = makeImageId(sourcePath);
  }

  const imageSet = await allocateImageSet();
  const outputDir = imageSet.outputDir;
  const apiConfig = await imageConfig.pickEndpoint();
  const args = buildImageGeneratorArgs({
    skillScript: SKILL_SCRIPT,
    prompt: request.prompt,
    endpoint,
    outputDir,
    filenamePrefix: IMAGE_TYPES.playground.prefix,
    requestSize: request.imageSpec.requestSize,
    count: request.count,
    background: request.background,
    system: request.system,
  });

  if (endpoint === "edits") {
    args.push("--image", sourcePath);
  }

  const { stdout, stderr } = await runPythonProcess(args, ROOT_DIR, buildImageGeneratorEnv(process.env, apiConfig));
  const imagePaths = parseGeneratedImagePaths(stdout).filter((filePath) => !filePath.endsWith("-response.json"));
  if (!imagePaths.length) {
    throw new Error(stderr || stdout || "生图完成，但没有找到输出图片路径");
  }

  const images = [];
  for (const imagePath of imagePaths) {
    await fsp.access(imagePath, fs.constants.R_OK);
    try {
      await normalizeGeneratedImageFile(imagePath, request.imageSpec, IMAGE_TYPES.playground.label);
    } catch (error) {
      await fsp.unlink(imagePath).catch(() => {});
      throw error;
    }
    images.push(makeImageRecord(imagePath, "playground", request.prompt, sourceMainId));
  }

  return { imageSet, images };
}

async function saveUploadedMain(req, imageSetId, imageSpec = normalizeImageSpec()) {
  const normalizedSpec = normalizeImageSpec(imageSpec);
  const upload = await readMultipartFile(req, "image");
  const ext = inferUploadedImageExt(upload.data, upload.mime);
  if (!ext) {
    throw new Error("只支持上传 PNG、JPG、WEBP 或 GIF 图片");
  }
  // 上传主图不限制原始尺寸/比例，落盘后统一归一化为当前选定的输出规格。

  const outputDir = resolveImageSetDir(imageSetId);
  await fsp.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const filePath = path.join(outputDir, `uploaded-main-${stamp}.${ext}`);
  await fsp.writeFile(filePath, upload.data);
  await normalizeGeneratedImageFile(filePath, normalizedSpec, "上传主图");
  return makeImageRecord(filePath, "main", `上传主图：${upload.filename}`);
}

async function generateImage({ type, prompt, mainImageId = "", imageSetId = "", imageSpec = {} }) {
  const normalizedSpec = normalizeImageSpec(imageSpec);
  const config = IMAGE_TYPES[type];
  if (!config) {
    throw new Error("未知图片类型");
  }
  const normalizedPrompt = cleanPrompt(prompt);
  if (!normalizedPrompt) {
    throw new Error(`${config.label}提示词不能为空`);
  }

  const outputDir = resolveImageSetDir(imageSetId);
  await fsp.mkdir(outputDir, { recursive: true });
  if (!SKILL_SCRIPT || !fs.existsSync(SKILL_SCRIPT)) {
    throw new Error(
      `找不到生图脚本：${SKILL_SCRIPT || "未配置"}。` +
        "请确认 CUSTOM_IMAGE_SKILL_SCRIPT 或 skills/custom-image-generator/scripts/image_generator.py",
    );
  }

  const apiConfig = await imageConfig.pickEndpoint();
  const args = buildImageGeneratorArgs({
    skillScript: SKILL_SCRIPT,
    prompt: normalizedPrompt,
    endpoint: config.endpoint,
    outputDir,
    filenamePrefix: config.prefix,
    requestSize: normalizedSpec.requestSize,
  });

  let sourceMainId = "";
  if (config.endpoint === "edits") {
    const sourcePath = resolveOutputFile(mainImageId);
    const sourceImageSetId = getImageSetIdFromImageId(mainImageId);
    if (sourceImageSetId && sourceImageSetId !== normalizeImageSetId(imageSetId)) {
      throw new Error("主图不属于当前套图");
    }
    await fsp.access(sourcePath, fs.constants.R_OK);
    sourceMainId = makeImageId(sourcePath);
    args.push("--image", sourcePath);
  }

  const { stdout, stderr } = await runPythonProcess(args, ROOT_DIR, buildImageGeneratorEnv(process.env, apiConfig));
  const imagePath = parseGeneratedImagePath(stdout);
  if (!imagePath) {
    throw new Error(stderr || stdout || "生图完成，但没有找到输出图片路径");
  }
  await fsp.access(imagePath, fs.constants.R_OK);
  try {
    await normalizeGeneratedImageFile(imagePath, normalizedSpec, config.label);
  } catch (error) {
    await fsp.unlink(imagePath).catch(() => {});
    throw error;
  }
  return makeImageRecord(imagePath, type, normalizedPrompt, sourceMainId);
}

function runProcess(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("生图请求超时"));
    }, 210000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `生图进程退出：${code}`));
    });
  });
}

async function runPythonProcess(args, cwd, env = process.env) {
  let lastError = null;
  for (const command of PYTHON_COMMANDS) {
    try {
      return await runProcess(command, args, cwd, env);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("No available Python interpreter found");
}

// 多页面路由：每个菜单一个独立目录（public/pages/<name>/index.html + 各自 JS）。
// 干净 URL → 页面目录的映射。auth: 'user' 需登录，'admin' 需管理员，'guest' 无需登录。
const PAGES_DIR = path.join(PUBLIC_DIR, "pages");
const PAGE_ROUTES = {
  "/login": { dir: "login", auth: "guest" },
  "/register": { dir: "login", auth: "guest" },
  "/config": { dir: "config", auth: "admin" },
  "/studio/hat": { dir: "studio-hat", auth: "user" },
  "/studio/bag": { dir: "studio-bag", auth: "user" },
  "/studio/3d": { dir: "studio-3d", auth: "user" },
  "/prompt": { dir: "prompt", auth: "user" },
  "/playground": { dir: "playground", auth: "user" },
  "/full-playground": { dir: "full-playground", auth: "user" },
  "/account": { dir: "account", auth: "user" },
  "/admin": { dir: "admin", auth: "admin" },
};

async function servePage(req, res, pathname) {
  if (req.method !== "GET") {
    return false;
  }
  // 根路径：登录后进套图工作台，未登录去登录页。
  if (pathname === "/" || pathname === "/index.html") {
    const user = await auth.getSessionUser(req).catch(() => null);
    res.writeHead(302, { Location: user ? "/studio/hat" : "/login" });
    res.end();
    return true;
  }

  const route = PAGE_ROUTES[pathname] || PAGE_ROUTES[pathname.replace(/\/$/, "")];
  if (!route) {
    return false;
  }

  if (route.auth === "user" || route.auth === "admin") {
    const user = await auth.getSessionUser(req).catch(() => null);
    if (!user) {
      res.writeHead(302, { Location: `/login?redirect=${encodeURIComponent(pathname)}` });
      res.end();
      return true;
    }
    if (route.auth === "admin" && user.role !== "admin") {
      res.writeHead(302, { Location: "/studio/hat" });
      res.end();
      return true;
    }
  }

  const dir = path.join(PAGES_DIR, route.dir);
  await serveStaticFromDir(res, dir, "index.html", "index.html");
  return true;
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${safePath}`);
  if (!isPathInside(PUBLIC_DIR, filePath)) {
    sendError(res, 403, "禁止访问");
    return;
  }

  try {
    const data = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch (error) {
    sendError(res, 404, "页面资源不存在");
  }
}

function isPathInside(rootDir, candidatePath) {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative)) || relative === "";
}

async function serveStaticFromDir(res, rootDir, relativePath, fallbackFile = "") {
  const safeRelativePath = relativePath.replace(/^\/+/, "") || "index.html";
  let filePath = path.resolve(rootDir, safeRelativePath);
  if (!isPathInside(rootDir, filePath)) {
    sendError(res, 403, "禁止访问");
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    const data = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch (error) {
    if (fallbackFile) {
      const fallbackPath = path.resolve(rootDir, fallbackFile);
      if (!isPathInside(rootDir, fallbackPath)) {
        sendError(res, 403, "禁止访问");
        return;
      }
      try {
        const data = await fsp.readFile(fallbackPath);
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[path.extname(fallbackPath).toLowerCase()] || "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(data);
        return;
      } catch (fallbackError) {
        sendError(res, 404, "页面资源不存在", fallbackError.message);
        return;
      }
    }
    sendError(res, 404, "页面资源不存在", error.message);
  }
}

async function serveGptImagePlayground(req, res, pathname) {
  if (!fs.existsSync(GPT_IMAGE_PLAYGROUND_DIST_DIR)) {
    sendError(res, 503, "GPT Image Playground 尚未构建", "请先在 vendor/gpt-image-playground 下运行 npm run build");
    return;
  }

  const relativePath = pathname.slice(GPT_IMAGE_PLAYGROUND_BASE_PATH.length);
  await serveStaticFromDir(res, GPT_IMAGE_PLAYGROUND_DIST_DIR, relativePath, "index.html");
}

async function serveImage(req, res, id, attachment) {
  try {
    const filePath = resolveOutputFile(id);
    const data = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-store",
    };
    if (attachment) {
      headers["Content-Disposition"] = `attachment; filename="${path.basename(filePath)}"`;
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch (error) {
    sendError(res, 404, "图片不存在", error.message);
  }
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function makeZipEntryName(id, filePath) {
  const parts = typeof id === "string" ? id.split(/[\\/]/).filter(Boolean) : [];
  if (parts.length === 2 && IMAGE_SET_ID_PATTERN.test(parts[0]) && IMAGE_FILE_PATTERN.test(parts[1])) {
    return `${parts[0]}/${parts[1]}`;
  }
  return path.basename(filePath);
}

async function createZip(ids) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const id of [...new Set(ids)]) {
    const filePath = resolveOutputFile(id);
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      continue;
    }

    const data = await fsp.readFile(filePath);
    const filename = Buffer.from(makeZipEntryName(id, filePath));
    const checksum = crc32(data);
    const { dosDate, dosTime } = dosDateTime(stat.mtime);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(filename.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, filename, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(filename.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, filename);

    offset += localHeader.length + filename.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const localDir = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  const count = centralParts.length / 2;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(localDir.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localDir, centralDir, end]);
}

async function handleApi(req, res, pathname, searchParams) {
  // 账户 / 认证 / 管理员接口优先处理；命中即返回。
  if (await accountApi.handle(req, res, pathname)) {
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/full-playground-proxy/")) {
    const user = await accountApi.requireUser(req, res);
    if (!user) {
      return;
    }
    let apiConfig;
    try {
      apiConfig = await imageConfig.pickEndpoint();
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }

    const proxyPath = normalizeProxyPath(pathname);
    if (!["images/generations", "images/edits"].includes(proxyPath)) {
      sendError(res, 404, "绘图聚集地代理接口不存在");
      return;
    }

    const contentType = req.headers["content-type"] || "";
    let body;
    let requestedCount = 1;
    try {
      body = await readRequestBuffer(req, MAX_PROXY_UPLOAD_BYTES);
      if (contentType.includes("application/json")) {
        const payload = body.length ? JSON.parse(body.toString("utf8")) : {};
        requestedCount = requestedImageCountFromJson(payload);
      } else if (contentType.includes("multipart/form-data")) {
        requestedCount = requestedImageCountFromMultipart(body, contentType);
      }
      await accounts.assertEnoughCredits(user.id, requestedCount);
    } catch (error) {
      const statusCode = error.statusCode || (error.message?.includes("JSON") ? 400 : 402);
      sendError(res, statusCode, error.message || "绘图聚集地请求不合法");
      return;
    }

    let upstreamResponse;
    let responseText = "";
    try {
      upstreamResponse = await fetch(buildApiEndpoint(apiConfig.apiBase, proxyPath), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiConfig.apiKey}`,
          "Content-Type": contentType,
        },
        body,
      });
      responseText = await upstreamResponse.text();
    } catch (error) {
      sendError(res, 502, "绘图聚集地生图请求失败", error.message);
      return;
    }

    const upstreamContentType = upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8";
    if (!upstreamResponse.ok) {
      res.writeHead(upstreamResponse.status, {
        "Content-Type": upstreamContentType,
        "Cache-Control": "no-store",
      });
      res.end(responseText);
      return;
    }

    let payload;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      res.writeHead(200, {
        "Content-Type": upstreamContentType,
        "Cache-Control": "no-store",
      });
      res.end(responseText);
      return;
    }

    const generatedCount = countImagesInApiResponse(payload);
    if (generatedCount > 0) {
      try {
        payload.workbenchCredits = await accounts.consumeCredits(
          user.id,
          generatedCount,
          `绘图聚集地 ${generatedCount} 张`,
        );
      } catch (error) {
        sendError(res, error.statusCode || 402, error.message);
        return;
      }
    } else {
      payload.workbenchCredits = (await accounts.getUserById(user.id))?.credits ?? 0;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      outputDir: OUTPUT_DIR,
      skillScript: SKILL_SCRIPT,
      skillScriptExists: Boolean(SKILL_SCRIPT && fs.existsSync(SKILL_SCRIPT)),
      skillScriptCandidates: SKILL_SCRIPT_CANDIDATES,
      defaultImageSpec: normalizeImageSpec(),
      defaultImageRatio: normalizeImageSpec().ratio,
      imageEndpoints: await imageConfig.countEndpoints(),
      promptApiConfig: await imageConfig.getPromptConfigSummary(),
    });
    return;
  }

  // 读接口：任何登录用户可见（仅返回 uploaded 状态用于启用生成按钮）。
  // 管理员额外拿到脱敏端点列表与调度策略（配置中心用）。
  if (req.method === "GET" && pathname === "/api/image-config") {
    const user = await accountApi.requireUser(req, res);
    if (!user) {
      return;
    }
    const uploaded = (await imageConfig.countEndpoints()) > 0;
    const payload = { ok: true, config: { uploaded } };
    if (user.role === "admin") {
      payload.endpoints = await imageConfig.listEndpointsForDisplay();
      payload.schedule = await imageConfig.getSchedule();
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && pathname === "/api/playground-config") {
    sendJson(res, 200, {
      ok: true,
      config: await getRuntimePlaygroundConfig(),
    });
    return;
  }

  // 写接口：仅管理员。action = add | delete | schedule。
  if (req.method === "POST" && pathname === "/api/image-config") {
    const admin = await accountApi.requireAdmin(req, res);
    if (!admin) {
      return;
    }
    const payload = await readJson(req);
    const action = cleanPrompt(payload.action) || "add";
    try {
      if (action === "delete") {
        await imageConfig.deleteEndpoint(payload.id);
      } else if (action === "schedule") {
        await imageConfig.setSchedule(payload.schedule);
      } else {
        await imageConfig.addEndpoint(payload);
      }
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    sendJson(res, 200, {
      ok: true,
      endpoints: await imageConfig.listEndpointsForDisplay(),
      schedule: await imageConfig.getSchedule(),
      config: { uploaded: (await imageConfig.countEndpoints()) > 0 },
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/prompt-config") {
    const user = await accountApi.requireUser(req, res);
    if (!user) {
      return;
    }
    sendJson(res, 200, {
      ok: true,
      config: await imageConfig.getPromptConfigSummary(),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/prompt-config") {
    const admin = await accountApi.requireAdmin(req, res);
    if (!admin) {
      return;
    }
    const payload = await readJson(req);
    let config;
    try {
      config = await imageConfig.setPromptConfig(payload);
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    sendJson(res, 200, {
      ok: true,
      config,
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/prompts/extract") {
    let apiConfig;
    try {
      apiConfig = await imageConfig.getRequiredPromptConfig();
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }

    try {
      const upload = await readMultipartFile(req, "image");
      const result = await callPromptExtractionApi({ upload, apiConfig });
      sendJson(res, 200, {
        ok: true,
        prompt: result.prompt,
        model: result.model,
      });
    } catch (error) {
      const message = error.message || "提示词提取失败";
      const statusCode =
        message.includes("上传") || message.includes("只支持") || message.includes("没有找到")
          ? 400
          : 502;
      sendError(res, statusCode, "提示词提取失败", message);
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/image-sets") {
    const imageSet = await allocateImageSet();
    sendJson(res, 200, { ok: true, imageSet });
    return;
  }

  if (req.method === "POST" && pathname === "/api/image-sets/reset") {
    const { removedCount, imageSet } = await resetImageSets();
    sendJson(res, 200, { ok: true, removedCount, imageSet });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/images/file/")) {
    const id = decodeURIComponent(pathname.replace("/api/images/file/", ""));
    await serveImage(req, res, id, false);
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/images/download/")) {
    const id = decodeURIComponent(pathname.replace("/api/images/download/", ""));
    await serveImage(req, res, id, true);
    return;
  }

  if (req.method === "POST" && pathname === "/api/images/main") {
    const user = await accountApi.requireUser(req, res);
    if (!user) {
      return;
    }
    const payload = await readJson(req);
    try {
      await imageConfig.assertConfigured();
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    if (!cleanPrompt(payload.prompt)) {
      sendError(res, 400, "主图提示词不能为空");
      return;
    }
    try {
      await accounts.assertEnoughCredits(user.id, 1);
    } catch (error) {
      sendError(res, error.statusCode || 402, error.message);
      return;
    }
    const image = await generateImage({
      type: "main",
      prompt: payload.prompt,
      imageSetId: payload.imageSetId,
      imageSpec: payload.imageSpec,
    });
    const balance = await accounts.consumeCredits(user.id, 1, "生成主图");
    sendJson(res, 200, { ok: true, image, credits: balance });
    return;
  }

  if (req.method === "POST" && pathname === "/api/images/main/upload") {
    const user = await accountApi.requireUser(req, res);
    if (!user) {
      return;
    }
    const image = await saveUploadedMain(
      req,
      searchParams.get("imageSetId"),
      imageSpecFromSearchParams(searchParams),
    );
    sendJson(res, 200, { ok: true, image });
    return;
  }

  if (req.method === "POST" && pathname === "/api/images/derived") {
    const user = await accountApi.requireUser(req, res);
    if (!user) {
      return;
    }
    const payload = await readJson(req);
    try {
      await imageConfig.assertConfigured();
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    if (!DERIVED_TYPES.includes(payload.type)) {
      sendError(res, 400, "未知衍生图类型");
      return;
    }
    if (!cleanPrompt(payload.prompt)) {
      sendError(res, 400, `${IMAGE_TYPES[payload.type].label}提示词不能为空`);
      return;
    }
    try {
      await accounts.assertEnoughCredits(user.id, 1);
    } catch (error) {
      sendError(res, error.statusCode || 402, error.message);
      return;
    }
    const image = await generateImage({
      type: payload.type,
      prompt: payload.prompt,
      mainImageId: payload.mainImageId,
      imageSetId: payload.imageSetId,
      imageSpec: payload.imageSpec,
    });
    const balance = await accounts.consumeCredits(user.id, 1, `生成${IMAGE_TYPES[payload.type].label}`);
    sendJson(res, 200, { ok: true, image, credits: balance });
    return;
  }

  if (req.method === "POST" && pathname === "/api/images/derived/batch") {
    const user = await accountApi.requireUser(req, res);
    if (!user) {
      return;
    }
    const payload = await readJson(req);
    try {
      await imageConfig.assertConfigured();
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    let batchTypes;
    try {
      batchTypes = getBatchDerivedTypes(payload.types);
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    // 批量按「成功生成张数」扣费，失败不扣。发起前要求余额至少能覆盖全部张数。
    try {
      await accounts.assertEnoughCredits(user.id, batchTypes.length);
    } catch (error) {
      sendError(res, error.statusCode || 402, error.message);
      return;
    }
    const tasks = batchTypes.map(async (type) => {
      try {
        const image = await generateImage({
          type,
          prompt: payload.prompts?.[type],
          mainImageId: payload.mainImageId,
          imageSetId: payload.imageSetId,
          imageSpec: payload.imageSpec,
        });
        return [type, { image }];
      } catch (error) {
        return [type, { error: error.message }];
      }
    });
    const entries = await Promise.all(tasks);
    const results = {};
    const errors = {};
    for (const [type, value] of entries) {
      if (value.image) {
        results[type] = value.image;
      } else {
        errors[type] = value.error || "生成失败";
      }
    }
    const successCount = Object.keys(results).length;
    let balance;
    if (successCount > 0) {
      balance = await accounts.consumeCredits(user.id, successCount, `批量生成 ${successCount} 张衍生图`);
    } else {
      balance = (await accounts.getUserById(user.id))?.credits ?? 0;
    }
    sendJson(res, 200, {
      ok: Object.keys(errors).length === 0,
      results,
      errors,
      credits: balance,
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/playground/images") {
    const user = await accountApi.requireUser(req, res);
    if (!user) {
      return;
    }
    const payload = await readJson(req);
    try {
      await imageConfig.assertConfigured();
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    try {
      const requestedCount = clampInteger(payload.count, 1, 1, PLAYGROUND_IMAGE_COUNT_MAX);
      await accounts.assertEnoughCredits(user.id, requestedCount);
      const result = await generatePlaygroundImages(payload);
      const generated = result.images.length;
      let balance;
      if (generated > 0) {
        balance = await accounts.consumeCredits(user.id, generated, `自由生图 ${generated} 张`);
      } else {
        balance = (await accounts.getUserById(user.id))?.credits ?? 0;
      }
      sendJson(res, 200, {
        ok: true,
        imageSet: result.imageSet,
        images: result.images,
        credits: balance,
      });
    } catch (error) {
      if (error.statusCode === 402 || error.statusCode === 404) {
        sendError(res, error.statusCode, error.message);
        return;
      }
      const message = error.message || "自由生图失败";
      const statusCode =
        message.includes("提示词") || message.includes("参考图") || message.includes("不存在")
          ? 400
          : 502;
      sendError(res, statusCode, "自由生图失败", message);
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/images/download-all") {
    const payload = await readJson(req);
    const ids = Array.isArray(payload.ids) ? payload.ids : [];
    if (!ids.length) {
      sendError(res, 400, "没有可下载的图片");
      return;
    }
    const zip = await createZip(ids);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
    const imageSetId = normalizeImageSetId(payload.imageSetId || getImageSetIdFromImageId(ids[0]));
    const downloadName = imageSetId
      ? `product-images-${imageSetId}.zip`
      : `product-images-${stamp}.zip`;
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": zip.length,
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Cache-Control": "no-store",
    });
    res.end(zip);
    return;
  }

  sendError(res, 404, "接口不存在");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname, url.searchParams);
      return;
    }
    if (url.pathname === GPT_IMAGE_PLAYGROUND_BASE_PATH.slice(0, -1)) {
      res.writeHead(302, { Location: GPT_IMAGE_PLAYGROUND_BASE_PATH });
      res.end();
      return;
    }
    if (url.pathname.startsWith(GPT_IMAGE_PLAYGROUND_BASE_PATH)) {
      await serveGptImagePlayground(req, res, url.pathname);
      return;
    }
    if (await servePage(req, res, url.pathname)) {
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    sendError(res, 500, error.message || "服务处理失败");
  }
});

if (require.main === module) {
  db.init()
    .then(() =>
      // 生图端点/提示词表建好；DB 为空时把 .env 里的旧值一次性迁进来，之后完全走 DB。
      imageConfig.init({
        imageBase: FIXED_IMAGE_API_BASE,
        imageKey: resolveImageApiKey(),
        promptBase: resolvePromptApiBase(),
        promptKey: resolvePromptApiKey(),
        promptModel: getPromptExtractModel(),
      }),
    )
    .then(() => {
      server.listen(PORT, HOST, () => {
        console.log(`商品图片设计工作台已启动：http://${HOST}:${PORT}`);
      });
    })
    .catch((error) => {
      console.error("数据库初始化失败，请检查 .env 中的 DB_* 配置与 MySQL 服务：");
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = {
  PREFERRED_IMAGE_HEIGHT,
  PREFERRED_IMAGE_SIZE,
  PREFERRED_IMAGE_WIDTH,
  GPT_IMAGE_PLAYGROUND_BASE_PATH,
  GPT_IMAGE_PLAYGROUND_DIST_DIR,
  assertImageSpecDimensions,
  buildApiEndpoint,
  buildImageGeneratorArgs,
  buildImageGeneratorEnv,
  buildPromptExtractionRequest,
  callPromptExtractionApi,
  clearOutputDirContents,
  countImagesInApiResponse,
  describeImageSpec,
  getBatchDerivedTypes,
  getDerivedImageTypes,
  getImageTypeConfig,
  getImageNormalizerCommands,
  getImageNormalizationPlan,
  normalizeImageSpec,
  normalizePlaygroundRequest,
  parseGeneratedImagePaths,
  requestedImageCountFromJson,
  normalizeGeneratedImageFile,
  parsePromptExtractionResponse,
  readImageDimensions,
};
