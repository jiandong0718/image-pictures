const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  GPT_IMAGE_PLAYGROUND_BASE_PATH,
  GPT_IMAGE_PLAYGROUND_DIST_DIR,
  applyEndpointModel,
  absolutizePlaygroundTaskResult,
  getPublicRequestOrigin,
  assertImageSpecDimensions,
  buildApiEndpoint,
  buildImageGeneratorArgs,
  buildImageGeneratorEnv,
  buildPromptExtractionRequest,
  callPromptExtractionApi,
  clearOutputDirContents,
  collectProxyImageSources,
  countImagesInApiResponse,
  getBatchDerivedTypes,
  getDerivedImageTypes,
  getImageTypeConfig,
  getImageNormalizerCommands,
  getImageNormalizationPlan,
  normalizeImageSpec,
  normalizePlaygroundRequest,
  parseGeneratedImagePaths,
  parsePromptExtractionResponse,
  requestedImageCountFromJson,
  isRetryablePlaygroundStatus,
  readImageDimensions,
} = require("../server");

// 生图端点 / 提示词配置的纯逻辑（不依赖 DB）。
const {
  normalizeApiBase,
  normalizeEndpointInput,
  maskKey,
  normalizeSchedule,
  selectEndpoint,
} = require("../lib/image-config");

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

test("exposes built GPT Image Playground under a stable subpath", async () => {
  assert.equal(GPT_IMAGE_PLAYGROUND_BASE_PATH, "/gpt-image-playground/");
  const indexPath = path.join(GPT_IMAGE_PLAYGROUND_DIST_DIR, "index.html");
  const indexHtml = await fs.readFile(indexPath, "utf8");
  assert.match(indexHtml, /<div id="root"><\/div>/);
});

test("enforces default output spec dimensions exactly", () => {
  assert.doesNotThrow(() => assertImageSpecDimensions(makePng(1024, 1024)));
  assert.throws(
    () => assertImageSpecDimensions(makePng(1254, 1254), undefined, "测试图片"),
    /测试图片尺寸必须是 1024x1024（1:1）/,
  );
  assert.throws(
    () => assertImageSpecDimensions(makePng(1024, 768), undefined, "测试图片"),
    /测试图片尺寸必须是 1024x1024（1:1）/,
  );
});

test("rejects unreadable image dimensions", () => {
  assert.equal(readImageDimensions(Buffer.from("not an image")), null);
  assert.throws(
    () => assertImageSpecDimensions(Buffer.from("not an image"), undefined, "测试图片"),
    /无法读取图片尺寸/,
  );
});

test("supports preset and custom image specs", () => {
  const widescreenSpec = normalizeImageSpec({ sizePreset: "2k", ratioPreset: "16:9" });
  assert.equal(widescreenSpec.width, 2048);
  assert.equal(widescreenSpec.height, 1152);
  assert.equal(widescreenSpec.requestSize, "2048x1152");
  assert.equal(widescreenSpec.ratio, "16:9");

  const customSpec = normalizeImageSpec({
    sizeMode: "custom",
    customSize: 1500,
    ratioPreset: "custom",
    customRatioWidth: 3,
    customRatioHeight: 5,
  });
  assert.equal(customSpec.width, 900);
  assert.equal(customSpec.height, 1500);
  assert.equal(customSpec.requestSize, "900x1500");
  assert.equal(customSpec.ratio, "3:5");
});

test("plans generated image normalization for the default square preset", () => {
  assert.deepEqual(getImageNormalizationPlan({ width: 1024, height: 1024 }), {
    needsNormalization: false,
    cropWidth: 0,
    cropHeight: 0,
    targetWidth: 0,
    targetHeight: 0,
  });
  assert.deepEqual(getImageNormalizationPlan({ width: 1254, height: 1254 }), {
    needsNormalization: true,
    cropWidth: 0,
    cropHeight: 0,
    targetWidth: 1024,
    targetHeight: 1024,
  });
  assert.deepEqual(getImageNormalizationPlan({ width: 1400, height: 1000 }), {
    needsNormalization: true,
    cropWidth: 1000,
    cropHeight: 1000,
    targetWidth: 1024,
    targetHeight: 1024,
  });
});

