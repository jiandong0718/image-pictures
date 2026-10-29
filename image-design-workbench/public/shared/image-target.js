import { apiGet } from "/shared/api.js";

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

export async function mountImageTarget(host, { storageKey, onChange = () => {} } = {}) {
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
  try {
    const config = await apiGet("/api/image-config");
    nodes = Array.isArray(config.nodes) ? config.nodes : [];
    globalDefault = config.defaultTarget || null;
    selected = resolveTargetPreference(nodes, selected);
    const globalName = globalDefault ? "全局默认 · " + globalDefault.name : "自动调度（未设全局默认）";
    nodeSelect.replaceChildren(new Option(globalName, ""), ...nodes.map((node) => new Option(node.name, String(node.id))));
    nodeSelect.value = selected.followGlobal ? "" : selected.endpointId;
    nodeSelect.disabled = !nodes.length;
    renderModels();
    configured = Boolean(config.config?.uploaded && nodes.length);
    if (!configured) hint.textContent = "没有可用的生图节点，请联系管理员配置服务。";
    persist();
  } catch (error) {
    selected = { endpointId: "", model: "", followGlobal: true };
    nodeSelect.replaceChildren(new Option("节点加载失败", ""));
    hint.textContent = error.message;
  }
  return {
    configured,
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
  const control = await mountImageTarget(drawer.querySelector("[data-target]"), { ...options, onChange(value) {
    trigger.textContent = value.endpointId ? "节点与模型 · 自定义" : "节点与模型 · 全局默认";
    options.onChange?.(value);
  } });
  drawer.querySelector("[data-default]").addEventListener("click", () => {
    control.setValue({ endpointId: "", model: "" });
    host.dispatchEvent(new Event("change", { bubbles: true }));
  });
  drawer.querySelector("[data-target]").addEventListener("change", () => host.dispatchEvent(new Event("change", { bubbles: true })));
  return control;
}
