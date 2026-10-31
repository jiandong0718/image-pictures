const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { createVideoPreviewCache } = require("../lib/video-preview");

test("视频预览生成可播放的小文件，并复用结果而不改写原视频", async (t) => {
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) return t.skip("ffmpeg 未安装");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-preview-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.resolve(__dirname, "../public/assets/video-teaser-from-stills.mp4");
  const original = await fs.readFile(source);
  const cache = createVideoPreviewCache({ directory });
  const [first, second] = await Promise.all([cache.get(source), cache.get(source)]);
  assert.notEqual(first, source);
  assert.equal(first, second);
  assert.ok((await fs.stat(first)).size < original.length);
  assert.equal(spawnSync("ffmpeg", ["-v", "error", "-i", first, "-f", "null", "-"], { stdio: "ignore" }).status, 0);
  assert.deepEqual(await fs.readFile(source), original);
  assert.equal(await cache.get(source), first);
});

test("转码工具不可用时安全回退原视频且不留下临时文件", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-preview-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.resolve(__dirname, "../public/assets/video-teaser-from-stills.mp4");
  const cache = createVideoPreviewCache({ directory, command: path.join(directory, "missing-ffmpeg") });
  assert.equal(await cache.get(source), source);
  assert.deepEqual(await fs.readdir(directory), []);
});
