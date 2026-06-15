(function registerHatProductSet(globalObject) {
  const registry = globalObject.ImageDesignProductSets || (globalObject.ImageDesignProductSets = {});

  registry.hat = {
    label: "商品衍生图",
    module: {
      kicker: "套图工作流",
      title: "商品衍生图",
      subtitle: "从商品主图扩展白底、尺寸、细节、穿戴、场景和卖点等详情图。",
      productSetMode: "hat",
      requiresApiConfig: true,
    },
    derivedTypes: ["whiteBackground", "dimensions", "detail", "worn", "scene", "sellingPoints"],
    generateAllLabel: "生成六张衍生图",
    readyStatus: "主图已准备，可以继续生成六张衍生图",
    generatingStatus: "正在同时生成六张衍生图",
    doneStatus: "六张衍生图已生成",
    partialStatus: "部分衍生图生成失败",
    typeLabels: {
      whiteBackground: "白色背景图",
      dimensions: "尺寸标注图",
      detail: "局部放大图",
      worn: "人物穿戴图",
      scene: "场景展示图",
      sellingPoints: "卖点展示图",
    },
    defaultPrompts: {
      whiteBackground:
        "基于主图保留商品外观、颜色和 3D 印花细节，生成纯白背景电商图。商品完整居中，边缘干净，无多余道具。",
      dimensions:
        "基于主图生成尺寸标注图。保留商品正面外观，添加清晰的尺寸辅助线、箭头和标注区域，画面整洁，适合商品详情页。",
      detail:
        "基于主图生成局部放大细节图。突出 3D 印花纹理、面料质感、边缘工艺和颜色层次，带局部放大窗口，商业详情页风格。",
      worn:
        "基于主图生成真实人物穿戴图。模特自然穿戴该商品，商品图案和颜色保持一致，姿态自然，背景简洁，适合电商展示。",
      scene:
        "基于主图生成生活场景展示图。保留商品外观、颜色和 3D 印花细节，将商品自然放置在简洁真实的使用场景中，适合商品详情页。",
      sellingPoints:
        "基于主图生成卖点展示图。保留商品外观、颜色和 3D 印花细节，加入清晰卖点标注区域和简洁版式，不添加虚假参数。",
    },
  };
})(globalThis);
