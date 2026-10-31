import { mountLayout, setCredits } from "/shared/layout.js";
import { apiGet, apiPost, apiUpload, downloadJsonFile } from "/shared/api.js";
import { escapeHtml } from "/shared/creative-utils.js";
import { previewUrl } from "/shared/media.js";
import { mountImageTargetDrawer } from "/shared/image-target.js";
import { PRODUCT_SLOTS, PRODUCT_TEMPLATES, buildProductPrompts } from "./templates.js";

const $ = id => document.getElementById(id);
let user, target, source = null, selectedTemplate = "clean", pending = null, results = [], lastTypes = [], lastErrors = {};
let submitting = false, uploading = false, polling = false, paused = false;
let storageKey = "";

function load() {
  try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return {}; }
}
function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ selectedTemplate, source, pending, results, lastTypes, lastErrors, productName: $("productName").value, productNotes: $("productNotes").value, selected: selectedTypes(), ratio: $("ratio").value, resolution: $("resolution").value }));
    return true;
  } catch { return false; }
}
function setError(message = "") { $("setupError").textContent = message; }
function selectedTypes() { return [...document.querySelectorAll('#slotList input:checked')].map(input => input.value); }
function currentTemplate() { return PRODUCT_TEMPLATES.find(item => item.id === selectedTemplate) || PRODUCT_TEMPLATES[0]; }

