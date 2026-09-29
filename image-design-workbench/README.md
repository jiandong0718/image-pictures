# 商品图片设计工作台

本地网页工具，用来生成并管理商品图片工作流。当前支持商品衍生图、商品微调图和 3D转平面；图片规格可在页面顶部配置，默认请求 `1024x1024`，默认只强制 1:1 方图。

根路径 `/` 是无需登录的灵感首页，展示创作者主动公开的图片、视频和提示词。未发布的作品不会出现在首页。首页带有明确标注的创作示例，即使尚无人发布也可以浏览灵感。

首页右上角可切换外观主题和中英文界面，打开版本更新通知或快捷菜单。主题与语言偏好保存在当前浏览器；主题也会应用到工作台其他页面，英文文案目前覆盖灵感首页。版本通知按浏览器记录已读状态。发布新版时，在 `public/shared/site-preferences.js` 的 `RELEASE_NOTES` 数组顶部添加一条带唯一 `id`、日期及中英文标题和摘要的记录；新 `id` 会自动显示为未读。

「我的图库」按单件作品展示已生成的图片和视频，支持按标题、类型或提示词搜索，分别收藏和命名，并在详情中查看同套图的邻近作品。作品详情可复制提示词、带提示词返回生图或视频页，也可把图片直接带入 AI 修图页。用户可在详情中发布作品到首页或随时撤回；发布会公开该作品、标题和提示词。

主图既可以用提示词生成，也可以上传已有图片作为源图，再基于这张主图生成当前工作流需要的衍生图。3D转平面模式使用上传主图作为源图，并生成部位1图和部位2图。

页面顶部的“提示词提取”入口支持上传一张图片，并调用已配置的视觉模型提取可复用的中文详细生图提示词。

## 启动

```bash
npm run dev
```

打开：

```text
http://127.0.0.1:4174
```

## 生图配置

后端会按以下顺序自动查找 `自定义文生图` 脚本：

```text
1) CUSTOM_IMAGE_SKILL_SCRIPT（仅当路径存在时使用）
2) image-design-workbench/skills/custom-image-generator/scripts/image_generator.py
3) ../skills/custom-image-generator/scripts/image_generator.py
4) ~/.codex/skills/custom-image-generator/scripts/image_generator.py
```

配置中心包含三类配置：

- 生图配置：每组 API 端点可配置多个可用模型（逗号分隔，首项为默认）；自由生图和绘图聚集地可在创作时选择模型，服务端只在支持该模型的端点中轮询或随机调度。旧端点原有的单模型配置继续有效。
- 提示词提取配置：单独填写提示词 API URL、API Key 和模型名；用于图片理解/GPT 能力，不影响画图接口。
- 生视频配置：填写视频 API Key 和模型名，用于文生视频与图生视频。

配置中心保存的生图端点、提示词和视频接口配置持久化在 MySQL；`.env` 仍可提供初始配置。账户、积分和图库元数据也使用 MySQL，图片及视频文件保存在 `generated-images/`。

`.env` 仍可作为命令行脚本的本地默认配置：

```dotenv
CUSTOM_IMAGE_API_KEY=your-api-key-here
CUSTOM_IMAGE_API_BASE=https://colorflowai.com/v1
CUSTOM_IMAGE_MODEL=gpt-image-2
CUSTOM_PROMPT_API_BASE=https://api.example.com/v1
CUSTOM_PROMPT_API_KEY=your-prompt-api-key-here
CUSTOM_PROMPT_EXTRACT_MODEL=gpt-4o-mini
```

每个浏览器窗口会自动分配一个独立套图编号，窗口之间互不影响；一套图包含 1 张主图和当前模式下的衍生图。生成结果会按数据顺序保存到独立文件夹：

```text
generated-images/product-design/001/
generated-images/product-design/002/
generated-images/product-design/003/
```

上传主图和生成结果会在服务端按当前选择的比例与边长进行裁剪或重采样，再保存到套图。
