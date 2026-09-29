// 私人作品画廊：逐件浏览图片/视频，并在详情中查看同套图的邻近作品。
import { mountLayout } from "/shared/layout.js";
import { apiGet, apiPost, downloadFile } from "/shared/api.js";
import { renderPagination } from "/shared/pagination.js";
import { saveReuse } from "/shared/reuse.js";

const els = {};
const state = { filter: "all", keyword: "", page: 1, pageSize: 10, total: 0, items: [], collection: null, index: 0, request: 0 };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function displayTitle(item) {
  return item.title || ((item.label || "创作作品") + (item.imageSetId ? " · 套图 " + item.imageSetId : ""));
}

function setMessage(text, detail = false) {
  (detail ? els.detailMessage : els.galleryMessage).textContent = text || "";
}

function setFilter(filter) {
  state.filter = ["image", "video", "favorite"].includes(filter) ? filter : "all";
  state.page = 1;
  els.tabs.querySelectorAll("[data-filter]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.filter === state.filter));
  });
  load();
}

function buildCover(item) {
  const media = item.kind === "video" ?
    '<video src="' + escapeHtml(item.url) + '" muted playsinline preload="metadata"></video>' :
    '<img src="' + escapeHtml(item.url) + '?thumb=1" alt="" loading="lazy" />';
  return '<div class="gallery-cover">' + media +
    '<span class="gallery-cover-count">' + (item.kind === "video" ? "VIDEO" : escapeHtml(item.label)) + '</span>' +
    (item.published ? '<span class="gallery-cover-public">已发布</span>' : "") + '</div>';
}

function renderCards() {
  els.grid.innerHTML = "";
  if (!state.items.length) {
    const searching = Boolean(state.keyword);
    const favoriting = state.filter === "favorite";
    const empty = document.createElement("div");
    empty.className = "gallery-empty";
    empty.innerHTML = '<div class="gallery-empty-symbol" aria-hidden="true">✳</div>' +
      '<h3>' + (searching ? "没有找到匹配的作品" : favoriting ? "还没有收藏作品" : "你的画廊正等着第一件作品") + '</h3>' +
      '<p>' + (searching ? "试试更短的关键词，或切换作品类型。" :
        favoriting ? "打开任意作品，点星标便能在这里快速找到它。" :
          "生成图片或视频后，作品会自动保存在这里。") + '</p>' +
      (searching || favoriting ? '<button type="button" id="resetGallery">查看全部作品</button>' :
        '<a href="/playground">去创作第一张图 ↗</a>');
    els.grid.appendChild(empty);
    empty.querySelector("#resetGallery")?.addEventListener("click", () => {
      state.keyword = "";
      els.keyword.value = "";
      setFilter("all");
    });
    return;
  }
  for (const item of state.items) {
    const card = document.createElement("article");
    card.className = "gallery-card" + (item.kind === "image" ? " is-image" : "");
    const label = item.kind === "video" ? "视频作品" : "图片作品";
    card.innerHTML =
      '<button type="button" class="gallery-card-open" aria-label="打开 ' + escapeHtml(displayTitle(item)) + '">' +
      buildCover(item) +
      '<div class="gallery-card-body"><div class="gallery-card-meta"><span>' + label +
      '</span><span>' + escapeHtml(formatDate(item.createdAt)) + '</span></div>' +
      '<h3>' + escapeHtml(displayTitle(item)) + '</h3>' +
      '<p>' + escapeHtml(item.prompt || "打开查看原作品和同套图的创作内容。") + '</p></div></button>' +
      '<button type="button" class="gallery-card-favorite' + (item.favorite ? " is-favorite" : "") +
      '" aria-label="' + (item.favorite ? "取消收藏" : "收藏") + '" aria-pressed="' +
      String(item.favorite) + '">' + (item.favorite ? "★" : "☆") + "</button>";
    card.querySelector(".gallery-card-open").addEventListener("click", () => openCollection(item.kind, item.id));
    card.querySelector(".gallery-card-favorite").addEventListener("click", () =>
      updateFavorite(item, !item.favorite));
    els.grid.appendChild(card);
  }
}

async function load() {
  const request = ++state.request;
  setMessage("");
  els.grid.innerHTML = '<div class="gallery-skeleton"></div><div class="gallery-skeleton"></div><div class="gallery-skeleton"></div>';
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
  if (state.filter === "favorite") params.set("favorite", "1");
  else if (state.filter !== "all") params.set("media", state.filter);
  if (state.keyword) params.set("keyword", state.keyword);
  try {
    const data = await apiGet("/api/gallery?" + params);
    if (request !== state.request) return;
    state.items = data.items || [];
    state.total = data.pagination?.total || 0;
    state.page = data.pagination?.page || 1;
    els.resultCount.textContent = state.total + " 件作品" + (state.keyword ? " · 搜索「" + state.keyword + "」" : "");
    renderCards();
    renderPagination(els.pagination, {
      page: state.page,
      pageSize: state.pageSize,
      total: state.total,
      onChange: (next) => {
        state.page = next.page;
        state.pageSize = next.pageSize;
        load();
        window.scrollTo({ top: 0, behavior: "smooth" });
      },
    });
  } catch (error) {
    if (request !== state.request) return;
    state.items = [];
    els.grid.innerHTML = "";
    els.pagination.innerHTML = "";
    els.resultCount.textContent = "作品加载失败";
    setMessage(error.message || "请刷新页面重试");
  }
}

