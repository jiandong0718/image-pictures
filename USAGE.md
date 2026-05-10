# 商品图片设计工具使用说明

本工具用于生成一组商品图片：主图、白色背景图、尺寸标注图、局部放大图、人物穿戴图、场景展示图、卖点展示图。图片规格可在页面顶部配置，默认请求 `1024x1024`，默认只强制 `1:1` 方图。

## 快速启动

进入工具目录：

```bash
cd image-design-toolkit/image-design-workbench
```

创建 `.env`：

```dotenv
CUSTOM_IMAGE_API_KEY=你的 API Key
CUSTOM_IMAGE_API_BASE=https://aicodelink.top/v1
CUSTOM_IMAGE_MODEL=gpt-image-2
```

启动：

```bash
npm run dev
```

打开：

```text
http://127.0.0.1:4173
```

## 使用流程

1. 填写主图提示词，点击“生成主图”；也可以点击“上传主图”，选择已有图片作为源图。
2. 主图准备好后，六张衍生图会自动解锁。
3. 填写六张衍生图的独立提示词。
4. 点击“生成六张衍生图”，或单独重新生成任意一张。
5. 图片生成后可以单张下载，也可以“下载全部”打包下载。
6. 需要多套图时点击“新套图窗口”，每个窗口都会分配独立编号，互不影响。

上传主图会按页面规格校验实际尺寸。生成结果如果不是 `1:1`，会自动裁剪成方图；如果选择“固定边长”，还会重采样到指定边长后保存到套图。

生成图片会按套图编号保存到独立文件夹：

```text
image-design-workbench/generated-images/product-design/001/
image-design-workbench/generated-images/product-design/002/
```

## 包内 skill

包内已包含 `自定义文生图` skill：

```text
skills/custom-image-generator/
```

网页工具会优先调用这个包内 skill。也可以单独使用：

```bash
python3 ../skills/custom-image-generator/scripts/image_generator.py "极简商品主图，白底，高级商业摄影" --output-dir ./outputs --size 1024x1024
```

基于源图编辑：

```bash
python3 ../skills/custom-image-generator/scripts/image_generator.py "基于源图生成白色背景电商图" --endpoint edits --image ./main.png --output-dir ./outputs --size 1024x1024
```

## 打包说明

压缩包不会包含 `.env`、API Key、历史生成图片、缓存文件。
