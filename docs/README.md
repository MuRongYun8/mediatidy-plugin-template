# 插件开发说明

- `plugin.py`：Python 入口，定义页面、动作和只读查询。
- `plugin.json`：能力、授权、配置及动作清单。
- `pyproject.toml`、`uv.lock`：Python 3.12 运行依赖及锁文件。
- `prompts/default.txt`：默认识别提示词；`scripts/sync-prompt.py` 同步清单默认值。
- `ui/icon.png`：插件图标。
- `tests/test_workflow.py`：模拟宿主的扫描、识别、提交、续接及失败分支测试。

入口 `recognize` 保存流程到实例 KV。目录扫描交给宿主任务，`scan-complete` 续接读取扫描结果；直接选择的文件也会保留，并按文件引用去重。

AI 可按宿主能力选择公开搜索或 TMDB 查询。响应只接受本次文件引用；重复引用、身份缺失、缺失季集及多集合集交给用户处理。宿主继续执行权限、来源及目标校验。

AI 工具包含 `tmdb_search`、`tmdb_detail` 和 `tmdb_season`。插件在提交剧集前用宿主 `tmdb.season` 返回的集号核对 AI 结论；按批缓存相同季查询。仅对明确的 `TMDB_SEASON_NOT_FOUND` 或缺集结果反馈给 AI，最多修正两次且总对话不超过六轮。网络、鉴权和旧宿主的通用错误不会被解释为编号错误。修正后的季集重新核验，未解决的文件不提交，不影响同批其他有效文件。取消在查询前后传播；提交后未知状态仍不自动重试。

直接整理调用 `organize.manual.run`，草稿模式调用 `organize.manual.prepare`。提交前先持久化待核对状态。任务入队后通过 `tasks.wait` 等待 `organize-complete`，最终状态与任务引用保留在逐文件记录中。内部续接验证父运行及任务集合，不能由页面直接调用。

`get_page` 返回 Python 组件页面。设置、授权、日志及任务入口由 MT 宿主提供。`history` 和 `detail` 查询读取当前实例 KV，不执行整理。

SDK 与能力参考应使用同版本 MT 下载的开发 Skill 完整包。安装、打包及测试命令见 [仓库首页](../README.md)。
