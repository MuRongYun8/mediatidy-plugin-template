"""Independent AI organize example. All identity and UI choices belong here."""
from __future__ import annotations
import json
from pathlib import Path
import time
from typing import Any

from mt_plugin import Context, Plugin as BasePlugin, SDKError, action, continuation, query, ui

DEFAULT_PROMPT = Path(__file__).with_name("prompts").joinpath("default.txt").read_text("utf-8").strip()
TOOLS = [
    {"name":"web_search","description":"搜索公开资料","parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"],"additionalProperties":False}},
    {"name":"tmdb_search","description":"查询作品与 TMDB ID","parameters":{"type":"object","properties":{"query":{"type":"string"},"mediaType":{"type":"string","enum":["movie","tv"]},"year":{"type":"integer"}},"required":["query","mediaType"],"additionalProperties":False}},
]


def read(ctx: Context, key: str) -> Any:
    result = ctx.mt.storage.get(key=key)
    if not result["found"]:
        raise ValueError("运行数据不存在，请重新选择文件")
    return result["value"]


def save(ctx: Context, key: str, value: Any) -> None:
    ctx.mt.storage.set(key=key, value=value)


def integer(value: Any, minimum: int = 1) -> bool:
    return type(value) is int and minimum <= value <= 2147483647


def parse_identity(content: str, refs: set[str]) -> dict[str, dict]:
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0]
    try:
        items = json.loads(content)["items"]
        if not isinstance(items, list):
            return {}
    except (ValueError, KeyError, TypeError):
        return {}
    result: dict[str, dict] = {}
    duplicate: set[str] = set()
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("fileRef"), str) or item["fileRef"] not in refs:
            continue
        ref = item["fileRef"]
        if ref in result or ref in duplicate:
            result.pop(ref, None)
            duplicate.add(ref)
        else:
            result[ref] = item
    return result


