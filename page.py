"""Recognition workspace, composed with the public Python UI SDK."""
from mt_plugin import ui


def host(name):
    return [{"type": "host", "name": name}]


def badges(path, fallback="状态待核对"):
    status = ui.ref(path) if isinstance(path, str) else path
    groups = [
        ("primary", {"pending": "等待识别", "recognized": "识别完成，待核对", "verifying": "核对 TMDB", "queued": "整理已排队", "running": "处理中", "waiting": "等待整理", "submitted": "已提交", "submitting": "提交中"}),
        ("success", {"done": "已完成", "ready": "待确认", "success": "已完成", "completed": "已完成"}),
        ("warning", {"needs_review": "需人工处理", "outcome_unknown": "结果待核对", "submission_unknown": "提交待核对", "interrupted": "已中断"}),
        ("danger", {"failed": "失败", "organize_failed": "整理失败", "verification_failed": "核对失败，已跳过"}),
        ("muted", {"cancelled": "已取消", "unrecognized": "未识别，已跳过"}),
    ]
    known: list[str] = []
    result = []
    for tone, states in groups:
        known.extend(states)
        label = status
        for value, text in states.items():
            label = ui.expr("if", ui.expr("eq", status, value), text, label)
        result.append(ui.Badge(text=label, tone=tone, visible=ui.expr("includes", list(states), status)))
    result.append(ui.Badge(text=fallback, tone="muted", visible=ui.expr("not", ui.expr("includes", known, status))))
    return result


def result_columns():
    # 1.x stored only file/status; JS 2.x stored identity fields on the row.
    # Read those historical formats without inventing missing recognition data.
    legacy = ui.expr("and", ui.ref("row.file"), ui.expr("not", ui.ref("row.name")))
    field = lambda name: ui.expr("coalesce", ui.ref("row.detail.identity." + name), ui.ref("row." + name))
    title = ui.expr("coalesce", ui.ref("row.title"), field("title"))
    year, kind = field("year"), field("mediaType")
    season, episode = field("season"), field("episode")
    reason = ui.expr("if", legacy, ui.ref("row.status"), field("reason"))
    path = ui.expr("coalesce", ui.ref("row.detail.path"), ui.ref("row.path"))
    task = ui.expr("coalesce", ui.ref("row.detail.taskRef"), ui.ref("row.taskRef"))
    sources = field("sources")
    return [
        {"label": "片源文件", "field": "name", "cells": [
            ui.Text(text=ui.expr("coalesce", ui.ref("row.name"), ui.ref("row.file"), "未保存文件名")),
        ]},
        {"label": "识别作品", "field": "title", "cells": [
            ui.Text(text=ui.expr("if", title, title, ui.expr("if", legacy, "旧版记录未保存作品字段", "未确定作品"))),
            ui.Text(text=ui.expr("concat",
                ui.expr("if", year, ui.expr("concat", year, " · "), ""),
                ui.expr("if", ui.expr("eq", kind, "movie"), "电影", ui.expr("if", ui.expr("eq", kind, "tv"), "剧集", "")),
                ui.expr("if", ui.expr("eq", kind, "tv"), ui.expr("concat", " · ",
                    ui.expr("coalesce", ui.ref("row.seasonEpisode"), ui.expr("concat", "S", ui.expr("coalesce", season, "?"), " E", ui.expr("coalesce", episode, "?")))), "")),
                tone="muted", size="sm", visible=ui.expr("not", legacy)),
            ui.Text(text=ui.expr("concat", "TMDB · ", field("tmdbId")), tone="muted", size="sm", visible=field("tmdbId")),
        ]},
        {"label": "处理状态", "field": "status", "cells": [
            ui.Badge(text="AI 识别完成", tone="success", visible=ui.expr("eq", ui.ref("row.recognitionStatus"), "recognized")),
            ui.Badge(text="TMDB 核对通过", tone="success", visible=ui.expr("eq", ui.ref("row.detail.identityVerified"), True)),
            ui.Text(text=ui.expr("concat", "元数据核对：", ui.ref("row.detail.metadataCheckMs"), " ms"), tone="muted", size="sm",
                    visible=ui.expr("gte", ui.expr("coalesce", ui.ref("row.detail.metadataCheckMs"), -1), 0)),
            *badges("row.status", ui.expr("if", legacy, "旧版摘要", "状态待核对")),
            ui.Text(text=ui.ref("row.error"), tone="muted", size="sm", visible=ui.ref("row.error")),
            ui.Text(text=ui.ref("row.warning"), tone="warning", size="sm", visible=ui.ref("row.warning")),
            ui.Text(text=ui.expr("concat", ui.expr("if", ui.expr("eq", ui.ref("row.detail.organizeTiming"), "prepare"), "整理准备耗时：", "整理耗时（含排队）："), ui.ref("row.detail.organizeDurationMs"), " ms"), tone="muted", size="sm",
                    visible=ui.expr("gte", ui.expr("coalesce", ui.ref("row.detail.organizeDurationMs"), -1), 0)),
        ]},
        {"label": "识别说明", "cells": [
            ui.Text(text=ui.expr("if", reason, reason, "未保存识别说明")),
            ui.Markdown(text=ui.ref("row.detail.sourceMarkdown"), visible=ui.ref("row.detail.sourceMarkdown")),
            ui.Details(
                ui.Text(text=ui.expr("concat", "文件路径：", path), size="sm", visible=path),
                ui.Text(text=ui.expr("concat", "任务引用：", task), size="sm", visible=task),
                ui.Text(text=sources, size="sm", visible=ui.expr("gt", ui.expr("length", sources), 0)),
                label="来源与任务信息",
                visible=ui.expr("or", path, task, ui.expr("gt", ui.expr("length", sources), 0)),
            ),
        ]},
    ]


