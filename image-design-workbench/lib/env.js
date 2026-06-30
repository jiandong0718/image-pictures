"use strict";

// 轻量 .env 加载器：把 .env 内容灌入 process.env（不覆盖已存在的变量），零依赖。
// 必须在 server.js 最顶部、任何读取 process.env 的常量求值之前调用。

const fs = require("fs");
const path = require("path");

function parseLine(line) {
  let stripped = line.trim();
  if (!stripped || stripped.startsWith("#")) {
    return null;
  }
  if (stripped.startsWith("export ")) {
    stripped = stripped.slice(7).trim();
  }
  const index = stripped.indexOf("=");
  if (index === -1) {
    return null;
  }
  const key = stripped.slice(0, index).trim();
  let value = stripped.slice(index + 1).trim();
  if (!key) {
    return null;
  }
  if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

function loadEnv(envPath = path.join(__dirname, "..", ".env")) {
  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) {
      continue;
    }
    const [key, value] = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadEnv };
