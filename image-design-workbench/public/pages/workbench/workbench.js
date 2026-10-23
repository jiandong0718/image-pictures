import { mountLayout, setCredits } from "/shared/layout.js";
import { apiGet, apiPost, downloadFile } from "/shared/api.js";
import { escapeHtml, thumbHtml, setStatus, emptyHtml, openCreativePicker, createDialog, confirmRemoval, showAsset, consumeTransfer } from "/shared/creative-picker.js";
import { readStored, writeStored, referenceToken, mergeBatch, cloneCreativeDraft } from "/shared/creative-utils.js";

const $ = (id) => document.getElementById(id);
let user;
let assetIds = [];
let assetNames = {};
let history = [];
let schemes = [];
let configured = false;
let submitting = false;
let previewVersion = 0;
const activePolls = new Set();

function draft() { return cloneCreativeDraft({ prompt: $("prompt").value, assetIds, assetNames, model: $("model").value, count: Number($("count").value), resolution: $("resolution").value, ratio: $("ratio").value }); }
function hasInFlightGeneration() { return history.some((batch) => ["pending", "paused"].includes(batch.status)); }
function syncGenerateButton() {
  const button = $("generate");
  const inFlight = hasInFlightGeneration();
  button.disabled = submitting || inFlight || !configured || !$("prompt").value.trim();
  button.textContent = submitting ? "正在提交…" : inFlight ? "正在生成…" : "开始生成";
}
function persistDraft() {
  const saved = writeStored(user.id, "draft", draft());
  $("draftStatus").textContent = saved ? "草稿已自动保存" : "浏览器存储已满，草稿暂未保存";
  syncGenerateButton();
  previewVersion += 1; $("previewPanel").hidden = true;
  setStatus($("composeStatus"), "");
}
function applyDraft(value = {}) {
  value = cloneCreativeDraft(value);
  $("prompt").value = typeof value.prompt === "string" ? value.prompt : "";
  assetIds = Array.isArray(value.assetIds) ? [...new Set(value.assetIds.map(String))] : [];
  assetNames = value.assetNames && typeof value.assetNames === "object" ? value.assetNames : {};
  for (const [key, fallback] of [["model", ""], ["count", "1"], ["resolution", "1k"], ["ratio", "1:1"]]) {
    const select = $(key); const saved = String(value[key] ?? fallback);
    select.value = [...select.options].some((option) => option.value === saved) ? saved : fallback;
  }
  renderReferences(); persistDraft();
}
function renderReferences() {
  $("references").innerHTML = assetIds.map((id) => `<span class="creative-tag">${escapeHtml(assetNames[id] || `素材 ${id}`)}<button type="button" data-remove="${escapeHtml(id)}" aria-label="移除${escapeHtml(assetNames[id] || `素材 ${id}`)}">×</button></span>`).join("");
}
function insertText(text) {
  const input = $("prompt");
  const start = input.selectionStart ?? input.value.length; const end = input.selectionEnd ?? start;
  const prefix = start && !/\s$/.test(input.value.slice(0, start)) ? "\n" : "";
  input.setRangeText(`${prefix}${text}\n`, start, end, "end"); input.focus(); persistDraft();
}
function addAsset(item) {
  if (!["image", "text"].includes(item.kind)) throw new Error("图片创作暂时支持引用图片和文本素材");
  const id = String(item.id);
  if (!assetIds.includes(id)) assetIds.push(id);
  assetNames[id] = item.title || `素材 ${id}`;
  insertText(referenceToken(id)); renderReferences();
}
function saveHistory() { if (!writeStored(user.id, "history", history)) setStatus($("generateStatus"), "浏览器存储不足，生成记录暂未保存；已生成图片可在我的图库查看", "error"); }
function updateBatch(batch) { history = mergeBatch(history, batch); saveHistory(); renderHistory(); syncGenerateButton(); }

