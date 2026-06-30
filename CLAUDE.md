# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概览

本仓库是一个**本地商品图片设计工作台**:用一张商品主图(生成或上传)扩展出整套电商详情图(白底、尺寸标注、局部放大、人物穿戴、场景、卖点等)。核心是 `image-design-workbench/` 下的零依赖 Node.js HTTP 服务,真正的画图能力委托给一个独立的 Python skill 脚本。

## 常用命令

所有命令在 `image-design-workbench/` 目录下运行(除非另有说明):

```bash
npm run dev      # = npm start = node server.js,启动工作台(默认 http://127.0.0.1:4174)
npm test         # 运行 node --test,执行 tests/*.test.js
```

跑单个测试文件 / 单个用例:

```bash
node --test tests/image-dimensions.test.js
node --test --test-name-pattern="部分关键字" tests/image-dimensions.test.js
```

直接调用画图脚本(绕过 Web 层,便于调试 API 连通性):

```bash
python3 skills/custom-image-generator/scripts/image_generator.py "提示词" \
  --endpoint generations --output-dir /tmp/out --filename-prefix test --dry-run
# 去掉 --dry-run 才会真正请求;edits 端点需额外传 --image <源图路径>
```

内嵌的 vendor 子项目 `vendor/gpt-image-playground/`(Vite + React + TS,独立技术栈)单独构建:

```bash
cd image-design-workbench/vendor/gpt-image-playground
npm install && npm run build   # 产物输出到 dist/,由主 server.js 在 /gpt-image-playground/ 路径下托管
npm test                       # vitest run
```

## 架构

理解本项目需要抓住三层之间的关系:

### 1. Node 服务层 (`server.js`,~2000 行,纯 CommonJS,无第三方依赖)

- 用原生 `http` 起服务,手写路由:`handleApi()` 按 `req.method + pathname` 逐条匹配 `/api/*`;非 API 请求走 `serveStatic()`;`/gpt-image-playground/*` 转发到 vendor 的 `dist/`。
- **不自己调用图片 API**,而是 `spawn` Python skill 脚本来生图(见下文第 2 层)。`buildImageGeneratorArgs()` 拼参数、`buildImageGeneratorEnv()` 注入运行时 API Key,解析脚本 stdout 里打印的图片路径。
- **运行时配置只存在进程内存里**(`runtimeImageApiConfig` / runtime prompt config),不写浏览器存储也不写文件。`/api/image-config`、`/api/prompt-config` 用于页面动态设置;进程重启后丢失,靠 `.env` 提供默认值。**画图接口地址在服务端固定(`FIXED_IMAGE_API_BASE`),不向页面暴露**;只有 API Key 由页面填写。
- 两套互不影响的配置:**生图配置**(`CUSTOM_IMAGE_*`)与**提示词提取配置**(`CUSTOM_PROMPT_*`,用于视觉模型从上传图反推中文提示词,走 `/api/prompts/extract`,这部分是 server.js 直接 `fetch`,没走 Python)。
- **图片规格归一化**:上传图和生成图若非 1:1 会在服务端自动裁成方图;选"固定边长"会重采样。归一化用外部命令完成 —— macOS 默认 `sips`,其他平台默认 `magick`(ImageMagick),可用 `IMAGE_NORMALIZER` 环境变量覆盖。`assertImageSpecDimensions` / `normalizeImageSpec` 等规格逻辑是测试重点。
- `IMAGE_TYPES`(server.js 顶部)是图片类型的**单一事实来源**:每种类型定义 `label` / `prefix`(文件名前缀,kebab-case)/ `endpoint`(`generations` 用于主图,`edits` 用于衍生图)。

### 2. Python skill 脚本 (`skills/custom-image-generator/scripts/image_generator.py`)

- 独立 CLI,**零第三方依赖**(只用标准库 `urllib`),调用 OpenAI 兼容的 image API。`generations` 走 JSON,`edits` 走 multipart 上传源图。
- 能从响应里多种形态提取图片:`b64_json` / data URL / 图片 URL(自动下载)/ 内联 base64,见 `collect_image_candidates()`。结果保存为 `<prefix>-<时间戳>-NN.<ext>`,路径打印到 stdout 供 Node 层解析。
- 配置优先级(`apply_config` + `pick_value`):命令行参数 > 环境变量 > `.env` 文件 > 内置默认值。
- **脚本路径解析有 fallback 链**(server.js 的 `SKILL_SCRIPT_CANDIDATES`):`CUSTOM_IMAGE_SKILL_SCRIPT` 环境变量 → workbench 内嵌副本 → 仓库根的 `skills/` → `~/.codex/skills/`。仓库根的 `skills/custom-image-generator/` 是这个脚本的主副本。
- Python 命令也有 fallback:`CUSTOM_IMAGE_PYTHON` → `PYTHON` → `python` → `python3`。

### 3. 前端 (`public/`,原生 JS,无构建步骤)

- 入口 `index.html` 按顺序加载:`product-sets/*.js`(注册各品类配置到全局 `ImageDesignProductSets`)→ `product-workspaces.js`(workspace 状态工厂,同时支持浏览器全局和 CommonJS `module.exports`,所以能被 Node 测试 require)→ `app.js`(主逻辑)。
- **产品套图模式(product set modes)是核心扩展点**:每个 `public/product-sets/<品类>.js` 声明该品类的 `derivedTypes`、各类型的中文默认提示词、UI 文案。当前模式见 `app.js` 顶部 `PRODUCT_WORKSPACE_MODES`(如 `hat` / `bag` / `shoulderBagFlat`)。新增一个品类工作流 = 加一个 product-set 文件 + 在 `PRODUCT_WORKSPACE_MODES` 注册,必要时在 server.js 的 `IMAGE_TYPES` 补充新的衍生类型。
- 每个浏览器窗口自动分配一个独立的套图编号(`/api/image-sets`),窗口间互不干扰;同一窗口在不同模式间切换时各自维护独立 workspace(`ProductWorkspaces`)。状态持久化在 `localStorage`,key 见 `STORAGE_KEY`。
- 生成结果按编号存到 `generated-images/product-design/001/`、`002/` …(被 gitignore 忽略)。

## 约定

- 服务端 / 测试 / 前端一律 **CommonJS + 2 空格缩进**,默认 `const`,需要重赋值才用 `let`。变量函数用 camelCase;生成图前缀和对外文件名用 kebab-case(如 `white-background`、`selling-points`)。
- 测试用 Node 内置 `node:test` + `node:assert/strict`,放在 `image-design-workbench/tests/`,命名 `*.test.js`。改动图片校验 / 归一化 / 上传解析 / 输出路径逻辑时,补对应的 server helper 测试;提 PR 前跑 `npm test`。
- 提交信息保持简短、祈使句、聚焦单一改动(如 `Add upload size validation`)。**不要提交** `.env`、API Key、`generated-images/`、`*response*.json` 临时响应、`node_modules/`(已在 `.gitignore` 覆盖)。
- 注:仓库根 `README.md` 写 `4173`,workbench 内 `README.md` 与代码默认 `4174`;实际默认端口以 `server.js` 的 `PORT`(4174)为准,可用 `PORT` 环境变量覆盖。

## 部署

`deploy/` 提供 systemd unit(`image-design-workbench.service`)和 nginx 反代配置,用于把工作台部署为常驻服务(生产环境用 `magick` 做归一化、`PORT=4173`)。
