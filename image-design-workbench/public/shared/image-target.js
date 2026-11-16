import { apiGet } from "/shared/api.js";

// 节点目录在一个会话内通常不会变化。只缓存创作页需要的安全投影（不含地址、密钥或管理端列表），
// 让相邻工作台之间切换时可以立刻恢复节点与按钮；缓存变旧后在后台刷新，最终提交仍由服务端实时校验。
const CONFIG_CACHE_VERSION = "v1";
const CONFIG_FRESH_MS = 30 * 1000;
const CONFIG_STALE_MS = 5 * 60 * 1000;

function imageConfigCacheKey(storageKey) {
  const match = /^imageStudio:target:([^:]+)/.exec(storageKey || "");
  return match ? `imageStudio:image-target-config:${CONFIG_CACHE_VERSION}:${match[1]}` : "";
}

function safeImageConfig(value) {
  const nodes = Array.isArray(value?.nodes)
    ? value.nodes.map((node) => ({
      id: String(node.id || ""),
      name: String(node.name || "未命名节点"),
      models: Array.isArray(node.models) ? node.models.filter((model) => typeof model === "string") : [],
      defaultModel: typeof node.defaultModel === "string" ? node.defaultModel : "",
    })).filter((node) => node.id)
    : [];
  const target = value?.defaultTarget;
  return {
    config: { uploaded: Boolean(value?.config?.uploaded) },
    nodes,
    defaultTarget: target && typeof target === "object"
      ? {
        endpointId: String(target.endpointId || ""),
        name: String(target.name || ""),
        model: String(target.model || ""),
      }
      : null,
  };
}

function readCachedConfig(key) {
  if (!key) return null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || "");
    if (!cached || typeof cached !== "object" || !Number.isFinite(cached.savedAt) || !cached.value) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCachedConfig(key, value) {
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    /* 浏览器存储不可用时，退回直接请求。 */
  }
}

export function clearImageTargetConfigCache() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(`imageStudio:image-target-config:${CONFIG_CACHE_VERSION}:`)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    /* 浏览器存储不可用时无需清理。 */
  }
}

async function loadImageConfig(cacheKey, onRefresh) {
  const cached = readCachedConfig(cacheKey);
  const age = cached ? Date.now() - cached.savedAt : Number.POSITIVE_INFINITY;
  if (cached && age <= CONFIG_FRESH_MS) {
    return cached.value;
  }

  const fetchFresh = async () => {
    const fresh = safeImageConfig(await apiGet("/api/image-config"));
    writeCachedConfig(cacheKey, fresh);
    return fresh;
  };

  if (cached && age <= CONFIG_STALE_MS) {
    void fetchFresh().then(onRefresh).catch(() => {
      /* 已有可用旧目录时，后台刷新失败不打断创作。 */
    });
    return cached.value;
  }
  return fetchFresh();
}

// 节点是模型目录的边界。旧选择失效时，只能回到当前节点的默认模型。
export function resolveImageTarget(nodes, previous = {}) {
  const node = nodes.find((item) => String(item.id) === String(previous.endpointId)) || nodes[0];
  if (!node) return { endpointId: "", model: "" };
  const models = Array.isArray(node.models) ? node.models : [];
  return {
    endpointId: String(node.id),
    model: models.includes(previous.model) ? previous.model : models.includes(node.defaultModel) ? node.defaultModel : models[0] || "",
  };
}

export function resolveTargetPreference(nodes, previous = {}) {
  const node = nodes.find((item) => String(item.id) === String(previous.endpointId));
  return previous.followGlobal === false && node
    ? { ...resolveImageTarget(nodes, previous), followGlobal: false }
    : { endpointId: "", model: "", followGlobal: true };
}