def draft_columns():
    title = ui.expr("coalesce", ui.ref("row.media.title"), ui.ref("row.recognition.title"))
    status = ui.expr("if", ui.expr("eq", ui.ref("row.status"), "submitted"),
        ui.expr("coalesce", ui.ref("row.taskStatus"), ui.ref("row.status")), ui.ref("row.status"))
    return [
        {"label": "片源文件", "cells": [ui.Text(text=ui.ref("row.file.name"))]},
        {"label": "识别作品", "cells": [
            ui.Text(text=ui.expr("if", title, title, "未确定作品")),
            ui.Text(text=ui.expr("concat", "TMDB · ", ui.expr("if", ui.ref("row.tmdbId"), ui.ref("row.tmdbId"), "待匹配"),
                ui.expr("if", ui.expr("eq", ui.ref("row.mediaType"), "tv"),
                    ui.expr("concat", " · S", ui.expr("coalesce", ui.ref("row.season"), "?"), " E", ui.expr("coalesce", ui.ref("row.episode"), "?")), "")), tone="muted", size="sm"),
        ]},
        {"label": "核验与整理状态", "cells": [
            *badges(status),
            ui.Text(text=ui.ref("row.error"), tone="danger", size="sm", visible=ui.ref("row.error")),
        ]},
        {"label": "识别说明", "cells": [ui.Text(text=ui.expr("if", ui.ref("row.reason"), ui.ref("row.reason"), "未保存识别说明"))]},
    ]


