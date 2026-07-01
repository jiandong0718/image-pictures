"use strict";

// 生图 API 端点（多组 key+url）与提示词/调度配置，持久化到 MySQL，不再依赖 .env。
// - image_endpoints：多组生图端点，画图时按调度策略轮询/随机取一组。
// - app_settings：键值表，存调度策略 image_schedule 和提示词（视觉理解）API 配置。
// 纯逻辑（归一化 / 脱敏 / 选取）单独导出，便于不依赖 DB 的单元测试。

const { getPool } = require("./db");

const SCHEDULE_ROUND_ROBIN = "round_robin";
const SCHEDULE_RANDOM = "random";
const DEFAULT_PROMPT_MODEL = "gpt-4o-mini";

// ---------- 纯逻辑（无 DB，可单测）----------

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeApiBase(value, label = "生图 API URL") {
  const apiBase = clean(value);
  if (!apiBase) {
    throw new Error(`${label}不能为空`);
  }
  let parsed;
  try {
    parsed = new URL(apiBase);
  } catch {
    throw new Error(`${label}格式不正确`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label}必须以 http:// 或 https:// 开头`);
  }
  return parsed.toString().replace(/\/$/, "");
}

// 校验并归一化一组生图端点（url + key）。
function normalizeEndpointInput(raw = {}) {
  const apiBase = normalizeApiBase(raw.apiBase || raw.apiUrl || raw.api_url);
  const apiKey = clean(raw.apiKey || raw.api_key);
  if (!apiKey) {
    throw new Error("生图 API Key 不能为空");
  }
  const label = clean(raw.label).slice(0, 100);
  return { apiBase, apiKey, label };
}

// key 只在配置中心展示脱敏形式，不回传明文。
function maskKey(key) {
  const value = clean(key);
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return `${value.slice(0, 2)}****`;
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function normalizeSchedule(value) {
  return clean(value) === SCHEDULE_RANDOM ? SCHEDULE_RANDOM : SCHEDULE_ROUND_ROBIN;
}

// 从一组端点里按调度策略选一个。纯函数：counter 由调用方持有，返回下一个 counter。
function selectEndpoint(rows, { schedule = SCHEDULE_ROUND_ROBIN, counter = 0, random = Math.random } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("请先在配置中心添加生图 API 端点");
  }
  if (schedule === SCHEDULE_RANDOM) {
    const idx = Math.floor(random() * rows.length) % rows.length;
    return { row: rows[idx], nextCounter: counter };
  }
  const idx = counter % rows.length;
  return { row: rows[idx], nextCounter: (counter + 1) % 1e9 };
}

// ---------- DB 层 ----------

