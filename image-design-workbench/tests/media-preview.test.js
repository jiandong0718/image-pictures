const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { createPreviewCache } = require('../lib/media-preview');

test('并发预览只转换一次，发布前不可读到半成品，原图不变', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = path.join(dir, 'original.png');
  await sharp({ create: { width: 2000, height: 1000, channels: 4, background: '#0077aa80' } }).png().toFile(original);
  const before = await fs.readFile(original);
  let calls = 0;
  const cache = createPreviewCache({ directory: path.join(dir, 'cache'), render: async (source, output, edge) => {
    calls++;
    await sharp(source).resize({ width: edge, height: edge, fit: 'inside' }).webp().toFile(output);
  }});
  const outputs = await Promise.all(Array.from({ length: 8 }, () => cache.get(original)));
  assert.equal(calls, 1);
  assert.equal(new Set(outputs).size, 1);
  assert.equal(await cache.get(original), outputs[0]);
  assert.equal(calls, 1);
  const meta = await sharp(outputs[0]).metadata();
  assert.equal(meta.width, 768);
  assert.equal(meta.height, 384);
  assert.equal(meta.format, 'webp');
  assert.equal(meta.hasAlpha, true);
  assert.deepEqual(await fs.readFile(original), before);
  assert.ok((await fs.readdir(path.join(dir, 'cache'))).every(name => !name.includes('.tmp')));
});

test('原件变化会重新生成，转换失败可以重试且不留下缓存文件', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.png');
  await sharp({ create: { width: 1000, height: 1000, channels: 3, background: 'red' } }).png().toFile(source);
  let failures = 1;
  const cache = createPreviewCache({ directory: path.join(dir, 'cache'), render: async (src, output) => {
    if (failures > 0) { failures--; throw new Error('conversion failed'); }
    await sharp(src).webp().toFile(output);
  }});
  await assert.rejects(cache.get(source), /conversion failed/);
  const first = await cache.get(source);
  await sharp({ create: { width: 500, height: 400, channels: 3, background: 'blue' } }).png().toFile(source);
  assert.notEqual(await cache.get(source), first);
});
