# Image Design Toolkit

本项目是一个本地商品图片设计工作台，用于生成和管理一组电商商品图。每套图包含主图、白色背景图、尺寸标注图、局部放大图、人物穿戴图、场景展示图和卖点展示图。

## 功能特性

- 本地网页工作台，默认地址为 `http://127.0.0.1:4173`
- 支持生成主图，也支持上传已有主图
- 基于主图生成六张衍生商品图
- 页面可配置图片规格：默认 `1:1` 方图，也可选择固定边长
- 生成结果按套图编号保存，支持单张下载和打包下载

## 项目结构

```text
image-design-workbench/          本地网页工具
image-design-workbench/public/   前端页面文件
image-design-workbench/server.js 本地服务和图片接口
skills/custom-image-generator/   图片生成脚本与配置说明
USAGE.md                         使用说明
使用说明.md                      中文打包说明
```

## 快速开始

进入工作台目录：

```bash
cd image-design-workbench
```

创建本地配置文件：

```bash
cp .env.example .env
```

编辑 `.env`，填入你的接口配置：

```dotenv
CUSTOM_IMAGE_API_KEY=your-api-key-here
CUSTOM_IMAGE_API_BASE=https://aicodelink.top/v1
CUSTOM_IMAGE_MODEL=gpt-image-2
```

启动服务：

```bash
npm run dev
```

浏览器打开：

```text
http://127.0.0.1:4173
```

## 常用命令

```bash
npm run dev
```

启动本地工作台。

```bash
npm test
```

运行服务端图片规格校验测试。

## 输出目录

生成图片保存在：

```text
image-design-workbench/generated-images/product-design/
```

每套图会按编号创建独立目录，例如 `001/`、`002/`。

## 安全说明

不要提交 `.env`、接口密钥、生成图片或临时响应文件。仓库已通过 `.gitignore` 忽略这些运行产物。
