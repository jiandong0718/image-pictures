import { mountLayout } from "/shared/layout.js";
import { apiGet, apiPost, apiDelete } from "/shared/api.js";
import { escapeHtml, parseTags, tagsHtml, setStatus, loadingHtml, emptyHtml, createDialog, confirmRemoval, transferToWorkbench } from "/shared/creative-picker.js";
import { listTotal } from "/shared/creative-utils.js";
import { publicLibraryStats, summarizePromptRefresh, promptPublicUrl, promptReferenceUrls } from "./prompt-library.js";

const $ = (id) => document.getElementById(id);
let user;
let page = 1;
let version = 0;
let items = [];
let sources = [];
let syncing = false;
let showExamples = false;

function editable(item) { return !item.readOnly && [undefined, "", "mine", "user", "local", "personal"].includes(item.sourceId || item.source); }

function renderPrompts() {
  $("promptList").innerHTML = items.map((item, index) => {
    const cover = showExamples ? promptPublicUrl(item.coverUrl) : "";
    return `<article class="creative-card">${cover ? `<img class="prompt-card-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(item.title || "提示词示例")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ""}<div class="creative-card-body"><span class="creative-meta">${editable(item) ? "我的私人提示词" : escapeHtml(item.sourceName || "公共来源")}</span><h3>${escapeHtml(item.title || "未命名提示词")}</h3><p class="creative-excerpt">${escapeHtml(item.description || item.content)}</p><div class="creative-tags">${tagsHtml(item.tags)}</div><div class="creative-actions"><button class="btn sm primary" type="button" data-action="use" data-index="${index}">去创作</button><button class="btn sm" type="button" data-action="detail" data-index="${index}">查看</button><button class="btn sm" type="button" data-action="${editable(item) ? "edit" : "fork"}" data-index="${index}">${editable(item) ? "编辑" : "存为我的"}</button>${editable(item) ? `<button class="btn sm ghost" type="button" data-action="delete" data-index="${index}">删除</button>` : ""}</div></div></article>`;
  }).join("") || emptyHtml("还没有匹配的提示词", $("sourceFilter").value === "mine" ? "新建一条私人提示词，或将公共提示词存为自己的副本。" : "调整搜索条件，或点击“一键同步全部”更新公共提示词库。");
}

function bindImageErrors(container) {
  container.addEventListener("error", (event) => {
    if (event.target.tagName !== "IMG") return;
    const hint = document.createElement("p"); hint.className = "prompt-image-error"; hint.textContent = "示例图暂时无法加载，提示词仍可使用。";
    event.target.replaceWith(hint);
  }, true);
}

