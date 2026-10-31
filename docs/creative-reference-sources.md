# 电商与视频参考来源

- 电商商品套图：[ecommerce-gpt-image-prompts](https://github.com/ecomimagelab/ecommerce-gpt-image-prompts)，仓库贡献者，CC BY 4.0，许可文本：https://creativecommons.org/licenses/by/4.0/ 。内置快照来自该仓库 2026-07-30 的 `data/prompts.json`，仅选取标记为 `repository-authored`、提示词许可为 CC BY 4.0 的记录；每个套图变体被拆分为独立条目，保留作者和来源。示例图仍是上游链接，只有明确为 CC BY 4.0 的仓库相对路径才展示；引用时应核实素材及商品相关权利。内置快照可离线浏览，用户主动同步时从固定来源更新，失败保留现有内容。
- 视频提示词：[AI Video Prompt Cookbook](https://github.com/yasuomang/ai-video-prompt-cookbook)，MIT 许可。视频页面的中文示例按照主体保真、动作、运镜、光线和约束的结构重新编写，提供文生与图生两类，并非上游原文的逐字翻译。
- 产品体验参考：[Lovart](https://www.lovart.art/) 的设计技能/商品图集入口，以及 [LibTV](https://www.liblib.tv/) 的多模型视频创作入口；仅参考功能组织，没有复制其界面素材或声称与其服务相同。

## 视频接口依据

- [阿里云万相 3.0](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference)：文生、首帧/首尾帧，2–30 秒，按官方异步任务接口调用；当前没有实现视频参考、音频参考或视频编辑。
- [阿里云万相 2.6 文生视频](https://help.aliyun.com/zh/model-studio/legacy-wan-text-to-video-api-reference) 和 [首帧图生视频](https://help.aliyun.com/zh/model-studio/legacy-image-to-video-api-reference/)：按模型类型分别添加节点，支持 2–15 秒。
- [MiniMax H3](https://platform.minimax.io/docs/guides/video-generation)：支持文生、首帧/首尾帧和模型对应的 4–15 秒（H3 Max 5–15 秒）；当前没有实现参考视频或参考音频。
- [Agnes API 概述](https://www.agnes-ai.com/zh-Hans/docs/overview)：保留原有 Agnes 兼容视频协议，官方 Base URL 为 `https://apihub.agnes-ai.com/v1`。具体模型是否开放以及其参数，请以模型专用文档为准；其他第三方聚合渠道须根据具体接口文档适配，不能假定协议一致。
- [Grsai Veo](https://grsai.com/zh/dashboard/documents/veo)：支持 veo3.1-fast / veo3.1-pro 文生视频及公网图片地址的首尾帧图生视频，按单次任务配置站内积分；该接口文档未提供时长和清晰度参数。多张参考图模式尚未接入。上游视频地址有时效，成功后立即下载到本地。

以上时长与参数以接口公开文档为依据；实际开通权限、可用区域、上游价格和结果由对应服务商决定。站内积分由管理员按视频节点配置，不代表上游账单。未使用真实付费 API Key 验证。
