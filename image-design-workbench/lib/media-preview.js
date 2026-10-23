"use strict";

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

// 预览与原图独立存储；同一原件共用转换，避免多个卡片同时启动转换进程。
function createPreviewCache({ directory, concurrency = 2, render = renderPreview }) {
  const pending = new Map();
  const queue = [];
  let running = 0;
  function schedule(work) {
    return new Promise((resolve, reject) => {
      queue.push({ work, resolve, reject });
      drain();
    });
  }
  function drain() {
    while (running < concurrency && queue.length) {
      const item = queue.shift();
      running++;
      Promise.resolve().then(item.work).then(item.resolve, item.reject).finally(() => { running--; drain(); });
    }
  }
  async function get(source, edge = 768) {
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new Error('图片文件不存在');
    const size = Math.max(128, Math.min(1280, Number(edge) || 768));
    const key = crypto.createHash('sha256').update(`${path.resolve(source)}:${stat.size}:${stat.mtimeMs}:${size}:webp-v1`).digest('hex');
    const output = path.join(directory, `${key}.webp`);
    try { if ((await fs.stat(output)).size > 0) return output; } catch { /* 首次生成 */ }
    if (pending.has(key)) return pending.get(key);
    const task = schedule(async () => {
      await fs.mkdir(directory, { recursive: true });
      const temporary = `${output}.${crypto.randomUUID()}.tmp`;
      try {
        await render(source, temporary, size);
        if (!(await fs.stat(temporary)).size) throw new Error('图片预览为空');
        await fs.rename(temporary, output);
        return output;
      } finally { await fs.unlink(temporary).catch(() => {}); }
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }
  return { get };
}

async function renderPreview(source, output, edge) {
  await sharp(source, { animated: false }).rotate()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 }).toFile(output);
}

module.exports = { createPreviewCache };