function renderHistory() {
  $("historyCount").textContent = `${history.length} 次创作`;
  $("history").innerHTML = history.map((batch) => `<article class="creative-batch"><div class="creative-batch-head"><div><h3>${escapeHtml(batch.title || batch.prompt?.slice(0, 45) || "图片创作")}</h3><p>${escapeHtml(new Date(batch.createdAt).toLocaleString("zh-CN"))} · ${escapeHtml(batch.model || "自动模型")} · ${batch.count || 1} 张</p></div><button class="btn sm" type="button" data-reuse="${escapeHtml(batch.id)}">复用</button></div><p class="creative-status ${batch.status === "error" ? "error" : ""}">${escapeHtml(batch.message || (batch.status === "done" ? "生成完成" : batch.status === "pending" ? "正在生成，请等待结果。" : batch.status === "paused" ? "任务状态待核对，请重新查询，不能重复提交。" : "等待处理"))}</p><div class="creative-result-grid">${(batch.images || []).map((image, index) => `<article class="creative-card"><button class="creative-thumb" type="button" data-open="${escapeHtml(batch.id)}" data-index="${index}" aria-label="查看第 ${index + 1} 张生成图片">${thumbHtml({ ...image, kind: "image", title: `生成图片 ${index + 1}` })}</button><div class="creative-card-body"><div class="creative-actions"><button class="btn sm" type="button" data-download="${escapeHtml(batch.id)}" data-index="${index}">下载</button><button class="btn sm" type="button" data-save="${escapeHtml(batch.id)}" data-index="${index}">${image.assetSaved ? "已存素材" : "存为素材"}</button></div></div></article>`).join("")}</div>${batch.status === "paused" ? `<button class="btn sm" type="button" data-resume="${escapeHtml(batch.id)}">重新查询任务</button>` : ""}</article>`).join("") || emptyHtml("第一张作品，从这里开始", "完成描述后点击“开始生成”，每次结果都会保留在这里。");
}

function buildSpec() {
  const size = { "1k": 1024, "2k": 2048, "4k": 4096 }[$("resolution").value] || 1024;
  const [rw, rh] = $("ratio").value.split(":").map(Number);
  const width = rw >= rh ? size : Math.round(size * rw / rh);
  const height = rh >= rw ? size : Math.round(size * rh / rw);
  return { sizeMode: "preset", sizePreset: $("resolution").value, customSize: size, ratioPreset: $("ratio").value, customRatioWidth: rw, customRatioHeight: rh, width, height, ratio: `${rw}:${rh}`, requestSize: `${width}x${height}` };
}

async function resolveComposition(snapshot = draft()) {
  return apiPost("/api/compositions/resolve", { text: snapshot.prompt, assetIds: snapshot.assetIds });
}

