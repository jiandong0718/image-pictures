const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { stripProxyRoutingFields, applyEndpointModel } = require("../server");
const { selectableEndpoints } = require("../lib/image-config");

test("节点显示配置名称、默认模型与其自身模型目录，且不暴露凭据", () => {
  const [node] = selectableEndpoints([{ id: 42, label: "agens 自定义名", model: "image-a", supported_models: '["image-a","image-b"]', api_base: "secret-address", api_key: "secret-key" }]);
  assert.deepEqual(node, { id: 42, name: "agens 自定义名", defaultModel: "image-a", models: ["image-a", "image-b"] });
});

test("切换节点后只能使用该节点模型，失效选择回到节点默认值", async () => {
  const source = (await fs.readFile(path.join(__dirname, "../public/shared/image-target.js"), "utf8")).replace(/^import .*;\n/, "");
  const { resolveImageTarget } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const nodes = [
    { id: 1, name: "我配置的主服务", defaultModel: "image-a", models: ["image-a", "shared"] },
    { id: 2, name: "备用服务", defaultModel: "image-b", models: ["image-b"] },
  ];
  assert.deepEqual(resolveImageTarget(nodes, { endpointId: "1", model: "shared" }), { endpointId: "1", model: "shared" });
  assert.deepEqual(resolveImageTarget(nodes, { endpointId: "2", model: "shared" }), { endpointId: "2", model: "image-b" });
  assert.deepEqual(resolveImageTarget(nodes, { endpointId: "deleted", model: "old" }), { endpointId: "1", model: "image-a" });
  assert.deepEqual(resolveImageTarget([], { endpointId: "1", model: "image-a" }), { endpointId: "", model: "" });
});

test("服务端指定节点使用该节点地址、密钥和模型，模型不匹配或节点停用不回退其他节点", async () => {
  const source = await fs.readFile(path.join(__dirname, "../lib/image-config.js"), "utf8");
  const fakeDb = { async query(sql, params) {
    assert.match(sql, /id = \? AND enabled = 1/);
    return [params[0] === 2 ? [{ api_base: "https://node-b.test/v1", api_key: "node-b-test-key", model: "image-b", supported_models: '["image-b","image-b-2"]' }] : []];
  } };
  const sandbox = { module: { exports: {} }, require: () => ({ getPool: () => fakeDb }), process: { env: {} } };
  vm.runInNewContext(source, sandbox);
  const config = sandbox.module.exports;
  const selected = await config.getEnabledEndpointById("2", "image-b-2");
  assert.equal(selected.apiBase, "https://node-b.test/v1");
  assert.equal(selected.apiKey, "node-b-test-key");
  assert.equal(selected.model, "image-b-2");
  await assert.rejects(config.getEnabledEndpointById("2", "image-a"), /不支持/);
  await assert.rejects(config.getEnabledEndpointById("3", "image-b"), /不存在或已停用/);
});

test("聚集地代理不向上游透传节点字段，编辑图片二进制保持完整", () => {
  const json = JSON.parse(applyEndpointModel(Buffer.from('{"model":"old","endpoint_id":"42","endpointId":"42","prompt":"test"}'), "application/json", "image-a").toString());
  assert.deepEqual(json, { model: "image-a", prompt: "test" });
  const prefix = Buffer.from('--test\r\nContent-Disposition: form-data; name="endpoint_id"\r\n\r\n42\r\n');
  const image = Buffer.concat([Buffer.from('--test\r\nContent-Disposition: form-data; name="image[]"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n'), Buffer.from([0, 255, 128, 65]), Buffer.from('\r\n--test--\r\n')]);
  assert.deepEqual(stripProxyRoutingFields(Buffer.concat([prefix, image]), "multipart/form-data; boundary=test"), image);
});

test("全局默认保存后用于无自定义的请求，手动节点优先；默认节点停用时回退调度", async () => {
  const source = await fs.readFile(path.join(__dirname, "../lib/image-config.js"), "utf8");
  const settings = new Map();
  const rows = [
    { id: 1, label: "主节点", model: "image-a", supported_models: '["image-a","image-a2"]', api_base: "https://a.test/v1", api_key: "a-test", enabled: 1 },
    { id: 2, label: "全局节点", model: "image-b", supported_models: '["image-b"]', api_base: "https://b.test/v1", api_key: "b-test", enabled: 1 },
  ];
  const db = { async query(sql, params) {
    if (sql.startsWith("SELECT v FROM app_settings")) return [settings.has(params[0]) ? [{ v: settings.get(params[0]) }] : []];
    if (sql.startsWith("INSERT INTO app_settings")) { settings.set(params[0], params[1]); return [{}]; }
    if (sql.includes("WHERE id = ? AND enabled = 1")) return [rows.filter((row) => row.enabled && row.id === params[0])];
    if (sql.includes("FROM image_endpoints WHERE enabled = 1")) return [rows.filter((row) => row.enabled)];
    throw new Error(sql);
  } };
  const create = () => {
    const sandbox = { module: { exports: {} }, require: () => ({ getPool: () => db }), process: { env: {} } };
    vm.runInNewContext(source, sandbox);
    return sandbox.module.exports;
  };
  const config = create();
  await config.setGlobalDefaultTarget(2);
  assert.equal((await create().getGlobalDefaultTarget()).endpointId, "2");
  assert.equal((await config.pickEndpoint()).apiKey, "b-test");
  assert.equal((await config.pickEndpoint()).model, "image-b");
  assert.equal((await config.getEnabledEndpointById(1, "image-a2")).model, "image-a2");
  // 默认节点的默认模型更新时，全局默认随之更新。
  rows[1].model = "image-b2"; rows[1].supported_models = '["image-b2"]';
  assert.equal((await config.pickEndpoint()).model, "image-b2");
  rows[1].enabled = 0;
  assert.equal(await config.getGlobalDefaultTarget(), null);
  assert.equal((await config.pickEndpoint()).apiKey, "a-test");
  await assert.rejects(config.setGlobalDefaultTarget(2), /已启用/);
});

test("新模块跟随全局；自定义选择保留，已删除的自定义节点恢复跟随", async () => {
  const source = (await fs.readFile(path.join(__dirname, "../public/shared/image-target.js"), "utf8")).replace(/^import .*;\n/, "");
  const { resolveTargetPreference } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const nodes = [{ id: 1, defaultModel: "a", models: ["a", "b"] }];
  assert.deepEqual(resolveTargetPreference(nodes), { endpointId: "", model: "", followGlobal: true });
  assert.deepEqual(resolveTargetPreference(nodes, { endpointId: "1", model: "b", followGlobal: false }), { endpointId: "1", model: "b", followGlobal: false });
  assert.equal(resolveTargetPreference(nodes, { endpointId: "deleted", followGlobal: false }).followGlobal, true);
});

test("聚集地图生图跟随全局时，替换空模型且保留图片二进制", () => {
  const prefix = Buffer.from('--edit\r\nContent-Disposition: form-data; name="model"\r\n\r\n\r\n');
  const image = Buffer.concat([Buffer.from('--edit\r\nContent-Disposition: form-data; name="image[]"; filename="x.png"\r\n\r\n'), Buffer.from([0, 255, 128, 65]), Buffer.from('\r\n--edit--\r\n')]);
  const output = applyEndpointModel(Buffer.concat([prefix, image]), "multipart/form-data; boundary=edit", "global-image");
  assert.deepEqual(output, Buffer.concat([Buffer.from('--edit\r\nContent-Disposition: form-data; name="model"\r\n\r\nglobal-image\r\n'), image]));
});
