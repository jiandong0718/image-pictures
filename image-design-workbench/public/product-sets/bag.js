(function registerBagProductSet(globalObject) {
  const registry = globalObject.ImageDesignProductSets || (globalObject.ImageDesignProductSets = {});

  registry.bag = {
    label: "商品微调图",
    module: {
      kicker: "套图工作流",
      title: "商品微调图",
      subtitle: "基于商品主图做局部调整、风格延展或展示方式微调，保留主体一致性。",
      productSetMode: "bag",
      requiresApiConfig: true,
    },
    derivedTypes: ["derived"],
    generateAllLabel: "生成衍生图",
    readyStatus: "主图已准备，可以继续生成衍生图",
    generatingStatus: "正在生成衍生图",
    doneStatus: "衍生图已生成",
    partialStatus: "衍生图生成失败",
    typeLabels: {
      derived: "衍生图",
    },
    defaultPrompts: {
      derived:
        "基于主图生成一张商品微调图。保留商品主体、颜色、材质和图案细节，按照我的要求调整场景、角度或展示方式，画面干净高级，适合电商详情页。",
    },
  };
})(globalThis);
