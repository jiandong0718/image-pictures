const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

let library;
let utils;
const sourceFixtures = [300, 541, 301, 200, 100, 100, 200].map((count, index) => ({ id: `source-${index}`, title: `公共来源 ${index}`, count, cachedAt: "2026-10-23T12:00:00Z" }));
async function importSource(relativePath) {
  const source = await fs.readFile(path.join(__dirname, relativePath), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
test.before(async () => {
  library = await importSource("../public/pages/prompts/prompt-library.js");
  utils = await importSource("../public/shared/creative-utils.js");
});

test("公共库数量按全部来源计数，保留同正文的不同案例", () => {
  assert.deepEqual(library.publicLibraryStats(sourceFixtures), { total: 1742, sourceCount: 7, cachedSources: 7 });
  assert.deepEqual(library.publicLibraryStats([{ id: "empty", count: 0 }]), { total: 0, sourceCount: 1, cachedSources: 0 });
});

test("全量同步逐来源区分成功、失败缓存与缺失回执", () => {
  const results = sourceFixtures.slice(0, 6).map((source) => ({ sourceId: source.id, count: source.count, success: true }));
  results[2] = { ...results[2], success: false, stale: true, error: "连接失败", warning: "连接失败，已保留上次缓存" };
  const summary = library.summarizePromptRefresh({ sourceId: "all", results }, sourceFixtures, "all");
  assert.equal(summary.rows.length, 7);
  assert.equal(summary.successCount, 5);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.unknownCount, 1);
  assert.equal(summary.rows[2].status, "failed");
  assert.match(summary.rows[2].message, /保留上次缓存/);
  assert.equal(summary.rows[6].status, "unknown");
});

test("同步没有逐来源回执时不谎报全成功，单个来源兼容独立刷新", () => {
  const missing = library.summarizePromptRefresh({ successCount: 7, count: 1742 }, sourceFixtures, "all");
  assert.equal(missing.successCount, 0);
  assert.equal(missing.unknownCount, 7);
  const single = library.summarizePromptRefresh({ sourceId: "source-1", success: true, reused: true, count: 541 }, sourceFixtures, "source-1");
  assert.equal(single.cachedCount, 1);
  assert.equal(single.successCount, 0);
  assert.equal(single.rows.length, 1);
});

test("详情只接受 HTTP(S) 原来源与参考图链接并去除重复链接", () => {
  assert.equal(library.promptPublicUrl("javascript:alert(1)"), "");
  assert.equal(library.promptPublicUrl("https://user:secret@example.com/x"), "");
  assert.deepEqual(library.promptReferenceUrls({ coverUrl: "https://example.com/cover.webp", referenceImageUrls: ["https://example.com/cover.webp", "https://example.com/ref.png", "data:image/png;base64,AAA"] }), ["https://example.com/cover.webp", "https://example.com/ref.png"]);
});

async function promptHarness(overrides = {}) {
  const source = await fs.readFile(path.join(__dirname, "../public/pages/prompts/prompts.js"), "utf8");
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: id === "sourceFilter" ? "all" : "", innerHTML: "", textContent: "", hidden: false, disabled: false, setAttribute() {}, removeAttribute() {}, querySelectorAll: () => [], addEventListener() {} });
    return elements.get(id);
  }
  element("searchForm").elements = { q: { value: "" }, tag: { value: "" }, source: element("sourceFilter") };
  class TestFormData { constructor(form) { this.values = Object.entries(form.elements).map(([name, field]) => [name, field.value]); } [Symbol.iterator]() { return this.values[Symbol.iterator](); } }
  const calls = [];
  const context = vm.createContext({
    ...utils, ...library, URLSearchParams, FormData: TestFormData,
    document: { getElementById: element },
    setStatus: (target, text, kind = "") => { target.textContent = text; target.kind = kind; },
    tagsHtml: (tags) => (tags || []).join(","), loadingHtml: () => "加载中", emptyHtml: (title) => title,
    apiGet: async (url) => { calls.push({ method: "GET", url }); return url === "/api/prompt-sources" ? { sources: sourceFixtures } : { items: [], pagination: { total: 0 } }; },
    apiPost: async (url, body) => { calls.push({ method: "POST", url, body }); return {}; },
    ...overrides,
  });
  vm.runInContext(source.replace(/^import .*;\s*$/gm, "").replace(/^main\(\)\.catch.*$/m, ""), context);
  return { context, element, calls, run: (code) => vm.runInContext(code, context) };
}

