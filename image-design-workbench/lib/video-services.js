"use strict";

// 显式记录各视频节点协议和站内价格，旧节点继续按 Agnes 协议运行。
const { getPool } = require("./db");
const { normalizeApiBase, normalizeModelName, maskKey } = require("./image-config");
const { capabilities } = require("./video-providers");
const DEFAULT_BASE = process.env.VIDEO_API_BASE || "https://apihub.agnes-ai.com/v1";
const DEFAULT_MODEL = "agnes-video-v2.0";
const clean = value => typeof value === "string" ? value.trim() : "";

async function init() {
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS video_endpoints (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    api_base VARCHAR(500) NOT NULL, api_key VARCHAR(500) NOT NULL,
    label VARCHAR(100) NOT NULL DEFAULT '', model VARCHAR(100) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1, legacy_id TINYINT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  for (const ddl of ["protocol VARCHAR(24) NOT NULL DEFAULT 'agnes'", "credits_per_second INT NULL"]) {
    try { await db.query(`ALTER TABLE video_endpoints ADD COLUMN ${ddl}`); }
    catch (error) { if (error.errno !== 1060) throw error; }
  }
  const [marker] = await db.query("SELECT v FROM app_settings WHERE k='video_endpoints_migrated'");
  if (!marker.length) {
    const [settings] = await db.query("SELECT k,v FROM app_settings WHERE k IN ('video_api_key','video_model')");
    const values = Object.fromEntries(settings.map(row => [row.k, row.v]));
    if (values.video_api_key) await db.query("INSERT IGNORE INTO video_endpoints (api_base,api_key,label,model,legacy_id) VALUES (?,?,?,?,1)", [normalizeApiBase(DEFAULT_BASE), values.video_api_key, "原视频服务", values.video_model || DEFAULT_MODEL]);
    await db.query("INSERT IGNORE INTO app_settings (k,v) VALUES ('video_endpoints_migrated','1')");
  }
}

async function raw(id) {
  const [rows] = await getPool().query("SELECT * FROM video_endpoints WHERE id=? LIMIT 1", [Number(id)]);
  if (!rows.length) throw new Error("视频服务不存在");
  return rows[0];
}
async function list() {
  const [rows] = await getPool().query("SELECT * FROM video_endpoints ORDER BY id");
  return rows.map(row => ({ id: row.id, label: row.label, apiBase: row.api_base, keyMasked: maskKey(row.api_key), model: row.model, models: [row.model], protocol: row.protocol || "agnes", creditsPerSecond: row.credits_per_second == null ? null : Number(row.credits_per_second), enabled: Boolean(row.enabled) }));
}
async function selectable() {
  return (await list()).filter(row => row.enabled).map(row => ({ id: String(row.id), name: row.label || `视频服务 #${row.id}`, model: row.model, protocol: row.protocol, creditsPerSecond: row.creditsPerSecond, capabilities: capabilities(row.protocol, row.model) }));
}
async function credentials(id) {
  const row = await raw(id);
  return { apiBase: row.api_base, apiKey: row.api_key };
}
async function save(input, id) {
  const previous = id ? await raw(id) : null;
  const apiBase = normalizeApiBase(input.apiBase || previous?.api_base || DEFAULT_BASE, "视频 API URL");
  const suppliedKey = clean(input.apiKey);
  if (previous && !suppliedKey && apiBase !== previous.api_base) throw new Error("修改 API 地址时请重新输入密钥");
  const apiKey = suppliedKey || previous?.api_key;
  if (!apiKey) throw new Error("视频 API Key 不能为空");
  const model = normalizeModelName(input.model || previous?.model || DEFAULT_MODEL);
  if (!model) throw new Error("请选择视频模型");
  const protocol = clean(input.protocol) || previous?.protocol || "agnes";
  capabilities(protocol, model);
  const rawPrice = input.creditsPerSecond === "" || input.creditsPerSecond === null ? null : input.creditsPerSecond ?? previous?.credits_per_second ?? null;
  const creditsPerSecond = rawPrice === null ? null : Number(rawPrice);
  if (creditsPerSecond !== null && (!Number.isSafeInteger(creditsPerSecond) || creditsPerSecond < 1 || creditsPerSecond > 100000)) throw new Error(`${protocol === "grsai_veo" ? "每次" : "每秒"}积分需为 1 到 100000 的整数`);
  const label = input.label === undefined ? previous?.label || "" : clean(input.label).slice(0, 100);
  if (previous) await getPool().query("UPDATE video_endpoints SET api_base=?,api_key=?,label=?,model=?,protocol=?,credits_per_second=? WHERE id=?", [apiBase, apiKey, label, model, protocol, creditsPerSecond, previous.id]);
  else {
    const [result] = await getPool().query("INSERT INTO video_endpoints (api_base,api_key,label,model,protocol,credits_per_second) VALUES (?,?,?,?,?,?)", [apiBase, apiKey, label, model, protocol, creditsPerSecond]);
    return result.insertId;
  }
  return previous.id;
}
async function setDefault(id) {
  const row = await raw(id);
  if (!row.enabled) throw new Error("只能将已启用的视频服务设为默认");
  await getPool().query("INSERT INTO app_settings (k,v) VALUES ('video_default_endpoint_id',?) ON DUPLICATE KEY UPDATE v=VALUES(v)", [String(row.id)]);
}
async function defaultId() {
  const [rows] = await getPool().query("SELECT v FROM app_settings WHERE k='video_default_endpoint_id' LIMIT 1");
  const nodes = await selectable();
  return nodes.find(node => node.id === rows[0]?.v)?.id || nodes[0]?.id || "";
}
async function required(id) {
  const selected = id ? String(id) : await defaultId();
  if (!selected || !/^\d+$/.test(selected)) throw new Error("请先在配置中心添加视频服务");
  const row = await raw(selected);
  if (!row.enabled) throw new Error("所选视频服务已停用");
  return { id: String(row.id), apiBase: row.api_base, apiKey: row.api_key, model: row.model, protocol: row.protocol || "agnes", creditsPerSecond: row.credits_per_second == null ? null : Number(row.credits_per_second) };
}
async function toggle(id, enabled) {
  const row = await raw(id);
  await getPool().query("UPDATE video_endpoints SET enabled=? WHERE id=?", [enabled ? 1 : 0, row.id]);
}
async function remove(id) {
  const row = await raw(id);
  await getPool().query("DELETE FROM video_endpoints WHERE id=?", [row.id]);
}
module.exports = { init, list, selectable, credentials, save, setDefault, defaultId, required, toggle, remove, DEFAULT_BASE };
