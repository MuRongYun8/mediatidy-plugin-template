# 开发入门

[返回 Wiki](README.md)

## 从可运行模板开始

使用仓库的 Fork 或 Use this template（若仓库已开启模板功能），也可以直接复制代码到自己的 GitHub/Gitee 公开仓库。必须修改插件 ID，避免覆盖官方插件。

```sh
git clone https://github.com/MuRongYun8/mediatidy-plugin-template.git my-mt-plugin
cd my-mt-plugin
npm ci --ignore-scripts
npm run check
```

本地开发建议 Node 20 或更新。开发依赖只有锁定版本的 TypeScript。MT 安装插件时不运行 npm；这里的命令只用于你自己的开发目录。

| 路径 | 作用 |
| --- | --- |
| `plugin.json` | 标识、版本、能力、动作、配置与结果列 |
| `src/worker/index.ts` | 同步入口、AI 自主对话、受控工具分发、输出映射 |
| `dist/index.js` | MT 实际安装的预打包 JS，必须提交 |
| `sdk/` | 从 MT 主仓库生成的固定 SDK 类型与 mock |
| `tests/` | 无真实凭据的识别流程测试 |
| `docs/wiki/` | 用户与开发文档 |

## 第一次修改

在清单中将 `id` 改为如 `example.my-organizer`，修改 `name`、`author`、`description` 和自己的版本；保留 SDK 主版本 `"1"` 和入口 `dist/index.js`。修改 `src/worker/index.ts` 的提示词或策略，保留按 `fileRef` 配对，实际条目由 MT 再核验。

只修改 AI 模板的提示词，也可直接使用完整 `prompt` 配置（留空恢复默认），无需追加到宿主固定策略，无需另写 UI。新增长期选项放 `config`，每次运行不同的输入放动作 `fields`，示例见 [清单规范](manifest-ui.md)。

```ts
/// <reference path="../sdk/index.d.ts" />
module.exports.run = function(input: MTInput) {
  mt.log({level: 'info', message: '开始处理'});
  // 在此调用同步 mt SDK；不使用 async、Promise、Node 或 require。
  return [{message: '处理完成'}];
};
```

这个小入口只是说明运行约定。实际模板已包含完整 AI 识别整理流程，修改它即可，不需要再安装另一个业务示例。

## 开发与测试循环

```sh
npm run typecheck
npm run validate
npm run build
npm test
```

`check` 会依次执行以上命令；修改源码后先构建再测试，否则会测到旧 dist。mock 使用可信本地 Node vm，不是运行不可信代码的生产沙箱。

```js
const fs = require('node:fs');
const {runPlugin} = require('./sdk/mock.cjs');
const code = fs.readFileSync('dist/index.js', 'utf8');
// input、多轮 ai.chat 工具交互与最终 JSON 结构可直接参考 tests/workflow.test.cjs。
const {result, calls} = runPlugin(code, input, handlers);
```

测试至少覆盖错序、漏项、重复引用、虚构 TMDB ID、缺失季集、多集合集、单批失败。不要在测试中使用真实密钥、云盘或 ff 服务。

## 安装自己的版本

提交清单、src、dist、sdk、测试、锁文件和文档到自己的公开仓库，在 MT“从仓库安装”填你的仓库地址及分支。检查权限，授权目录和方案，启用后运行测试媒体。按运行日志定位哪个能力失败；不要将凭据或全局日志写入插件。

发布前创建不可随意移动的版本标签，参见 [发布指南](release-troubleshooting.md)。SDK 快照只从 MT 主仓库更新，禁止两边手工维护定义。

## 页面开发

1. 修改 `src/ui/page.ts`，使用 ui-sdk 的 definePage/node；类型检查会提示组件属性。
2. 替换 `ui/icon.png`，使用 16–2048 像素 PNG，最大 2 MiB。
3. `npm run build` → `npm run typecheck` → `npm run validate` → `npm test`。
4. `npm run preview -- <MT源码目录>`，在真实 MT 渲染器中检查桌面、手机和深浅主题。
5. 提交 dist、ui、源码与文档，打新标签，通过仓库地址安装。SDK/UI SDK 快照只从 MT 同步，不在模板维护另一套类型。

[完整组件协议](component-protocol.md) 按 AI 页面各段解释布局、数据和事件。
