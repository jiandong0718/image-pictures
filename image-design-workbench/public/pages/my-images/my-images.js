// 我的图库：分页展示当前用户在服务器上生成过的所有图（按时间倒序），支持按提示词搜索。
// 图片本体长期存服务器，本页只是读元数据表列出来，不依赖 localStorage。

import { mountLayout } from "/shared/layout.js";
import { apiGet, downloadFile } from "/shared/api.js";
import { renderPagination } from "/shared/pagination.js";

let pageState = { page: 1, pageSize: 10 };
let keyword = "";

function setMsg(text, kind = "") {
  const msg = document.getElementById("msg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.className = `msg ${kind}`;
}

function fmtTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || "");
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(text) {
  return String(text || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

async function load() {
  const grid = document.getElementById("grid");
  const skN = Math.min(pageState.pageSize || 8, 10);
  grid.innerHTML = Array.from({ length: skN }, () => `
    <div class="mi-item">
      <div class="mi-thumb skeleton"></div>
      <div class="mi-meta">
        <div class="mi-meta-top"><span class="sk-line skeleton" style="width:38%"></span><span class="sk-line skeleton" style="width:28%"></span></div>
        <span class="sk-line skeleton" style="width:92%"></span>
        <span class="sk-line skeleton" style="width:58%"></span>
      </div>
    </div>`).join("");

  const params = new URLSearchParams({
    page: String(pageState.page),
    pageSize: String(pageState.pageSize),
  });
  if (keyword) params.set("keyword", keyword);
  const data = await apiGet(`/api/my-images?${params}`);
  const list = data.items || [];

  if (!list.length) {
    grid.innerHTML = `<div class="empty">${keyword ? "没有匹配的图片" : "还没有生成过图片"}</div>`;
  } else {
    grid.innerHTML = "";
    list.forEach((img) => {
      const card = document.createElement("div");
      card.className = "mi-item";
      const promptText = img.prompt ? escapeHtml(img.prompt) : "（无提示词）";
      card.innerHTML = `
        <div class="mi-thumb">
          <img src="${img.url}?thumb=1&t=${encodeURIComponent(img.createdAt || "")}" alt="${escapeHtml(img.label || "图片")}" loading="lazy" />
        </div>
        <div class="mi-meta">
          <div class="mi-meta-top">
            <span class="badge">${escapeHtml(img.label || img.type || "图片")}</span>
            <span class="mi-time mono">${fmtTime(img.createdAt)}</span>
          </div>
          <div class="mi-prompt" title="${promptText}">${promptText}</div>
          <button class="btn sm ghost mi-dl" type="button">下载</button>
        </div>`;
      card.querySelector("img").addEventListener("click", () => window.open(img.url, "_blank", "noopener"));
      card.querySelector(".mi-dl").addEventListener("click", async () => {
        setMsg("");
        try {
          await downloadFile(img.downloadUrl, img.filename || "image.png");
        } catch (err) {
          setMsg(`下载失败：${err.message}`, "error");
        }
      });
      grid.appendChild(card);
    });
  }

  const { page, pageSize, total } = data.pagination;
  pageState = { page, pageSize };
  renderPagination(document.getElementById("pagination"), {
    page,
    pageSize,
    total,
    onChange: (next) => {
      pageState = next;
      load();
    },
  });
}

async function main() {
  const ctx = await mountLayout({ active: "my-images", title: "我的图库", crumb: "ACCOUNT" });
  if (!ctx) return;

  document.getElementById("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    keyword = document.getElementById("keyword").value.trim();
    pageState = { page: 1, pageSize: pageState.pageSize };
    load();
  });

  await load();
}

main();
