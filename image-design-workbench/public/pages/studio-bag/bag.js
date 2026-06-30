// 商品微调图工作台入口：主图 → 单张微调衍生图。独立 JS，注入本模式配置。

import { createStudio } from "/shared/studio-core.js";

createStudio({
  mode: "bag",
  crumb: "STUDIO",
  title: "商品微调图",
  derivedTypes: ["derived"],
  generateAllLabel: "生成衍生图",
  typeLabels: {
    derived: "衍生图",
  },
  defaultPrompts: {
    main: "为一款商品生成电商主图。商品居中展示，材质真实，光线干净，高级商业摄影风格，适合电商平台首图。",
    derived: "基于主图生成一张商品微调图。保留商品主体、颜色、材质和图案细节，按照我的要求调整场景、角度或展示方式，画面干净高级，适合电商详情页。",
  },
}).start();
