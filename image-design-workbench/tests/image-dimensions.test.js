const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertImageSpecDimensions,
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
