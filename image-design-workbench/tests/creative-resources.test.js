"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCreativeResources, PROMPT_SOURCES, normalizeSourcePrompts, mapAsset } = require("../lib/creative-resources");

function fixture() {
  const assets = new Map([
    [1, { id: 1, owner_user_id: 10, kind: "text", title: "品牌", content: "保持品牌红色", tags: '["品牌"]' }],
    [2, { id: 2, owner_user_id: 10, kind: "image", title: "商品", media_id: "001/product.png", tags: "[]" }],
    [3, { id: 3, owner_user_id: 20, kind: "text", title: "私密", content: "另一账户素材", tags: "[]" }],
    [4, { id: 4, owner_user_id: 10, kind: "image", title: "同张商品", media_id: "001/product.png", tags: "[]" }],
    [5, { id: 5, owner_user_id: 10, kind: "image", title: "上传图", storage_path: "10/aaaaaaaa.png", tags: "[]" }],
    [6, { id: 6, owner_user_id: 10, kind: "video", title: "视频", media_id: "001/demo.mp4", tags: "[]" }],
  ]);
  const prompts = new Map([[1, { id: 1, owner_user_id: 20, title: "秘密", content: "private", tags: "[]" }]]);
  const cache = new Map();
  const queries = [];
  let next = 10;
  const pool = { async query(sql, args = []) {
    queries.push({ sql, args });
    if (sql.startsWith("SELECT * FROM creative_assets WHERE generation_task_id")) return [[...assets.values()].filter((row) => row.generation_task_id === args[0] && row.owner_user_id === args[1])];
    if (sql.startsWith("INSERT INTO creative_assets")) {
      const [owner_user_id, kind, title, content, tags, media_id, storage_path, mime, byte_size, generation_task_id] = args;
      if (generation_task_id && [...assets.values()].some((row) => row.generation_task_id === generation_task_id)) throw Object.assign(new Error("Duplicate task"), { errno: 1062 });
      const id = next++;
      assets.set(id, { id, owner_user_id, kind, title, content, tags, media_id, storage_path, mime, byte_size, generation_task_id });
      return [{ insertId: id }];
    }
    if (sql.startsWith("SELECT * FROM creative_assets WHERE id")) return [[assets.get(Number(args[0]))].filter((row) => row && row.owner_user_id === args[1])];
    if (sql.startsWith("SELECT id, image_set_id")) return [args[1] === 10 && args[0] === "001/product.png" ? [{ id: args[0], image_set_id: "001" }] : []];
    if (sql.startsWith("DELETE FROM creative_assets")) {
      const row = assets.get(Number(args[0]));
      const affectedRows = row?.owner_user_id === args[1] ? Number(assets.delete(row.id)) : 0;
      return [{ affectedRows }];
    }
    if (sql.startsWith("SELECT * FROM creative_prompts WHERE id")) return [[prompts.get(Number(args[0]))].filter((row) => row && row.owner_user_id === args[1])];
    if (sql.startsWith("SELECT COUNT(*) AS n FROM creative_prompts")) return [[{ n: [...prompts.values()].filter((row) => row.owner_user_id === args[0]).length }]];
    if (sql.startsWith("SELECT * FROM creative_prompts WHERE owner_user_id")) return [[...prompts.values()].filter((row) => row.owner_user_id === args[0]).slice(args.at(-1), args.at(-1) + args.at(-2))];
    if (sql.startsWith("UPDATE creative_prompts")) {
      const [title, content, tags, id, userId] = args;
      const row = prompts.get(id);
      if (!row || row.owner_user_id !== userId) return [{ affectedRows: 0 }];
      Object.assign(row, { title, content, tags });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("DELETE FROM creative_prompts")) {
      const row = prompts.get(Number(args[0]));
      return [{ affectedRows: row?.owner_user_id === args[1] ? Number(prompts.delete(row.id)) : 0 }];
    }
    if (sql.startsWith("INSERT INTO creative_prompts")) {
      const [owner_user_id, title, content, tags] = args;
      const id = next++;
      prompts.set(id, { id, owner_user_id, title, content, tags });
      return [{ insertId: id }];
    }
    if (sql.startsWith("SELECT items, updated_at")) return [[cache.get(args[0])].filter(Boolean)];
    if (sql.startsWith("INSERT INTO creative_prompt_cache")) { cache.set(args[0], { items: args[1], updated_at: new Date() }); return [{}]; }
    throw new Error(`未预期的测试 SQL：${sql}`);
  } };
  return { pool, assets, cache, queries };
}

