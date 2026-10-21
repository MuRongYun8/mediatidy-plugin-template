# 开发入门

复制仓库后修改 `plugin.json` 的标识、名称和作者。源码使用同步 Goja SDK，入口是 `module.exports.run(input)`；不能使用 Promise、Node、fetch、系统命令或文件系统。

```sh
npm ci
npm run build
npm run test:unit
```

使用与 MT 同版本的 SDK 开发包：设置 `MT_PLUGIN_RUNTIME` 指向 `mt-plugin-runtime` 后执行 `npm run test:goja`。测试包含真实 Goja 重放和安装包校验。`npm run check` 包含构建、模拟测试和 Goja 验证。

设置 `MT_PLUGIN_SDK` 指向含 `preview/` 的开发包，执行 `npm run preview`。预览运行 MT 同一渲染器，使用模拟数据，不连接真实账号或执行整理；用浏览器设备模式验证手机断点。

`npm run pack` 打包。提交 `plugin.json/dist/index.js/ui/page.json/ui/icon.png`，宿主不安装依赖或执行构建。源码依赖由开发机安装，安装后的插件不下载运行代码。

SDK 类型与模拟器来自官方快照。更新执行 `node scripts/sync-sdk.cjs <官方开发包目录>`，检查 `sdk/snapshot.json`，然后重新构建测试。不手工维护第二套接口定义。

[返回首页](README.md)
