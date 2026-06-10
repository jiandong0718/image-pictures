const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT_DIR = __dirname;
const PROJECT_ROOT_DIR = path.resolve(ROOT_DIR, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
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
const REQUIRED_IMAGE_RATIO = "1:1";
const IMAGE_SPEC_MODES = new Set(["square", "fixed"]);
const MIN_IMAGE_SPEC_SIZE = 256;
const MAX_IMAGE_SPEC_SIZE = 4096;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const UPLOAD_MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const IMAGE_TYPES = {
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
    label: "肩带部位图",
    prefix: "shoulder-bag-strap",
    endpoint: "edits",
  },
  shoulderBagBody: {
    label: "包身部位图",
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
const DERIVED_TYPES = Object.keys(IMAGE_TYPES).filter((type) => type !== "main");
const IMAGE_SET_ID_PATTERN = /^\d{3,}$/;
const IMAGE_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp|gif)$/i;
let imageSetAllocationQueue = Promise.resolve();

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
  const mode = IMAGE_SPEC_MODES.has(rawSpec?.mode) ? rawSpec.mode : "square";
  const parsedSize = Number(rawSpec?.size);
  const size = Number.isInteger(parsedSize)
    ? Math.min(Math.max(parsedSize, MIN_IMAGE_SPEC_SIZE), MAX_IMAGE_SPEC_SIZE)
    : PREFERRED_IMAGE_WIDTH;
  return {
    mode,
    size,
    requestSize: `${size}x${size}`,
    ratio: REQUIRED_IMAGE_RATIO,
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
  return normalized.mode === "fixed"
    ? `${normalized.size}x${normalized.size}（${REQUIRED_IMAGE_RATIO}）`
    : `${REQUIRED_IMAGE_RATIO} 方图`;
}

function imageSpecFromSearchParams(searchParams) {
  return normalizeImageSpec({
    mode: searchParams.get("imageSpecMode"),
    size: searchParams.get("imageSpecSize"),
  });
}

function assertImageSpecDimensions(data, spec = normalizeImageSpec(), label = "图片") {
  const normalized = normalizeImageSpec(spec);
  const dimensions = readImageDimensions(data);
  if (!dimensions) {
    throw new Error(`${label}无法读取图片尺寸，请使用 PNG、JPG、WEBP 或 GIF 图片`);
  }
  if (dimensions.width !== dimensions.height) {
    throw new Error(`${label}必须是 ${REQUIRED_IMAGE_RATIO} 方图，当前是 ${dimensions.width}x${dimensions.height}`);
  }
  if (
    normalized.mode === "fixed" &&
    (dimensions.width !== normalized.size || dimensions.height !== normalized.size)
  ) {
    throw new Error(
      `${label}尺寸必须是 ${normalized.size}x${normalized.size}（${REQUIRED_IMAGE_RATIO}），` +
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
      cropSize: 0,
      targetWidth: 0,
      targetHeight: 0,
    };
  }
  const needsCrop = dimensions.width !== dimensions.height;
  const squareSize = needsCrop ? Math.min(dimensions.width, dimensions.height) : dimensions.width;
  const needsResize = normalized.mode === "fixed" && squareSize !== normalized.size;
  return {
    needsNormalization: needsCrop || needsResize,
    cropSize: needsCrop ? Math.min(dimensions.width, dimensions.height) : 0,
    targetWidth: needsResize ? normalized.size : 0,
    targetHeight: needsResize ? normalized.size : 0,
  };
}

function getImageNormalizerCommands(command, plan, filePath) {
  const commandName = path.basename(command).toLowerCase();
  const commands = [];
  const isImageMagick = commandName === "convert" || commandName === "magick";

  if (plan.cropSize) {
    if (isImageMagick) {
      commands.push({
        command,
        args: [
          filePath,
          "-gravity",
          "center",
          "-crop",
          `${plan.cropSize}x${plan.cropSize}+0+0`,
          "+repage",
          filePath,
        ],
      });
    } else {
      commands.push({
        command,
        args: ["--cropToHeightWidth", String(plan.cropSize), String(plan.cropSize), filePath],
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

function makeImageRecord(filePath, type, prompt, sourceMainId = "") {
  const id = makeImageId(filePath);
  const filename = path.basename(filePath);
  const imageSetId = getImageSetIdFromImageId(id);
  return {
    id,
    type,
    label: IMAGE_TYPES[type].label,
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

async function saveUploadedMain(req, imageSetId, imageSpec = normalizeImageSpec()) {
  const normalizedSpec = normalizeImageSpec(imageSpec);
  const upload = await readMultipartFile(req, "image");
  const ext = inferUploadedImageExt(upload.data, upload.mime);
  if (!ext) {
    throw new Error("只支持上传 PNG、JPG、WEBP 或 GIF 图片");
  }
  // 上传主图不限制尺寸/比例，落盘后再归一化为 1:1，保证生成阶段为方图。

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

  const args = [
    SKILL_SCRIPT,
    normalizedPrompt,
    "--endpoint",
    config.endpoint,
    "--output-dir",
    outputDir,
    "--filename-prefix",
    config.prefix,
    "--n",
    "1",
    "--size",
    normalizedSpec.requestSize,
    "--timeout",
    "180",
  ];

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

  const { stdout, stderr } = await runPythonProcess(args, ROOT_DIR);
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

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
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

async function runPythonProcess(args, cwd) {
  let lastError = null;
  for (const command of PYTHON_COMMANDS) {
    try {
      return await runProcess(command, args, cwd);
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

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${safePath}`);
  if (!filePath.startsWith(path.resolve(PUBLIC_DIR))) {
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
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      outputDir: OUTPUT_DIR,
      skillScript: SKILL_SCRIPT,
      skillScriptExists: Boolean(SKILL_SCRIPT && fs.existsSync(SKILL_SCRIPT)),
      skillScriptCandidates: SKILL_SCRIPT_CANDIDATES,
      defaultImageSpec: normalizeImageSpec(),
      requiredImageRatio: REQUIRED_IMAGE_RATIO,
    });
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
    const payload = await readJson(req);
    if (!cleanPrompt(payload.prompt)) {
      sendError(res, 400, "主图提示词不能为空");
      return;
    }
    const image = await generateImage({
      type: "main",
      prompt: payload.prompt,
      imageSetId: payload.imageSetId,
      imageSpec: payload.imageSpec,
    });
    sendJson(res, 200, { ok: true, image });
    return;
  }

  if (req.method === "POST" && pathname === "/api/images/main/upload") {
    const image = await saveUploadedMain(
      req,
      searchParams.get("imageSetId"),
      imageSpecFromSearchParams(searchParams),
    );
    sendJson(res, 200, { ok: true, image });
    return;
  }

  if (req.method === "POST" && pathname === "/api/images/derived") {
    const payload = await readJson(req);
    if (!DERIVED_TYPES.includes(payload.type)) {
      sendError(res, 400, "未知衍生图类型");
      return;
    }
    if (!cleanPrompt(payload.prompt)) {
      sendError(res, 400, `${IMAGE_TYPES[payload.type].label}提示词不能为空`);
      return;
    }
    const image = await generateImage({
      type: payload.type,
      prompt: payload.prompt,
      mainImageId: payload.mainImageId,
      imageSetId: payload.imageSetId,
      imageSpec: payload.imageSpec,
    });
    sendJson(res, 200, { ok: true, image });
    return;
  }

  if (req.method === "POST" && pathname === "/api/images/derived/batch") {
    const payload = await readJson(req);
    let batchTypes;
    try {
      batchTypes = getBatchDerivedTypes(payload.types);
    } catch (error) {
      sendError(res, 400, error.message);
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
    sendJson(res, 200, {
      ok: Object.keys(errors).length === 0,
      results,
      errors,
    });
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
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    sendError(res, 500, error.message || "服务处理失败");
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`商品图片设计工作台已启动：http://${HOST}:${PORT}`);
  });
}

module.exports = {
  PREFERRED_IMAGE_HEIGHT,
  PREFERRED_IMAGE_SIZE,
  PREFERRED_IMAGE_WIDTH,
  REQUIRED_IMAGE_RATIO,
  assertImageSpecDimensions,
  clearOutputDirContents,
  describeImageSpec,
  getBatchDerivedTypes,
  getDerivedImageTypes,
  getImageTypeConfig,
  getImageNormalizerCommands,
  getImageNormalizationPlan,
  normalizeImageSpec,
  normalizeGeneratedImageFile,
  readImageDimensions,
};
