# 清单、页面与 Logo

清单使用 `sdkVersion:"2"`，页面使用 `ui.version:"1"`。`ui.entry` 指向 `ui/page.json`，`ui.icon` 指向本插件的 `ui/icon.png`。Logo 属于插件包，参与安装完整性和回退。

业务动作包括：`recognize`（文件、方案、说明）、`retry-pending`（选中文件引用）、`scan-complete` 与 `organize-complete`（持久完成事件）。后两者只接受对应业务事件，不能从普通表单伪造。

`src/ui/page.ts` 使用类型化组件定义。`npm run build` 生成 JSON，MT 渲染卡片、文件和方案选择器、结果表格、详情、日志和任务列表。作者不需要 React，也不能插入 HTML、浏览器 JS、CSS、远程资源或表达式。

结果表绑定 `run.result`；行键是 `row.fileRef`，跨页选择绑定 `input.selectedFileRefs`。按钮只引用清单声明动作。宿主原有草稿 `Results/SelectionBar` 是可选的另一套流程，本插件不使用。

完整组件与属性见 [官方 UI 文档](https://murongyun8.github.io/MediaTidy-Wiki/plugins/ui)。本仓库 `sdk/ui-schema/index.d.ts` 与真实校验器配套。

[返回首页](README.md)