function updateItemUrl(kind, id) {
  const url = new URL(location.href);
  if (kind && id) {
    url.searchParams.set("kind", kind);
    url.searchParams.set("item", id);
  } else {
    url.searchParams.delete("kind");
    url.searchParams.delete("item");
  }
  history.replaceState(null, "", url);
}

async function openCollection(kind, id, updateUrl = true) {
  setMessage("");
  try {
    const params = new URLSearchParams({ kind, id });
    const data = await apiGet("/api/gallery/item?" + params);
    state.collection = data.detail;
    state.index = data.detail.selectedIndex;
    els.customTitle.value = selectedItem().title;
    renderDetail();
    if (!els.dialog.open) els.dialog.showModal();
    if (updateUrl) updateItemUrl(kind, id);
  } catch (error) {
    setMessage(error.message || "作品详情加载失败");
  }
}

function selectedItem() {
  return state.collection?.items?.[state.index] || null;
}

function renderDetail() {
  const collection = state.collection;
  const item = selectedItem();
  if (!collection || !item) return;
  els.detailSetId.textContent = item.imageSetId || "---";
  els.detailType.textContent = item.kind === "video" ? "VIDEO / " + (item.label || "AI 视频") :
    "IMAGE / " + (item.label || "图片");
  els.detailTitle.textContent = displayTitle(item);
  els.detailDate.textContent = formatDate(item.createdAt) + " · 同套图共 " + collection.totalInSet + " 件";
  els.detailFavorite.textContent = item.favorite ? "★" : "☆";
  els.detailFavorite.classList.toggle("is-favorite", item.favorite);
  els.detailFavorite.setAttribute("aria-label", item.favorite ? "取消收藏" : "收藏作品");
  els.detailFavorite.setAttribute("aria-pressed", String(item.favorite));
  els.publicationNote.textContent = item.published ?
    "已在灵感首页公开展示；任何访客都能查看作品、标题和提示词。" :
    "默认仅你可见。发布后，作品、标题和提示词将对所有访客可见。";
  els.togglePublication.textContent = item.published ? "撤回发布" : "发布到首页";
  els.togglePublication.classList.toggle("is-public", item.published);
  els.detailStage.innerHTML = item.kind === "video" ?
    '<video src="' + escapeHtml(item.url) + '" controls playsinline preload="metadata"></video>' :
    '<img src="' + escapeHtml(item.url) + '" alt="' + escapeHtml(item.label || "作品图片") + '" />';
  els.itemPosition.textContent = (state.index + 1) + " / " + collection.items.length;
  els.previousItem.disabled = state.index === 0;
  els.nextItem.disabled = state.index >= collection.items.length - 1;
  els.detailThumbs.innerHTML = collection.items.map((entry, index) =>
    '<button type="button" data-index="' + index + '" aria-label="查看第 ' + (index + 1) + ' 件作品" aria-current="' +
    String(index === state.index) + '">' +
    (entry.kind === "video" ? '<span class="video-thumb">▶</span>' :
      '<img src="' + escapeHtml(entry.url) + '?thumb=1" alt="" loading="lazy" />') + "</button>").join("");
  els.detailThumbs.querySelectorAll("button").forEach((button) =>
    button.addEventListener("click", () => selectItem(Number(button.dataset.index))));
  els.detailPrompt.textContent = item.prompt || "这件作品没有保存提示词，仍可查看和下载原文件。";
  els.copyPrompt.disabled = !item.prompt;
  els.reusePrompt.disabled = !item.prompt;
  els.reusePrompt.textContent = item.kind === "video" ? "用提示词再生视频 ↗" : "用提示词再次生图 ↗";
  els.editImage.hidden = item.kind !== "image";
  setMessage("", true);
}

function selectItem(index) {
  if (!state.collection || index < 0 || index >= state.collection.items.length) return;
  state.index = index;
  els.customTitle.value = selectedItem().title;
  updateItemUrl(selectedItem().kind, selectedItem().id);
  renderDetail();
}

async function updateFavorite(item, favorite) {
  try {
    const data = await apiPost("/api/gallery/item", { kind: item.kind, id: item.id, favorite });
    const card = state.items.find((entry) => entry.kind === item.kind && entry.id === item.id);
    if (card) card.favorite = data.item.favorite;
    if (state.collection?.items) {
      const detailItem = state.collection.items.find((entry) =>
        entry.kind === item.kind && entry.id === item.id);
      if (detailItem) detailItem.favorite = data.item.favorite;
      renderDetail();
    }
    if (state.filter === "favorite" && !favorite) load();
    else renderCards();
  } catch (error) {
    setMessage(error.message || "收藏操作失败", Boolean(state.collection));
  }
}

