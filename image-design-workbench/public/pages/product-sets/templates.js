export const PRODUCT_SLOTS = Object.freeze([
  { id: "whiteBackground", title: "干净主图", subtitle: "突出商品整体" },
  { id: "detail", title: "细节特写", subtitle: "展示真实材质" },
  { id: "scene", title: "场景展示", subtitle: "呈现使用氛围" },
  { id: "sellingPoints", title: "卖点展示", subtitle: "突出已提供的信息" },
]);

export const PRODUCT_TEMPLATES = Object.freeze([
  { id: "clean", title: "清透商品套系", category: "通用", image: "beauty.png", accent: "#c7dfd7", description: "干净主图、质感特写与自然使用场景。", direction: "清爽中性色商业摄影，自然柔光、干净背景、真实比例，统一画面光线。" },
  { id: "beauty", title: "质感美妆套系", category: "美妆", image: "beauty.png", accent: "#b9d8ce", description: "柔和棚拍与材质细节，适合精致产品。", direction: "高级美妆商业摄影，柔和漫射光，克制的浅色石材或陶瓷台面，细腻自然的材质与反射。" },
  { id: "fashion", title: "服饰穿搭套系", category: "服饰", image: "fashion.png", accent: "#b8c8cd", description: "服饰整体、面料细节和自然穿搭场景。", direction: "真实服饰电商摄影，简洁中性色影棚与自然穿搭氛围，清晰表现布料纹理、版型及真实比例。" },
  { id: "home", title: "生活居家套系", category: "家居", image: "home.png", accent: "#d2c4b3", description: "自然居家环境，强调真实生活感。", direction: "真实居家生活方式摄影，自然窗光、温润材质、整洁空间，画面舒展且主体清晰。" },
  { id: "tech", title: "数码科技套系", category: "数码", image: "electronics.png", accent: "#bec9dd", description: "简洁陈列和结构细节，突出产品质感。", direction: "克制的数码产品商业摄影，整洁中性台面，均匀轮廓光，真实展示产品材质、结构和接口。" },
]);

const SLOT_DIRECTIONS = Object.freeze({
  whiteBackground: "生成一张商品整体主图：纯白或接近白色的干净背景，完整展示商品，构图居中，边缘清晰，保持自然阴影，不添加道具和文字。",
  detail: "生成一张商品细节特写：选择参考图中真实可见的材质、结构或工艺局部，清晰展示细节，同时保留足够的商品轮廓，不创造不存在的部件。",
  scene: "生成一张场景展示图：将商品自然放置在与其用途相符的环境中，商品清晰完整，场景只作辅助，不夸大使用效果。",
  sellingPoints: "生成一张卖点展示图：以清晰构图突出用户提供的真实特点；如果没有提供卖点，仅展示可见外观和材质，不添加未经证实的文字或功能。",
});

export function buildProductPrompts(templateId, productName, productNotes, types) {
  const template = PRODUCT_TEMPLATES.find(item => item.id === templateId);
  if (!template) throw new Error("请选择套图模板");
  const chosen = [...new Set(Array.isArray(types) ? types : [])];
  if (!chosen.length || chosen.some(type => !SLOT_DIRECTIONS[type])) throw new Error("请选择需要生成的图片类型");
  const name = String(productName || "").trim().slice(0, 100);
  const notes = String(productNotes || "").trim().slice(0, 800);
  const common = [
    "以上传的商品图片为唯一产品外观依据。准确保持商品的形状、结构、颜色、材质、图案、包装与可见标识，不重新设计、不替换商品、不虚构配件。",
    name ? `商品名称：${name}。` : "",
    notes ? `用户提供的商品信息：${notes}。仅将其作为真实信息参考，不扩展或虚构功效。` : "没有提供的规格、数量、材质与功效均不得猜测。",
    `整套视觉方向：${template.direction}`,
    "每次只生成一张独立图片，不拼图、不加水印；保持商品真实可信，不添加未经用户提供的文字或品牌。",
  ].filter(Boolean).join("\n");
  return Object.fromEntries(chosen.map(type => [type, `${common}\n本张任务：${SLOT_DIRECTIONS[type]}`]));
}