class Plugin(BasePlugin):
    def validate_config(self, config: dict, ctx: Context):
        prompt = config.get("prompt", DEFAULT_PROMPT)
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 16000:
            return {"fieldErrors":{"prompt":"提示词不能为空，最多 16000 字符"}}

    def get_page(self, ctx: Context):
        return ui.page(
            ui.Card(ui.Text(text="选择文件或目录。AI 识别后可直接提交，或先在宿主审阅草稿。"),
                    ui.FilePicker(), ui.ProfilePicker(label="整理方案", bind="input.profileId"),
                    ui.Textarea(label="补充说明", bind="input.instructions"),
                    ui.Checkbox(label="先审阅整理草稿", bind="input.review"),
                    ui.Button(label="开始扫描、识别与整理", disabled=ui.ref("plugin.busy"),
                              onClick=[{"type":"invoke","actionId":"recognize"}])),
            ui.Progress(label=ui.ref("run.progress.message"), value=ui.ref("run.progress.completed"), total=ui.ref("run.progress.total")),
            ui.Table(source=ui.ref("run.result"), rowKey="fileRef", searchable=True, pageSize=20, columns=[
                {"label":"文件","field":"name","cells":[ui.Text(text=ui.ref("row.name"))]},
                {"label":"识别结果","field":"title","cells":[ui.Text(text=ui.ref("row.title"))]},
                {"label":"状态与原因","field":"status","cells":[ui.Badge(text=ui.ref("row.status")),ui.Text(text=ui.ref("row.error"))]},
                {"label":"详情","cells":[ui.Details(ui.Text(text=ui.ref("row.detail"), format="json"),label="识别依据、任务和来源")]}]),
            ui.Button(label="审阅整理草稿", onClick=[{"type":"host","name":"reviewDrafts"}]),
            ui.Details(ui.Textarea(label="完整识别提示词",bind="config.prompt"),
                       ui.Button(label="保存提示词",onClick=[{"type":"host","name":"saveConfig"}]),label="编辑完整提示词"),
            ui.RunHistory(), ui.RunLog(), state={})

    @action("recognize")
    def recognize(self, input: dict, ctx: Context):
        key = "ai/flow/" + ctx.flow_id
        flow = {"key":key,"createdAt":time.time(),"profileId":input["profileId"],"instructions":input.get("instructions", ""),
                "review":bool(input.get("review")),"refs":[],"scanTasks":[],"taskRefs":[],"stage":"scan"}
        files = [file for file in ctx.files if not file["isDir"]]
        save(ctx, key, flow)
        for index, file in enumerate(ctx.files):
            if file["isDir"]:
                task = ctx.mt.files.scan(root_id=file["rootId"],path=file["path"],video_only=True,limit=100,
                                         idempotency_key=f"{ctx.run_id}:scan:{index}")
                flow["scanTasks"].append(task["ref"])
        self._append(ctx, flow, files)
        if flow["scanTasks"]:
            flow["scanParent"] = ctx.run_id
            save(ctx,key,flow)
            ctx.mt.log(level="info",message=f"扫描 {len(flow['scanTasks'])} 个目录任务，等待完成")
            rows=self._rows(ctx,flow)
            ctx.mt.tasks.wait(refs=flow["scanTasks"],completion={"action":"scan-complete","input":{"flowKey":key}})
            return rows
        return self._process(ctx,flow)

    def _append(self, ctx: Context, flow: dict, files: list[dict]):
        for file in files:
            if file["ref"] in flow["refs"]:
                continue
            if len(flow["refs"]) >= 100:
                raise ValueError("超过 100 个视频，请缩小范围；已有结果已保留")
            flow["refs"].append(file["ref"])
            save(ctx, flow["key"]+"/"+file["ref"], {"file":file,"status":"pending","title":"","error":"","taskRef":""})
        save(ctx,flow["key"],flow)

    def _event_flow(self, ctx: Context, input: dict, stage: str) -> dict:
        key = input["flowKey"]
        if not key.startswith("ai/flow/"):
            raise ValueError("无效流程引用")
        flow = read(ctx,key)
        expected = flow["scanTasks"] if stage == "scan" else flow["taskRefs"]
        parent = flow["scanParent"] if stage == "scan" else flow["organizeParent"]
        if not ctx.event or ctx.event["parentRunId"] != parent or {t["ref"] for t in ctx.event["tasks"]} != set(expected):
            raise ValueError("续接事件与原流程不匹配")
        return flow

    @continuation("scan-complete")
    def scan_complete(self, input: dict, ctx: Context):
        flow = self._event_flow(ctx,input,"scan")
        for task in ctx.event["tasks"]:
            if task["status"] != "done":
                raise ValueError("扫描未成功，请检查扫描任务；没有自动提交整理")
            offset = 0
            while True:
                page = ctx.mt.tasks.items(ref=task["ref"],offset=offset,limit=100)
                self._append(ctx,flow,[item["file"] for item in page["items"] if item.get("file")])
                next_offset = page.get("nextOffset",0)
                if next_offset <= offset:
                    break
                offset = next_offset
        return self._process(ctx,flow)

    def _identify(self, ctx: Context, flow: dict, files: list[dict]) -> dict[str, dict]:
        capabilities = ctx.mt.ai.capabilities()
        tools = [tool for tool in TOOLS if capabilities["webSearch" if tool["name"]=="web_search" else "tmdb"]["available"]]
        messages = [{"role":"system","content":ctx.config.get("prompt") or DEFAULT_PROMPT},
                    {"role":"user","content":json.dumps({"files":files,"instructions":flow["instructions"]},ensure_ascii=False)}]
        previous = ""
        for turn in range(6):
            ctx.mt.runtime.checkpoint()
            response = ctx.mt.ai.chat(messages=messages,tools=tools,file_refs=[file["ref"] for file in files])
            if response.get("toolsUnavailable"):
                tools=[]
                ctx.mt.log(level="warn",message="模型不支持工具，后续直接识别")
            message = response["message"]
            if not message.get("toolCalls"):
                return parse_identity(message.get("content", ""),{f["ref"] for f in files})
            signature = json.dumps([{k:call[k] for k in ("name","arguments")} for call in message["toolCalls"]],sort_keys=True)
            if signature == previous:
                ctx.mt.log(level="warn",message="模型重复查询，停止此批次")
                break
            previous = signature
            messages.append(message)
            for call in message["toolCalls"][:16]:
                try:
                    args = json.loads(call["arguments"])
                    if call["name"] == "web_search" and any(t["name"]==call["name"] for t in tools):
                        result = ctx.mt.ai.web.search(query=args["query"])
                    elif call["name"] == "tmdb_search" and any(t["name"]==call["name"] for t in tools):
                        result = ctx.mt.tmdb.search(query=args["query"],media_type=args["mediaType"],year=args.get("year",0))
                    else:
                        raise ValueError("工具不可用")
                except (SDKError, ValueError, KeyError, TypeError):
                    result = {"error":"查询不可用，请按已有信息判断，不编造身份"}
                messages.append({"role":"tool","toolCallId":call["id"],"content":json.dumps(result,ensure_ascii=False)})
        return {}

    def _process(self, ctx: Context, flow: dict):
        items = [read(ctx,flow["key"]+"/"+ref) for ref in flow["refs"]]
        for offset in range(0,len(items),8):
            batch=items[offset:offset+8]
            ctx.mt.runtime.progress(completed=offset,total=len(items),message="AI 识别")
            ctx.mt.log(level="info",message=f"识别第 {offset+1} 至 {min(offset+8,len(items))} 个文件")
            identities=self._identify(ctx,flow,[item["file"] for item in batch])
            for item in batch:
                identity=identities.get(item["file"]["ref"],{})
                item["identity"]=identity
                item["title"]=str(identity.get("title", ""))[:300]
                kind=identity.get("mediaType")
                if not item["title"] or kind not in ("movie","tv") or not integer(identity.get("tmdbId")) or identity.get("multiEpisode") or kind=="tv" and (not integer(identity.get("season"),0) or not integer(identity.get("episode"))):
                    item.update(status="needs_review",error="作品身份或季集不完整，请人工处理")
                else:
                    proposal={"fileRef":item["file"]["ref"],"profileId":flow["profileId"],"tmdbId":identity["tmdbId"],"mediaType":kind}
                    if kind=="tv":
                        proposal.update(season=identity["season"],episode=identity["episode"])
                    # Persist ambiguity before crossing the business submission boundary.
                    item.update(status="outcome_unknown",error="正在提交；若中断请先核对任务")
                    save(ctx,flow["key"]+"/"+item["file"]["ref"],item)
                    if flow["review"]:
                        draft=ctx.mt.organize.manual.prepare({**proposal,"reason":str(identity.get("reason","AI 识别"))[:500]})
                        item.update(status=draft["status"],error=draft.get("error",""),draftId=draft["id"])
                    else:
                        try:
                            task=ctx.mt.organize.manual.run({**proposal,"idempotencyKey":flow["key"]+":"+item["file"]["ref"]})
                            item.update(status=task["status"],taskRef=task["ref"],error="已入队，等待任务最终结果")
                            flow["taskRefs"].append(task["ref"])
                        except SDKError as error:
                            item["error"]=f"提交结果待核对，不自动重试：{error.code}"
                    ctx.mt.log(level="info",message=f"{item['file']['name']}：{item['status']}")
                save(ctx,flow["key"]+"/"+item["file"]["ref"],item)
            ctx.mt.runtime.result(value=self._views(items))
        flow["stage"]="waiting" if flow["taskRefs"] else "review" if flow["review"] else "done"
        flow["organizeParent"]=ctx.run_id
        save(ctx,flow["key"],flow)
        rows=self._views(items)
        if flow["taskRefs"]:
            ctx.mt.runtime.progress(completed=0,total=len(flow["taskRefs"]),message="等待 MT 整理任务最终结果")
            ctx.mt.tasks.wait(refs=flow["taskRefs"],completion={"action":"organize-complete","input":{"flowKey":flow["key"]}})
        return rows

    @continuation("organize-complete")
    def organize_complete(self, input: dict, ctx: Context):
        flow=self._event_flow(ctx,input,"organize")
        tasks={task["ref"]:task for task in ctx.event["tasks"]}
        for ref in flow["refs"]:
            key=flow["key"]+"/"+ref
            item=read(ctx,key)
            if item["taskRef"] in tasks:
                task=tasks[item["taskRef"]]
                item.update(status=task["status"],error=(task.get("error") or {}).get("message", ""))
                save(ctx,key,item)
        flow["stage"]="done"
        save(ctx,flow["key"],flow)
        ctx.mt.log(level="info",message="整理任务完成，逐文件状态已保存")
        return self._rows(ctx,flow)

    def _rows(self, ctx: Context, flow: dict) -> list[dict]:
        return self._views([read(ctx,flow["key"]+"/"+ref) for ref in flow["refs"]])

    def _views(self, items: list[dict]) -> list[dict]:
        rows=[]
        for item in items:
            ref=item["file"]["ref"]
            rows.append({"fileRef":ref,"name":item["file"]["name"],"title":item["title"],"status":item["status"],"error":item["error"],
                         "detail":{"identity":item.get("identity",{}),"taskRef":item["taskRef"],"path":item["file"]["path"]}})
        return rows

    @query("history")
    def history(self, input: dict, ctx: Context):
        return ctx.mt.storage.list(prefix="ai/flow/",limit=100,values=True)

    @query("detail")
    def detail(self, input: dict, ctx: Context):
        if not input["key"].startswith("ai/flow/"):
            raise ValueError("无效详情引用")
        return read(ctx,input["key"])
