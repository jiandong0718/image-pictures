---
name: custom-image-generator
description: 使用兼容图片接口调用 `gpt-image-2` 等模型执行文生图。适用于用户要求根据提示词生成图片、批量出图、指定输出目录、调试第三方兼容接口，或需要通过 `.env`、命令行参数或环境变量提供凭证时。
---

# 自定义文生图

## Overview

使用 `scripts/image_generator.py` 调用兼容图片 HTTP 接口执行文生图。
默认配置：模型 `gpt-image-2`，API Base `https://aicodelink.top/v1`，默认端点 `/v1/images/generations`，支持从 `.env` 自动读取 API Key。

## Quick Start

1. 在 skill 根目录创建 `.env`，或者用 `--env-file` 指定其他路径。
2. 把 `CUSTOM_IMAGE_API_KEY` 写进去。
3. 运行脚本生成图片。

推荐把 `.env` 放在 skill 根目录，也就是 `scripts/` 的上一级，和 `SKILL.md` 同级。

示例 `.env`：

```dotenv
CUSTOM_IMAGE_API_KEY=your-api-key-here
CUSTOM_IMAGE_API_BASE=https://aicodelink.top/v1
CUSTOM_IMAGE_MODEL=gpt-image-2
CUSTOM_IMAGE_OUTPUT_DIR=generated-images
```

示例：

```bash
python3 scripts/image_generator.py "一只戴墨镜的橘猫，坐在复古摩托车上，电影海报风格"
python3 scripts/image_generator.py "赛博朋克城市夜景" --env-file ./secrets/image.env --output-dir ./outputs
python3 scripts/image_generator.py "极简风产品海报，白底，高级感" --save-response
python3 scripts/image_generator.py "把这张产品图改成暖金色高级质感" --endpoint edits --image ./input.png --save-response
```

## Workflow

### 1. 准备参数

优先使用以下默认值，除非用户明确要求覆盖：

- `--model gpt-image-2`
- `--api-base https://aicodelink.top/v1`
- `--endpoint generations`

配置来源优先级：

1. 命令行参数
2. `.env` 文件
3. 环境变量
4. 代码内默认值

默认会自动查找两个位置的 `.env`：

- 当前工作目录下的 `.env`
- skill 根目录下的 `.env`

不要把密钥写死进脚本，更别整进仓库。那不是工具，那是给自己埋雷。

### 2. 选择请求模式

脚本支持两种图片端点：

- `generations`：请求 `/images/generations`
- `edits`：请求 `/images/edits`
- `auto`：按 `generations -> edits` 顺序自动探测

默认使用 `generations`。如果要做带源图的编辑，改用 `--endpoint edits --image ./input.png`；如果不确定供应商兼容层怎么实现，可以用 `--endpoint auto` 兜底。

### 3. 保存结果

脚本会把返回的 Base64 图片或图片 URL 下载成本地文件，默认输出到 `./generated-images`。
如果需要排查兼容性问题，附加 `--save-response` 保存原始 JSON。

## Script Reference

主脚本：`scripts/image_generator.py`

常用参数：

- `prompt`：必填提示词
- `--env-file`：显式指定 `.env` 文件路径
- `--api-key`：显式传入密钥
- `--api-base`：覆盖默认 API Base
- `--model`：覆盖默认模型
- `--endpoint`：`auto`、`generations`、`edits`
- `--image`：`edits` 模式下要编辑的源图路径
- `--output-dir`：输出目录
- `--filename-prefix`：输出文件名前缀
- `--n`：期望图片数量
- `--size`：透传给兼容图片接口的尺寸参数
- `--background`：透传背景参数
- `--save-response`：保存原始响应 JSON
- `--dry-run`：仅打印将要请求的端点和载荷，不发起网络请求

## Debugging

排障顺序别整反了：

1. 先用 `--dry-run` 检查请求参数和 `loaded_env_file`。
2. 再用 `--save-response` 看服务端到底回了啥。
3. 如果默认 `generations` 失败，改用 `--endpoint edits` 或 `--endpoint auto` 单独试。
4. 如果返回里只有文本没有图，优先怀疑供应商兼容层，不要先甩锅脚本。

需要端点兼容细节时，再看 `references/request-modes.md`。
