# Request Modes

## Purpose

说明 `scripts/image_generator.py` 在不同兼容接口下如何组织请求和解析响应。
只在联调第三方兼容层、定位 400/404/422、或确认某个端点是否真的支持图片输出时阅读。

## Endpoint Order

默认使用 `generations`，也就是 `/images/generations`。

`--endpoint auto` 按以下顺序尝试：

1. `/images/generations`
2. `/images/edits`

这样排的原因很简单：当前模型明确挂在图片接口上，先走生成端点；如果任务本身带源图，再尝试编辑端点。

## Request Shapes

### `/images/generations`

发送字段：

- `model`
- `prompt`
- `n`
- 可选 `size`
- 可选 `background`

### `/images/edits`

发送字段：

- `model`
- `prompt`
- `image`
- `n`
- 可选 `size`
- 可选 `background`

## Response Parsing

脚本会递归扫描常见图片返回字段：

- `b64_json`
- `image_base64`
- `result`
- `url`
- `image_url`

如果拿到的是图片 URL，脚本会继续下载文件到本地。
如果拿到的是 Base64，脚本会根据 MIME 或文件头推断扩展名。

## Notes

- 这个工具目标是“尽量兼容”，不是“替供应商定义标准”。
- 第三方兼容接口经常嘴上说兼容，手上乱回字段；所以保留 `--save-response` 和 `--endpoint` 很有必要。
- 如果服务端需要完全不同的字段结构，就改脚本；别指望祈祷把接口祷成标准件。
