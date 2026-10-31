"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

// Previews are derived files: keep the original untouched and never publish a partial output.
function createVideoPreviewCache({ directory, command = "ffmpeg", timeoutMs = 120000, maxPending = 3 } = {}) {
  const pending = new Map();
  let queue = Promise.resolve();
  let unavailableUntil = 0;

  async function generate(source, target) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.${crypto.randomUUID()}.tmp.mp4`);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(command, [
          "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", source,
          "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
          "-vf", "scale=w='min(854,iw)':h='min(854,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
          "-c:v", "libx264", "-preset", "veryfast", "-threads", "2", "-pix_fmt", "yuv420p",
          "-b:v", "450k", "-maxrate", "550k", "-bufsize", "900k",
          "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", temporary,
        ], { stdio: "ignore" });
        const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("视频预览转码失败")); });
      });
      const output = await fs.stat(temporary);
      if (!output.isFile() || output.size === 0) throw new Error("视频预览为空");
      await fs.rename(temporary, target);
      return target;
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async function get(source) {
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new Error("视频不存在");
    const key = crypto.createHash("sha256").update(`${source}\0${stat.size}\0${stat.mtimeMs}\0v1`).digest("hex");
    const target = path.join(directory, `${key}.mp4`);
    const cached = await fs.stat(target).catch(() => null);
    if (cached?.isFile() && cached.size > 0) return target;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= maxPending || Date.now() < unavailableUntil) return source;
    const task = queue.then(() => generate(source, target)).catch(error => {
      if (error.code === "ENOENT") unavailableUntil = Date.now() + 60000;
      console.error("视频预览暂不可用，回退原视频:", error.message);
      return source;
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    queue = task.then(() => {});
    return task;
  }

  return { get };
}

module.exports = { createVideoPreviewCache };
