# 本例使用的 SDK

准确参数与返回类型在 [本仓库类型](../../sdk/index.d.ts) 和 [官方能力清单](https://murongyun8.github.io/MediaTidy-Wiki/plugins/capabilities)。不使用旧 SDK v1 的 `organize.prepare` 或整数任务 ID。

| 方法 | 用途 |
|---|---|
| `runtime.info/checkpoint/progress/result` | 持久运行 ID、取消检查、进度和部分结果 |
| `files.scan` | 授权目录后台扫描 MT 视频类型 |
| `system.config` | 只读视频扩展名，不返回服务凭据或 FF 配置 |
| `organize.profile` | 授权方案状态 |
| `ai.capabilities/chat/web.search` | 可用工具、模型通信及按需公开搜索 |
| `tmdb.search/detail/season` | AI 明确请求的查询 |
| `organize.manual.run` | 按插件作品和季集参数逐文件直接整理 |
| `tasks.wait/items` | 释放工作进程、完成回调与分页扫描结果 |
| `storage.get/set` | 安装实例隔离的流程与单文件记录 |
| `log` | 简短公开状态，不记录原始异常和提示词 |

`organize.manual.run` 输入为 `fileRef/profileId/tmdbId/mediaType/idempotencyKey`，剧集同时传 `season/episode`。权限为 `organize.manual.run`，还要有读取目录和授权方案。文件范围、状态、方案修订、许可证、封存和幂等继续由 MT 检查。作品识别与参数结论由插件负责。

[返回首页](README.md)
