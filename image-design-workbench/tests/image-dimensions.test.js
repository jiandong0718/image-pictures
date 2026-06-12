const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertImageSpecDimensions,
  buildApiEndpoint,
  buildImageGeneratorArgs,
  buildImageGeneratorEnv,
  buildPromptExtractionRequest,
  callPromptExtractionApi,
  clearRuntimeImageApiConfig,
  clearRuntimePromptApiConfig,
  clearOutputDirContents,
  getBatchDerivedTypes,
  getDerivedImageTypes,
  getImageTypeConfig,
  getImageNormalizerCommands,
  getImageNormalizationPlan,
  getRequiredRuntimeImageApiConfig,
  getRequiredRuntimePromptApiConfig,
  getRuntimeImageApiConfigSummary,
  getRuntimePromptApiConfigSummary,
  normalizeImageApiConfig,
  normalizeImageSpec,
  normalizePromptApiConfig,
  parsePromptExtractionResponse,
  readImageDimensions,
  setRuntimeImageApiConfig,
  setRuntimePromptApiConfig,
} = require("../server");

function makePng(width, height) {
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function makeGif(width, height) {
  const data = Buffer.alloc(10);
  data.write("GIF89a", 0, "ascii");
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return data;
}

function makeJpeg(width, height) {
  const data = Buffer.alloc(23);
  data[0] = 0xff;
  data[1] = 0xd8;
  data[2] = 0xff;
  data[3] = 0xc0;
  data.writeUInt16BE(17, 4);
  data[6] = 8;
  data.writeUInt16BE(height, 7);
  data.writeUInt16BE(width, 9);
  return data;
}

test("reads image dimensions from supported headers", () => {
  assert.deepEqual(readImageDimensions(makePng(1024, 1024)), { width: 1024, height: 1024 });
  assert.deepEqual(readImageDimensions(makeGif(800, 600)), { width: 800, height: 600 });
  assert.deepEqual(readImageDimensions(makeJpeg(1200, 900)), { width: 1200, height: 900 });
});

test("accepts any square image in square mode", () => {
  assert.doesNotThrow(() => assertImageSpecDimensions(makePng(1024, 1024)));
  assert.doesNotThrow(() => assertImageSpecDimensions(makePng(1254, 1254)));
  assert.throws(
    () => assertImageSpecDimensions(makePng(1024, 768), undefined, "测试图片"),
    /测试图片必须是 1:1 方图/,
  );
});

test("optionally enforces fixed square size", () => {
  const fixedSpec = normalizeImageSpec({ mode: "fixed", size: 1024 });
  assert.doesNotThrow(() => assertImageSpecDimensions(makePng(1024, 1024), fixedSpec));
  assert.throws(
    () => assertImageSpecDimensions(makePng(1254, 1254), fixedSpec, "测试图片"),
    /测试图片尺寸必须是 1024x1024/,
  );
});

test("rejects unreadable image dimensions", () => {
  assert.equal(readImageDimensions(Buffer.from("not an image")), null);
  assert.throws(
    () => assertImageSpecDimensions(Buffer.from("not an image"), undefined, "测试图片"),
    /无法读取图片尺寸/,
  );
});

test("plans generated image normalization for square mode", () => {
  assert.deepEqual(getImageNormalizationPlan({ width: 1024, height: 1024 }), {
    needsNormalization: false,
    cropSize: 0,
    targetWidth: 0,
    targetHeight: 0,
  });
  assert.deepEqual(getImageNormalizationPlan({ width: 1254, height: 1254 }), {
    needsNormalization: false,
    cropSize: 0,
    targetWidth: 0,
    targetHeight: 0,
  });
  assert.deepEqual(getImageNormalizationPlan({ width: 1400, height: 1000 }), {
    needsNormalization: true,
    cropSize: 1000,
    targetWidth: 0,
    targetHeight: 0,
  });
});

test("plans generated image normalization for fixed mode", () => {
  const fixedSpec = normalizeImageSpec({ mode: "fixed", size: 1024 });
  assert.deepEqual(getImageNormalizationPlan({ width: 1254, height: 1254 }, fixedSpec), {
    needsNormalization: true,
    cropSize: 0,
    targetWidth: 1024,
    targetHeight: 1024,
  });
  assert.deepEqual(getImageNormalizationPlan({ width: 1400, height: 1000 }, fixedSpec), {
    needsNormalization: true,
    cropSize: 1000,
    targetWidth: 1024,
    targetHeight: 1024,
  });
});

test("builds ImageMagick normalization commands for Linux", () => {
  const commands = getImageNormalizerCommands(
    "convert",
    {
      needsNormalization: true,
      cropSize: 1000,
      targetWidth: 1024,
      targetHeight: 1024,
    },
    "/tmp/product.png",
  );

  assert.deepEqual(commands, [
    {
      command: "convert",
      args: ["/tmp/product.png", "-gravity", "center", "-crop", "1000x1000+0+0", "+repage", "/tmp/product.png"],
    },
    {
      command: "convert",
      args: ["/tmp/product.png", "-resize", "1024x1024!", "/tmp/product.png"],
    },
  ]);
});

test("supports product-specific derived image types without changing the default hat batch set", () => {
  assert.equal(getImageTypeConfig("derived").label, "衍生图");
  assert.equal(getImageTypeConfig("derived").endpoint, "edits");
  assert.equal(getImageTypeConfig("shoulderBagStrap").label, "肩带部位图");
  assert.equal(getImageTypeConfig("shoulderBagStrap").prefix, "shoulder-bag-strap");
  assert.equal(getImageTypeConfig("shoulderBagBody").label, "包身部位图");
  assert.equal(getImageTypeConfig("shoulderBagBody").endpoint, "edits");
  assert.ok(getDerivedImageTypes().includes("derived"));
  assert.ok(getDerivedImageTypes().includes("shoulderBagStrap"));
  assert.ok(getDerivedImageTypes().includes("shoulderBagBody"));
  assert.deepEqual(getBatchDerivedTypes(), [
    "whiteBackground",
    "dimensions",
    "detail",
    "worn",
    "scene",
    "sellingPoints",
  ]);
  assert.deepEqual(getBatchDerivedTypes(["shoulderBagStrap", "shoulderBagBody"]), [
    "shoulderBagStrap",
    "shoulderBagBody",
  ]);
  assert.throws(() => getBatchDerivedTypes(["shoulderBagStrap", "unknown"]), /未知衍生图类型/);
});

test("requires uploaded runtime image API config", () => {
  clearRuntimeImageApiConfig();

  assert.deepEqual(getRuntimeImageApiConfigSummary(), {
    uploaded: false,
    hasApiKey: false,
    uploadedAt: "",
  });
  assert.throws(() => getRequiredRuntimeImageApiConfig(), /请先在页面保存 API 配置/);
});

test("normalizes runtime image API config without exposing the key in summaries", () => {
  clearRuntimeImageApiConfig();

  const summary = setRuntimeImageApiConfig({
    apiKey: " secret-key ",
  });

  assert.equal(summary.uploaded, true);
  assert.equal(summary.hasApiKey, true);
  assert.equal(typeof summary.uploadedAt, "string");
  assert.equal(Object.hasOwn(summary, "apiBase"), false);
  assert.equal(Object.hasOwn(summary, "apiKey"), false);
  const runtimeConfig = getRequiredRuntimeImageApiConfig();
  assert.equal(typeof runtimeConfig.apiBase, "string");
  assert.ok(runtimeConfig.apiBase.startsWith("https://"));
  assert.equal(runtimeConfig.apiKey, "secret-key");
  assert.equal(runtimeConfig.uploadedAt, summary.uploadedAt);
});

test("rejects invalid runtime image API config", () => {
  assert.throws(() => normalizeImageApiConfig({ apiKey: "" }), /API Key 不能为空/);
  assert.throws(() => normalizeImageApiConfig({}), /API Key 不能为空/);
});

test("normalizes prompt extraction API config separately from image config", () => {
  clearRuntimePromptApiConfig();

  assert.deepEqual(getRuntimePromptApiConfigSummary(), {
    uploaded: false,
    apiBase: "",
    model: "gpt-4o-mini",
    hasApiKey: false,
    uploadedAt: "",
  });
  assert.throws(() => getRequiredRuntimePromptApiConfig(), /请先在配置中心保存提示词 API 配置/);

  const summary = setRuntimePromptApiConfig({
    apiBase: " https://prompt.unit.test/v1/ ",
    apiKey: " prompt-key ",
    model: " vision-unit-model ",
  });

  assert.equal(summary.uploaded, true);
  assert.equal(summary.apiBase, "https://prompt.unit.test/v1");
  assert.equal(summary.model, "vision-unit-model");
  assert.equal(summary.hasApiKey, true);
  assert.equal(Object.hasOwn(summary, "apiKey"), false);
  const runtimeConfig = getRequiredRuntimePromptApiConfig();
  assert.equal(runtimeConfig.apiBase, "https://prompt.unit.test/v1");
  assert.equal(runtimeConfig.apiKey, "prompt-key");
  assert.equal(runtimeConfig.model, "vision-unit-model");
});

test("rejects invalid prompt extraction API config", () => {
  assert.throws(
    () => normalizePromptApiConfig({ apiBase: "", apiKey: "prompt-key" }),
    /提示词 API URL 不能为空/,
  );
  assert.throws(
    () => normalizePromptApiConfig({ apiBase: "not-a-url", apiKey: "prompt-key" }),
    /提示词 API URL 格式不正确/,
  );
  assert.throws(
    () => normalizePromptApiConfig({ apiBase: "ftp://prompt.unit.test/v1", apiKey: "prompt-key" }),
    /提示词 API URL 必须以 http:\/\/ 或 https:\/\//,
  );
  assert.throws(
    () => normalizePromptApiConfig({ apiBase: "https://prompt.unit.test/v1", apiKey: "" }),
    /提示词 API Key 不能为空/,
  );
});

test("injects uploaded API config through process env instead of command args", () => {
  const args = buildImageGeneratorArgs({
    skillScript: "/workspace/image_generator.py",
    prompt: "测试提示词",
    endpoint: "generations",
    outputDir: "/tmp/images",
    filenamePrefix: "main",
    requestSize: "1024x1024",
  });
  const env = buildImageGeneratorEnv(
    { PATH: "/bin", CUSTOM_IMAGE_API_BASE: "https://env.example/v1", CUSTOM_IMAGE_API_KEY: "env-key" },
    { apiBase: "https://unit.test/v1", apiKey: "uploaded-key" },
  );

  assert.equal(args.includes("--api-key"), false);
  assert.equal(args.includes("uploaded-key"), false);
  assert.deepEqual(args, [
    "/workspace/image_generator.py",
    "测试提示词",
    "--endpoint",
    "generations",
    "--output-dir",
    "/tmp/images",
    "--filename-prefix",
    "main",
    "--n",
    "1",
    "--size",
    "1024x1024",
    "--timeout",
    "180",
  ]);
  assert.equal(env.CUSTOM_IMAGE_API_BASE, "https://unit.test/v1");
  assert.equal(env.CUSTOM_IMAGE_API_KEY, "uploaded-key");
  assert.equal(env.PATH, "/bin");
});

test("builds prompt extraction payload without API secrets", () => {
  const payload = buildPromptExtractionRequest({
    imageData: Buffer.from("image-bytes"),
    mime: "image/png",
    model: "vision-unit-model",
  });
  const serialized = JSON.stringify(payload);

  assert.equal(payload.model, "vision-unit-model");
  assert.equal(payload.messages[0].role, "user");
  assert.match(payload.messages[0].content[0].text, /详细提示词/);
  assert.equal(
    payload.messages[0].content[1].image_url.url,
    "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
  );
  assert.equal(serialized.includes("uploaded-key"), false);
  assert.equal(serialized.includes("https://unit.test/v1"), false);
});

test("parses prompt extraction responses from compatible response shapes", () => {
  assert.equal(
    parsePromptExtractionResponse({
      choices: [{ message: { content: "  详细中文提示词  " } }],
    }),
    "详细中文提示词",
  );
  assert.equal(
    parsePromptExtractionResponse({
      choices: [{ message: { content: [{ type: "text", text: "分段提示词" }] } }],
    }),
    "分段提示词",
  );
  assert.equal(parsePromptExtractionResponse({ output_text: "响应式提示词" }), "响应式提示词");
  assert.throws(() => parsePromptExtractionResponse({ choices: [] }), /API 未返回提示词内容/);
});

test("calls prompt extraction API with Authorization header only", async () => {
  let capturedUrl = "";
  let capturedRequest = null;
  const fetchImpl = async (url, request) => {
    capturedUrl = url;
    capturedRequest = request;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "商品图详细提示词" } }] }),
    };
  };

  const result = await callPromptExtractionApi({
    upload: {
      filename: "product.png",
      mime: "image/png",
      data: makePng(32, 32),
    },
    apiConfig: { apiBase: "https://unit.test/v1", apiKey: "uploaded-key", model: "vision-unit-model" },
    fetchImpl,
  });
  const body = JSON.parse(capturedRequest.body);

  assert.equal(capturedUrl, buildApiEndpoint("https://unit.test/v1", "chat/completions"));
  assert.equal(capturedRequest.headers.Authorization, "Bearer uploaded-key");
  assert.equal(body.model, "vision-unit-model");
  assert.equal(JSON.stringify(body).includes("uploaded-key"), false);
  assert.match(body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(result.prompt, "商品图详细提示词");
});

test("rejects unsupported prompt extraction uploads before calling the API", async () => {
  let called = false;
  await assert.rejects(
    () =>
      callPromptExtractionApi({
        upload: {
          filename: "notes.txt",
          mime: "text/plain",
          data: Buffer.from("not an image"),
        },
        apiConfig: { apiBase: "https://unit.test/v1", apiKey: "uploaded-key" },
        fetchImpl: async () => {
          called = true;
        },
      }),
    /只支持上传 PNG、JPG、WEBP 或 GIF 图片/,
  );
  assert.equal(called, false);
});

test("clears generated output contents while keeping the output directory", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "image-output-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const outputDir = path.join(tempDir, "product-design");
  await fs.mkdir(path.join(outputDir, "001"), { recursive: true });
  await fs.writeFile(path.join(outputDir, "001", "main.png"), "image");
  await fs.writeFile(path.join(outputDir, "loose.txt"), "cache");

  const removed = await clearOutputDirContents(outputDir);

  assert.equal(removed, 2);
  assert.deepEqual(await fs.readdir(outputDir), []);
});
