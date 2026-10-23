"""Exercise the Python plugin against the public SDK with an in-memory host."""
from copy import deepcopy
from unittest.mock import patch
import json
from pathlib import Path
import unittest

from mt_plugin import Context, SDKError
from plugin import DEFAULT_PROMPT, Plugin, parse_identity


def file(ref, *, directory=False):
    return {"ref": ref, "rootId": "media", "path": ref, "name": ref + ".mkv", "isDir": directory}


def identity(ref):
    return {"fileRef": ref, "title": "Example", "mediaType": "movie", "tmdbId": 123, "reason": "Matched", "originalTitle":"Example", "year":2024, "sources":["https://www.themoviedb.org/movie/123"]}


def searched(response):
    if "nativeWebSearch" in response:
        return response
    try:
        items = json.loads(response.get("message", {}).get("content", ""))["items"]
    except (ValueError, KeyError, TypeError):
        items = []
    return {**response, "nativeWebSearch":{"performed":True,"sources":[{"title":"TMDB","url":url} for item in items if isinstance(item,dict) for url in item.get("sources", [])]}}


class Host:
    def __init__(self):
        self.values = {}
        self.calls = []
        self.submissions = []
        self.prepared = []
        self.waits = []
        self.scan_files = []
        self.replies = []
        self.chat_results = []
        self.submit_error = None
        self.file_errors = {}
        self.checkpoint_error = None
        self.seasons = {}
        self.details = {}

    def call(self, invocation, method, args):
        self.calls.append((method, deepcopy(args)))
        if method == "storage.set":
            self.values[args["key"]] = deepcopy(args["value"])
        elif method == "storage.get":
            return {"found": args["key"] in self.values, "value": deepcopy(self.values.get(args["key"]))}
        elif method == "storage.list":
            return {"items": [{"key": k, "value": deepcopy(v)} for k, v in self.values.items() if k.startswith(args["prefix"])]}
        elif method == "files.scan":
            return {"ref": "scan-task", "status": "queued"}
        elif method == "tasks.items":
            return {"items": [{"file": f} for f in self.scan_files], "nextOffset": 0}
        elif method == "tasks.wait":
            self.waits.append(deepcopy(args))
        elif method == "ai.capabilities":
            return {"webSearch": {"available": True}, "tmdb": {"available": True}}
        elif method == "ai.chat":
            if self.chat_results:
                response = self.chat_results.pop(0)
                if isinstance(response, Exception):
                    raise response
                return searched(response)
            if self.replies:
                return searched({"message": self.replies.pop(0)})
            return searched({"message": {"role": "assistant", "content": json.dumps({"items": [identity(ref) for ref in args["fileRefs"]]})}})
        elif method == "ai.web.search":
            return {"items": [{"title": "Example", "url": "https://example.invalid/result"}]}
        elif method == "tmdb.detail":
            result = self.details.get((args["mediaType"], args["id"]), {"id": args["id"], "title": "Example", "originalTitle":"Example", "year":"2024", "mediaType": args["mediaType"]})
            if isinstance(result, Exception):
                raise result
            return result
        elif method == "tmdb.season":
            result = self.seasons[(args["id"], args["season"])]
            if isinstance(result, Exception):
                raise result
            return result
        elif method == "organize.manual.run":
            # The durable ambiguity marker must exist before a write can occur.
            row = self.values["ai/flow/flow/" + args["fileRef"]]
            if row["status"] != "outcome_unknown":
                raise AssertionError("Submission was not persisted before calling the host")
            self.submissions.append(deepcopy(args))
            if args["fileRef"] in self.file_errors:
                raise self.file_errors[args["fileRef"]]
            if self.submit_error:
                raise self.submit_error
            return {"ref": "task-" + args["fileRef"], "status": "queued"}
        elif method == "organize.manual.prepare":
            self.prepared.append(deepcopy(args))
            if args["fileRef"] in self.file_errors:
                raise self.file_errors[args["fileRef"]]
            return {"id": "draft-" + args["fileRef"], "status": "ready"}
        elif method == "runtime.checkpoint" and self.checkpoint_error:
            raise self.checkpoint_error
        elif method not in {"runtime.checkpoint", "runtime.progress", "runtime.result", "log"}:
            raise AssertionError("Unexpected host call: " + method)
        return True

    def context(self, *, run="run-start", files=(), event=None, config=None):
        return Context({"runId": run, "flowId": "flow", "files": list(files), "event": event,
                        "config": config or {}, "instanceId": "instance"}, self, run)


