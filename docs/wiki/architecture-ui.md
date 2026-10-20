# 插件页面的原理

插件作者在 `src/ui/page.ts` 设计组件布局、参数、结果列和操作。构建生成 `ui/page.json`，MT 校验后用当前 UI 库渲染；无需额外 React 页面、iframe 或浏览器插件脚本。Logo 和页面随插件版本安装、更新和回退。

管理、资源授权、草稿核验和最终确认由 MT 控制。没有 ui 声明的旧插件继续采用清单字段生成页面。

完整机制与安全边界见 [组件协议参考](component-protocol.md)。实际示例见 [页面源码](../../src/ui/page.ts) 与 [构建页面](../../ui/page.json)。