test("默认公共全量查询按18条分页，卡片不请求封面且公共库没有编辑删除入口", async () => {
  const requested = [];
  const items = Array.from({ length: 18 }, (_, index) => ({ id: `public:${index}`, title: `案例 ${index}`, content: "相同正文仍保留不同案例", source: "source-0", sourceName: "公开案例", readOnly: true, coverUrl: `https://example.com/${index}.webp`, referenceImageUrls: ["https://example.com/ref.png"] }));
  const page = await promptHarness({ apiGet: async (url) => { requested.push(url); return { items, pagination: { total: 1742 }, sources: sourceFixtures }; } });
  await page.run("loadPrompts()");
  const query = new URL(requested[0], "http://local").searchParams;
  assert.equal(query.get("source"), "all");
  assert.equal(query.get("pageSize"), "18");
  assert.equal((page.element("promptList").innerHTML.match(/<article /g) || []).length, 18);
  assert.doesNotMatch(page.element("promptList").innerHTML, /<img|data-action="edit"|data-action="delete"/);
  assert.match(page.element("promptList").innerHTML, /data-action="fork"/);
  assert.match(page.element("librarySummary").innerHTML, /1,742/);
  assert.equal(page.element("nextPage").disabled, false);
  page.run("showExamples = true; renderPrompts();");
  assert.equal((page.element("promptList").innerHTML.match(/<img /g) || []).length, 18);
  assert.match(page.element("promptList").innerHTML, /loading="lazy" decoding="async"/);
  assert.doesNotMatch(page.element("promptList").innerHTML, /ref\.png/);
});

test("私人来源仍独立查询与编辑，公共源部分失败提示不会被清空", async () => {
  const requested = [];
  const page = await promptHarness({ apiGet: async (url) => { requested.push(url); return { items: [{ id: 7, title: "私有", content: "正文", source: "mine" }], pagination: { total: 1 }, warnings: [{ sourceId: "source-1", sourceName: "来源一", error: "缓存未更新" }] }; } });
  page.element("sourceFilter").value = "mine";
  await page.run("loadPrompts()");
  assert.equal(new URL(requested[0], "http://local").searchParams.get("source"), "mine");
  assert.match(page.element("promptList").innerHTML, /data-action="edit"/);
  assert.match(page.element("promptList").innerHTML, /data-action="delete"/);
  assert.match(page.element("status").textContent, /来源一：缓存未更新/);
});

test("一键同步请求强制刷新all，逐行展示失败与成功且不写私人提示词", async () => {
  const results = sourceFixtures.map((source, index) => ({ sourceId: source.id, count: source.count, success: index !== 3, ...(index === 3 ? { stale: true, error: "来源超时", warning: "来源超时，已保留上次缓存" } : {}) }));
  const calls = [];
  const page = await promptHarness({ apiPost: async (url, body) => { calls.push({ url, body }); return { sourceId: "all", results, successCount: 6, failureCount: 1 }; } });
  page.run(`sources = ${JSON.stringify(sourceFixtures)};`);
  await page.run('syncSources("all")');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/prompt-sources/refresh");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body)), { sourceId: "all", force: true });
  assert.match(page.element("syncStatus").textContent, /同步成功 6 个.*失败 1 个/);
  assert.equal(page.element("syncStatus").kind, "error");
  assert.equal((page.element("syncResults").innerHTML.match(/data-result=/g) || []).length, 7);
  assert.match(page.element("syncResults").innerHTML, /来源超时，已保留上次缓存/);
  assert.equal(page.element("syncAll").disabled, false);
});

test("自动初始化后的新数量不会被迟到的旧来源请求覆盖", async () => {
  const page = await promptHarness();
  page.run(`renderSources(${JSON.stringify(sourceFixtures)});`);
  page.run(`renderSources(${JSON.stringify(sourceFixtures.map((source) => ({ ...source, count: 0, cachedAt: null })))});`);
  assert.match(page.element("librarySummary").innerHTML, /1,742/);
  assert.match(page.element("sourceList").innerHTML, /541 条/);
});

test("来源重试成功后清除旧失败提示，成功数量以最新来源为准", async () => {
  const page = await promptHarness();
  page.run(`renderSources(${JSON.stringify(sourceFixtures.map((source) => ({ ...source, lastError: "旧错误" })))});`);
  assert.match(page.element("sourceList").innerHTML, /旧错误/);
  page.run(`renderSources(${JSON.stringify(sourceFixtures.map((source) => ({ ...source, error: "" })))});`);
  assert.doesNotMatch(page.element("sourceList").innerHTML, /旧错误/);
});

test("提示词中心和选择器默认公共all，私人mine保持单独选项", async () => {
  const html = await fs.readFile(path.join(__dirname, "../public/pages/prompts/index.html"), "utf8");
  assert.match(html, /id="sourceFilter"><option value="all">全部公共提示词<\/option><option value="mine">/);
  const picker = await fs.readFile(path.join(__dirname, "../public/shared/creative-picker.js"), "utf8");
  assert.match(picker, /name="source"><option value="all">全部公共提示词<\/option><option value="mine">/);
  assert.match(picker, /query\.set\("source", "all"\)/);
});
