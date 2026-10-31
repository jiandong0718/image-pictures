import { mountLayout } from "/shared/layout.js";
import { apiGet, apiPost } from "/shared/api.js";

const $ = (id) => document.getElementById(id);
const categories = {
  images: { title: "图像生成", description: "用于自由生图、套图工作台、修图与绘图聚集地。", icon: "▧" },
  prompt: { title: "视觉理解", description: "用于识别参考图并提取提示词。", icon: "◎" },
  video: { title: "视频生成", description: "用于文生视频与图生视频。", icon: "▷" },
  audio: { title: "语音生成", description: "用于文字转语音，按字符计费。", icon: "♫" },
  maintenance: { title: "维护", description: "管理当前账户的本地生成文件。" },
};
const requestedCategory = new URLSearchParams(location.search).get("category");
let category = Object.hasOwn(categories, requestedCategory) ? requestedCategory : "images";
let endpoints = [];
let configs = {};
let errors = {};
let editing = null;
let modelVersion = 0;
let saving = false;
let availableModels = [];
let globalDefault = null;
let videoEndpoints = [];
let videoDefaultId = "";
let modelEndpoints = { prompt: [], audio: [] };
let modelDefaults = { prompt: "", audio: "" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}
function message(id, text = "", kind = "") {
  $(id).textContent = text;
  $(id).className = `settings-message ${kind}`;
}
function isConfigured(kind) {
  return kind === "audio" ? configs[kind]?.configured : configs[kind]?.uploaded;
}
function rows() {
  if (category === "images") return endpoints.map((ep) => ({ ...ep, title: ep.label || "图像服务", enabled: ep.enabled !== false }));
  if (category === "video") return videoEndpoints.map(ep => ({ ...ep, title: ep.label || `视频服务 #${ep.id}`, pricing: `${({ openai_video: "通用视频接口", agnes: "Agnes 兼容", wan3: "阿里云万相 3.0", wan26: "阿里云万相 2.6", minimax_h3: "MiniMax H3", grsai_veo: "Grsai Veo 3.1" })[ep.protocol] || ep.protocol} · ${ep.creditsPerSecond ? `每${ep.protocol === "grsai_veo" ? "次" : "秒"} ${ep.creditsPerSecond} 积分` : ep.protocol === "grsai_veo" ? "每次使用全局积分数" : "使用全局每秒积分"}` }));
  if (category === "prompt" || category === "audio") return modelEndpoints[category].map(ep => ({ ...ep, title: ep.label || `${categories[category].title}服务 #${ep.id}`, pricing: category === "audio" ? `每 ${ep.charactersPerCredit} 字符 / ${ep.creditsPerUnit} 积分` : "" }));
  if (!isConfigured(category)) return [];
  const config = configs[category];
  return [{ id: category, title: `${categories[category].title}服务`, apiBase: config.apiBase || "Agnes AI · 固定服务地址", model: config.model, models: [config.model], enabled: true, keyMasked: "已保存", pricing: category === "audio" ? `每 ${config.charactersPerCredit} 字符 / ${config.creditsPerUnit} 积分` : "" }];
}
function render() {
  document.querySelectorAll("[data-category]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.category === category)));
  $("countImages").textContent = errors.images ? "!" : endpoints.length;
  for (const kind of ["prompt", "video", "audio"]) $("count" + kind[0].toUpperCase() + kind.slice(1)).textContent = errors[kind] ? "!" : kind === "video" ? videoEndpoints.length : modelEndpoints[kind].length;
  const maintenance = category === "maintenance";
  $("scheduleField").hidden = category !== "images";
  $("addService").hidden = maintenance;
  $("maintenancePanel").hidden = !maintenance;
  $("providerList").hidden = maintenance;
  $("categoryDescription").textContent = categories[category].description + (category === "images" ? globalDefault ? ` 全局默认：${globalDefault.name} / ${globalDefault.model}` : " 可通过服务的更多菜单设定全局默认。" : "");
  $("providerList").setAttribute("aria-busy", "false");
  const list = rows();
  $("addService").textContent = "＋ 添加服务";
  if (errors[category]) {
    $("providerList").innerHTML = '<div class="settings-empty"><h3>配置暂时无法加载</h3><p>请稍后重试，已有配置不会被修改。</p><button class="btn" data-retry type="button">重新加载</button></div>';
    message("pageMessage", errors[category], "error");
    return;
  }
  if (!list.length && !maintenance) {
    $("providerList").innerHTML = `<div class="settings-empty"><h3>尚未接入${categories[category].title}服务</h3><p>添加一个服务，即可在对应的创作模块中使用。</p><button class="btn" data-add type="button">添加服务</button></div>`;
    return;
  }
  $("providerList").innerHTML = list.map((ep) => {
    const models = (ep.models || [ep.model]).filter(Boolean);
    const isGlobalDefault = category === "images" ? String(ep.id) === globalDefault?.endpointId : String(ep.id) === (category === "video" ? videoDefaultId : modelDefaults[category]);
    return `<article class="provider-row">
      <div class="provider-icon" aria-hidden="true">${categories[category].icon}</div>
      <div><div class="provider-title"><h3>${esc(ep.title)}</h3><span class="provider-status ${ep.enabled ? "enabled" : ""}">${ep.enabled ? "已启用" : "已停用"}</span>${isGlobalDefault ? '<span class="global-default-badge">全局默认</span>' : ""}</div>
      <p class="provider-address">${esc(ep.apiBase)}</p>
      <div class="provider-models">${models.slice(0, 3).map((model) => `<span class="model-tag">${esc(model)}${model === ep.model ? " · 默认" : ""}</span>`).join("")}${models.length > 3 ? `<span class="model-tag">另 ${models.length - 3} 个模型</span>` : ""}</div>
      <p class="provider-meta">${ep.pricing ? esc(ep.pricing) : `API Key · ${esc(ep.keyMasked || "已保存")}`}</p></div>
      <div class="provider-actions"><button class="btn sm" data-edit="${esc(ep.id)}" type="button">管理</button><details class="provider-menu"><summary aria-label="更多操作">⋯</summary><div class="provider-menu-content"><button type="button" data-default="${esc(ep.id)}"${!ep.enabled || isGlobalDefault ? " disabled" : ""}>${isGlobalDefault ? "当前全局默认" : "设为全局默认"}</button>${category === "images" ? `<button type="button" data-refresh="${esc(ep.id)}">刷新模型</button>` : ""}<button type="button" data-toggle="${esc(ep.id)}">${ep.enabled ? "停用服务" : "启用服务"}</button><button class="destructive" type="button" data-delete="${esc(ep.id)}">删除服务</button></div></details></div>
    </article>`;
  }).join("");
}
async function load() {
  const kinds = ["images", "prompt", "video", "audio"];
  const results = await Promise.allSettled(kinds.map((kind) => apiGet("/api/" + (kind === "images" ? "image" : kind) + "-config")));
  results.forEach((result, i) => {
    const kind = kinds[i];
    if (result.status === "rejected") { errors[kind] = result.reason.message; return; }
    delete errors[kind];
    if (kind === "images") { endpoints = result.value.endpoints || []; globalDefault = result.value.defaultTarget || null; $("schedule").value = result.value.schedule || "round_robin"; }
    else { configs[kind] = result.value.config || {}; if (kind === "video") { videoEndpoints = result.value.endpoints || []; videoDefaultId = result.value.defaultId || ""; } else { modelEndpoints[kind] = result.value.endpoints || []; modelDefaults[kind] = result.value.defaultId || ""; } }
  });
  render();
}
function setModels(models, selected = "") {
  const unique = [...new Set(models.filter(Boolean))];
  availableModels = unique;
  $("serviceModel").replaceChildren(new Option(unique.length ? "请选择默认模型" : "请先拉取模型", ""), ...unique.map((model) => new Option(model, model)));
  $("serviceModel").value = unique.includes(selected) ? selected : "";
}
function openEditor(id) {
  const list = category === "images" ? endpoints : category === "video" ? videoEndpoints : modelEndpoints[category] || [];
  editing = list.find(ep => String(ep.id) === String(id)) || null;
  $("serviceForm").reset();
  message("formMessage");
  modelVersion++;
  $("fetchModels").disabled = false;
  $("dialogTitle").textContent = `${editing ? "管理" : "添加"}${categories[category].title}服务`;
  $("dialogDescription").textContent = category === "video" ? "填写 API 地址和密钥后，可拉取模型或手动填写。" : "保存后，对应的创作模块将共用这份配置。";
  $("videoProtocolField").hidden = category !== "video";
  $("videoPricing").hidden = category !== "video";
  $("videoProtocol").value = editing?.protocol || "openai_video";
  $("videoPricing").querySelector("span").textContent = $("videoProtocol").value === "grsai_veo" ? "站内每次积分" : "站内每秒积分";
  $("videoCredits").value = editing?.creditsPerSecond ?? "";
  $("labelField").hidden = false;
  $("urlField").hidden = false;
  $("videoModelField").hidden = category === "images";
  $("audioPricing").hidden = category !== "audio";
  $("serviceLabel").value = editing?.label || "";
  $("serviceUrl").value = editing?.apiBase || "";
  $("serviceUrl").required = true;
  $("videoModel").value = category !== "images" ? editing?.model || "" : "";
  $("serviceKey").value = "";
  $("keyHint").textContent = editing ? "留空保留已保存的密钥。" : "仅用于连接当前服务。";
  setModels(editing?.models || [editing?.model], editing?.model);
  $("modelHint").textContent = "从 API 获取模型列表后选择；返回列表可能包含非视频模型，请按服务商说明选择。";
  $("charactersPerCredit").value = editing?.charactersPerCredit || 1000;
  $("creditsPerUnit").value = editing?.creditsPerUnit || 1;
  $("serviceDialog").showModal();
}
function closeEditor() {
  if (saving) return;
  modelVersion++;
  $("serviceDialog").close();
  $("serviceKey").value = "";
}
async function discover() {
  const version = ++modelVersion;
  $("fetchModels").disabled = true;
  message("formMessage", "正在拉取模型…");
  try {
    const data = await apiPost("/api/image-config", {
      action: "discover_models",
      apiBase: $("serviceUrl").value.trim(), apiKey: $("serviceKey").value.trim(),
      sourceType: category, id: editing?.id,
    });
    if (version !== modelVersion) return;
    setModels(data.models || [], $("serviceModel").value);
    $("modelHint").textContent = `已获取 ${data.models.length} 个模型，请选择用于${categories[category].title}的模型。`;
    message("formMessage");
  } catch (error) { if (version === modelVersion) message("formMessage", error.message, "error"); }
  finally { if (version === modelVersion) $("fetchModels").disabled = false; }
}
async function save(event) {
  event.preventDefault();
  if (saving) return;
  const model = category !== "images" ? $("videoModel").value.trim() || $("serviceModel").value : $("serviceModel").value;
  if (!model) return message("formMessage", category !== "images" ? "请填写模型或拉取后选择模型" : "请拉取并选择一个默认模型", "error");
  const input = { apiBase: $("serviceUrl").value.trim(), apiKey: $("serviceKey").value.trim(), model };
  saving = true; $("saveService").disabled = true;
  try {
    if (category === "images") {
      await apiPost("/api/image-config", { ...input, action: editing ? "update" : "add", id: editing?.id, label: $("serviceLabel").value.trim(), models: [model, ...availableModels.filter((item) => item !== model)] });
    } else {
      if (category === "audio") Object.assign(input, { charactersPerCredit: Number($("charactersPerCredit").value), creditsPerUnit: Number($("creditsPerUnit").value) });
      if (category === "video") Object.assign(input, { protocol: $("videoProtocol").value, creditsPerSecond: $("videoCredits").value });
      await apiPost("/api/" + category + "-config", { ...input, action: editing ? "update" : "add", id: editing?.id, label: $("serviceLabel").value.trim() });
    }
    await load();
    saving = false;
    closeEditor();
    message("pageMessage", "服务配置已保存", "success");
  } catch (error) { message("formMessage", error.message, "error"); }
  finally { saving = false; $("saveService").disabled = false; }
}
async function imageAction(action, id) {
  const endpoint = (category === "video" ? videoEndpoints : category === "images" ? endpoints : modelEndpoints[category] || []).find((ep) => String(ep.id) === id);
  if (!endpoint) return;
  if (action === "delete" && !window.confirm(`删除「${endpoint.label || "图像服务"}」？`)) return;
  message("pageMessage", "正在更新服务…");
  try {
    const data = await apiPost("/api/" + (category === "images" ? "image" : category) + "-config", { action, id, ...(action === "toggle" ? { enabled: !endpoint.enabled } : {}) });
    if (category !== "images") await load();
    else { endpoints = data.endpoints; globalDefault = data.defaultTarget || null; }
    render();
    message("pageMessage", action === "set_default" ? "已设为全局默认，跟随默认的模块将优先使用此节点与其默认模型" : "服务已更新", "success");
  } catch (error) { message("pageMessage", error.message, "error"); }
}
async function main() {
  const ctx = await mountLayout({ active: "config", title: "配置中心", crumb: "SETTINGS" });
  if (!ctx) return;
  document.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => { category = button.dataset.category; message("pageMessage"); render(); }));
  $("addService").addEventListener("click", () => openEditor());
  $("closeDialog").addEventListener("click", closeEditor);
  $("cancelDialog").addEventListener("click", closeEditor);
  $("serviceDialog").addEventListener("cancel", (event) => { if (saving) event.preventDefault(); else { modelVersion++; $("serviceKey").value = ""; } });
  $("serviceForm").addEventListener("submit", save);
  $("fetchModels").addEventListener("click", discover);
  $("serviceModel").addEventListener("change", () => { if (category !== "images") $("videoModel").value = ""; });
  $("videoProtocol").addEventListener("change", () => {
    const presets = { openai_video: ["", ""], agnes: ["https://apihub.agnes-ai.com/v1", "agnes-video-v2.0"], wan3: ["https://dashscope.aliyuncs.com/api/v1", "wan3.0-video"], wan26: ["https://dashscope.aliyuncs.com/api/v1", "wan2.6-t2v"], minimax_h3: ["https://api.minimax.io", "MiniMax-H3"], grsai_veo: ["https://grsai.dakka.com.cn", "veo3.1-fast"] };
    const [base, model] = presets[$("videoProtocol").value];
    $("serviceUrl").value = base;
    $("videoModel").value = model;
    $("videoPricing").querySelector("span").textContent = $("videoProtocol").value === "grsai_veo" ? "站内每次积分" : "站内每秒积分";
    $("serviceKey").value = "";
    setModels([]);
    $("keyHint").textContent = "协议或地址变更时请重新输入密钥。";
  });
  for (const id of ["serviceUrl", "serviceKey"]) $(id).addEventListener("input", () => { modelVersion++; $("fetchModels").disabled = false; setModels([]); });
  $("providerList").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-add")) openEditor();
    else if (button.hasAttribute("data-retry")) load();
    else if (button.dataset.edit) openEditor(button.dataset.edit);
    else if (button.dataset.default) imageAction("set_default", button.dataset.default);
    else if (button.dataset.refresh) { openEditor(button.dataset.refresh); discover(); }
    else if (button.dataset.toggle) imageAction("toggle", button.dataset.toggle);
    else if (button.dataset.delete) imageAction("delete", button.dataset.delete);
  });
  $("schedule").addEventListener("change", async () => {
    try { await apiPost("/api/image-config", { action: "schedule", schedule: $("schedule").value }); message("pageMessage", "调度策略已保存", "success"); }
    catch (error) { message("pageMessage", error.message, "error"); await load(); }
  });
  $("resetCache").addEventListener("click", async () => {
    if (!window.confirm("确认清理当前账户的生成图片缓存？此操作无法撤销。")) return;
    $("resetCache").disabled = true;
    try { await apiPost("/api/image-sets/reset", {}); message("pageMessage", "缓存已清理", "success"); }
    catch (error) { message("pageMessage", error.message, "error"); }
    finally { $("resetCache").disabled = false; }
  });
  await load();
}
main().catch((error) => message("pageMessage", error.message, "error"));
