import { mountLayout } from "/shared/layout.js";
import { apiGet, apiPost, apiUpload, apiDelete } from "/shared/api.js";
import { escapeHtml, parseTags, tagsHtml, thumbHtml, kindLabels, setStatus, loadingHtml, emptyHtml, createDialog, confirmRemoval, showAsset, requestMutation, transferToWorkbench } from "/shared/creative-picker.js";
import { listTotal } from "/shared/creative-utils.js";

const $ = (id) => document.getElementById(id);
let user;
let page = 1;
let version = 0;
let items = [];

async function loadAssets() {
  const current = ++version;
  const query = new URLSearchParams(new FormData($("searchForm")));
  query.set("page", String(page)); query.set("pageSize", "18");
  $("assetList").innerHTML = loadingHtml(); $("assetList").setAttribute("aria-busy", "true");
  $("previousPage").disabled = true; $("nextPage").disabled = true;
  setStatus($("status"), "正在加载素材…");
  try {
    const data = await apiGet(`/api/assets?${query}`);
    if (current !== version) return;
    items = data.items || [];
    $("assetList").innerHTML = items.map((item, index) => `<article class="creative-card"><button class="creative-thumb" type="button" data-action="detail" data-index="${index}" aria-label="查看${escapeHtml(item.title || kindLabels[item.kind])}">${thumbHtml(item)}</button><div class="creative-card-body"><span class="creative-meta">${kindLabels[item.kind] || "素材"}${item.favorite ? " · 已收藏" : ""}</span><h3>${escapeHtml(item.title || "未命名素材")}</h3>${item.kind === "text" ? `<p class="creative-excerpt">${escapeHtml(item.content)}</p>` : ""}<div class="creative-tags">${tagsHtml(item.tags)}</div><div class="creative-actions">${["image", "text"].includes(item.kind) ? `<button class="btn sm primary" type="button" data-action="use" data-index="${index}">引用创作</button>` : ""}<button class="btn sm" type="button" data-action="favorite" data-index="${index}" aria-pressed="${Boolean(item.favorite)}">${item.favorite ? "取消收藏" : "收藏"}</button><button class="btn sm" type="button" data-action="edit" data-index="${index}">编辑</button><button class="btn sm ghost" type="button" data-action="delete" data-index="${index}">删除</button></div></div></article>`).join("") || emptyHtml("还没有匹配的素材", "上传一张参考图，或新建一段常用文本开始积累素材。");
    $("previousPage").disabled = page <= 1;
    $("nextPage").disabled = page * 18 >= listTotal(data);
    $("pageLabel").textContent = `第 ${page} 页 · 共 ${listTotal(data)} 项`;
    setStatus($("status"), "");
  } catch (error) {
    if (current !== version) return;
    $("assetList").innerHTML = emptyHtml("素材暂时无法加载", "点击搜索重试。"); setStatus($("status"), error.message, "error");
  } finally { if (current === version) $("assetList").removeAttribute("aria-busy"); }
}

function editAsset(item = {}) {
  const isNew = !item.id;
  const dialog = createDialog(isNew ? "新建文本素材" : "编辑素材", `<form><label class="field"><span>名称</span><input class="input" name="title" value="${escapeHtml(item.title || "")}" maxlength="160" required /></label>${isNew ? '<label class="field"><span>文本内容</span><textarea class="textarea" name="content" rows="8" required placeholder="例如：品牌色、产品描述或固定拍摄要求"></textarea></label>' : item.kind === "text" ? `<p class="creative-note">修改名称与标签不会改变已有引用中的文本内容。</p><pre class="creative-detail-content">${escapeHtml(item.content || "")}</pre>` : ""}<label class="field"><span>标签（逗号分隔）</span><input class="input" name="tags" value="${escapeHtml(parseTags(item.tags).join(", "))}" /></label><p class="creative-status" role="status" data-status></p><button class="btn primary" type="submit">保存素材</button></form>`);
  const form = dialog.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(form)); const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const payload = { title: values.title.trim(), tags: parseTags(values.tags) };
      if (isNew) await apiPost("/api/assets", { ...payload, kind: "text", content: values.content.trim() });
      else await requestMutation(`/api/assets/${encodeURIComponent(item.id)}`, "PATCH", payload);
      dialog.close(); await loadAssets(); setStatus($("status"), "素材已保存", "success");
    } catch (error) { setStatus(dialog.querySelector("[data-status]"), error.message, "error"); } finally { button.disabled = false; }
  });
}

function uploadAsset() {
  const dialog = createDialog("上传素材", `<form><label class="field"><span>文件</span><input class="input" name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,audio/aac,audio/flac" required /></label><label class="field"><span>名称（可选）</span><input class="input" name="title" maxlength="160" placeholder="默认使用文件名" /></label><p class="creative-note">支持常见图片、视频与音频格式，最大 20MB，上传后仅自己可见。</p><p class="creative-status" role="status" data-status></p><button class="btn primary" type="submit">上传到素材库</button></form>`);
  const form = dialog.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true; button.textContent = "上传中…";
    try { await apiUpload("/api/assets/upload", new FormData(form)); dialog.close(); await loadAssets(); setStatus($("status"), "素材上传成功", "success"); }
    catch (error) { setStatus(dialog.querySelector("[data-status]"), error.message, "error"); } finally { button.disabled = false; button.textContent = "上传到素材库"; }
  });
}

async function main() {
  const context = await mountLayout({ active: "assets", title: "素材库", crumb: "创作资源" }); if (!context) return; user = context.me;
  const kind = new URLSearchParams(location.search).get("kind"); if (kind && kindLabels[kind]) $("searchForm").elements.kind.value = kind;
  $("newText").addEventListener("click", () => editAsset()); $("uploadAsset").addEventListener("click", uploadAsset);
  $("searchForm").addEventListener("submit", (event) => { event.preventDefault(); page = 1; loadAssets(); });
  $("previousPage").addEventListener("click", () => { page -= 1; loadAssets(); }); $("nextPage").addEventListener("click", () => { page += 1; loadAssets(); });
  $("assetList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]"); if (!button) return; const item = items[Number(button.dataset.index)]; if (!item) return;
    try {
      if (button.dataset.action === "detail") showAsset(item);
      if (button.dataset.action === "edit") editAsset(item);
      if (button.dataset.action === "use") transferToWorkbench(user.id, item, "asset");
      if (button.dataset.action === "favorite") { button.disabled = true; await requestMutation(`/api/assets/${encodeURIComponent(item.id)}`, "PATCH", { favorite: !item.favorite }); await loadAssets(); }
      if (button.dataset.action === "delete" && await confirmRemoval(item.title)) { button.disabled = true; await apiDelete(`/api/assets/${encodeURIComponent(item.id)}`); await loadAssets(); }
    } catch (error) { setStatus($("status"), error.message, "error"); button.disabled = false; }
  });
  await loadAssets();
}
main().catch((error) => { $("page").style.visibility = "visible"; setStatus($("status"), error.message, "error"); });