async function createTables() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS image_endpoints (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      api_base VARCHAR(500) NOT NULL,
      api_key VARCHAR(500) NOT NULL,
      label VARCHAR(100) NOT NULL DEFAULT '',
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      k VARCHAR(64) NOT NULL,
      v TEXT NOT NULL,
      PRIMARY KEY (k)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
  `);
}

async function getSetting(key, fallback = "") {
  const [rows] = await getPool().query("SELECT v FROM app_settings WHERE k = ? LIMIT 1", [key]);
  return rows.length ? rows[0].v : fallback;
}

async function setSetting(key, value) {
  await getPool().query(
    "INSERT INTO app_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)",
    [key, String(value)],
  );
}

async function listEndpoints() {
  const [rows] = await getPool().query(
    "SELECT id, api_base, api_key, label, enabled, created_at FROM image_endpoints WHERE enabled = 1 ORDER BY id ASC",
  );
  return rows;
}

// 配置中心展示用：key 脱敏。
async function listEndpointsForDisplay() {
  const rows = await listEndpoints();
  return rows.map((row) => ({
    id: row.id,
    apiBase: row.api_base,
    keyMasked: maskKey(row.api_key),
    label: row.label || "",
    createdAt: row.created_at,
  }));
}

async function addEndpoint(raw) {
  const { apiBase, apiKey, label } = normalizeEndpointInput(raw);
  const [result] = await getPool().query(
    "INSERT INTO image_endpoints (api_base, api_key, label) VALUES (?, ?, ?)",
    [apiBase, apiKey, label],
  );
  return result.insertId;
}

async function deleteEndpoint(id) {
  await getPool().query("DELETE FROM image_endpoints WHERE id = ?", [Number(id)]);
}

async function countEndpoints() {
  const [rows] = await getPool().query("SELECT COUNT(*) AS n FROM image_endpoints WHERE enabled = 1");
  return Number(rows[0].n) || 0;
}

async function assertConfigured() {
  if ((await countEndpoints()) === 0) {
    throw new Error("请先在配置中心添加生图 API 端点");
  }
}

async function getSchedule() {
  return normalizeSchedule(await getSetting("image_schedule", SCHEDULE_ROUND_ROBIN));
}

async function setSchedule(value) {
  const schedule = normalizeSchedule(value);
  await setSetting("image_schedule", schedule);
  return schedule;
}

// 内存轮询计数器（单实例足够；ponytail: 多实例需改为 DB 计数或随机策略）。
let roundRobinCounter = 0;

// 画图时取一组端点：按调度策略轮询/随机。
async function pickEndpoint() {
  const rows = await listEndpoints();
  const schedule = await getSchedule();
  const { row, nextCounter } = selectEndpoint(rows, { schedule, counter: roundRobinCounter });
  roundRobinCounter = nextCounter;
  return { apiBase: row.api_base, apiKey: row.api_key };
}

// ---------- 提示词（视觉理解）配置：单组，存 app_settings ----------

async function getPromptConfig() {
  const [apiBase, apiKey, model] = await Promise.all([
    getSetting("prompt_api_base", ""),
    getSetting("prompt_api_key", ""),
    getSetting("prompt_model", ""),
  ]);
  return { apiBase, apiKey, model: model || DEFAULT_PROMPT_MODEL };
}

async function getPromptConfigSummary() {
  const config = await getPromptConfig();
  return {
    uploaded: Boolean(config.apiBase && config.apiKey),
    apiBase: config.apiBase,
    model: config.model,
    hasApiKey: Boolean(config.apiKey),
  };
}

async function setPromptConfig(raw = {}) {
  const apiBase = normalizeApiBase(raw.apiBase || raw.apiUrl || raw.api_url, "提示词 API URL");
  const apiKey = clean(raw.apiKey || raw.api_key);
  const model = clean(raw.model) || DEFAULT_PROMPT_MODEL;
  if (!apiKey) {
    throw new Error("提示词 API Key 不能为空");
  }
  await Promise.all([
    setSetting("prompt_api_base", apiBase),
    setSetting("prompt_api_key", apiKey),
    setSetting("prompt_model", model),
  ]);
  return getPromptConfigSummary();
}

async function getRequiredPromptConfig() {
  const config = await getPromptConfig();
  if (!config.apiBase || !config.apiKey) {
    throw new Error("请先在配置中心保存提示词 API 配置");
  }
  return config;
}

// 首次启动迁移：DB 为空且 .env 里还有旧值时，各种一次性种子进来，之后完全走 DB。
async function seedFromEnv({ imageBase, imageKey, promptBase, promptKey, promptModel } = {}) {
  if ((await countEndpoints()) === 0 && clean(imageBase) && clean(imageKey)) {
    try {
      await addEndpoint({ apiBase: imageBase, apiKey: imageKey, label: "默认（迁移自 .env）" });
    } catch {
      /* 旧值不合法就跳过，交给 admin 在页面重配 */
    }
  }
  const prompt = await getPromptConfig();
  if (!prompt.apiBase && clean(promptBase) && clean(promptKey)) {
    try {
      await setPromptConfig({ apiBase: promptBase, apiKey: promptKey, model: promptModel });
    } catch {
      /* 同上 */
    }
  }
}

async function init(seed) {
  await createTables();
  if (seed) {
    await seedFromEnv(seed);
  }
}

module.exports = {
  SCHEDULE_ROUND_ROBIN,
  SCHEDULE_RANDOM,
  DEFAULT_PROMPT_MODEL,
  // 纯逻辑
  normalizeApiBase,
  normalizeEndpointInput,
  maskKey,
  normalizeSchedule,
  selectEndpoint,
  // DB
  init,
  createTables,
  listEndpoints,
  listEndpointsForDisplay,
  addEndpoint,
  deleteEndpoint,
  countEndpoints,
  assertConfigured,
  getSchedule,
  setSchedule,
  pickEndpoint,
  getPromptConfig,
  getPromptConfigSummary,
  setPromptConfig,
  getRequiredPromptConfig,
  seedFromEnv,
};