function viewPrompt(item) {
  const sourceUrl = promptPublicUrl(item.sourceUrl);
  const author = typeof item.author === "string" ? item.author : item.author?.name || "";
  const references = promptReferenceUrls(item);
  const dialog = createDialog(item.title || "提示词", `<div class="creative-row"><span class="creative-meta">${escapeHtml(item.sourceName || (editable(item) ? "我的私人提示词" : "公共来源"))}${author ? ` · 作者 ${escapeHtml(author)}` : ""}</span>${sourceUrl ? `<a class="btn sm" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">查看原来源</a>` : ""}</div>${item.description ? `<p class="creative-note">${escapeHtml(item.description)}</p>` : ""}${references.length ? `<div class="prompt-detail-references">${references.map((url, index) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(url)}" alt="参考图 ${index + 1}" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></a>`).join("")}</div>` : ""}<pre class="creative-detail-content">${escapeHtml(item.content)}</pre><div class="creative-tags">${tagsHtml(item.tags)}</div><p class="creative-status" role="status" data-status></p><button class="btn" type="button" data-copy>复制提示词</button>`, true);
  bindImageErrors(dialog);
  dialog.querySelector("[data-copy]").addEventListener("click", async () => { try { await navigator.clipboard.writeText(item.content || ""); setStatus(dialog.querySelector("[data-status]"), "已复制", "success"); } catch { setStatus(dialog.querySelector("[data-status]"), "复制失败，请选择文字后手动复制", "error"); } });
}

async function loadPrompts() {
  const current = ++version;
  const params = new URLSearchParams(new FormData($("searchForm")));
  params.set("page", String(page)); params.set("pageSize", "18");
  $("promptList").innerHTML = loadingHtml(); $("promptList").setAttribute("aria-busy", "true");
  $("previousPage").disabled = true; $("nextPage").disabled = true;
  setStatus($("status"), "正在加载提示词…");
  try {
    const data = await apiGet(`/api/prompts?${params}`);
    if (current !== version) return;
    items = data.items || data.prompts || [];
    if (params.get("source") === "all" && Array.isArray(data.sources)) renderSources(data.sources);
    renderPrompts();
    $("previousPage").disabled = page <= 1;
    $("nextPage").disabled = page * 18 >= listTotal(data);
    $("pageLabel").textContent = `第 ${page} 页 · 共 ${listTotal(data)} 条`;
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    setStatus($("status"), warnings.map((warning) => `${warning.sourceName || warning.sourceId}：${warning.error}`).join("；"), warnings.length ? "error" : "");
  } catch (error) {
    if (current !== version) return;
    $("promptList").innerHTML = emptyHtml("提示词暂时无法加载", "点击搜索重新加载。"); setStatus($("status"), error.message, "error");
  } finally { if (current === version) $("promptList").removeAttribute("aria-busy"); }
}

function editPrompt(item = {}, copy = false) {
  const dialog = createDialog(copy ? "存为我的提示词" : item.id ? "编辑提示词" : "新建提示词", `<form data-editor><label class="field"><span>名称</span><input class="input" name="title" value="${escapeHtml(item.title || "")}" maxlength="160" required /></label><label class="field"><span>提示词内容</span><textarea class="textarea" name="content" rows="10" required>${escapeHtml(item.content || "")}</textarea></label><label class="field"><span>标签（逗号分隔）</span><input class="input" name="tags" value="${escapeHtml(parseTags(item.tags).join(", "))}" placeholder="产品摄影, 白底, 极简" /></label><p class="creative-status" role="status" data-status></p><button class="btn primary" type="submit">保存到我的提示词</button></form>`);
  const form = dialog.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      await apiPost("/api/prompts", { ...(item.id && !copy ? { id: item.id } : {}), title: values.title.trim(), content: values.content.trim(), tags: parseTags(values.tags) });
      $("sourceFilter").value = "mine"; $("searchForm").elements.q.value = ""; $("searchForm").elements.tag.value = ""; page = 1;
      dialog.close(); await loadPrompts(); setStatus($("status"), "提示词已保存", "success");
    } catch (error) { setStatus(dialog.querySelector("[data-status]"), error.message, "error"); } finally { button.disabled = false; }
  });
}

function renderSources(nextSources) {
    sources = nextSources.map((source) => {
      source = { ...source, error: source.lastError ?? source.error ?? "", lastError: source.lastError ?? source.error ?? "" };
      const current = sources.find((item) => item.id === source.id);
      const currentAt = new Date(current?.cachedAt || current?.lastRefreshedAt || 0).getTime();
      const incomingAt = new Date(source.cachedAt || source.lastRefreshedAt || 0).getTime();
      return currentAt > incomingAt ? { ...source, ...current } : { ...current, ...source };
    });
    const selectedSource = $("sourceFilter").value || "all";
    const stats = publicLibraryStats(sources);
    $("librarySummary").innerHTML = `公共库 <strong>${stats.total.toLocaleString("zh-CN")}</strong> 条 · ${stats.sourceCount} 个来源 · 已缓存 ${stats.cachedSources}/${stats.sourceCount} 个来源`;
    $("sourceFilter").innerHTML = `<option value="all">全部公共提示词（${stats.total} 条）</option><option value="mine">我的私人提示词</option>` + sources.map((source) => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.name || source.title || source.id)}（${Math.max(0, Number(source.count) || 0)} 条）</option>`).join("");
    if (selectedSource) $("sourceFilter").value = selectedSource;
    $("sourceList").innerHTML = sources.map((source) => `<div class="creative-source"><div><strong>${escapeHtml(source.name || source.title || source.id)}</strong><span class="prompt-source-count">${Math.max(0, Number(source.count) || 0)} 条</span><p class="creative-meta">${escapeHtml(source.description || "公开提示词来源")}</p>${source.cachedAt || source.lastRefreshedAt || source.updatedAt ? `<p class="creative-meta">最近同步 ${escapeHtml(new Date(source.cachedAt || source.lastRefreshedAt || source.updatedAt).toLocaleString("zh-CN"))}</p>` : '<p class="creative-meta">尚未同步</p>'}${source.lastError || source.error ? `<p class="creative-status error">${escapeHtml(source.lastError || source.error)}</p>` : ""}</div><button class="btn sm" type="button" data-refresh="${escapeHtml(source.id)}" ${syncing ? "disabled" : ""}>同步</button></div>`).join("") || '<p class="creative-note">暂无可用公共来源，可以先保存自己的提示词。</p>';
}