test("用户提示词只能修改/删除自己的记录", async () => {
  const { pool } = fixture();
  const resources = createCreativeResources({ getPool: () => pool });
  await assert.rejects(resources.savePrompt(10, { id: 1, title: "覆盖", content: "覆盖", tags: [] }), (error) => error.statusCode === 404);
  await assert.rejects(resources.deletePrompt(10, 1), (error) => error.statusCode === 404);
  const saved = await resources.savePrompt(10, { title: "我的风格", content: "品牌风格", tags: ["品牌", "品牌"] });
  assert.deepEqual(saved.tags, ["品牌"]);
  assert.equal(saved.source, "mine");
  await resources.savePrompt(10, { ...saved, content: "新版品牌风格" });
  await resources.deletePrompt(10, saved.id);
});

test("素材和图库引用均隔离归属，拒绝远程 URL 与越界 ID", async () => {
  const { pool } = fixture();
  const resources = createCreativeResources({ getPool: () => pool });
  await assert.rejects(resources.getAsset(10, 3), (error) => error.statusCode === 404);
  await assert.rejects(resources.deleteAsset(10, 3), (error) => error.statusCode === 404);
  await assert.rejects(resources.getOwnedMedia(20, "image", "001/product.png"), (error) => error.statusCode === 404);
  await assert.rejects(resources.getOwnedMedia(10, "image", "https://internal/a.png"));
  await assert.rejects(resources.getOwnedMedia(10, "image", "../001/product.png"));
  await assert.rejects(resources.getAsset(10, "1 OR 1=1"));
});

test("编排按标记出现顺序替换、合并引用且同一图片不重复编号", async () => {
  const { pool } = fixture();
  const resources = createCreativeResources({ getPool: () => pool });
  const result = await resources.resolveComposition(10, { text: "设计 @[asset:2]，@[asset:1]，再用 @[asset:2]。", assetIds: [4, 5, 1] });
  assert.deepEqual(result.assetIds, [2, 1, 4, 5]);
  assert.deepEqual(result.imageIds, ["001/product.png", "asset:5"]);
  assert.match(result.prompt, /设计 \[参考图 1：商品\]，保持品牌红色/);
  assert.match(result.prompt, /\[参考图 1：同张商品\]/);
  assert.match(result.prompt, /\[参考图 2：上传图\]/);
  await assert.rejects(resources.resolveComposition(10, { text: "@[asset:3]" }), (error) => error.statusCode === 404);
  await assert.rejects(resources.resolveComposition(10, { text: "@[asset:6]" }), /仅支持文本和图片/);
});

test("七个标准 JSON 来源来自固定 registry，刷新禁止任意 URL 和重定向", async () => {
  assert.equal(PROMPT_SOURCES.length, 7);
  const { pool, cache } = fixture();
  const calls = [];
  const resources = createCreativeResources({ getPool: () => pool, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify([{ title: "广告主图", prompt: "白底产品图", tags: ["商品"] }]));
  } });
  await assert.rejects(resources.refreshPromptSource("http://127.0.0.1/private"), (error) => error.statusCode === 404);
  assert.equal(calls.length, 0);
  const sourceId = PROMPT_SOURCES[0].id;
  assert.equal((await resources.refreshPromptSource(sourceId)).count, 1);
  assert.equal(calls[0].url, PROMPT_SOURCES[0].url);
  assert.equal(calls[0].options.redirect, "error");
  assert.ok(cache.has(sourceId));
  assert.equal((await resources.listPrompts(10, { source: sourceId, q: "白底" })).items[0].content, "白底产品图");
  await resources.refreshPromptSource(sourceId);
  assert.equal(calls.length, 1);
});

