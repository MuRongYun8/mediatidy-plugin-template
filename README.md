# MediaTidy AI 识别整理 · Python 版

独立安装的 AI 整理插件，使用 Python SDK v2。入口为 `plugin.py:Plugin`，页面由 Python 动态生成，支持扫描、AI 识别、直接整理或草稿审阅、等待任务、逐文件结果及历史。

需要支持 Python 插件的 MediaTidy，宿主运行环境为 Python 3.12 和 uv 0.6.7。旧 JavaScript 插件宿主不能运行此版本。插件自身没有第三方 Python 运行依赖，普通使用和打包都不需要 Node.js。

## 安装

在 MT 插件中心选择“从仓库安装”，填写本仓库地址 `https://github.com/MuRongYun8/mediatidy-plugin-template`，分支填写 `main`。仓库根目录已包含安装需要的 Python 入口、依赖锁、清单、提示词和图标。

也可上传由 `python -m mt_plugin pack` 生成的 ZIP。安装后授权文件目录、整理方案和所需 AI 能力，再配置并启用。首次安装默认停用；AI 与 TMDB 配置沿用宿主。

当前版本为 `2.0.2`。先更新 MT 主程序，再从仓库更新插件。需要同时更新支持 `ai.chat(singleRequest, nativeWebSearch)` 的 MT 主程序；旧宿主会拒绝该参数，插件不会降级成可能重复请求的旧流程。之后可在插件中心从原仓库更新，无需手动安装 ZIP。

## 使用

工作区左侧选择片源，右侧选择整理方案、处理方式并填写可选的补充说明。直接整理会按所选方案执行文件操作；处理方式选择“整理前让我确认”时，只生成待确认结果；核对作品、季集和目标位置后，点击确认才执行文件整理。单次最多处理 100 个视频；手机上两个区域按顺序上下排列。

每批最多 8 个文件，在一次模型 HTTP 请求内执行原生网页搜索，再返回作品名、原文名、首映/首播年份、类型、TMDB ID、季集、简短说明和来源。服务商内部可以搜索多次，插件不追加模型对话。必须支持 Responses `web_search`，并在 MT 设置中启用 AI 联网；升级时确认新增 `ai.web.search` 和 `tmdb.read` 权限。未知、缺少有效 ID、季集不完整、重复引用或缺失的结果自动跳过，文件保留原位；同批其他有效文件继续整理。

AI 结论会先显示。只有本次服务商搜索响应确实包含对应类型和 ID 的 TMDB 来源才继续；插件通过现有 `tmdb.detail` 核对该 ID 的作品名和年份（同次运行去重）。标题/原文名经 Unicode、大小写、标点规范化后至少匹配一个，首映/首播年份必须一致；缺失、冲突或详情读取失败均跳过，保留原结论并显示差异。随后按 AI 提供的 ID 交给 MT 整理。MT 为命名和刮削获取该 ID 的元数据，保留方案、权限、路径和必要业务校验；不会根据片名搜索或更换 ID。ID 无效、元数据获取失败或条件不满足时显示整理失败，同时保留 AI 结论。排队不表示整理成功，任务完成后更新逐文件结果；提交结果未知时不自动重试。

每批只允许一次模型 HTTP 请求；原生搜索必须有已完成记录。超时、空回复、非法 JSON、参数不兼容或工具不支持均不自动重发；本批未知不触发补查，不降级为普通聊天或第三方搜索。请求统计分别记录模型响应、模型排队、整理准备与提交耗时；文件结果单列元数据核对耗时，并记录从整理提交至完成的耗时（含排队，确认模式仅记录草稿准备时间）。实际速度取决于模型、TMDB 和存储服务。

默认提示词随更新升级，仅替换仍使用旧默认值的配置；用户自定义提示词保留。输出协议始终要求原生搜索、单次回答及有效来源；不因旧自定义提示词恢复多轮工具对话。

开始运行后，页面集中展示进度与逐文件结果；作品、季集、TMDB ID、处理状态和识别说明直接显示，无需展开详情。AI 原始结论和可点击的 TMDB 搜索依据直接显示；核对失败不会产生可确认草稿。有 MT 核验记录时，同时展示核验后的作品与错误；点击“修正或确认整理”可编辑并确认。旧版历史记录兼容显示文件路径和原始摘要，未保存的作品字段会明确说明。日志和运行记录可通过宿主顶部入口查看。完整提示词从“高级设置”打开侧面板编辑并保存。页面布局在 `page.py`，识别与整理逻辑在 `plugin.py`。开发时的默认提示词只有一个来源：`prompts/default.txt`，通过同步脚本写入安装清单。

## 开发与验证

从同版本 MT 插件中心下载“开发 Skill 完整包”，其中 `mediatidy-plugin-development/references/sdk` 是 Python SDK 源码。用 Python 3.12 创建开发环境，然后安装该 SDK、固定版本的 uv 和 mypy：

```sh
python -m pip install /path/to/mediatidy-plugin-development/references/sdk uv==0.6.7 mypy
python scripts/sync-prompt.py --check
python -m unittest discover -s tests -v
python -m mt_plugin pack
```

修改默认提示词后运行 `python scripts/sync-prompt.py` 再打包。产物默认位于 `dist/official.ai-organize-2.0.2.zip`。测试使用内存宿主，不调用真实 AI、云盘或整理服务。

在 MT 源码目录下联调页面时，还可运行 `node --test tests/page.test.cjs`，通过宿主实际的 UI 表达式求值器检查新版及历史结果。独立检出时用 `MT_UI_SCHEMA` 指定宿主 `plugin-ui-schema/index.cjs` 的绝对路径，`PYTHON` 指定安装了 SDK 的 Python 解释器。此项联调检查需要 Node.js，不影响插件运行与打包。

目录与流程说明见 [插件开发说明](docs/README.md)。
