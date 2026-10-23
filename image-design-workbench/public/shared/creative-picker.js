import { apiGet } from "./api.js";
import { escapeHtml, parseTags, thumbnailUrl, mediaUrl, storageKey, listTotal } from "./creative-utils.js";

export { escapeHtml, parseTags, thumbnailUrl, mediaUrl } from "./creative-utils.js";
export const kindLabels = { text: "文本", image: "图片", video: "视频", audio: "音频" };

export function setStatus(element, message = "", kind = "") {
  element.textContent = message;
  element.className = `creative-status ${kind}`;
}

export function tagsHtml(tags) {
  return parseTags(tags).map((tag) => `<span class="creative-tag">${escapeHtml(tag)}</span>`).join("");
}

export function loadingHtml(count = 3) {
  return `<span class="creative-sr-only">正在加载</span>${Array.from({ length: count }, () => '<div class="creative-loading" aria-hidden="true"></div>').join("")}`;
}

export function emptyHtml(title, description = "") {
  return `<div class="creative-empty"><strong>${escapeHtml(title)}</strong>${description ? `<p>${escapeHtml(description)}</p>` : ""}</div>`;
}

export function thumbHtml(item) {
  if (item.kind === "image") return `<img src="${escapeHtml(thumbnailUrl(item))}" alt="${escapeHtml(item.title || "图片素材")}" loading="lazy" decoding="async" />`;
  return `<span class="creative-media-label">${escapeHtml(kindLabels[item.kind] || "文本")}</span>`;
}

export async function requestMutation(url, method, body) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) location.href = `/?auth=login&redirect=${encodeURIComponent(location.pathname)}`;
  if (!response.ok) throw new Error(data.details || data.error || "操作失败，请重试");
  return data;
}

export function createDialog(title, body, wide = false) {
  const dialog = document.createElement("dialog");
  dialog.className = `creative-dialog${wide ? " creative-dialog-wide" : ""}`;
  const titleId = `creative-dialog-title-${Math.random().toString(36).slice(2)}`;
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.innerHTML = `<div class="creative-heading"><h2 id="${titleId}">${escapeHtml(title)}</h2><button type="button" class="btn sm ghost" data-close>关闭</button></div>${body}`;
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { dialog.querySelectorAll("audio, video").forEach((media) => media.pause()); dialog.remove(); }, { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
  return dialog;
}

export function confirmRemoval(title) {
  return new Promise((resolve) => {
    let confirmed = false;
    const dialog = createDialog("确认删除", `<p>删除「${escapeHtml(title)}」后将无法在这里继续引用。</p><div class="creative-actions"><button type="button" class="btn" data-cancel>保留</button><button type="button" class="btn danger" data-confirm>删除</button></div>`);
    dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-confirm]").addEventListener("click", () => { confirmed = true; dialog.close(); });
    dialog.addEventListener("close", () => resolve(confirmed), { once: true });
  });
}

export function showAsset(item) {
  const kind = item.kind || "text";
  let content = `<pre class="creative-detail-content">${escapeHtml(item.content || "")}</pre>`;
  if (kind === "image") content = `<img class="creative-dialog-media" src="${escapeHtml(mediaUrl(item))}" alt="${escapeHtml(item.title || "图片详情")}" />`;
  if (kind === "video" || kind === "audio") content = `<${kind} class="creative-dialog-media" controls preload="none" src="${escapeHtml(mediaUrl(item))}"></${kind}>`;
  return createDialog(item.title || kindLabels[kind], `${content}<div class="creative-tags creative-reference">${tagsHtml(item.tags)}</div>`, true);
}

export function transferToWorkbench(userId, item, type = "prompt") {
  try {
    sessionStorage.setItem(storageKey(userId, "transfer"), JSON.stringify({ type, item }));
    location.href = "/workbench";
  } catch { throw new Error("浏览器暂时无法保存内容，请复制后前往工作台粘贴"); }
}