async function loadSources() {
  try {
    const data = await apiGet("/api/prompt-sources"); renderSources(data.sources || []);
  } catch (error) { $("sourceList").textContent = `来源加载失败：${error.message}`; $("librarySummary").textContent = "公共库数量暂时无法读取，请刷新后重试。"; }
}

async function syncSources(sourceId = "all") {
  if (syncing) return;
  syncing = true; $("syncAll").disabled = true;
  $("sourceList").querySelectorAll("[data-refresh]").forEach((button) => { button.disabled = true; });
  $("syncResultPanel").hidden = false; $("syncResults").innerHTML = "";
  setStatus($("syncStatus"), sourceId === "all" ? "正在同步全部公共来源，请稍候…" : "正在同步来源…");
  try {
    const result = await apiPost("/api/prompt-sources/refresh", { sourceId, force: true });
    const summary = summarizePromptRefresh(result, sources, sourceId);
    const problems = summary.failedCount + summary.unknownCount;
    const message = summary.rows.length ? `同步成功 ${summary.successCount} 个，沿用缓存 ${summary.cachedCount} 个，失败 ${summary.failedCount} 个，未确认 ${summary.unknownCount} 个。` : "没有收到逐来源同步结果，暂时无法确认是否同步完成。";
    setStatus($("syncStatus"), message, problems || !summary.rows.length ? "error" : "success");
    $("syncResults").innerHTML = summary.rows.length ? `<table class="prompt-sync-table"><thead><tr><th scope="col">来源</th><th scope="col">当前条数</th><th scope="col">结果</th></tr></thead><tbody>${summary.rows.map((row) => `<tr data-result="${row.status}"><td>${escapeHtml(row.title)}</td><td>${row.count}</td><td>${escapeHtml(row.message)}</td></tr>`).join("")}</tbody></table>` : "";
    await Promise.all([loadSources(), loadPrompts()]);
  } catch (error) { setStatus($("syncStatus"), `同步请求失败：${error.message}。本次结果未确认，已缓存的提示词仍可使用。`, "error"); }
  finally { syncing = false; $("syncAll").disabled = false; $("sourceList").querySelectorAll("[data-refresh]").forEach((button) => { button.disabled = false; }); }
}

async function main() {
  const context = await mountLayout({ active: "prompts", title: "提示词中心", crumb: "创作资源" });
  if (!context) return; user = context.me;
  $("newPrompt").addEventListener("click", () => editPrompt());
  $("syncAll").addEventListener("click", () => syncSources("all"));
  $("showExamples").addEventListener("change", (event) => { showExamples = event.target.checked; renderPrompts(); });
  bindImageErrors($("promptList"));
  $("sourceFilter").addEventListener("change", () => { page = 1; loadPrompts(); });
  $("searchForm").addEventListener("submit", (event) => { event.preventDefault(); page = 1; loadPrompts(); });
  $("previousPage").addEventListener("click", () => { page -= 1; loadPrompts(); });
  $("nextPage").addEventListener("click", () => { page += 1; loadPrompts(); });
  $("promptList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const item = items[Number(button.dataset.index)]; if (!item) return;
    try {
      if (button.dataset.action === "use") transferToWorkbench(user.id, item);
      if (button.dataset.action === "edit") editPrompt(item);
      if (button.dataset.action === "fork") editPrompt(item, true);
      if (button.dataset.action === "detail") viewPrompt(item);
      if (button.dataset.action === "delete" && await confirmRemoval(item.title)) { await apiDelete(`/api/prompts/${encodeURIComponent(item.id)}`); await loadPrompts(); }
    } catch (error) { setStatus($("status"), error.message, "error"); }
  });
  $("sourceList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-refresh]"); if (!button) return;
    await syncSources(button.dataset.refresh);
  });
  await Promise.all([loadPrompts(), loadSources()]);
}
main().catch((error) => { document.getElementById("page").style.visibility = "visible"; setStatus($("status"), error.message, "error"); });
