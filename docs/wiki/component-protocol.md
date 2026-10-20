# 插件组件协议 v1

插件页面是数据，MT 使用现有 React 组件库渲染。插件仓库提供布局、文案、业务脚本和 Logo；浏览器不加载插件 React、JavaScript、HTML、样式表、远程模块或 iframe。SDK v1 与 UI 协议 v1 独立版本化。

## 文件和构建

```text
src/worker/index.ts       Goja 业务入口源码
src/ui/page.ts            类型化页面定义
dist/index.js             已打包业务脚本
ui/page.json              页面构建产物
ui/icon.png               插件自己的 Logo
sdk/                     MT SDK 固定版本快照
ui-sdk/                  @mediatidy/plugin-ui-schema 1.0.0 快照
```

清单增加可选字段：`"ui":{"version":"1","entry":"ui/page.json","icon":"ui/icon.png"}`。没有 `ui` 的旧插件继续使用字段声明界面。未知版本和路径在安装时拒绝。页面读取失败时展示错误并回退到兼容界面，不执行替代脚本。安装后的页面、Logo 和脚本一起参与内容哈希、原子安装、更新及回退。PNG/JPEG 输入限制 2 MiB、边长 16–2048 像素，安装时重新编码为 PNG；SVG、HTML 和动画资源不受支持。

主仓库 `plugin-ui-schema/` 是类型、构建器、注册表和前端校验器的唯一来源。`scripts/sync-plugin-template.cjs` 同步模板快照、后端注册表及内嵌模板；浏览器 ESM 由同一份校验器生成。后端独立执行结构和安全校验，共用恶意页面测试语料。

## 页面与组件

根结构为 `{version:"1",tabs:[{id,label,content:UINode[]}]}`，页签 ID 只允许 `overview / run / history / settings`，不重复。节点为 `{component,props?,children?,visibleWhen?,disabledWhen?}`。所有节点、属性和枚举以 [完整类型](../../ui-sdk/index.d.ts) 和 [注册表](../../ui-sdk/registry.json) 为准。未知属性会拒绝整个页面，不会向 React 透传。

| 组件 | 属性与职责 |
|---|---|
| Page / Card | title、description，children 为内容 |
| Stack | direction: row/column，gap: none/sm/md/lg |
| Grid | columns: 1–4，ratio: equal/wide-left，gap；手机自动单列或双列统计 |
| Text | text 或 bind；tone、size、lines；format 为 text/datetime/mediaType/defaultSeason；季集使用 row.seasonEpisode |
| Badge / Alert | text/bind、tone；Alert 可包含子节点 |
| Input / Textarea | label、bind、placeholder；Input 的 type 为 text/number |
| Select / Checkbox | label、bind；Select 的 options 为 label/value 数组 |
| FilePicker | MT 授权目录浏览、多选与移除；不读取文件正文 |
| ProfilePicker | label、bind；仅显示授权整理方案 |
| Steps | labels、bind（从 0 开始的步骤索引） |
| Metric | label、bind、tone、filter；点击切换结果筛选 |
| Progress | label、bind（完成数）、total（总数绑定）；未知总数不显示虚构百分比 |
| Results | title；结果上下文，内部组合 Table、Search、Pagination、SelectionBar、RunLog 与操作按钮 |
| Table | source: run.drafts/run.result；columns: `{label,cells:UINode[]}`；selectable 声明行选择 |
| Details | label、children；展开相对路径、依据和方案等文本 |
| Button | label、action、actionId、tab、variant；只能触发声明动作或固定事件 |
| Status / EmptyState | bind / title、description |
| Search / Pagination | 搜索与每页 20 项；草稿选择跨页保留 |
| SelectionBar | MT 固定选择数量、清除与整理预览确认入口 |
| RunHistory / ConfigForm / ScheduleForm / RunLog | MT 运行历史、配置授权、定时及白名单运行日志 |

表格单元格仅支持 Stack、Text、Badge、Status、Details、Button、Alert 的组合。`run.drafts` 必须位于 Results 中，MT 持有其选择、修正和确认状态。`run.result` 可在页面任意位置展示插件返回的 JSON 数组，搜索和分页由 MT 提供；普通结果不获得整理确认能力。草稿组件使用真实任务状态，`submitted/queued` 不视为成功。

