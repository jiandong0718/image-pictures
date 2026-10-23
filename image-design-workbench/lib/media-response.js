"use strict";

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pipeline } = require('node:stream/promises');

function byteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  // 不支持多段时沿用旧接口的整文件响应；只有实际越界的单段返回 416。
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = Math.min(size - 1, match[1] && match[2] ? Number(match[2]) : size - 1);
  return !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size
    ? { invalid: true } : { start, end };
}

// 调用方先校验访问权限，再执行条件请求。公开作品撤回后仍会经过权限查询。
async function sendMediaFile(req, res, filename, headers = {}) {
  const stat = await fsp.stat(filename);
  if (!stat.isFile()) throw new Error('文件不存在');
  const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  const common = { ...headers, ETag: etag, 'Last-Modified': stat.mtime.toUTCString(), 'Accept-Ranges': 'bytes' };
  if (req.headers['if-none-match']?.split(/\s*,\s*/).some(value => value === etag || value === '*')) {
    res.writeHead(304, common);
    res.end();
    return;
  }
  const range = !req.headers['if-range'] || req.headers['if-range'] === etag ? byteRange(req.headers.range, stat.size) : null;
  if (range?.invalid) {
    res.writeHead(416, { ...common, 'Content-Range': `bytes */${stat.size}`, 'Content-Length': 0 });
    res.end();
    return;
  }
  const length = range ? range.end - range.start + 1 : stat.size;
  res.writeHead(range ? 206 : 200, { ...common, 'Content-Length': length,
    ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}` } : {}) });
  if (req.method === 'HEAD') return res.end();
  try { await pipeline(fs.createReadStream(filename, range || undefined), res); }
  catch (error) { if (!res.destroyed) throw error; }
}

module.exports = { sendMediaFile, byteRange };