test("网络错误或无效源数据保留上次缓存", async () => {
  for (const response of [null, [], { unexpected: true }]) {
    const { pool, cache } = fixture();
    const sourceId = PROMPT_SOURCES[0].id;
    const old = { items: JSON.stringify([{ id: "old", title: "旧缓存", content: "保留", tags: [] }]), updated_at: new Date(0) };
    cache.set(sourceId, old);
    const resources = createCreativeResources({ getPool: () => pool, fetchImpl: async () => { if (response === null) throw new Error("network"); return new Response(JSON.stringify(response)); } });
    assert.equal((await resources.refreshPromptSource(sourceId)).stale, true);
    assert.equal(cache.get(sourceId), old);
  }
  assert.throws(() => normalizeSourcePrompts([{ title: "x", prompt: "x", tags: ["x".repeat(41)] }], "test"));
});

test("创作资源分页支持前端 12/18 条，不能沿用旧图库规则截断", async () => {
  const { pool, cache } = fixture();
  const sourceId = PROMPT_SOURCES[0].id;
  cache.set(sourceId, { items: JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ id: i + 1, title: String(i + 1), content: "test", tags: [] }))), updated_at: new Date() });
  const resources = createCreativeResources({ getPool: () => pool });
  const second = await resources.listPrompts(10, { source: sourceId, page: 2, pageSize: 18 });
  assert.equal(second.items.length, 18);
  assert.equal(second.items[0].id, 19);
  assert.equal(second.total, 40);
  const picker = await resources.listPrompts(10, { source: sourceId, page: 2, pageSize: 12 });
  assert.equal(picker.items.length, 12);
  assert.equal(picker.items[0].id, 13);
});

test("音频素材下载名称与实际 MIME 匹配", () => {
  for (const [mime, extension] of [["audio/mpeg", "mp3"], ["audio/wav", "wav"], ["audio/ogg", "ogg"], ["audio/mp4", "m4a"], ["audio/flac", "flac"]]) {
    const asset = mapAsset({ id: 7, kind: "audio", mime, title: "声音", tags: "[]" });
    assert.equal(asset.format, extension);
    assert.equal(asset.filename, `audio-7.${extension}`);
  }
});

test("音频任务关联仅接受服务端参数，唯一且按账户隔离查询", async () => {
  const { pool } = fixture();
  const resources = createCreativeResources({ getPool: () => pool });
  const file = { storagePath: "10/aaaaaaaa.wav", mime: "audio/wav", size: 80, taskId: "server-task" };
  const asset = await resources.createAsset(10, { kind: "audio", title: "音频", taskId: "client-task", generationTaskId: "forged", generation_task_id: "forged" }, file);
  assert.equal(asset.generationTaskId, "server-task");
  assert.equal((await resources.findAssetByTask(10, "server-task")).id, asset.id);
  assert.equal(await resources.findAssetByTask(20, "server-task"), null);
  assert.equal(await resources.findAssetByTask(10, "client-task"), null);
  await assert.rejects(resources.createAsset(10, { kind: "audio", title: "重复" }, file), (error) => error.errno === 1062);
  const unbound = await resources.createAsset(10, { kind: "audio", title: "上传", taskId: "client-task" }, { storagePath: "10/bbbbbbbb.wav", mime: "audio/wav", size: 80 });
  assert.equal(unbound.generationTaskId, "");
});

test("素材初始化为已存在表幂等补齐任务列及唯一索引，其他迁移错误不能吞掉", async () => {
  const alterations = [];
  let hasColumn = false;
  let hasIndex = false;
  const pool = { query: async (sql) => {
    if (!sql.startsWith("ALTER TABLE")) return [{}];
    alterations.push(sql);
    assert.match(sql, /^ALTER TABLE creative_assets /);
    if (sql.includes("ADD COLUMN")) {
      if (hasColumn) throw Object.assign(new Error("duplicate column"), { errno: 1060 });
      hasColumn = true;
    } else {
      if (hasIndex) throw Object.assign(new Error("duplicate key"), { errno: 1061 });
      hasIndex = true;
    }
    return [{}];
  } };
  const resources = createCreativeResources({ getPool: () => pool });
  await resources.init();
  await resources.init();
  assert.equal(hasColumn, true);
  assert.equal(hasIndex, true);
  assert.equal(alterations.length, 4);
  const broken = createCreativeResources({ getPool: () => ({ query: async (sql) => { if (sql.startsWith("ALTER TABLE")) throw Object.assign(new Error("permission denied"), { errno: 1142 }); return [{}]; } }) });
  await assert.rejects(broken.init(), /permission denied/);
});

