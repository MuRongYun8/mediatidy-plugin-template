# MediaTidy AI 识别整理插件模板

**v1.2.0 · SDK v1**　[完整 Wiki](docs/wiki/README.md) · [用户指南](docs/wiki/user-guide.md) · [开发入门](docs/wiki/quick-start.md) · [SDK 参考](docs/wiki/sdk-reference.md)

新版 MT 插件中心提供“已安装／发现插件”，以及独立插件页面的“概览／运行／运行记录／设置”。插件作者在 src/ui/page.ts 定义页面并随包提供 Logo，MT 用现有组件库安全渲染，作者无需编写 React 页面。剧集未识别到季数时默认第 1 季，仍需 MT 核验、用户预览确认；明确季数和异常值不会被覆盖。

**识别全部由插件 AI 完成**：直接将原始文件名、相对路径和说明交给模型，AI 自行决定是否联网、如何查询 TMDB 以及最终作品和季集；不再固定提取字段、拼搜索词或二轮选候选。MT 不调用核心识别 Agent，只负责授权、条目核验和最终整理确认。未匹配 TMDB 仍保留 AI 结论。

可复制的独立 SDK v1 插件：选择多个媒体文件或目录 → AI 自主识别并按需查询 → MT 核验与人工修正 → 用户确认后调用 MT 手动整理。

不读取文件内容、远程 ff 数据、云盘凭据或模型密钥。发送给已配置模型的文件信息只有文件名、授权目录内相对路径及随机引用；还会发送用户说明。定时运行只产生待确认草稿，不自动整理。

## 安装

在已支持插件中心的 MT 中预先配置 AI、TMDB 和整理方案。插件中心输入仓库地址：

```
https://github.com/MuRongYun8/mediatidy-plugin-template
```

v1.2.0 需要同步更新支持 `ai.chat` 和 `ai.web.search` 的 MT 宿主；旧宿主会因未知能力拒绝安装。升级后插件停用，新增模型对话和联网权限需重新审阅，再手动启用。

建议指定标签 `v1.2.0`。检查固定提交与权限，授权媒体目录和整理方案，安装后启用。也可在发现页官方插件详情选择「安装 MT 内置版本」。两者标识相同；切换来源按 MT 提示先卸载再装。

每次最多 100 视频。混合电影/剧集逐文件生成草稿；错误、冲突、缺少季集不默认选择。搜索修正后 MT 再核验。多集合集请人工处理，不自动截取一集。提交前核对目标目录、移动/复制方式和封存覆盖选项。已排队不代表整理成功，提交超时先刷新核对。

## 复制开发

1. 复制仓库，修改 plugin.json 的 id/name/author/version，自己的插件务必使用新 ID。
2. 修改 src/worker/index.ts 的提示词或识别策略，也可在 MT 设置完整编辑 `prompt`（留空使用默认任务）。
3. 本地安装开发工具并验证：

   ```sh
   npm install --ignore-scripts
   npm run check
   ```

4. 提交源码、清单、sdk/、ui-sdk/、测试、锁文件、**dist/index.js** 和 **ui/**，创建版本标签，在 MT 用你自己的 GitHub/Gitee 公开仓库地址安装。

目录：src/ 是 TypeScript 源码；dist/ 是无需构建即可安装的同步 CommonJS JS；sdk/ 是从 MT 主仓库 plugin-sdk/ 生成并固定的 1.0.0 类型与 mock 快照；tests/ 使用模拟 SDK，无需真实凭据。MT 不执行本仓库构建命令，也不加载前端脚本。

SDK 全部为同步 JSON 调用，不使用 Promise/async、Node、文件系统或命令。只允许返回 JSON 对象/数组。工作进程不暴露 organize.submit；插件只 prepare，人工确认由 MT 执行。模型响应必须按 fileRef 匹配，不能按数组顺序。模型提供的 TMDB ID 不可信，必须由 MT 查询实际详情并核验。

开发命令：`npm run typecheck`、`npm run validate`、`npm run build`、`npm test`。SDK 升级只通过 MT 主仓库生成快照，勿手改两套类型；sdkVersion 主版本不兼容的 MT 会拒绝安装。

完整规范随分发附在 docs/：系统设计、开发指南、AI 安全规范。生产独立进程不等同于 OS 沙箱，不应放宽宿主发行加固。用户确认前、重启后和定时运行均不能自动重放整理。

## 自定义页面与 Logo

页面源码在 `src/ui/page.ts`，Logo 在 `ui/icon.png`；业务与提示词在 `src/worker/index.ts`。`npm run build` 同时生成脚本和 `ui/page.json`，发布时都要提交。新增 UI 能力版本为 **v1.1.0**，后端 SDK 仍为 v1；旧标签保持不变。需要支持 UI 组件协议 v1 的 MT。

`npm run preview -- <MT源码目录>` 使用 MT 真实组件和模拟数据预览主题、桌面与手机布局。请先在 MT/frontend 安装依赖。详细使用方式见 [组件协议参考](docs/wiki/component-protocol.md)。
