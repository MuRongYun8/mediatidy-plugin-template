# AI 识别整理 · SDK v2

独立的 MediaTidy 插件及开发示例，版本 **2.0.0**。作品、TMDB 对应和季集由插件中的 AI 判断；MT 按这些参数调用现有手动整理。没有固定关键词提取、候选筛选、MT 复核或额外确认阶段。

**选择文件或目录 → AI 自主识别 → 逐文件调用手动整理 → 查看真实执行结果。**

页面在 `src/ui/page.ts`，Logo 在 `ui/icon.png`，默认提示词在 `src/worker/ai.ts`，业务入口在 `src/worker/index.ts`。安装只读取 `plugin.json`、`dist/index.js`、`ui/page.json` 和 Logo，不运行仓库构建脚本。MT 不内置、推荐或自动安装本插件。

## 使用

1. 准备支持 `organize.manual.run` 和 `runtime.result` 的 SDK v2 宿主，在 MT 配好 AI、TMDB 和整理方案。
2. 在插件中心输入仓库地址 `https://github.com/MuRongYun8/mediatidy-plugin-template.git`，分支／标签选择 `v2.0.0`，审阅能力。授予读取目录、整理方案、AI 和直接手动整理权限；联网与 TMDB 查询按需要授权。
3. 启用插件，选择文件与方案，点击 **AI 识别并整理**。该操作会直接执行授权方案的移动、复制、覆盖和清理行为。
4. 每个文件单独识别和入队。无法确定、缺少 TMDB ID 或集号的文件保留待处理；选择这些行可重试。
5. “停止后续识别”只停止插件后续动作，已入队整理到业务任务中单独取消。已入队不等于成功。

每批最多 8 个文件，每次最多 100 个视频。AI 资料足够时每批一次对话，100 个文件是 13 批；AI 自主查询后可能继续对话。未提供季数默认第一季，明确的第 0 季保留，缺失集号不猜测。实际整理会读取命名和元数据所需的 TMDB 资料，不再次识别作品。

## 开发

Node.js 22+。SDK 类型、方法表、模拟器和构建工具来自 MT 官方开发包快照，可独立构建，不需要完整 MT 源码。

```sh
npm ci
npm run build
npm run test:unit
```

真实 Goja 验证需要同版本开发包中的 `mt-plugin-runtime`，设置 `MT_PLUGIN_RUNTIME` 后运行 `npm run test:goja`。将 `MT_PLUGIN_SDK` 指向含 `preview/` 的官方开发包，运行 `npm run preview` 可用 MT 同一渲染器预览。`npm run pack` 生成可验证的安装包。

SDK 更新执行 `node scripts/sync-sdk.cjs <官方 plugin-sdk 目录>`，然后构建和测试。`sdk/snapshot.json` 校验快照来源；不要手改类型或模拟接口。当前 SDK 开发包未发布 npm。

## 文档

- [本插件 Wiki 首页](docs/wiki/README.md)：使用、识别、页面、开发和排错。
- [MT 官方 SDK Wiki](https://murongyun8.github.io/MediaTidy-Wiki/plugins/)：通用能力、授权、任务、存储与 UI 协议。
- [开发 Skill 完整下载](https://murongyun8.github.io/MediaTidy-Wiki/downloads/mediatidy-plugin-development-2.0.0.zip)。

2.0.0 使用 SDK v2，旧 SDK v1 代码不能继续运行。旧标签及旧记录保留，不迁移或扩大既有授权。版本标签固定发布内容，安装时优先使用 `v2.0.0`；仓库已包含可安装的 `dist/index.js`、页面和 Logo。