test("plans generated image normalization for non-square presets", () => {
  const widescreenSpec = normalizeImageSpec({ sizePreset: "2k", ratioPreset: "16:9" });
  assert.deepEqual(getImageNormalizationPlan({ width: 2048, height: 1152 }, widescreenSpec), {
    needsNormalization: false,
    cropWidth: 0,
    cropHeight: 0,
    targetWidth: 0,
    targetHeight: 0,
  });
  assert.deepEqual(getImageNormalizationPlan({ width: 3200, height: 2000 }, widescreenSpec), {
    needsNormalization: true,
    cropWidth: 3200,
    cropHeight: 1800,
    targetWidth: 2048,
    targetHeight: 1152,
  });
});

test("builds ImageMagick normalization commands for Linux", () => {
  const commands = getImageNormalizerCommands(
    "convert",
    {
      needsNormalization: true,
      cropWidth: 3200,
      cropHeight: 1800,
      targetWidth: 2048,
      targetHeight: 1152,
    },
    "/tmp/product.png",
  );

  assert.deepEqual(commands, [
    {
      command: "convert",
      args: ["/tmp/product.png", "-gravity", "center", "-crop", "3200x1800+0+0", "+repage", "/tmp/product.png"],
    },
    {
      command: "convert",
      args: ["/tmp/product.png", "-resize", "2048x1152!", "/tmp/product.png"],
    },
  ]);
});

