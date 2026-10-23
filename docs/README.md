# 插件开发说明

- `plugin.py`：Python 入口，定义页面、动作和只读查询。
- `plugin.json`：能力、授权、配置及动作清单。
- `pyproject.toml`、`uv.lock`：Python 3.12 运行依赖及锁文件。
- `prompts/default.txt`：默认识别提示词；`scripts/sync-prompt.py` 同步清单默认值。
- `ui/icon.png`：插件图标。
- `tests/test_workflow.py`：模拟宿主的扫描、识别、提交、续接及失败分支测试。

入口 `recognize` 保存流程到实例 KV。目录扫描交给宿主任务，`scan-complete` 续接读取扫描结果；直接选择的文件也会保留，并按文件引用去重。

AI 每批最多接收 8 个文件。请求只包含系统提示词、文件引用、文件名、最近三级目录线索及用户说明，通过 `ai.chat(single_request=True, native_web_search=True)` 发出一次原生搜索请求。要求服务商完成搜索并返回最终 JSON 和真实来源；不会单独调用 `ai.web.search`，没有多轮对话或修复。

解析校验格式、文件引用、重复项、字段类型、范围及搜索来源；完整身份必须具有正整数 TMDB ID、有效 movie/tv 类型、作品名、原文名和年份，剧集还需有效季集。每项 TMDB 来源必须出现在本次服务商的搜索来源或引用中。未知结果为 `unrecognized`，自动跳过；合法结果先保存为 `recognized` 并发布整批结果，然后按类型与 ID 去重调用现有 `tmdb.detail`，核对标题/原文名与首映首播年份。失败记为 `verification_failed`，原始结论保留，既不创建可确认草稿也不提交任务；通过后才逐文件整理。单项无效或整理失败不会阻断其他有效文件。原始身份保存在 `detail.identity`，整理失败不替换身份。

宿主负责保证单次请求禁用底层重发。插件不对请求失败或非法 JSON 进行补问；模型响应时间由宿主统计，逐文件 `metadataCheckMs` 记录元数据核对耗时，`organizeDurationMs` 记录整理提交至任务完成（含队列等待），确认模式仅记录草稿准备耗时。流程重入复用已有记录，任务提交使用稳定幂等键；未知提交结果保留 `outcome_unknown`，取消照常传播。

直接整理调用 `organize.manual.run`，草稿模式调用 `organize.manual.prepare`。提交前先持久化待核对状态。任务入队后通过 `tasks.wait` 等待 `organize-complete`，最终状态与任务引用保留在逐文件记录中。内部续接验证父运行及任务集合，不能由页面直接调用。

`get_page` 返回 Python 组件页面。设置、授权、日志及任务入口由 MT 宿主提供。`history` 和 `detail` 查询读取当前实例 KV，不执行整理。

SDK 与能力参考应使用同版本 MT 下载的开发 Skill 完整包。安装、打包及测试命令见 [仓库首页](../README.md)。