export function consumeTransfer(userId) {
  try {
    const key = storageKey(userId, "transfer");
    const value = JSON.parse(sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    return value;
  } catch { return null; }
}

// 原生 dialog 提供焦点限制和 Escape 关闭；列表只获取当前页缩略图。
export function openCreativePicker({ type = "assets", kinds = [], onSelect }) {
  const promptMode = type === "prompts";
  const dialog = createDialog(promptMode ? "选择提示词" : "选择素材", `<form class="creative-toolbar" data-search><label class="field creative-search"><span>搜索</span><input class="input" name="q" placeholder="输入标题、内容或关键词" /></label>${!promptMode ? `<label class="field"><span>类型</span><select class="select" name="kind">${kinds.length ? "" : '<option value="">全部类型</option>'}${(kinds.length ? kinds : Object.keys(kindLabels)).map((kind) => `<option value="${kind}">${kindLabels[kind]}</option>`).join("")}</select></label>` : '<label class="field"><span>来源</span><select class="select" name="source"><option value="all">全部公共提示词</option><option value="mine">我的私人提示词</option></select></label>'}<button class="btn" type="submit">搜索</button></form><p class="creative-status" role="status" data-status></p><div class="creative-grid" data-list></div><div class="creative-pagination"><button class="btn sm" type="button" data-prev>上一页</button><span data-page></span><button class="btn sm" type="button" data-next>下一页</button></div>`, true);
  const form = dialog.querySelector("[data-search]");
  const list = dialog.querySelector("[data-list]");
  const status = dialog.querySelector("[data-status]");
  let page = 1;
  let version = 0;
  let items = [];
  let promptSources = [];
  function renderPromptSourceOptions(nextSources) {
    promptSources = nextSources.map((source) => {
      const current = promptSources.find((item) => item.id === source.id);
      return new Date(current?.cachedAt || 0).getTime() > new Date(source.cachedAt || 0).getTime() ? { ...source, ...current } : { ...current, ...source };
    });
    const selected = form.elements.source.value || "all";
    const total = promptSources.reduce((sum, source) => sum + Math.max(0, Number(source.count) || 0), 0);
    form.elements.source.innerHTML = `<option value="all">全部公共提示词（${total} 条）</option><option value="mine">我的私人提示词</option>` + promptSources.map((source) => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.name || source.title || source.id)}（${Math.max(0, Number(source.count) || 0)} 条）</option>`).join("");
    form.elements.source.value = selected;
  }
  async function load() {
    const current = ++version;
    const query = new URLSearchParams(new FormData(form));
    if (promptMode && !query.get("source")) query.set("source", "all");
    query.set("page", String(page)); query.set("pageSize", "12");
    list.innerHTML = loadingHtml(); list.setAttribute("aria-busy", "true");
    setStatus(status, "正在加载…");
    dialog.querySelector("[data-prev]").disabled = true;
    dialog.querySelector("[data-next]").disabled = true;
    try {
      const data = await apiGet(`/api/${promptMode ? "prompts" : "assets"}?${query}`);
      if (current !== version || !dialog.open) return;
      items = data.items || data.prompts || [];
      if (promptMode && query.get("source") === "all" && Array.isArray(data.sources)) renderPromptSourceOptions(data.sources);
      if (!promptMode && kinds.length) items = items.filter((item) => kinds.includes(item.kind));
      list.innerHTML = items.map((item, index) => `<article class="creative-card">${!promptMode ? `<div class="creative-thumb">${thumbHtml(item)}</div>` : ""}<div class="creative-card-body">${promptMode ? `<span class="creative-meta">${escapeHtml(item.sourceName || (item.source === "mine" ? "我的私人提示词" : "公共来源"))}</span>` : ""}<h3>${escapeHtml(item.title || "未命名")}</h3><p class="creative-excerpt">${escapeHtml(item.content || item.prompt || "")}</p><div class="creative-tags">${tagsHtml(item.tags)}</div><button class="btn" type="button" data-pick="${index}">选择</button></div></article>`).join("") || emptyHtml("没有找到内容", promptMode ? "切换公共或私人来源，或调整搜索条件。" : "先在素材库上传图片或新建文本素材。");
      dialog.querySelector("[data-prev]").disabled = page <= 1;
      dialog.querySelector("[data-next]").disabled = page * 12 >= listTotal(data);
      dialog.querySelector("[data-page]").textContent = `第 ${page} 页${promptMode ? ` · 共 ${listTotal(data)} 条` : ""}`;
      const warnings = promptMode && Array.isArray(data.warnings) ? data.warnings : [];
      setStatus(status, warnings.map((warning) => `${warning.sourceName || warning.sourceId}：${warning.error}`).join("；"), warnings.length ? "error" : "");
    } catch (error) {
      if (current !== version || !dialog.open) return;
      list.innerHTML = emptyHtml("加载失败", "可以重新点击搜索。"); setStatus(status, error.message, "error");
    } finally { if (current === version) list.removeAttribute("aria-busy"); }
  }
  form.addEventListener("submit", (event) => { event.preventDefault(); page = 1; load(); });
  form.querySelectorAll("select").forEach((select) => select.addEventListener("change", () => { page = 1; load(); }));
  dialog.querySelector("[data-prev]").addEventListener("click", () => { page -= 1; load(); });
  dialog.querySelector("[data-next]").addEventListener("click", () => { page += 1; load(); });
  list.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-pick]");
    if (!button) return;
    try { await onSelect(items[Number(button.dataset.pick)]); dialog.close(); } catch (error) { setStatus(status, error.message, "error"); }
  });
  load();
  if (promptMode) apiGet("/api/prompt-sources").then((data) => {
    if (!dialog.open) return;
    renderPromptSourceOptions(data.sources || []);
  }).catch(() => { /* 个人提示词仍可正常选择。 */ });
  return dialog;
}