class WorkflowTests(unittest.TestCase):
    def assert_single_chat(self, host, count=1):
        chats = [args for method, args in host.calls if method == "ai.chat"]
        self.assertEqual(len(chats), count)
        for chat in chats:
            self.assertIs(chat["singleRequest"], True)
            self.assertIs(chat["nativeWebSearch"], True)
            self.assertNotIn("tools", chat)
            self.assertLessEqual(len(chat["fileRefs"]), 8)
            self.assertEqual(len(chat["messages"]), 2)
        self.assertFalse(any(m in ("tmdb.search", "tmdb.season", "ai.web.search", "ai.capabilities") for m, _ in host.calls))
        return chats

    def test_two_files_one_request_minimal_input_and_results_before_organize(self):
        host = Host()
        files = [{**file("one"), "size":12345, "storageType":"private", "path":"root/show/season/one.mkv"}, file("two")]
        Plugin().recognize({"profileId":7,"instructions":"Two movies"}, host.context(files=files, config={"prompt":"My custom prompt"}))
        chat = self.assert_single_chat(host)[0]
        self.assertIn("My custom prompt", chat["messages"][0]["content"])
        payload = json.loads(chat["messages"][1]["content"])
        self.assertEqual(set(payload["files"][0]), {"fileRef","name","directory"})
        self.assertEqual(payload["instructions"], "Two movies")
        publish = next(i for i, (method, _) in enumerate(host.calls) if method == "runtime.result")
        submit = next(i for i, (method, _) in enumerate(host.calls) if method == "organize.manual.run")
        self.assertLess(publish, submit)
        self.assertEqual([r["status"] for r in host.calls[publish][1]["value"]], ["recognized", "recognized"])

    def test_batches_have_at_most_eight_files(self):
        host = Host()
        Plugin().recognize({"profileId":7}, host.context(files=[file(str(i)) for i in range(17)]))
        self.assertEqual([len(c["fileRefs"]) for c in self.assert_single_chat(host, 3)], [8,8,1])

    def test_custom_prompt_is_preserved_with_current_source_policy_appended(self):
        host = Host()
        custom = "保留我的译名偏好。旧要求：每个已识别作品必须有 TMDB 引用。"
        ctx = host.context(files=[file("one")], config={"prompt":custom})
        Plugin().recognize({"profileId":7}, ctx)
        prompt = self.assert_single_chat(host)[0]["messages"][0]["content"]
        self.assertTrue(prompt.startswith(custom + "\n"))
        self.assertIn("取代旧提示词中必须有 TMDB 引用才能识别的要求", prompt)
        self.assertEqual(ctx.config["prompt"], custom)

    def test_empty_invalid_or_tool_reply_never_retries(self):
        for response in [{"content":""}, {"content":"not JSON"}, {"content":None}, {"content":"[]"},
                         {"toolCalls":[{"name":"tmdb_search","arguments":"{}"}]}]:
            with self.subTest(response=response):
                host = Host(); host.replies = [response]
                rows = Plugin().recognize({"profileId":7}, host.context(files=[file("one")]))
                self.assert_single_chat(host)
                self.assertEqual(rows[0]["status"],"unrecognized")
                self.assertFalse(host.submissions)

    def test_timeout_never_retries(self):
        host = Host(); host.chat_results = [SDKError("Timed out", "AI_TIMEOUT", True)]
        with self.assertRaises(SDKError):
            Plugin().recognize({"profileId":7}, host.context(files=[file("one")]))
        self.assert_single_chat(host)
        self.assertFalse(host.submissions)

    def test_partial_unknown_missing_and_invalid_items_do_not_block_valid_result(self):
        for invalid in [{"tmdbId":None}, {"tmdbId":"123"}, {"tmdbId":True}, {"tmdbId":0}, {"year":False},
                        {"title":{}}, {"reason":{}}, {"mediaType":"tv","season":10000,"episode":1}]:
            with self.subTest(invalid=invalid):
                host = Host(); host.replies = [{"content":json.dumps({"items":[{**identity("one"),**invalid},identity("two")]})}]
                rows=Plugin().recognize({"profileId":7},host.context(files=[file("one"),file("two"),file("missing")]))
                self.assertEqual([r["status"] for r in rows],["unrecognized","queued","unrecognized"])
                self.assertEqual([p["fileRef"] for p in host.submissions],["two"])
                self.assert_single_chat(host)

    def test_exact_id_and_season_pass_through_and_business_error_keeps_identity(self):
        for review in (False, True):
            host = Host()
            tv = {**identity("one"),"tmdbId":987654,"mediaType":"tv","season":5,"episode":1,"sources":["https://www.themoviedb.org/tv/987654"]}
            host.replies = [{"content":json.dumps({"items":[tv,identity("two")]})}]
            host.file_errors["one"]=SDKError("TMDB ID 不存在", "TMDB_NOT_FOUND")
            rows=Plugin().recognize({"profileId":7,"review":review},host.context(files=[file("one"),file("two")]))
            proposals=host.prepared if review else host.submissions
            self.assertEqual((proposals[0]["tmdbId"],proposals[0]["season"],proposals[0]["episode"]),(987654,5,1))
            self.assertEqual(rows[0]["detail"]["identity"],tv)
            self.assertEqual(rows[0]["recognitionStatus"],"recognized")
            self.assertEqual(rows[0]["status"],"organize_failed")
            self.assertIn("TMDB ID 不存在", rows[0]["error"])
            self.assertEqual(len(proposals),2)
            self.assert_single_chat(host)

    def test_same_flow_reentry_never_reidentifies_or_resubmits(self):
        host=Host(); plugin=Plugin(); ctx=host.context(files=[file("one")])
        first=plugin.recognize({"profileId":7},ctx)
        self.assertEqual(plugin.recognize({"profileId":7},ctx),first)
        self.assert_single_chat(host)
        self.assertEqual(len(host.submissions),1)

    def test_checkpoint_cancel_stops_before_chat(self):
        host=Host(); host.checkpoint_error=SDKError("Cancelled","CANCELLED")
        with self.assertRaises(SDKError):
            Plugin().recognize({"profileId":7},host.context(files=[file("one")]))
        self.assertFalse(host.submissions)
        self.assert_single_chat(host,0)

    def test_organization_timing_uses_task_completion_not_late_callback(self):
        host=Host(); plugin=Plugin()
        with patch("plugin.time.time", return_value=1000):
            plugin.recognize({"profileId":7},host.context(files=[file("one")]))
        event={"parentRunId":"run-start","tasks":[{"ref":"task-one","status":"done","updatedAt":"1970-01-01T00:16:42Z"}]}
        with patch("plugin.time.time", return_value=9999):
            rows=plugin.organize_complete({"flowKey":"ai/flow/flow"},host.context(event=event))
        self.assertEqual(rows[0]["detail"]["organizeDurationMs"],2000)
        self.assertEqual(rows[0]["recognitionStatus"],"recognized")

    def test_cancellation_at_submission_retains_identity_and_never_retries(self):
        host=Host();host.submit_error=SDKError("Cancelled","CANCELLED")
        with self.assertRaises(SDKError):
            Plugin().recognize({"profileId":7},host.context(files=[file("one"),file("two")]))
        self.assertEqual(len(host.submissions),1)
        self.assertEqual(host.values["ai/flow/flow/one"]["identity"]["tmdbId"],123)
        self.assert_single_chat(host)

    def test_ai_failure_publishes_file_errors_without_submitting(self):
        for review in (False, True):
            with self.subTest(review=review):
                host = Host()
                host.chat_results = [SDKError("AI 服务限流（HTTP 429）", "AI_RATE_LIMITED", True)]
                with self.assertRaises(SDKError) as caught:
                    Plugin().recognize({"profileId": 7, "review": review}, host.context(files=[file("one"), file("two")]))
                self.assertEqual(caught.exception.code, "AI_RATE_LIMITED")
                self.assertTrue(caught.exception.retryable)
                rows = [args["value"] for method, args in host.calls if method == "runtime.result"][-1]
                self.assertEqual([row["status"] for row in rows], ["failed", "failed"])
                self.assertTrue(all("HTTP 429" in row["error"] for row in rows))
                self.assertEqual(host.values["ai/flow/flow"]["stage"], "failed")
                self.assertFalse(host.submissions)
                self.assertFalse(host.prepared)

    def test_later_ai_failure_keeps_earlier_submissions_tracked(self):
        host = Host()
        files = [file(str(i)) for i in range(10)]
        host.chat_results = [{"message": {"content": json.dumps({"items": [identity(str(i)) for i in range(8)]})}},
                             SDKError("AI 服务不可用（HTTP 503）", "AI_SERVICE_UNAVAILABLE", True)]
        rows = Plugin().recognize({"profileId": 7}, host.context(files=files))
        self.assertEqual(len(host.submissions), 8)
        self.assertEqual(host.waits[-1]["refs"], ["task-" + str(i) for i in range(8)])
        self.assertEqual([row["status"] for row in rows], ["queued"] * 8 + ["failed"] * 2)
        event = {"parentRunId": "run-start", "tasks": [{"ref": ref, "status": "done"} for ref in host.waits[-1]["refs"]]}
        rows = Plugin().organize_complete({"flowKey": "ai/flow/flow"}, host.context(run="complete", event=event))
        self.assertEqual([row["status"] for row in rows], ["done"] * 8 + ["failed"] * 2)
        self.assertEqual(len(host.submissions), 8)


    def test_ai_cancellation_is_not_reported_as_provider_failure(self):
        host = Host()
        host.chat_results = [SDKError("Cancelled", "CANCELLED")]
        with self.assertRaises(SDKError) as caught:
            Plugin().recognize({"profileId": 7}, host.context(files=[file("one")]))
        self.assertEqual(caught.exception.code, "CANCELLED")
        self.assertFalse(host.submissions)
        self.assertFalse(any(method == "runtime.result" for method, _ in host.calls))

    def test_direct_selection_waits_for_final_results_and_preserves_history(self):
        host = Host()
        rows = Plugin().recognize({"profileId": 7}, host.context(files=[file("one"), file("two")]))
        self.assertEqual([row["status"] for row in rows], ["queued", "queued"])
        self.assertEqual(host.waits[-1]["refs"], ["task-one", "task-two"])
        self.assertEqual(host.submissions[0]["idempotencyKey"], "ai/flow/flow:one")
        event = {"parentRunId": "run-start", "tasks": [{"ref": "task-one", "status": "done"},
                 {"ref": "task-two", "status": "failed", "error": {"message": "Target unavailable"}}]}
        plugin = Plugin()
        ctx = host.context(run="run-complete", event=event)
        rows = plugin.organize_complete({"flowKey": "ai/flow/flow"}, ctx)
        self.assertEqual([row["status"] for row in rows], ["done", "organize_failed"])
        self.assertEqual(rows[1]["error"], "Target unavailable")
        self.assertEqual(len(plugin.history({}, ctx)["items"]), 3)
        self.assertEqual(plugin.detail({"key": "ai/flow/flow/one"}, ctx)["taskRef"], "task-one")

    def test_scan_continuation_retains_selected_files_and_deduplicates(self):
        host = Host()
        rows = Plugin().recognize({"profileId": 7}, host.context(files=[file("one"), file("directory", directory=True)]))
        self.assertEqual(rows[0]["status"], "pending")
        self.assertFalse(host.submissions)
        self.assertEqual(host.waits[0]["completion"]["action"], "scan-complete")
        host.scan_files = [file("one"), file("two")]
        event = {"parentRunId": "run-start", "tasks": [{"ref": "scan-task", "status": "done"}]}
        rows = Plugin().scan_complete({"flowKey": "ai/flow/flow"}, host.context(run="run-scan", event=event))
        self.assertEqual([row["fileRef"] for row in rows], ["one", "two"])
        self.assertEqual(len(host.submissions), 2)

    def test_failed_or_foreign_scan_event_never_submits(self):
        for parent, status in [("wrong-run", "done"), ("run-start", "failed")]:
            with self.subTest(parent=parent, status=status):
                host = Host()
                Plugin().recognize({"profileId": 7}, host.context(files=[file("directory", directory=True)]))
                event = {"parentRunId": parent, "tasks": [{"ref": "scan-task", "status": status}]}
                with self.assertRaises(ValueError):
                    Plugin().scan_complete({"flowKey": "ai/flow/flow"}, host.context(event=event))
                self.assertFalse(host.submissions)
                self.assertNotIn("ai.chat", [method for method, _ in host.calls])

    def test_review_prepares_drafts_without_submitting(self):
        host = Host()
        rows = Plugin().recognize({"profileId": 7, "review": True}, host.context(files=[file("one")]))
        self.assertEqual(rows[0]["status"], "ready")
        self.assertEqual(len(host.prepared), 1)
        self.assertFalse(host.submissions)
        self.assertFalse(host.waits)

    def test_unknown_submission_is_persisted_without_retry(self):
        host = Host()
        host.submit_error = SDKError("Commit result unknown", "OUTCOME_UNKNOWN")
        rows = Plugin().recognize({"profileId": 7}, host.context(files=[file("one")]))
        self.assertEqual(rows[0]["status"], "outcome_unknown")
        self.assertEqual(host.values["ai/flow/flow/one"]["status"], "outcome_unknown")
        self.assertEqual(len(host.submissions), 1)
        self.assertFalse(host.waits)

    def test_incomplete_identity_is_skipped(self):
        for invalid in [{"tmdbId": True}, {"mediaType": "tv", "season": 1}, {"multiEpisode": True}]:
            with self.subTest(invalid=invalid):
                host = Host()
                host.replies = [{"content": json.dumps({"items": [{**identity("one"), **invalid}]})}]
                rows = Plugin().recognize({"profileId": 7}, host.context(files=[file("one")]))
                self.assertEqual(rows[0]["status"], "unrecognized")
                self.assertFalse(host.submissions)


    def test_invalid_and_duplicate_file_references_are_rejected(self):
        items = [identity("one"), identity("one"), identity("foreign"), {"fileRef": []}, {"fileRef": {}}]
        self.assertEqual(parse_identity(json.dumps({"items": items}), {"one"}), {})
        self.assertEqual(parse_identity("invalid JSON", {"one"}), {})






    def test_prompt_default_and_config_validation(self):
        manifest = json.loads((Path(__file__).resolve().parents[1] / "plugin.json").read_text("utf-8"))
        self.assertEqual(next(field["default"] for field in manifest["config"] if field["key"] == "prompt"), DEFAULT_PROMPT)
        host = Host()
        plugin = Plugin()
        self.assertIsNone(plugin.validate_config({}, host.context()))
        self.assertIn("prompt", plugin.validate_config({"prompt": " "}, host.context())["fieldErrors"])
        self.assertFalse(host.calls)
        with self.assertRaises(ValueError):
            plugin.detail({"key": "another-plugin/key"}, host.context())


if __name__ == "__main__":
    unittest.main()