test("supports product-specific derived image types without changing the default hat batch set", () => {
  assert.equal(getImageTypeConfig("derived").label, "衍生图");
  assert.equal(getImageTypeConfig("derived").endpoint, "edits");
  assert.equal(getImageTypeConfig("shoulderBagStrap").label, "部位1图");
  assert.equal(getImageTypeConfig("shoulderBagStrap").prefix, "shoulder-bag-strap");
  assert.equal(getImageTypeConfig("shoulderBagBody").label, "部位2图");
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

test("normalizes playground requests with bounded count and image spec", () => {
  assert.deepEqual(
    normalizePlaygroundRequest({
      prompt: "  生成一张商品图  ",
      count: 9,
      imageSpec: { mode: "fixed", size: 1200 },
    }),
    {
      mode: "generate",
      prompt: "生成一张商品图",
      count: 4,
      background: "",
      system: "",
      imageSpec: {
        sizeMode: "custom",
        sizePreset: "1k",
        customSize: 1200,
        ratioPreset: "1:1",
        customRatioWidth: 1,
        customRatioHeight: 1,
        size: 1200,
        width: 1200,
        height: 1200,
        requestSize: "1200x1200",
        ratio: "1:1",
      },
      referenceImageId: "",
      endpointId: "",
    },
  );
  assert.deepEqual(
    normalizePlaygroundRequest({
      mode: "edit",
      prompt: "调整背景",
      count: 2,
      background: "transparent",
      system: "保留主体",
      referenceImageId: "001/main-test.png",
    }),
    {
      mode: "edit",
      prompt: "调整背景",
      count: 2,
      background: "transparent",
      system: "保留主体",
      imageSpec: {
        sizeMode: "preset",
        sizePreset: "1k",
        customSize: 1024,
        ratioPreset: "1:1",
        customRatioWidth: 1,
        customRatioHeight: 1,
        size: 1024,
        width: 1024,
        height: 1024,
        requestSize: "1024x1024",
        ratio: "1:1",
      },
      referenceImageId: "001/main-test.png",
      endpointId: "",
    },
  );
  assert.throws(() => normalizePlaygroundRequest({ prompt: "" }), /自由生图提示词不能为空/);
});

test("counts full playground generated images for credit billing", () => {
  assert.equal(countImagesInApiResponse({ data: [{ url: "https://example.com/a.png" }, { b64_json: "abc" }] }), 2);
  assert.equal(countImagesInApiResponse({ data: [{ revised_prompt: "no image" }] }), 0);
  assert.equal(countImagesInApiResponse({
    output: [
      { content: [{ type: "output_text", text: "x" }, { type: "output_image", image_url: "https://example.com/a.png" }] },
      { content: [{ b64_json: "abc" }] },
    ],
  }), 2);
  assert.equal(countImagesInApiResponse({
    data: [
      { content: [{ type: "image_generation_call", result: "abc" }] },
      { images: [{ data_url: "data:image/png;base64,abc" }] },
    ],
  }), 2);
  assert.equal(countImagesInApiResponse(null), 0);
});

test("collects full playground image sources from nested response shapes", () => {
  assert.deepEqual(
    collectProxyImageSources({
      output: [
        { content: [{ type: "output_text", text: "x" }, { type: "output_image", image_url: "https://example.com/a.png" }] },
        { content: [{ type: "image_generation_call", result: "YmFzZTY0LWltYWdl" }] },
        { images: [{ data_url: "data:image/png;base64,UE5HREFUQQ==" }] },
        { image_url: { url: "https://example.com/b.webp" } },
      ],
    }),
    [
      { type: "url", value: "https://example.com/a.png" },
      { type: "base64", value: "YmFzZTY0LWltYWdl" },
      { type: "base64", value: "UE5HREFUQQ==" },
      { type: "url", value: "https://example.com/b.webp" },
    ],
  );
});

test("converts playground task image paths to absolute URLs", () => {
  const result = absolutizePlaygroundTaskResult(
    { images: [{ url: "/api/images/file/001%2Fimage.png" }], credits: 39 },
    "https://image.chatyh.cn",
  );
  assert.deepEqual(result, {
    images: [{ url: "https://image.chatyh.cn/api/images/file/001%2Fimage.png" }],
    credits: 39,
  });
});

test("uses Cloudflare visitor scheme for public playground image URLs", () => {
  assert.equal(
    getPublicRequestOrigin({
      host: "image.chatyh.cn",
      "x-forwarded-proto": "http",
      "cf-visitor": '{"scheme":"https"}',
    }),
    "https://image.chatyh.cn",
  );
  assert.equal(
    getPublicRequestOrigin({ host: "127.0.0.1:4174", "x-forwarded-proto": "http" }),
    "http://127.0.0.1:4174",
  );
});

test("retries only transient playground upstream statuses", () => {
  assert.equal(isRetryablePlaygroundStatus(422), true);
  assert.equal(isRetryablePlaygroundStatus(429), true);
  assert.equal(isRetryablePlaygroundStatus(500), true);
  assert.equal(isRetryablePlaygroundStatus(503), true);
  assert.equal(isRetryablePlaygroundStatus(400), false);
  assert.equal(isRetryablePlaygroundStatus(401), false);
});

test("normalizes full playground requested image count for credit preflight", () => {
  assert.equal(requestedImageCountFromJson({ n: 4 }), 4);
  assert.equal(requestedImageCountFromJson({ n: "3" }), 3);
  assert.equal(requestedImageCountFromJson({ n: 0 }), 1);
  assert.equal(requestedImageCountFromJson({ n: 99 }), 16);
  assert.equal(requestedImageCountFromJson({}), 1);
});

test("builds image generator args with optional playground parameters", () => {
  assert.deepEqual(
    buildImageGeneratorArgs({
      skillScript: "/tmp/image_generator.py",
      prompt: "商品图",
      endpoint: "generations",
      outputDir: "/tmp/out",
      filenamePrefix: "playground",
      requestSize: "1024x1024",
      count: 3,
      background: "transparent",
      system: "不要文字",
    }),
    [
      "/tmp/image_generator.py",
      "商品图",
      "--endpoint",
      "generations",
      "--output-dir",
      "/tmp/out",
      "--filename-prefix",
      "playground",
      "--n",
      "3",
      "--size",
      "1024x1024",
      "--timeout",
      "180",
      "--background",
      "transparent",
      "--system",
      "不要文字",
    ],
  );
});

test("parses multiple generated image paths from generator output", () => {
  assert.deepEqual(
    parseGeneratedImagePaths(
      [
        "[OK] endpoint=generations images=2",
        "/tmp/out/playground-20260101-01.png",
        "/tmp/out/playground-20260101-02.webp",
        "/tmp/out/playground-20260101-response.json",
      ].join("\n"),
    ),
    ["/tmp/out/playground-20260101-01.png", "/tmp/out/playground-20260101-02.webp"],
  );
});

test("normalizes a generation endpoint (url + key) and rejects bad input", () => {
  const ep = normalizeEndpointInput({ apiBase: " https://api.one/v1/ ", apiKey: " key-1 ", label: " 主号 " });
  assert.deepEqual(ep, { apiBase: "https://api.one/v1", apiKey: "key-1", label: "主号", model: "" });

  // 每组端点可带自己的模型名（供 Agnes 等模型名不同的渠道共用同一套配置）。
  const withModel = normalizeEndpointInput({ apiBase: "https://api.one/v1", apiKey: "k", model: " agnes-image-2.1-flash " });
  assert.equal(withModel.model, "agnes-image-2.1-flash");

  assert.throws(() => normalizeEndpointInput({ apiBase: "", apiKey: "k" }), /生图 API URL不能为空/);
  assert.throws(() => normalizeEndpointInput({ apiBase: "not-a-url", apiKey: "k" }), /生图 API URL格式不正确/);
  assert.throws(() => normalizeEndpointInput({ apiBase: "ftp://api/v1", apiKey: "k" }), /http:\/\/ 或 https:\/\//);
  assert.throws(() => normalizeEndpointInput({ apiBase: "https://api/v1", apiKey: "" }), /生图 API Key 不能为空/);
});

test("masks api keys for display without leaking the middle", () => {
  assert.equal(maskKey("sk-1234567890abcd"), "sk-1****abcd");
  assert.equal(maskKey("short"), "sh****");
  assert.equal(maskKey(""), "");
});

test("selectEndpoint round-robins across endpoints and wraps", () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  let counter = 0;
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    const { row, nextCounter } = selectEndpoint(rows, { schedule: "round_robin", counter });
    seen.push(row.id);
    counter = nextCounter;
  }
  assert.deepEqual(seen, [1, 2, 3, 1]);
  assert.throws(() => selectEndpoint([], { schedule: "round_robin" }), /请先在配置中心添加生图 API 端点/);
});

test("selectEndpoint random picks within range and keeps counter", () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const { row, nextCounter } = selectEndpoint(rows, { schedule: "random", counter: 5, random: () => 0.5 });
  assert.equal(row.id, 2);
  assert.equal(nextCounter, 5);
});

