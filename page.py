"""Recognition workspace, composed with the public Python UI SDK."""
from mt_plugin import ui


def host(name):
    return [{"type": "host", "name": name}]


def badges(path):
    groups = [
        ("primary", {"pending": "等待识别", "queued": "已排队", "running": "处理中", "waiting": "等待整理", "submitted": "已提交", "submitting": "提交中"}),
        ("success", {"done": "已完成", "ready": "待确认", "success": "已完成", "completed": "已完成"}),
        ("warning", {"needs_review": "需人工处理", "outcome_unknown": "结果待核对", "submission_unknown": "提交待核对", "interrupted": "已中断"}),
        ("danger", {"failed": "失败"}),
        ("muted", {"cancelled": "已取消"}),
    ]
    known: list[str] = []
    result = []
    for tone, states in groups:
        known.extend(states)
        label = ui.ref(path)
        for value, text in states.items():
            label = ui.expr("if", ui.expr("eq", ui.ref(path), value), text, label)
        result.append(ui.Badge(text=label, tone=tone, visible=ui.expr("includes", list(states), ui.ref(path))))
    result.append(ui.Badge(text=ui.ref(path), visible=ui.expr("not", ui.expr("includes", known, ui.ref(path)))))
    return result


def recognition_page():
    has_run = ui.ref("run.id")
    running = ui.expr("includes", ["queued", "running", "waiting", "submitting"], ui.ref("run.status"))
    has_rows = ui.expr("gt", ui.expr("length", ui.ref("run.result")), 0)
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
                ui.Text(text="逐文件结果会持续更新。完成状态请以每个文件的整理结果为准。", tone="muted", size="sm"),
                ui.Stack(
                    ui.Button(label="检查结果并确认整理", visible=ui.expr("gt", ui.ref("stats.drafts"), 0), onClick=host("reviewDrafts")),
                    ui.Button(label="刷新结果", variant="outline", onClick=host("refreshRun")),
                    ui.Button(label="查看日志", variant="ghost", onClick=host("openLogs")),
                    ui.Button(label="取消本次运行", variant="outline", visible=running, onClick=host("cancelRun")),
                    ui.Button(label="开始新一轮", variant="outline", visible=ui.expr("not", running), onClick=host("newRun")),
                    direction="row", gap="sm",
                ),
                title="本次识别", visible=has_run,
            ),
            ui.Card(
                ui.Table(source=ui.ref("run.result"), rowKey="fileRef", searchable=True, sortable=True, pageSize=20, visible=has_rows, columns=[
                    {"label": "片源文件", "field": "name", "cells": [ui.Text(text=ui.ref("row.name"))]},
                    {"label": "识别作品", "field": "title", "cells": [
                        ui.Text(text=ui.expr("if", ui.ref("row.title"), ui.ref("row.title"), "未确定作品")),
                        ui.Text(text=ui.expr("concat",
                            ui.expr("if", ui.ref("row.detail.identity.year"), ui.expr("concat", ui.ref("row.detail.identity.year"), " · "), ""),
                            ui.expr("if", ui.expr("eq", ui.ref("row.detail.identity.mediaType"), "movie"), "电影", ui.expr("if", ui.expr("eq", ui.ref("row.detail.identity.mediaType"), "tv"), "剧集", "")),
                            ui.expr("if", ui.expr("eq", ui.ref("row.detail.identity.mediaType"), "tv"), ui.expr("concat", " · S", ui.ref("row.detail.identity.season"), " E", ui.ref("row.detail.identity.episode")), "")), tone="muted", size="sm"),
                    ]},
                    {"label": "处理状态", "field": "status", "cells": [*badges("row.status"), ui.Text(text=ui.ref("row.error"), tone="muted", size="sm")]},
                    {"label": "识别依据", "cells": [ui.Details(
                        ui.Text(text=ui.ref("row.detail.identity.reason")),
                        ui.Text(text=ui.ref("row.detail.path"), tone="muted", size="sm"),
                        ui.Details(ui.Text(text=ui.ref("row.detail"), format="json", size="sm", tone="muted"), label="完整识别信息"),
                        label="查看详情",
                    )]},
                ]),
                ui.EmptyState(
                    title=ui.expr("if", has_run, "还没有识别结果", "让每个文件，找到它的作品"),
                    description=ui.expr("if", running, "正在扫描或识别片源，结果会自动显示在这里。", ui.expr("if", has_run,
                        "本次运行尚未返回文件结果，可查看上方状态或运行日志。", "选择片源和整理方案后开始。作品、季集与处理结果将在这里集中展示。")),
                    visible=ui.expr("not", has_rows),
                ),
                title="识别结果", description="作品识别、处理状态和判断依据，一处查看。", visible=has_run,
            ),
        ),
        ui.Drawer(
            ui.Text(text="保存后应用于之后的识别。当前任务的临时线索请填写在「补充说明」中。", tone="muted"),
            ui.Textarea(label="完整识别提示词", bind="config.prompt"),
            ui.Button(label="保存提示词", onClick=host("saveConfig")),
            bind="state.promptOpen", title="识别提示词",
        ),
        state={"promptOpen": False},
    )