async function pollBatch(batch) {
  if (activePolls.has(batch.id)) return;
  activePolls.add(batch.id); const deadline = Date.now() + 10 * 60 * 1000;
  updateBatch({ id: batch.id, status: "pending", message: "正在生成…" });
  try {
    while (Date.now() < deadline) {
      const data = await apiGet(`/api/tasks/${encodeURIComponent(batch.taskId)}`);
      if (data.partial?.images?.length) updateBatch({ id: batch.id, images: data.partial.images, message: `已完成 ${data.partial.images.length}/${batch.count || 1} 张` });
      if (data.status === "done") {
        const images = data.result?.images || [];
        updateBatch({ id: batch.id, images, status: "done", message: `已生成 ${images.length} 张图片` });
        if (typeof data.result?.credits === "number") setCredits(data.result.credits);
        return;
      }
      if (data.status === "interrupted") { updateBatch({ id: batch.id, status: "paused", message: data.error || "任务已中断，状态正在核对中。可稍后重新查询，请勿重复提交。" }); return; }
      if (data.status === "error") { updateBatch({ id: batch.id, status: "error", message: data.error || "生成失败" }); return; }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    updateBatch({ id: batch.id, status: "paused", message: "任务仍在处理中，可稍后重新查询。请勿重复提交。" });
  } catch (error) { updateBatch({ id: batch.id, status: "paused", message: `查询中断：${error.message}。可重新查询任务。` }); }
  finally { activePolls.delete(batch.id); }
}

async function generate() {
  if (submitting || !configured) return;
  const snapshot = draft(); if (!snapshot.prompt.trim()) return setStatus($("generateStatus"), "请先填写创作提示词", "error");
  const spec = buildSpec(); submitting = true; syncGenerateButton();
  setStatus($("generateStatus"), "正在解析素材并提交任务…");
  try {
    const resolved = await resolveComposition(snapshot);
    const response = await apiPost("/api/playground/images", { prompt: resolved.prompt, mode: resolved.imageIds?.length ? "edit" : "generate", referenceImageIds: resolved.imageIds || [], referenceImageId: resolved.imageIds?.[0] || "", model: snapshot.model, count: snapshot.count, imageSpec: spec });
    if (!response.taskId) throw new Error("接口没有返回任务编号，请检查我的图库后再操作");
    const batch = { id: String(response.taskId), taskId: response.taskId, createdAt: new Date().toISOString(), prompt: resolved.prompt, draft: snapshot, model: snapshot.model, count: snapshot.count, status: "pending", images: [] };
    updateBatch(batch); setStatus($("generateStatus"), "任务已提交，正在生成，请等待结果…"); pollBatch(batch);
  } catch (error) { setStatus($("generateStatus"), error.message, "error"); }
  finally { submitting = false; persistDraft(); }
}

function renderSchemes() {
  $("schemes").innerHTML = schemes.map((scheme) => `<div class="creative-row"><span class="creative-tag">${escapeHtml(scheme.title)}</span><button class="btn sm" type="button" data-load-scheme="${escapeHtml(scheme.id)}">载入</button><button class="btn sm ghost" type="button" data-delete-scheme="${escapeHtml(scheme.id)}">删除</button></div>`).join("") || '<p class="creative-meta">还没有保存方案</p>';
}

async function saveAsPrompt() {
  if (!$("prompt").value.trim()) return setStatus($("composeStatus"), "先写下创作提示词再保存", "error");
  const dialog = createDialog("保存为我的提示词", '<form><label class="field"><span>提示词名称</span><input class="input" name="title" maxlength="160" required /></label><p class="creative-note">保存时会展开文本素材。图片参考和模型设置可通过“保存当前方案”保留。</p><p class="creative-status" data-status role="status"></p><button class="btn primary" type="submit">保存</button></form>');
  const snapshot = draft();
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault(); const button = dialog.querySelector('[type="submit"]'); button.disabled = true;
    try { const resolved = await resolveComposition(snapshot); await apiPost("/api/prompts", { title: new FormData(event.target).get("title").trim(), content: resolved.prompt, tags: [] }); dialog.close(); setStatus($("composeStatus"), "已保存到个人提示词中心", "success"); }
    catch (error) { setStatus(dialog.querySelector("[data-status]"), error.message, "error"); } finally { button.disabled = false; }
  });
}