export async function mountImageTarget(host, { storageKey, onChange = () => {}, onConfig = () => {} } = {}) {
  host.classList.add("image-target");
  host.innerHTML = '<label class="field"><span>生图节点</span><select class="select" data-node aria-label="生图节点" disabled><option>正在加载…</option></select></label><label class="field"><span>生图模型</span><select class="select" data-model aria-label="生图模型" disabled><option>请先选择节点</option></select></label><p class="image-target-message" role="status"></p>';
  const nodeSelect = host.querySelector("[data-node]");
  const modelSelect = host.querySelector("[data-model]");
  const hint = host.querySelector("[role=status]");
  const preferenceKey = storageKey ? storageKey + ":global-default-v2" : "";
  let nodes = [];
  let globalDefault = null;
  let selected = { followGlobal: true, endpointId: "", model: "" };
  try { selected = preferenceKey ? JSON.parse(localStorage.getItem(preferenceKey) || "{}") || {} : {}; } catch { /* 无本地存储时使用全局默认。 */ }
  const currentValue = () => selected.followGlobal ? { endpointId: "", model: "" } : { endpointId: selected.endpointId, model: selected.model };
  const persist = () => {
    try { if (preferenceKey) localStorage.setItem(preferenceKey, JSON.stringify(selected)); } catch { /* 本页选择仍然有效。 */ }
    onChange(currentValue());
  };
  const renderModels = () => {
    if (selected.followGlobal) {
      modelSelect.replaceChildren(new Option(globalDefault?.model || "按调度节点的默认模型", ""));
      modelSelect.disabled = true;
      return;
    }
    const node = nodes.find((item) => String(item.id) === selected.endpointId);
    modelSelect.replaceChildren(...(node?.models || []).map((model) => new Option(model + (model === node.defaultModel ? "（节点默认）" : ""), model)));
    modelSelect.value = selected.model;
    modelSelect.disabled = !selected.model;
  };
  nodeSelect.addEventListener("change", () => {
    selected = resolveTargetPreference(nodes, { endpointId: nodeSelect.value, followGlobal: false });
    renderModels(); persist();
  });
  modelSelect.addEventListener("change", () => {
    selected = resolveTargetPreference(nodes, { ...selected, model: modelSelect.value });
    persist();
  });
  let configured = false;
  const applyConfig = (config) => {
    nodes = Array.isArray(config.nodes) ? config.nodes : [];
    globalDefault = config.defaultTarget || null;
    selected = resolveTargetPreference(nodes, selected);
    const globalName = globalDefault ? "全局默认 · " + globalDefault.name : "自动调度（未设全局默认）";
    nodeSelect.replaceChildren(new Option(globalName, ""), ...nodes.map((node) => new Option(node.name, String(node.id))));
    nodeSelect.value = selected.followGlobal ? "" : selected.endpointId;
    nodeSelect.disabled = !nodes.length;
    renderModels();
    configured = Boolean(config.config?.uploaded && nodes.length);
    hint.textContent = configured ? "" : "没有可用的生图节点，请联系管理员配置服务。";
    persist();
    onConfig(configured);
  };
  try {
    const config = await loadImageConfig(imageConfigCacheKey(storageKey), applyConfig);
    applyConfig(config);
  } catch (error) {
    selected = { endpointId: "", model: "", followGlobal: true };
    nodeSelect.replaceChildren(new Option("节点加载失败", ""));
    hint.textContent = error.message;
    onConfig(false);
  }
  return {
    get configured() {
      return configured;
    },
    value: currentValue,
    setValue(value) {
      if (value.endpointId === undefined && value.model === undefined) return;
      selected = resolveTargetPreference(nodes, { ...value, followGlobal: !value.endpointId });
      nodeSelect.value = selected.followGlobal ? "" : selected.endpointId;
      renderModels(); persist();
    },
  };
}

// 工作台共用的右侧抽屉，只在用户展开时展示执行目标。
export async function mountImageTargetDrawer(host, options = {}) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "btn sm target-drawer-trigger";
  trigger.textContent = "节点与模型 · 全局默认";
  trigger.setAttribute("aria-haspopup", "dialog");
  host.append(trigger);
  const drawer = document.createElement("dialog");
  drawer.className = "target-drawer";
  drawer.setAttribute("aria-label", "节点与模型");
  drawer.innerHTML = '<header><div><h2>节点与模型</h2><p>默认跟随模型中心，也可以为本次创作自定义。</p></div><button class="btn sm" type="button" data-close aria-label="关闭节点与模型">×</button></header><div class="target-drawer-body"><div data-target></div><button class="btn full" type="button" data-default>恢复全局默认</button></div><footer><button class="btn primary" type="button" data-done>完成</button></footer>';
  document.body.append(drawer);
  trigger.addEventListener("click", () => drawer.showModal());
  drawer.querySelector("[data-close]").addEventListener("click", () => drawer.close());
  drawer.querySelector("[data-done]").addEventListener("click", () => drawer.close());
  drawer.addEventListener("click", (event) => { if (event.target === drawer) { const rect = drawer.getBoundingClientRect(); if (event.clientX < rect.left) drawer.close(); } });
  const control = await mountImageTarget(drawer.querySelector("[data-target]"), {
    ...options,
    onChange(value) {
      trigger.textContent = value.endpointId ? "节点与模型 · 自定义" : "节点与模型 · 全局默认";
      options.onChange?.(value);
    },
    onConfig(configured) {
      options.onConfig?.(configured);
    },
  });
  drawer.querySelector("[data-default]").addEventListener("click", () => {
    control.setValue({ endpointId: "", model: "" });
    host.dispatchEvent(new Event("change", { bubbles: true }));
  });
  drawer.querySelector("[data-target]").addEventListener("change", () => host.dispatchEvent(new Event("change", { bubbles: true })));
  return control;
}
