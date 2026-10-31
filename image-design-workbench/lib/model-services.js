"use strict";

// 多组视觉理解与语音配置；语音计价跟随选中的服务，并在提交时快照。
const { getPool } = require("./db");
const { normalizeApiBase, normalizeModelName, maskKey } = require("./image-config");
const { normalizeAudioConfig } = require("./audio-client");
const clean = value => typeof value === "string" ? value.trim() : "";
const validKind = kind => { if (!["prompt", "audio"].includes(kind)) throw new Error("未知服务类型"); return kind; };

async function init() {
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS model_service_endpoints (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    kind VARCHAR(16) NOT NULL, api_base VARCHAR(500) NOT NULL, api_key VARCHAR(1000) NOT NULL,
    label VARCHAR(100) NOT NULL DEFAULT '', model VARCHAR(100) NOT NULL,
    characters_per_credit INT NOT NULL DEFAULT 1000, credits_per_unit INT NOT NULL DEFAULT 1,
    enabled TINYINT(1) NOT NULL DEFAULT 1, legacy_kind VARCHAR(16) NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_model_service_kind (kind,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  const [marker] = await db.query("SELECT v FROM app_settings WHERE k='model_services_migrated'");
  if (marker.length) return;
  const [settings] = await db.query("SELECT k,v FROM app_settings WHERE k IN ('prompt_api_base','prompt_api_key','prompt_model')");
  const values = Object.fromEntries(settings.map(row => [row.k, row.v]));
  if (values.prompt_api_base && values.prompt_api_key) {
    await db.query("INSERT IGNORE INTO model_service_endpoints (kind,api_base,api_key,label,model,legacy_kind) VALUES ('prompt',?,?,?,?,'prompt')", [values.prompt_api_base, values.prompt_api_key, "原视觉理解服务", values.prompt_model || "gpt-4o-mini"]);
  }
  const [rows] = await db.query("SELECT * FROM creative_audio_config WHERE id=1");
  const row = rows[0];
  if (row?.api_base && row?.api_key && row?.model) {
    await db.query("INSERT IGNORE INTO model_service_endpoints (kind,api_base,api_key,label,model,characters_per_credit,credits_per_unit,legacy_kind) VALUES ('audio',?,?,?,?,?,?,'audio')", [row.api_base, row.api_key, "原语音服务", row.model, row.characters_per_credit, row.credits_per_unit]);
  }
  await db.query("INSERT IGNORE INTO app_settings (k,v) VALUES ('model_services_migrated','1')");
}
async function raw(kind, id) {
  validKind(kind);
  const [rows] = await getPool().query("SELECT * FROM model_service_endpoints WHERE kind=? AND id=? LIMIT 1", [kind, Number(id)]);
  if (!rows.length) throw new Error("服务不存在");
  return rows[0];
}
function project(row) {
  return { id: String(row.id), label: row.label, apiBase: row.api_base, keyMasked: maskKey(row.api_key), model: row.model, models: [row.model], enabled: Boolean(row.enabled), charactersPerCredit: Number(row.characters_per_credit), creditsPerUnit: Number(row.credits_per_unit) };
}
async function list(kind) {
  validKind(kind);
  const [rows] = await getPool().query("SELECT * FROM model_service_endpoints WHERE kind=? ORDER BY id", [kind]);
  return rows.map(project);
}
async function selectable(kind) {
  return (await list(kind)).filter(row => row.enabled).map(row => ({ id: row.id, name: row.label || `服务 #${row.id}`, model: row.model, ...(kind === "audio" ? { charactersPerCredit: row.charactersPerCredit, creditsPerUnit: row.creditsPerUnit } : {}) }));
}
async function defaultId(kind) {
  validKind(kind);
  const [rows] = await getPool().query("SELECT v FROM app_settings WHERE k=? LIMIT 1", [`${kind}_default_endpoint_id`]);
  const nodes = await selectable(kind);
  return nodes.find(node => node.id === rows[0]?.v)?.id || nodes[0]?.id || "";
}
async function credentials(kind, id) {
  const row = await raw(kind, id);
  return { apiBase: row.api_base, apiKey: row.api_key };
}
async function required(kind, id) {
  const selected = id ? String(id) : await defaultId(kind);
  if (!/^\d+$/.test(selected)) throw new Error(`请先在配置中心添加${kind === "audio" ? "语音" : "视觉理解"}服务`);
  const row = await raw(kind, selected);
  if (!row.enabled) throw new Error("所选服务已停用");
  return { id: String(row.id), apiBase: row.api_base, apiKey: row.api_key, model: row.model, charactersPerCredit: Number(row.characters_per_credit), creditsPerUnit: Number(row.credits_per_unit) };
}
async function save(kind, input, id) {
  validKind(kind);
  const previous = id ? await raw(kind, id) : null;
  const apiBase = normalizeApiBase(input.apiBase || previous?.api_base, "API 地址");
  const suppliedKey = clean(input.apiKey);
  if (previous && !suppliedKey && apiBase !== previous.api_base) throw new Error("修改 API 地址时请重新输入密钥");
  const apiKey = suppliedKey || previous?.api_key;
  if (!apiKey) throw new Error("API Key 不能为空");
  const model = normalizeModelName(input.model || previous?.model);
  if (!model) throw new Error("请选择模型");
  const label = input.label === undefined ? previous?.label || "" : clean(input.label).slice(0, 100);
  const pricing = normalizeAudioConfig({ apiBase, apiKey, model, charactersPerCredit: input.charactersPerCredit ?? previous?.characters_per_credit ?? 1000, creditsPerUnit: input.creditsPerUnit ?? previous?.credits_per_unit ?? 1 });
  if (previous) {
    await getPool().query("UPDATE model_service_endpoints SET api_base=?,api_key=?,label=?,model=?,characters_per_credit=?,credits_per_unit=? WHERE id=? AND kind=?", [apiBase, apiKey, label, model, pricing.charactersPerCredit, pricing.creditsPerUnit, previous.id, kind]);
    return previous.id;
  }
  const [result] = await getPool().query("INSERT INTO model_service_endpoints (kind,api_base,api_key,label,model,characters_per_credit,credits_per_unit) VALUES (?,?,?,?,?,?,?)", [kind, apiBase, apiKey, label, model, pricing.charactersPerCredit, pricing.creditsPerUnit]);
  return result.insertId;
}
async function action(kind, payload) {
  validKind(kind);
  const name = payload.action;
  if (!name && kind === "audio" && payload.clearKey === true) {
    const id = await defaultId(kind);
    if (id) await getPool().query("UPDATE model_service_endpoints SET api_key='', enabled=0 WHERE kind=? AND id=?", [kind, id]);
    return;
  }
  if (name === "add") return save(kind, payload);
  if (name === "update") return save(kind, payload, payload.id);
  if (!name) return save(kind, payload, await defaultId(kind) || undefined);
  const row = await raw(kind, payload.id);
  if (name === "delete") return getPool().query("DELETE FROM model_service_endpoints WHERE kind=? AND id=?", [kind, row.id]);
  if (name === "toggle") {
    if (payload.enabled && (!row.api_key || !row.api_base || !row.model)) throw new Error("请先补齐服务地址、密钥和模型");
    return getPool().query("UPDATE model_service_endpoints SET enabled=? WHERE kind=? AND id=?", [payload.enabled ? 1 : 0, kind, row.id]);
  }
  if (name === "set_default") {
    if (!row.enabled) throw new Error("只能将已启用的服务设为默认");
    return getPool().query("INSERT INTO app_settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)", [`${kind}_default_endpoint_id`, String(row.id)]);
  }
  throw new Error("未知服务操作");
}
module.exports = { init, list, selectable, defaultId, credentials, required, action };