def recognition_page():
    has_run = ui.ref("run.id")
    running = ui.expr("includes", ["queued", "running", "waiting", "submitting"], ui.ref("run.status"))
    has_rows = ui.expr("gt", ui.expr("length", ui.ref("run.result")), 0)
    has_drafts = ui.expr("gt", ui.expr("length", ui.ref("run.drafts")), 0)
    can_retry = ui.expr("and", ui.expr("not", running), ui.expr("gt", ui.ref("query.retry.data.count"), 0))
    flow_key = ui.expr("if", has_run,
        ui.expr("concat", "ai/flow/", ui.expr("coalesce", ui.ref("run.flowId"), ui.ref("run.id"))), "")
    has_responses = ui.expr("gt", ui.expr("length", ui.ref("query.responses.data.items")), 0)
    review = ui.ref("input.review")
    return ui.page(
        ui.Page(
            ui.Grid(
                ui.Card(
                    ui.FilePicker(),
                    title="选择片源",
                    description="勾选视频文件，或选择一个目录批量扫描。每次最多处理 100 个视频。",
                ),
                ui.Card(
                    ui.ProfilePicker(label="整理到哪里", bind="input.profileId"),
                    ui.Select(label="识别后如何处理", bind="input.review", options=[
                        {"label": "识别后直接整理", "value": False, "description": "AI 识别完成后，按所选方案自动处理文件。"},
                        {"label": "整理前让我确认", "value": True, "description": "先核对作品、季集和目标位置；确认后才执行整理。"},
                    ]),
                    ui.Text(text=ui.expr("if", review,
                        "本次先识别。你确认结果前，不会执行文件整理。",
                        "识别成功后按方案执行整理，包括方案中设置的移动、覆盖和清理操作。"), tone="muted", size="sm"),
                    ui.Details(ui.Textarea(label="补充说明", bind="input.instructions",
                        placeholder="例如：这是某剧的第二季，文件名中的数字是集数。"), label="给 AI 补充线索 · 可选"),
                    ui.Details(
                        ui.Text(text="提示词决定 AI 如何识别作品。默认提示词已可直接使用，按需调整即可。", tone="muted"),
                        ui.Button(label="编辑识别提示词", variant="outline", onClick=[{"type": "set", "path": "state.promptOpen", "value": True}]),
                        label="高级设置",
                    ),
                    ui.Divider(),
                    ui.Stack(
                        ui.Button(label=ui.expr("if", review, "开始识别，稍后确认", "开始识别并整理"),
                            disabled=ui.expr("or", ui.ref("plugin.busy"), ui.expr("not", ui.ref("input.profileId")), ui.expr("eq", ui.ref("stats.selections"), 0)),
                            onClick=[{"type": "invoke", "actionId": "recognize"}]),
                        ui.Text(text=ui.expr("if", ui.expr("eq", ui.ref("stats.selections"), 0),
                            "请先选择文件或目录", ui.expr("if", ui.ref("input.profileId"), "准备就绪，可以开始识别", "请选择整理方案")), tone="muted", size="sm"),
                        gap="sm",
                    ),
                    title="整理设置",
                    description="选择已授权的整理方案，告诉 AI 需要注意的线索。",
                ),
                columns=2, gap="lg", visible=ui.expr("not", has_run),
            ),
            ui.Card(
                ui.Stack(*badges("run.status"),
                    ui.Text(text=ui.ref("run.createdAt"), format="datetime", tone="muted", size="sm"),
                    direction="row", align="center", gap="sm"),
                ui.Progress(label=ui.expr("coalesce", ui.ref("run.progress.message"), "正在准备识别"),
                    value=ui.ref("run.progress.completed"), total=ui.ref("run.progress.total"), visible=running),
                ui.Alert(text=ui.ref("run.error"), tone="danger", visible=ui.ref("run.error")),
                ui.Text(text="重试沿用原方案与补充说明，识别成功后按原处理方式整理。已成功的结果保留在原运行记录。", tone="muted", size="sm", visible=can_retry),
                ui.Text(text=ui.ref("query.retry.data.message"), tone="muted", size="sm", visible=ui.ref("query.retry.data.message")),
                ui.Text(text="AI 原生搜索结论先显示，再核对该 TMDB ID 的作品与年份后整理。未识别的文件自动跳过并保留原位；整理失败不会重新识别。", tone="muted", size="sm"),
                ui.Stack(
                    ui.Button(label=ui.expr("concat", "重试识别（", ui.ref("query.retry.data.count"), " 个文件）"), visible=can_retry,
                        onClick=[{"type": "invoke", "actionId": "retry-recognition", "input": {"flowKey": ui.ref("query.retry.data.flowKey")}}]),
                    ui.Button(label="修正或确认整理", visible=has_drafts, onClick=host("reviewDrafts")),
                    ui.Button(label="刷新结果", variant="outline", onClick=host("refreshRun")),
                    ui.Button(label="查看日志", variant="ghost", onClick=host("openLogs")),
                    ui.Button(label="取消本次运行", variant="outline", visible=running, onClick=host("cancelRun")),
                    ui.Button(label="开始新一轮", variant="outline", visible=ui.expr("not", running), onClick=host("newRun")),
                    direction="row", gap="sm",
                ),
                title="本次识别", visible=has_run,
            ),
            ui.Card(
                ui.Section(
                    ui.Table(source=ui.ref("run.drafts"), rowKey="id", searchable=True, pageSize=20, columns=draft_columns()),
                    ui.Text(text="需要修正时，点击上方「修正或确认整理」。核验通过并由你确认后才会提交整理。", tone="muted", size="sm"),
                    title="MT 核验与整理", visible=has_drafts,
                ),
                ui.Table(source=ui.ref("run.result"), rowKey="fileRef", searchable=True, sortable=True, pageSize=20,
                    visible=has_rows, columns=result_columns()),
                ui.Details(
                    ui.Text(text="保留每批最终回答的前 8 KB，便于核对解析错误或文件引用；旧版记录无法补回未保存的回答。", tone="muted", size="sm"),
                    ui.Button(label="刷新回答", variant="outline", onClick=[{"type": "query", "queryId": "responses"}]),
                    ui.Text(text="正在读取回答", visible=ui.ref("query.responses.loading")),
                    ui.Alert(text=ui.ref("query.responses.error"), tone="danger", visible=ui.ref("query.responses.error")),
                    ui.Text(text="本次记录没有保存 AI 最终回答。", tone="muted",
                        visible=ui.expr("and", ui.expr("not", has_responses), ui.expr("not", ui.ref("query.responses.loading")), ui.expr("not", ui.ref("query.responses.error")))),
                    ui.Table(source=ui.ref("query.responses.data.items"), rowKey="batch", visible=has_responses, columns=[
                        {"label": "批次", "cells": [ui.Text(text=ui.ref("row.batch"))]},
                        {"label": "解析诊断", "cells": [ui.Text(text=ui.ref("row.diagnosis"))]},
                        {"label": "最终回答", "cells": [ui.Details(
                            ui.Text(text=ui.expr("if", ui.ref("row.responseText"), ui.ref("row.responseText"), "（空回答）")),
                            ui.Text(text="回答较长，仅保留前 8 KB。", tone="muted", size="sm", visible=ui.ref("row.truncated")),
                            label="展开原始回答") ]},
                    ]),
                    label="AI 原始回答与诊断",
                ),
                ui.EmptyState(
                    title=ui.expr("if", has_run, "还没有识别结果", "让每个文件，找到它的作品"),
                    description=ui.expr("if", running, "正在扫描或识别片源，结果会自动显示在这里。", ui.expr("if", has_run,
                        "本次运行尚未返回文件结果，可查看上方状态或运行日志。", "选择片源和整理方案后开始。作品、季集与处理结果将在这里集中展示。")),
                    visible=ui.expr("not", ui.expr("or", has_rows, has_drafts)),
                ),
                title="识别结果", description="作品、季集和识别说明直接展示。旧版历史记录保留原始摘要。", visible=has_run,
            ),
        ),
        ui.Drawer(
            ui.Text(text="保存后应用于之后的识别。当前任务的临时线索请填写在「补充说明」中。", tone="muted"),
            ui.Textarea(label="完整识别提示词", bind="config.prompt"),
            ui.Button(label="保存提示词", onClick=host("saveConfig")),
            bind="state.promptOpen", title="识别提示词",
        ),
        state={"promptOpen": False},
        queries=[{"id": "retry", "name": "retry-state", "input": {"flowKey": flow_key}},
                 {"id": "responses", "name": "responses", "input": {"flowKey": flow_key}}],
    )