test("normalizeSchedule defaults to round_robin unless random", () => {
  assert.equal(normalizeSchedule("random"), "random");
  assert.equal(normalizeSchedule("round_robin"), "round_robin");
  assert.equal(normalizeSchedule("nonsense"), "round_robin");
  assert.equal(normalizeSchedule(""), "round_robin");
});

test("normalizeApiBase validates protocol and trims trailing slash", () => {
  assert.equal(normalizeApiBase(" https://prompt.unit.test/v1/ ", "提示词 API URL"), "https://prompt.unit.test/v1");
  assert.throws(() => normalizeApiBase("", "提示词 API URL"), /提示词 API URL不能为空/);
  assert.throws(() => normalizeApiBase("not-a-url", "提示词 API URL"), /提示词 API URL格式不正确/);
  assert.throws(
    () => normalizeApiBase("ftp://prompt.unit.test/v1", "提示词 API URL"),
    /提示词 API URL必须以 http:\/\/ 或 https:\/\//,
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

test("applyEndpointModel：JSON 请求体的 model 被端点模型覆盖，multipart 保持原样", () => {
  const json = Buffer.from(JSON.stringify({ model: "gpt-image-2", prompt: "x" }));
  // 端点配了模型 → 覆盖
  const out = applyEndpointModel(json, "application/json", "agnes-image-2.1-flash");
  assert.equal(JSON.parse(out.toString()).model, "agnes-image-2.1-flash");
  assert.equal(JSON.parse(out.toString()).prompt, "x");
  // 端点没配模型、也无 .env 默认 → 原样返回
  const prevEnv = process.env.CUSTOM_IMAGE_MODEL;
  delete process.env.CUSTOM_IMAGE_MODEL;
  assert.equal(applyEndpointModel(json, "application/json", "").toString(), json.toString());
  if (prevEnv !== undefined) process.env.CUSTOM_IMAGE_MODEL = prevEnv;
  // multipart 不改
  const mp = Buffer.from("--b\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\ngpt-image-2\r\n--b--");
  assert.equal(applyEndpointModel(mp, "multipart/form-data; boundary=b", "agnes").toString(), mp.toString());
});