function renderTemplates() {
  $("templateGrid").innerHTML = PRODUCT_TEMPLATES.map(item => `<button class="product-template" type="button" data-template="${escapeHtml(item.id)}" aria-pressed="${item.id === selectedTemplate}"><div class="product-template-image" style="--sample-color:${item.accent}"><img src="/assets/product-templates/${item.image}" alt="${escapeHtml(item.category)}商品示例" loading="lazy" /><span class="product-template-check" aria-hidden="true">✓</span></div><span class="product-template-title">${escapeHtml(item.title)}</span><span class="product-template-desc">${escapeHtml(item.description)}</span></button>`).join("");
  const template = currentTemplate();
  $("chosenTemplate").innerHTML = `<span>当前模板</span><strong>${escapeHtml(template.title)}</strong>`;
}
function renderSlots(selected = PRODUCT_SLOTS.map(slot => slot.id)) {
  $("slotList").innerHTML = PRODUCT_SLOTS.map(slot => `<label class="product-slot"><input type="checkbox" value="${slot.id}" ${selected.includes(slot.id) ? "checked" : ""} /><span>${slot.title}</span></label>`).join("");
  syncState();
}
function renderSource() {
  const valid = source?.id && /^\/api\/images\/file\//.test(source.url || "");
  $("sourcePreview").hidden = !valid;
  $("uploadButton").hidden = Boolean(valid);
  if (valid) $("sourceImage").src = previewUrl(source.url);
}
function syncState() {
  const count = selectedTypes().length;
  $("selectedCount").textContent = `已选 ${count} 张`;
  $("costLabel").textContent = `${count} 积分`;
  $("generate").disabled = !target?.configured || !source?.id || !count || submitting || uploading || Boolean(pending);
  $("generate").textContent = submitting ? "正在提交…" : pending ? "任务处理中" : `一键生成 ${count} 张`;
  $("uploadButton").disabled = uploading || submitting || Boolean(pending);
  $("replaceSource").disabled = uploading || submitting || Boolean(pending);
  $("resumeTask").hidden = !pending?.taskId || polling;
  $("clearTask").hidden = !pending || polling || (!paused && Boolean(pending.taskId));
  $("downloadAll").disabled = !results.length;
  $("setupHint").textContent = !target?.configured ? "请先在配置中心添加可用的生图服务。" : pending ? "任务尚未确认完成，请勿重复提交。" : "每张预占 1 积分，完成后按成功张数结算；未成功的积分退回。";
}
function renderResults() {
  const types = pending?.types || lastTypes;
  if (!types.length) {
    $("resultGrid").innerHTML = '<div class="product-result-empty">上传商品图并选择模板后，生成结果会显示在这里。</div>';
    return;
  }
  $("resultGrid").innerHTML = types.map(type => {
    const slot = PRODUCT_SLOTS.find(item => item.id === type);
    const image = results.find(item => item.type === type);
    const safeUrl = image && /^\/api\/images\/file\//.test(image.url || "") ? previewUrl(image.url) : "";
    const body = safeUrl ? `<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(slot?.title || "商品图")}" />` : `<span>${escapeHtml(lastErrors[type] || (pending ? "等待生成" : "未生成"))}</span>`;
    const action = image?.downloadUrl && /^\/api\/images\/download\//.test(image.downloadUrl) ? `<a href="${escapeHtml(image.downloadUrl)}" download>下载</a>` : "";
    return `<article class="product-result"><div class="product-result-image">${body}</div><div class="product-result-meta"><strong>${escapeHtml(slot?.title || "商品图")}</strong>${action}</div></article>`;
  }).join("");
}
async function upload(file) {
  if (!file || uploading || pending) return;
  uploading = true; setError(); syncState();
  try {
    const form = new FormData(); form.append("image", file);
    const data = await apiUpload("/api/product-sets/source", form);
    source = data.image; renderSource(); save();
  } catch (error) { setError(error.message); }
  finally { uploading = false; syncState(); }
}
async function refreshCredits() {
  try { const data = await apiGet("/api/auth/me"); if (typeof data.user?.credits === "number") setCredits(data.user.credits); } catch { /* 余额稍后由布局刷新 */ }
}
async function poll(taskId) {
  if (!taskId || polling) return;
  polling = true; paused = false; syncState();
  try {
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline && pending?.taskId === taskId) {
      const task = await apiGet(`/api/tasks/${encodeURIComponent(taskId)}`);
      if (Array.isArray(task.partial?.images)) { results = task.partial.images; renderResults(); }
      if (task.status === "done") {
        results = Object.values(task.result?.results || {}); lastErrors = task.result?.errors || {}; lastTypes = pending.types;
        const count = results.length;
        pending = null; paused = false;
        $("taskStatus").textContent = `已完成 ${count} 张${count < lastTypes.length ? `，${lastTypes.length - count} 张未成功` : ""}。按成功张数结算，作品已保存到我的图库。`;
        if (typeof task.result?.credits === "number") setCredits(task.result.credits);
        save(); renderResults(); return;
      }
      if (task.status === "error") {
        lastTypes = pending.types; pending = null; paused = false;
        $("taskStatus").textContent = task.error || "套图生成失败";
        await refreshCredits(); save(); renderResults(); return;
      }
      if (task.status === "interrupted") { paused = true; $("taskStatus").textContent = `任务中断，预占积分暂未结算。${task.error || "请先查看图库，确认结果后联系管理员处理，勿重复提交。"}`; return; }
      $("taskStatus").textContent = `正在生成，已完成 ${results.length} / ${pending.types.length} 张；任务完成后统一结算。`;
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
    paused = true; $("taskStatus").textContent = "任务仍在处理中，请稍后重新查询，勿重复提交。";
  } catch (error) { paused = true; $("taskStatus").textContent = `查询中断：${error.message}。请重新查询，勿重复提交。`; }
  finally { polling = false; save(); syncState(); }
}
async function generate() {
  if (pending || submitting || uploading || !target?.configured || !source?.id) return;
  const types = selectedTypes();
  let prompts;
  try { prompts = buildProductPrompts(selectedTemplate, $("productName").value, $("productNotes").value, types); }
  catch (error) { setError(error.message); return; }
  const [rw, rh] = $("ratio").value.split(":").map(Number);
  const payload = { templateId: selectedTemplate, imageSetId: source.imageSetId, mainImageId: source.id, types, prompts, imageSpec: { sizeMode: "preset", sizePreset: $("resolution").value, ratioPreset: $("ratio").value, customRatioWidth: rw, customRatioHeight: rh }, ...target.value() };
  pending = { taskId: "", types, templateId: selectedTemplate }; results = []; lastErrors = {}; lastTypes = types; submitting = true; paused = false;
  if (!save()) { pending = null; submitting = false; setError("无法保存任务状态，请允许浏览器本地存储后重试"); syncState(); return; }
  setError(); $("taskStatus").textContent = "正在提交整套生成任务…"; renderResults(); syncState();
  try {
    const data = await apiPost("/api/product-sets/generate", payload);
    if (!data.taskId) throw new Error("未收到任务编号，请先查看图库");
    pending.taskId = data.taskId; save(); await refreshCredits();
    submitting = false; poll(data.taskId);
  } catch (error) {
    if (error.status && error.status < 500) { pending = null; $("taskStatus").textContent = ""; setError(error.message); }
    else { paused = true; $("taskStatus").textContent = "提交结果未确认。请先查看图库或任务记录，确认后再解除关联，避免重复生成。"; }
    save();
  } finally { submitting = false; syncState(); }
}

