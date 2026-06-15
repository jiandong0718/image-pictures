(function registerShoulderBagFlatProductSet(globalObject) {
  const registry = globalObject.ImageDesignProductSets || (globalObject.ImageDesignProductSets = {});

  registry.shoulderBagFlat = {
    label: "3D转平面",
    module: {
      kicker: "套图工作流",
      title: "3D转平面",
      subtitle: "上传 3D 商品图后生成适合电商详情页使用的平面结构部位图。",
      productSetMode: "shoulderBagFlat",
      requiresApiConfig: true,
    },
    derivedTypes: ["shoulderBagStrap", "shoulderBagBody"],
    generateAllLabel: "生成两张部位图",
    readyStatus: "主图已准备，可以继续生成两张部位图",
    generatingStatus: "正在同时生成两张部位图",
    doneStatus: "两张部位图已生成",
    partialStatus: "部分部位图生成失败",
    mainUploadOnly: true,
    typeLabels: {
      shoulderBagStrap: "部位1图",
      shoulderBagBody: "部位2图",
    },
    defaultPrompts: {
      shoulderBagStrap:
        "基于上传的 3D 商品图生成平面部位1图。保留商品颜色、材质、印花和五金细节，突出肩带连接、调节扣、走线和受力结构，画面干净，适合电商详情页。",
      shoulderBagBody:
        "基于上传的 3D 商品图生成平面部位2图。保留包型、颜色、材质和印花细节，突出包身轮廓、开合结构、边缘工艺和容量区域，画面干净，适合电商详情页。",
    },
  };
})(globalThis);
