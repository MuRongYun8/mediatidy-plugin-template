# 组件页面协议

使用 [官方组件协议](https://murongyun8.github.io/MediaTidy-Wiki/plugins/ui) 和本仓库 `sdk/ui-schema/`。源码只构建 JSON；宿主在后端和前端双重校验组件、属性、绑定与事件，然后用 MT 当前组件库渲染。

本例使用 Grid、Card、Stack、Text、Alert、Badge、FilePicker、ProfilePicker、Textarea、Progress、Table、Details、Button、RunLog、TaskList、RunHistory 与宿主设置入口。

绑定只能读取允许命名空间的自身属性。条件是有限谓词，不是 JavaScript。表格单元格只能组合白名单组件。模型结果、文件名和错误只能作为文本，不能变成新页面、权限、方法名或代码。

允许调整受控布局、间距、语义颜色和响应式列数；没有任意 HTML、CSS、属性透传、远程资源、iframe 或浏览器脚本。

[返回首页](README.md)