test("公共条目保留来源、作者、描述和安全图片链接，相同文案不同原始 ID 不合并", () => {
  const source = PROMPT_SOURCES[0];
  const [first, second] = normalizeSourcePrompts([
    { id: "case-1", title: "同一标题", prompt: "相同正文", author: "原作者", description: "案例说明", coverUrl: "https://images.example/first.png", referenceImageUrls: ["https://images.example/ref.png", "javascript:alert(1)", "data:image/png,x", "https://images.example/ref.png"], sourceUrl: "https://author.example/post/1", tags: ["产品"] },
    { id: "case-2", title: "同一标题", prompt: "相同正文", coverUrl: "https://images.example/second.png", sourceUrl: "javascript:alert(1)" },
  ], source.id);
  assert.notEqual(first.id, second.id);
  assert.equal(first.originalId, "case-1");
  assert.equal(first.id, `${source.id}:case-1`);
  assert.equal(first.author, "原作者");
  assert.equal(first.description, "案例说明");
  assert.equal(first.coverUrl, "https://images.example/first.png");
  assert.equal(second.coverUrl, "https://images.example/second.png");
  assert.deepEqual(first.referenceImageUrls, ["https://images.example/ref.png"]);
  assert.equal(first.sourceUrl, "https://author.example/post/1");
  assert.equal(second.sourceUrl, "");
  assert.equal(first.readOnly, true);
  assert.equal(first.sourceId, source.id);
  assert.equal(first.sourceName, source.title);
  assert.equal(normalizeSourcePrompts([{ title: "同文", prompt: "同文", coverUrl: "https://a.example/1" }, { title: "同文", prompt: "同文", coverUrl: "https://a.example/2" }], source.id).length, 2);
});

test("全部公共库只聚合七源缓存，跨源搜索标签后全局分页，mine 仍按用户隔离", async () => {
  const { pool, cache, queries } = fixture();
  for (const [index, source] of PROMPT_SOURCES.entries()) cache.set(source.id, { items: JSON.stringify([
    { id: `${source.id}:a`, title: `公开 ${index}`, content: "共同正文", tags: ["商品"], author: "作者甲", description: "光影说明" },
    { id: `${source.id}:b`, title: "另一个案例", content: "未匹配", tags: ["人物"] },
  ]), updated_at: new Date() });
  const resources = createCreativeResources({ getPool: () => pool, fetchImpl: async () => { throw new Error("缓存完整，不该联网"); } });
  await resources.savePrompt(10, { title: "私有", content: "私人正文", tags: [] });
  const privateQueries = queries.length;
  const result = await resources.listPrompts(10, { source: "all", q: "光影说明", tag: "商品", page: 2, pageSize: 3 });
  assert.equal(result.total, 7);
  assert.equal(result.totalAvailable, 14);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].sourceId, PROMPT_SOURCES[3].id);
  assert.equal(result.items.every((item) => item.readOnly), true);
  assert.equal(result.sources.length, 7);
  assert.deepEqual(result.tags, ["人物", "商品"]);
  assert.equal(queries.slice(privateQueries).some(({ sql }) => sql.includes("creative_prompts")), false);
  assert.equal((await resources.listPrompts(10, { source: "all", q: "私人正文" })).total, 0);
  const mine = await resources.listPrompts(10);
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0].title, "私有");
  assert.equal((await resources.listPrompts(20, { source: "mine" })).items[0].title, "秘密");
});