颜色语义为 default/muted/primary/success/warning/danger；字体尺寸为 sm/md/lg/xl；文本行数为 1–3。禁止任意 CSS、className、style、URL、属性透传和 HTML。

## 数据绑定与事件

绑定使用点路径，不是表达式：`input.instructions`、`run.status`、`row.media.title`。只读命名空间：`plugin / run / stats / ui / row`；可编辑字段：`input.<已声明动作字段>` 和 `config.<已声明配置字段>`。配置保存仍由 ConfigForm 完成，编辑字段不会自动提交。模型不含授权根的宿主路径、登录令牌、全局配置、FF 事实或凭据。

- plugin：name、version、enabled。
- ui：showNew、hasRun、working、busy、canStart、step。
- stats：files、drafts、ready、review、submitted。
- run：当前本插件运行的白名单模型。
- row：本行；草稿额外提供 displayStatus、seasonEpisode、canEdit、canCancel。

有限谓词：`{path:"ui.hasRun",op:"truthy"}`；op 仅允许 eq/ne/truthy/falsy，value 仅允许标量。取值逐段检查自身属性，拒绝 `__proto__ / prototype / constructor`、数组下标、调用、运算、模板表达式和 window/document 路径。正文即使包含 `<script>` 也按文本显示，不参与生成节点。

固定事件：start（必填已声明 actionId）、newRun、refresh、cancelRun、retry、openTab（必填 tab）；Results 内还支持 clearSelection、confirmDrafts，单元格支持 editDraft、cancelTask。confirmDrafts 只打开 MT 固定确认对话框，不能传入“已确认”、封存覆盖结果、任意参数或 API 路径。确认提交包含后端草稿 ID 和修订，后端重新检查文件、方案、授权与版本。

## 安全限制与 FF 边界

每页最多 500 节点、深度 12、256 KiB；子节点最多 100；表格最多 12 列、每列 20 个单元格节点。前后端均校验。后端还拒绝重复 JSON 键、路径穿越和异常清单。资源接口仅提供经过认证的页面 JSON 和重新编码的图标，图片以 Bearer 请求的 Blob 加载，令牌不放在图片 URL 中。

Goja 仍在受限独立进程运行，不能访问浏览器、Node、环境变量、文件系统、宿主 Go 对象和数据库。能力调用重新校验安装修订、许可证、启用状态、目录、方案及限额。此机制不是操作系统级完整沙箱。

FF 正文、原始 probe JSON、SHA1 查询/枚举/导出、节点设置、凭据和全局日志没有插件入口。HTTP 授权不能豁免 MT、FF 节点与云元数据禁止规则。错误和日志必须使用白名单模型；不可将内部错误直接拼到插件响应。

独立评分能力 `quality.evaluate({fileRef,profileId})` 只返回 `{total,eligible}`；`quality.compare({fileRef,otherRef,profileId})` 返回两项摘要和 `first/second/equivalent`。仅使用已有缓存及方案保存的规则；没有缓存时使用文件名信息，不新建 ffprobe 任务、不计算文件哈希。本地文件没有提供者 SHA1 时仅按文件名评分。插件不能提供权重、公式或字段查询；两种能力合计每天 UTC 200 个文件，按插件持久化累计。AI 示例默认不申请。

## 本地预览

在 MT/frontend 安装依赖后，在模板运行 `npm run preview -- <MT源码目录>`，访问终端显示的 localhost 地址。模板自动构建，修改 src/ui 时重新生成 JSON。页面复用 MT 实际插件详情、渲染器、修正组件和确认对话框；接口全部为模拟数据，不启动后端、不需要密钥、不执行整理。工具栏可切换主题、打开 390×844 手机窗口；浏览器若将窗口合并为标签，可使用设备视口模式。正式发行构建不启用预览中间件。

新增组件时先扩展 canonical 注册表、类型、前后端校验及原生渲染器，再更新快照与测试。不能按插件 ID 编写宿主专用页面。
