# 商品图片设计工作台

本地网页工具，用来生成并管理 7 张商品图：主图、白色背景图、尺寸标注图、局部放大图、人物穿戴图、场景展示图、卖点展示图。图片规格可在页面顶部配置，默认请求 `1024x1024`，默认只强制 1:1 方图。

主图既可以用提示词生成，也可以上传已有图片作为源图，再基于这张主图生成六张衍生图。

## 启动

```bash
npm run dev
```

打开：

```text
http://127.0.0.1:4173
```

## 生图配置

后端会按以下顺序自动查找 `自定义文生图` 脚本：

```text
1) CUSTOM_IMAGE_SKILL_SCRIPT（仅当路径存在时使用）
2) image-design-workbench/skills/custom-image-generator/scripts/image_generator.py
3) ../skills/custom-image-generator/scripts/image_generator.py
4) ~/.codex/skills/custom-image-generator/scripts/image_generator.py
```

API Key 可以放在当前项目的 `.env`，也可以继续使用 skill 目录下的 `.env`：

```dotenv
CUSTOM_IMAGE_API_KEY=your-api-key-here
CUSTOM_IMAGE_API_BASE=https://aicodelink.top/v1
CUSTOM_IMAGE_MODEL=gpt-image-2
```

每个浏览器窗口会自动分配一个独立套图编号，窗口之间互不影响；一套图包含 1 张主图和 6 张衍生图。生成结果会按数据顺序保存到独立文件夹：

```text
generated-images/product-design/001/
generated-images/product-design/002/
generated-images/product-design/003/
```

上传主图会按页面规格校验实际尺寸。生成结果如果不是 1:1，会在服务端自动裁剪成方图；如果选择“固定边长”，还会重采样到指定边长后保存到套图。