test("首次公共读取自动同步缺失来源，多用户并发只拉取一次且失败后限流重试", async () => {
  const { pool } = fixture();
  const calls = [];
  const broken = PROMPT_SOURCES[2].url;
  const resources = createCreativeResources({ getPool: () => pool, fetchImpl: async (url) => {
    calls.push(url);
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (url === broken) throw new Error("network unavailable");
    return new Response(JSON.stringify([{ id: "one", title: "公开内容", prompt: "测试正文" }]));
  } });
  const [first, second] = await Promise.all([resources.listPrompts(10, { source: "all" }), resources.listPrompts(20, { source: "all" })]);
  assert.equal(first.total, 6);
  assert.equal(second.total, 6);
  assert.equal(first.warnings.length, 1);
  assert.equal(calls.length, 7);
  assert.equal(new Set(calls).size, 7);
  await resources.listPrompts(10, { source: "all" });
  assert.equal(calls.length, 7);
});

test("强制全同步绕过新鲜旧缓存补齐 metadata，失败来源保留原记录并返回逐源结果", async () => {
  const { pool, cache } = fixture();
  for (const source of PROMPT_SOURCES) cache.set(source.id, { items: JSON.stringify([{ id: `${source.id}:old`, title: "旧版条目", content: "旧字段", tags: [] }]), updated_at: new Date() });
  const old = cache.get(PROMPT_SOURCES[0].id);
  let calls = 0;
  const resources = createCreativeResources({ getPool: () => pool, fetchImpl: async (url) => {
    calls++;
    if (url === PROMPT_SOURCES[0].url) return new Response("not available", { status: 503 });
    return new Response(JSON.stringify([{ id: "new", title: "新条目", prompt: "新版正文", author: "完整作者", coverUrl: "https://images.example/cover.jpg" }]));
  } });
  await resources.refreshAllSources();
  assert.equal(calls, 0);
  const result = await resources.refreshAllSources({ force: true });
  assert.equal(calls, 7);
  assert.equal(result.successCount, 6);
  assert.equal(result.failureCount, 1);
  assert.equal(result.count, 7);
  assert.equal(result.results[0].stale, true);
  assert.match(result.results[0].error, /503/);
  assert.equal(cache.get(PROMPT_SOURCES[0].id), old);
  const updated = JSON.parse(cache.get(PROMPT_SOURCES[1].id).items)[0];
  assert.equal(updated.author, "完整作者");
  assert.equal(updated.coverUrl, "https://images.example/cover.jpg");
  assert.equal(updated.readOnly, true);
});

test("并发全部同步复用每个来源的同一请求，强制同步不会被普通缓存复用吞掉", async () => {
  const { pool, cache } = fixture();
  let calls = 0;
  const resources = createCreativeResources({ getPool: () => pool, fetchImpl: async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 2));
    return new Response(JSON.stringify([{ id: "fresh", title: "同步", prompt: "完整正文" }]));
  } });
  await Promise.all([resources.refreshAllSources({ force: true }), resources.refreshAllSources({ force: true })]);
  assert.equal(calls, 7);
  const first = PROMPT_SOURCES[0].id;
  assert.ok(cache.has(first));
  await Promise.all([resources.refreshPromptSource(first), resources.refreshPromptSource(first, { force: true })]);
  assert.equal(calls, 8);
});

test("缺失来源处于失败冷却时，用户强制同步仍可绕过并补齐缓存", async () => {
  const { pool } = fixture();
  let calls = 0;
  const sourceId = PROMPT_SOURCES[0].id;
  const resources = createCreativeResources({ getPool: () => pool, fetchImpl: async () => {
    calls++;
    if (calls === 1) throw new Error("temporary network failure");
    return new Response(JSON.stringify([{ id: "ready", title: "恢复", prompt: "完整内容" }]));
  } });
  await assert.rejects(resources.refreshPromptSource(sourceId));
  const results = await Promise.allSettled([resources.refreshPromptSource(sourceId), resources.refreshPromptSource(sourceId, { force: true })]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  assert.equal(results[1].value.count, 1);
  assert.equal(calls, 2);
});
