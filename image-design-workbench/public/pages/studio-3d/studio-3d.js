// 3D 转平面工作台入口：上传 3D 商品图作源图 → 生成两张平面部位图。
// mainUploadOnly = 主图只能上传、不能文生图。独立 JS。

import { createStudio } from "/shared/studio-core.js";

createStudio({
  mode: "shoulderBagFlat",
  crumb: "STUDIO",
  title: "3D 转平面",
  mainUploadOnly: true,
  derivedTypes: ["shoulderBagStrap", "shoulderBagBody"],
  generateAllLabel: "生成两张部位图",
  typeLabels: {
    shoulderBagStrap: "部位1图",
    shoulderBagBody: "部位2图",
  },
  defaultPrompts: {
    main: "",
    shoulderBagStrap: "基于上传的 3D 商品图生成平面部位1图。保留商品颜色、材质、印花和五金细节，突出肩带连接、调节扣、走线和受力结构，画面干净，适合电商详情页。",
    shoulderBagBody: "基于上传的 3D 商品图生成平面部位2图。保留包型、颜色、材质和印花细节，突出包身轮廓、开合结构、边缘工艺和容量区域，画面干净，适合电商详情页。",
  },
}).start();