async function main() {
  const ctx = await mountLayout({ active: "product-sets", title: "电商套图", crumb: "创作工具" });
  if (!ctx) return;
  user = ctx.me; storageKey = `imageStudio:productSets:${user.id}:v1`;
  const saved = load();
  selectedTemplate = PRODUCT_TEMPLATES.some(item => item.id === saved.selectedTemplate) ? saved.selectedTemplate : "clean";
  source = saved.source || null; pending = saved.pending || null; results = Array.isArray(saved.results) ? saved.results : []; lastTypes = Array.isArray(saved.lastTypes) ? saved.lastTypes : []; lastErrors = saved.lastErrors || {};
  $("productName").value = saved.productName || ""; $("productNotes").value = saved.productNotes || "";
  if (["1:1", "3:4", "4:3", "9:16", "16:9"].includes(saved.ratio)) $("ratio").value = saved.ratio;
  if (["1k", "2k"].includes(saved.resolution)) $("resolution").value = saved.resolution;
  renderTemplates(); renderSlots(Array.isArray(saved.selected) ? saved.selected : undefined); renderSource(); renderResults();
  try { target = await mountImageTargetDrawer($("imageTarget"), { storageKey: `imageStudio:target:${user.id}:product-sets` }); }
  catch (error) { setError(`生图配置加载失败：${error.message}`); }
  $("templateGrid").addEventListener("click", event => { const button = event.target.closest("[data-template]"); if (!button) return; selectedTemplate = button.dataset.template; renderTemplates(); save(); });
  $("slotList").addEventListener("change", () => { syncState(); save(); });
  $("uploadButton").addEventListener("click", () => $("productFile").click());
  $("replaceSource").addEventListener("click", () => $("productFile").click());
  $("productFile").addEventListener("change", event => { const file = event.target.files?.[0]; event.target.value = ""; upload(file); });
  for (const id of ["productName", "productNotes", "ratio", "resolution"]) $(id).addEventListener("input", save);
  $("generate").addEventListener("click", generate);
  $("resumeTask").addEventListener("click", () => poll(pending?.taskId));
  $("clearTask").addEventListener("click", () => { if (!pending || !window.confirm("解除关联不会取消上游任务或改变积分结算。请先确认任务状态，确定继续吗？")) return; lastTypes = pending.types || []; pending = null; paused = false; $("taskStatus").textContent = "已解除本地任务关联，可到我的图库查看已生成的作品。"; save(); renderResults(); syncState(); });
  $("downloadAll").addEventListener("click", async () => { try { await downloadJsonFile("/api/images/download-all", { ids: results.map(image => image.id), imageSetId: results[0]?.imageSetId }, "product-set.zip"); } catch (error) { setError(error.message); } });
  syncState();
  if (pending?.taskId) poll(pending.taskId);
  else if (pending) { paused = true; $("taskStatus").textContent = "上次提交结果未确认，请先查看图库或任务记录，确认后再解除关联。"; syncState(); }
}
main().catch(error => { $("page").style.visibility = "visible"; setError(error.message); });