async function main() {
  const context = await mountLayout({ active: "workbench", title: "创作工作台", crumb: "自由创作" }); if (!context) return; user = context.me;
  const saved = readStored(user.id, "draft", {});
  history = readStored(user.id, "history", []); if (!Array.isArray(history)) history = [];
  schemes = readStored(user.id, "schemes", []); if (!Array.isArray(schemes)) schemes = [];
  renderHistory(); renderSchemes();
  try {
    const data = await apiGet("/api/image-config"); configured = Boolean(data.config?.uploaded);
    $("model").innerHTML = '<option value="">自动选择</option>' + (data.models || []).map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("");
    $("configHint").textContent = configured ? "每张图片按当前生图规则扣除积分，任务提交后将在生成记录中显示。" : "尚未配置可用生图服务，请联系管理员在配置中心设置。";
  } catch (error) { $("configHint").textContent = `生图配置加载失败：${error.message}，请刷新后重试。`; }
  applyDraft(saved);
  const incoming = consumeTransfer(user.id);
  if (incoming?.item) { if (incoming.type === "asset") addAsset(incoming.item); else insertText(incoming.item.content || incoming.item.prompt || ""); }
  $("prompt").addEventListener("input", persistDraft);
  ["model", "count", "resolution", "ratio"].forEach((id) => $(id).addEventListener("change", persistDraft));
  $("pickPrompt").addEventListener("click", () => openCreativePicker({ type: "prompts", onSelect: (item) => insertText(item.content || item.prompt || "") }));
  $("pickAsset").addEventListener("click", () => openCreativePicker({ kinds: ["image", "text"], onSelect: addAsset }));
  $("references").addEventListener("click", (event) => { const button = event.target.closest("[data-remove]"); if (!button) return; const id = button.dataset.remove; assetIds = assetIds.filter((value) => value !== id); delete assetNames[id]; $("prompt").value = $("prompt").value.split(referenceToken(id)).join(""); renderReferences(); persistDraft(); });
  $("previewComposition").addEventListener("click", async () => {
    const current = ++previewVersion; $("previewComposition").disabled = true; setStatus($("composeStatus"), "正在解析引用…");
    try { const data = await resolveComposition(); if (current !== previewVersion) return; $("resolvedPrompt").textContent = data.prompt; $("previewMeta").textContent = `包含 ${data.imageIds?.length || 0} 张参考图`; $("previewPanel").hidden = false; setStatus($("composeStatus"), ""); }
    catch (error) { if (current === previewVersion) setStatus($("composeStatus"), error.message, "error"); } finally { $("previewComposition").disabled = false; }
  });
  $("savePrompt").addEventListener("click", saveAsPrompt); $("generate").addEventListener("click", generate);
  $("saveScheme").addEventListener("click", () => {
    const title = $("schemeName").value.trim(); if (!title) return setStatus($("schemeStatus"), "请输入方案名称", "error");
    schemes.unshift({ id: crypto.randomUUID(), title, draft: draft() });
    if (!writeStored(user.id, "schemes", schemes)) { schemes.shift(); return setStatus($("schemeStatus"), "浏览器存储不足，方案未保存", "error"); }
    renderSchemes(); $("schemeName").value = ""; setStatus($("schemeStatus"), "方案已保存", "success");
  });
  $("schemes").addEventListener("click", async (event) => {
    const load = event.target.closest("[data-load-scheme]"); const remove = event.target.closest("[data-delete-scheme]");
    if (load) { const scheme = schemes.find((item) => item.id === load.dataset.loadScheme); if (scheme) { applyDraft(scheme.draft); setStatus($("schemeStatus"), `已载入「${scheme.title}」`, "success"); } }
    if (remove) { const scheme = schemes.find((item) => item.id === remove.dataset.deleteScheme); if (scheme && await confirmRemoval(scheme.title)) { schemes = schemes.filter((item) => item.id !== scheme.id); writeStored(user.id, "schemes", schemes); renderSchemes(); } }
  });
  $("history").addEventListener("click", async (event) => {
    const button = event.target.closest("button"); if (!button) return;
    const id = button.dataset.reuse || button.dataset.open || button.dataset.download || button.dataset.save || button.dataset.resume; const batch = history.find((item) => item.id === id); if (!batch) return;
    try {
      if (button.dataset.reuse) { applyDraft(batch.draft || { prompt: batch.prompt, model: batch.model }); $("prompt").focus(); return; }
      if (button.dataset.resume) { pollBatch(batch); return; }
      const image = batch.images?.[Number(button.dataset.index)]; if (!image) return;
      if (button.dataset.open) showAsset({ ...image, kind: "image", title: "生成图片" });
      if (button.dataset.download) await downloadFile(image.downloadUrl || image.url, image.filename || "image.png");
      if (button.dataset.save && !image.assetSaved) { button.disabled = true; await apiPost("/api/assets", { kind: "image", mediaId: image.id, title: batch.prompt.slice(0, 100) || "生成图片", tags: [] }); image.assetSaved = true; saveHistory(); renderHistory(); }
    } catch (error) { setStatus($("generateStatus"), error.message, "error"); button.disabled = false; }
  });
  history.filter((batch) => batch.taskId && batch.status === "pending").forEach(pollBatch);
}
main().catch((error) => { $("page").style.visibility = "visible"; setStatus($("generateStatus"), error.message, "error"); });
