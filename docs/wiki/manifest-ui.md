# 清单与 UI

新插件优先使用 [组件页面协议 v1](component-protocol.md)。清单增加 `ui: {version:"1",entry:"ui/page.json",icon:"ui/icon.png"}`，布局源码在 [src/ui/page.ts](../../src/ui/page.ts)。以下 config/actions/columns 字段继续作为动作、参数和旧版兼容界面的契约；不能利用页面绕过它们的后端校验。

## 兼容字段声明

[返回 Wiki](README.md)

## 完整清单示例

以下清单使用本仓库现成的 AI 工作流，修改标识后可用于自定义插件。JSON 不支持注释。

```json
{
  "id": "example.ai-organize",
  "name": "我的 AI 识别整理",
  "version": "1.0.0",
  "sdkVersion": "1",
  "entry": "dist/index.js",
  "author": "example",
  "description": "识别文件名，核验后由用户确认整理。",
  "permissions": ["files.read", "ai.complete", "tmdb.read", "organize.prepare", "organize.submit", "tasks.read", "tasks.cancel"],
  "config": [
    {"key":"extractionPrompt","label":"第一轮补充策略","type":"textarea","default":""},
    {"key":"selectionPrompt","label":"候选选择补充策略","type":"textarea","default":""}
  ],
  "actions": [{"id":"recognize","label":"识别并生成草稿","fields":[
    {"key":"files","label":"文件或目录","type":"files","required":true},
    {"key":"profileId","label":"整理方案","type":"profile","required":true},
    {"key":"instructions","label":"识别补充说明","type":"textarea","default":""}
  ]}],
  "columns": [{"key":"file","label":"文件"},{"key":"status","label":"结果"}]
}
```

## 标识与限制

插件和动作 ID：小写字母开头，其后小写字母、数字、点或连字符，总长 3～80。字段 key：小写字母开头，其后大小写字母、数字、下划线，总长 2～64，允许 `profileId`。同一配置或动作中的字段不可重复。

名称 1～160 字节，版本 1～60 字节，简介最多 4000 字节，作者最多 200 字节。动作 1～10 个，每动作字段最多 30 个，配置最多 30 个，结果列最多 20 个。入口必须固定为 `dist/index.js`；SDK 目前只接受字符串 `"1"`。未知或重复能力被拒绝。

## 字段怎样变成 UI

| type | MT 控件 | 值 |
| --- | --- | --- |
| `text` | 单行文本 | string |
| `textarea` | 多行文本 | string |
| `number` | 数字输入 | number |
| `boolean` | 勾选项 | boolean |
| `profile` | 授权整理方案选择器 | number ID |
| `files` | 文件／目录选择器 | 不放字段值，单独放 selections |

每项使用 `key`、`label`、`type`，可带 `required`、`default`。默认值必须符合类型。字段值不超过 16 KiB；文本先按 UI 字符数限制，后端仍按序列化字节检查。必填由后端再次验证，profile 的实际授权和可用性在整理时另查。

`config` 是长期配置，保存后改变安装修订；`input.input` 是一次运行的动作字段。`files` 仅用在动作字段，不要放在长期配置中。选中文件放运行请求的 `selections`，脚本得到宿主扫描后的 `input.files`，不能从配置自行拼接宿主绝对路径。

## 动作、结果和固定预览

`input.action` 对应 action ID，脚本根据它执行流程。所有方法同步，不返回 Promise。`module.exports.run` 返回 JSON 对象或数组，普通表格期望对象数组，列的 key 映射每行属性，MT 以纯文本渲染，HTML 不会执行。例：

```ts
return [{file: 'Show.E01.mkv', status: '等待确认'}];
```

有整理草稿时显示 MT 固定预览，避免与普通结果表重复。草稿状态、修正和确认不是自定义列控制的。插件不能提供任意组件、网页脚本、替换确认弹窗或伪造“用户已确认”。

新增 UI 类型需要 MT 主程序支持，不能仅往清单里写未知 type。图标、分类与官方说明由 MT 静态目录维护；清单当前不支持随意加载远程图标或 HTML。旧清单无需加入新 UI 字段即可使用新版插件中心。
