const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertImageSpecDimensions,
  clearOutputDirContents,
  getBatchDerivedTypes,
  getDerivedImageTypes,
  getImageTypeConfig,
  getImageNormalizerCommands,
  getImageNormalizationPlan,
  normalizeImageSpec,
  readImageDimensions,
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

test("supports one generic derived image without changing the hat batch set", () => {
  assert.equal(getImageTypeConfig("derived").label, "衍生图");
  assert.equal(getImageTypeConfig("derived").endpoint, "edits");
  assert.ok(getDerivedImageTypes().includes("derived"));
  assert.deepEqual(getBatchDerivedTypes(), [
    "whiteBackground",
    "dimensions",
    "detail",
    "worn",
    "scene",
    "sellingPoints",
  ]);
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