async function saveTitle(event) {
  event.preventDefault();
  const item = selectedItem();
  if (!item) return;
  try {
    const data = await apiPost("/api/gallery/item",
      { kind: item.kind, id: item.id, title: els.customTitle.value.trim() });
    item.title = data.item.title;
    const card = state.items.find((entry) => entry.kind === item.kind && entry.id === item.id);
    if (card) card.title = data.item.title;
    renderDetail();
    renderCards();
    setMessage("标题已保存", true);
  } catch (error) {
    setMessage(error.message || "标题保存失败", true);
  }
}

async function togglePublication() {
  const item = selectedItem();
  if (!item) return;
  els.togglePublication.disabled = true;
  try {
    const data = await apiPost("/api/gallery/item",
      { kind: item.kind, id: item.id, published: !item.published });
    item.published = data.item.published;
    const card = state.items.find((entry) => entry.kind === item.kind && entry.id === item.id);
    if (card) card.published = item.published;
    renderDetail();
    renderCards();
    setMessage(item.published ? "作品已发布到灵感首页" : "已撤回，作品恢复为私密", true);
  } catch (error) {
    setMessage(error.message || "发布状态更新失败", true);
  } finally {
    els.togglePublication.disabled = false;
  }
}

async function copyPrompt() {
  const prompt = selectedItem()?.prompt;
  if (!prompt) return;
  try {
    await navigator.clipboard.writeText(prompt);
    setMessage("提示词已复制", true);
  } catch {
    setMessage("复制失败，请选中提示词手动复制", true);
  }
}

function reusePrompt() {
  const item = selectedItem();
  if (!item?.prompt) return;
  const target = item.kind === "video" ? "video" : "playground";
  saveReuse({ target, prompt: item.prompt });
  location.href = target === "video" ? "/video" : "/playground";
}

function editImage() {
  const item = selectedItem();
  if (!item || item.kind !== "image") return;
  saveReuse({ target: "retouch", prompt: item.prompt, imageId: item.id });
  location.href = "/retouch";
}

async function downloadCurrent() {
  const item = selectedItem();
  if (!item) return;
  try {
    await downloadFile(item.downloadUrl, item.filename || (item.kind === "video" ? "video.mp4" : "image.png"));
  } catch (error) {
    setMessage("下载失败：" + error.message, true);
  }
}

async function main() {
  const ctx = await mountLayout({ active: "my-images", title: "我的图库", crumb: "ARCHIVE" });
  if (!ctx) return;
  Object.assign(els, {
    tabs: document.querySelector(".gallery-tabs"),
    keyword: document.getElementById("keyword"),
    grid: document.getElementById("grid"),
    pagination: document.getElementById("pagination"),
    resultCount: document.getElementById("resultCount"),
    galleryMessage: document.getElementById("galleryMessage"),
    dialog: document.getElementById("collectionDialog"),
    detailSetId: document.getElementById("detailSetId"),
    detailType: document.getElementById("detailType"),
    detailTitle: document.getElementById("detailTitle"),
    detailDate: document.getElementById("detailDate"),
    detailFavorite: document.getElementById("detailFavorite"),
    publicationNote: document.getElementById("publicationNote"),
    togglePublication: document.getElementById("togglePublication"),
    detailStage: document.getElementById("detailStage"),
    detailThumbs: document.getElementById("detailThumbs"),
    itemPosition: document.getElementById("itemPosition"),
    previousItem: document.getElementById("previousItem"),
    nextItem: document.getElementById("nextItem"),
    detailPrompt: document.getElementById("detailPrompt"),
    detailMessage: document.getElementById("detailMessage"),
    customTitle: document.getElementById("customTitle"),
    copyPrompt: document.getElementById("copyPrompt"),
    reusePrompt: document.getElementById("reusePrompt"),
    editImage: document.getElementById("editImage"),
    downloadItem: document.getElementById("downloadItem"),
  });
  els.tabs.querySelectorAll("[data-filter]").forEach((tab) =>
    tab.addEventListener("click", () => setFilter(tab.dataset.filter)));
  document.getElementById("searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.keyword = els.keyword.value.trim();
    state.page = 1;
    load();
  });
  document.getElementById("closeDetail").addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("close", () => { state.collection = null; updateItemUrl("", ""); });
  els.previousItem.addEventListener("click", () => selectItem(state.index - 1));
  els.nextItem.addEventListener("click", () => selectItem(state.index + 1));
  els.dialog.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowLeft") selectItem(state.index - 1);
    if (event.key === "ArrowRight") selectItem(state.index + 1);
  });
  els.detailFavorite.addEventListener("click", () =>
    updateFavorite(selectedItem(), !selectedItem().favorite));
  els.togglePublication.addEventListener("click", togglePublication);
  document.getElementById("titleForm").addEventListener("submit", saveTitle);
  els.copyPrompt.addEventListener("click", copyPrompt);
  els.reusePrompt.addEventListener("click", reusePrompt);
  els.editImage.addEventListener("click", editImage);
  els.downloadItem.addEventListener("click", downloadCurrent);
  await load();
  const params = new URLSearchParams(location.search);
  if (params.get("kind") && params.get("item")) {
    openCollection(params.get("kind"), params.get("item"), false);
  }
}

main();
