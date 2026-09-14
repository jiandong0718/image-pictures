// 版画商品图：以主图为源，扩展人物、场景和细节展示图。
import { createStudio } from "/shared/studio-core.js";

createStudio({
  mode: "print",
  crumb: "STUDIO",
  title: "版画商品图",
  derivedTypes: ["worn", "scene", "detail"],
  heroLayout: false,
  generateAllLabel: "生成全部衍生图",
  typeLabels: { worn: "人物图", scene: "场景图", detail: "细节图" },
  defaultPrompts: {
    main: "为一幅版画商品生成电商主视图。画面平整、构图完整，突出版画的纸张、印刷纹理、色彩和艺术细节，背景干净，适合商品展示。",
    worn: "基于主图生成版画装饰在真实人物空间中的展示图。保留版画内容、色彩和比例，人物自然入镜，突出装饰效果与生活方式氛围。",
    scene: "基于主图生成版画商品的场景展示图。保留版画主体和细节，将它自然融入高级家居或艺术空间，光线真实，构图适合电商展示。",
    detail: "基于主图生成版画局部细节图。放大纸张、印刷纹理、笔触和色彩层次，保持原作风格与真实材质，适合商品详情页。",
  },
}).start();
