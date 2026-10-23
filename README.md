# MediaTidy AI 识别整理 · Python 版

独立安装的 AI 整理插件，使用 Python SDK v2。入口为 `plugin.py:Plugin`，页面由 Python 动态生成，支持扫描、AI 识别、直接整理或草稿审阅、等待任务、逐文件结果及历史。

需要支持 Python 插件的 MediaTidy，宿主运行环境为 Python 3.12 和 uv 0.6.7。旧 JavaScript 插件宿主不能运行此版本。插件自身没有第三方 Python 运行依赖，普通使用和打包都不需要 Node.js。

## 安装

在 MT 插件中心选择“从仓库安装”，填写本仓库地址 `https://github.com/MuRongYun8/mediatidy-plugin-template`，分支填写 `main`。仓库根目录已包含安装需要的 Python 入口、依赖锁、清单、提示词和图标。

也可上传由 `python -m mt_plugin pack` 生成的 ZIP。安装后授权文件目录、整理方案和所需 AI 能力，再配置并启用。首次安装默认停用；AI 与 TMDB 配置沿用宿主。

此迁移保留插件 ID `official.ai-organize` 和版本号 `2.0.0`，MT 通过构建哈希区分新旧构建。确认清单入口为 `plugin.py:Plugin`、UI 模式为 `python`，即可区分 Python 版本与此前的 JavaScript 版本。

## 使用

工作区左侧选择片源，右侧选择整理方案、处理方式并填写可选的补充说明。直接整理会按所选方案执行文件操作；处理方式选择“整理前让我确认”时，只生成待确认结果；核对作品、季集和目标位置后，点击确认才执行文件整理。单次最多处理 100 个视频；手机上两个区域按顺序上下排列。

“已入队”表示等待宿主任务，最终完成或失败会更新逐文件状态。身份或季集不完整时交给用户处理；提交结果未知时先到 MT 任务中心核对，插件不会自动重试该提交。

AI 请求失败时，未识别文件也会保留结果行，显示失败原因并注明未提交整理；此前已提交的任务继续跟踪最终状态。新版 MT 主程序会区分认证失败、访问拒绝、限流、超时和服务故障，并对短暂故障最多重试一次。旧主程序可能只提供通用原因，需要同时更新主程序才能看到具体错误。模型不支持工具时，插件会重新发起不带工具的识别请求。

文件名中的季集可能采用发行版编号，与 TMDB 不同。插件会在 TMDB 能力可用时查询剧集目标季的集号；明确的编号冲突会交回 AI 查证并修正（最多两次），确认后才提交。AI 可调用作品搜索、详情、季集及公开搜索工具，不会把所有缺季文件直接改成特别篇。查询故障或仍无法确定的映射保留为待处理，并显示原因；第 0 季作为特别篇正常支持。这个编号约束也会附加到已保存的自定义提示词之后，无需手动重置提示词。

自动修正缺季编号需要宿主区分 `TMDB_SEASON_NOT_FOUND` 与查询故障。旧宿主返回通用错误时，插件保留待处理结果；请同时更新主程序。历史运行不会自动重跑或执行文件操作，可修正已有核验结果，或选择原文件重新识别。

开始运行后，页面集中展示进度与逐文件结果；作品、季集、TMDB ID、处理状态和识别说明直接显示，无需展开详情。有 MT 核验记录时，直接展示核验后的作品与错误；点击“修正或确认整理”可编辑并确认。旧版历史记录兼容显示文件路径和原始摘要，未保存的作品字段会明确说明。日志和运行记录可通过宿主顶部入口查看。完整提示词从“高级设置”打开侧面板编辑并保存。页面布局在 `page.py`，识别与整理逻辑在 `plugin.py`。开发时的默认提示词只有一个来源：`prompts/default.txt`，通过同步脚本写入安装清单。

## 开发与验证

从同版本 MT 插件中心下载“开发 Skill 完整包”，其中 `mediatidy-plugin-development/references/sdk` 是 Python SDK 源码。用 Python 3.12 创建开发环境，然后安装该 SDK、固定版本的 uv 和 mypy：

```sh
python -m pip install /path/to/mediatidy-plugin-development/references/sdk uv==0.6.7 mypy
python scripts/sync-prompt.py --check
python -m unittest discover -s tests -v
python -m mt_plugin pack
```

修改默认提示词后运行 `python scripts/sync-prompt.py` 再打包。产物默认位于 `dist/official.ai-organize-2.0.0.zip`。测试使用内存宿主，不调用真实 AI、云盘或整理服务。

在 MT 源码目录下联调页面时，还可运行 `node --test tests/page.test.cjs`，通过宿主实际的 UI 表达式求值器检查新版及历史结果。独立检出时用 `MT_UI_SCHEMA` 指定宿主 `plugin-ui-schema/index.cjs` 的绝对路径，`PYTHON` 指定安装了 SDK 的 Python 解释器。此项联调检查需要 Node.js，不影响插件运行与打包。

目录与流程说明见 [插件开发说明](docs/README.md)。
