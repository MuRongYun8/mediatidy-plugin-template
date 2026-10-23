"""Exercise the Python plugin against the public SDK with an in-memory host."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from mt_plugin import Context, SDKError
from plugin import DEFAULT_PROMPT, Plugin, parse_identity


def file(ref, *, directory=False):
    return {"ref": ref, "rootId": "media", "path": ref, "name": ref + ".mkv", "isDir": directory}


def identity(ref):
    return {"fileRef": ref, "title": "Example", "mediaType": "movie", "tmdbId": 123, "reason": "Matched"}


class Host:
    def __init__(self):
        self.values = {}
        self.calls = []
        self.submissions = []
        self.prepared = []
        self.waits = []
        self.scan_files = []
        self.replies = []
        self.submit_error = None
        self.seasons = {}

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
            if self.replies:
                return {"message": self.replies.pop(0)}
            return {"message": {"role": "assistant", "content": json.dumps({"items": [identity(ref) for ref in args["fileRefs"]]})}}
        elif method == "ai.web.search":
            return {"items": [{"title": "Example", "url": "https://example.invalid/result"}]}
        elif method == "tmdb.detail":
            return {"id": args["id"], "title": "Example", "mediaType": args["mediaType"]}
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
            if self.submit_error:
                raise self.submit_error
            return {"ref": "task-" + args["fileRef"], "status": "queued"}
        elif method == "organize.manual.prepare":
            self.prepared.append(deepcopy(args))
            return {"id": "draft-" + args["fileRef"], "status": "ready"}
        elif method not in {"runtime.checkpoint", "runtime.progress", "runtime.result", "log"}:
            raise AssertionError("Unexpected host call: " + method)
        return True

    def context(self, *, run="run-start", files=(), event=None, config=None):
        return Context({"runId": run, "flowId": "flow", "files": list(files), "event": event,
                        "config": config or {}, "instanceId": "instance"}, self, run)


class WorkflowTests(unittest.TestCase):
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
        self.assertEqual([row["status"] for row in rows], ["done", "failed"])
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

    def test_incomplete_identity_requires_review(self):
        for invalid in [{"tmdbId": True}, {"mediaType": "tv", "season": 1}, {"multiEpisode": True}]:
            with self.subTest(invalid=invalid):
                host = Host()
                host.replies = [{"content": json.dumps({"items": [{**identity("one"), **invalid}]})}]
                rows = Plugin().recognize({"profileId": 7}, host.context(files=[file("one")]))
                self.assertEqual(rows[0]["status"], "needs_review")
                self.assertFalse(host.submissions)

    def test_tool_result_reaches_ai_and_repeated_queries_stop(self):
        tool = {"role": "assistant", "toolCalls": [{"id": "lookup", "name": "web_search", "arguments": '{"query":"Example"}'}]}
        for repeated in [False, True]:
            with self.subTest(repeated=repeated):
                host = Host()
                host.replies = [deepcopy(tool), deepcopy(tool) if repeated else {"content": json.dumps({"items": [identity("one")]})}]
                rows = Plugin().recognize({"profileId": 7}, host.context(files=[file("one")]))
                chat = [args for method, args in host.calls if method == "ai.chat"]
                self.assertEqual(chat[1]["messages"][-1]["role"], "tool")
                self.assertEqual(len([method for method, _ in host.calls if method == "ai.web.search"]), 1)
                self.assertEqual(rows[0]["status"], "needs_review" if repeated else "queued")

    def test_invalid_and_duplicate_file_references_are_rejected(self):
        items = [identity("one"), identity("one"), identity("foreign"), {"fileRef": []}, {"fileRef": {}}]
        self.assertEqual(parse_identity(json.dumps({"items": items}), {"one"}), {})
        self.assertEqual(parse_identity("invalid JSON", {"one"}), {})

    def test_ai_corrects_release_season_to_verified_special_before_submission(self):
        for review in (False, True):
            with self.subTest(review=review):
                host = Host()
                original = {**identity("one"), "mediaType": "tv", "season": 5, "episode": 1}
                corrected = {**original, "season": 0, "reason": "发行版 S05E01 对应 TMDB 特别篇 S00E01，已核对公开资料"}
                host.seasons = {(123, 5): SDKError("TMDB 未收录第 5 季", "TMDB_SEASON_NOT_FOUND"), (123, 0): [1]}
                host.replies = [
                    {"role": "assistant", "content": json.dumps({"items": [original]})},
                    {"role": "assistant", "toolCalls": [
                        {"id": "detail", "name": "tmdb_detail", "arguments": '{"id":123,"mediaType":"tv"}'},
                        {"id": "specials", "name": "tmdb_season", "arguments": '{"id":123,"season":0}'},
                    ]},
                    {"role": "assistant", "content": json.dumps({"items": [corrected]})},
                ]
                rows = Plugin().recognize({"profileId": 7, "review": review}, host.context(files=[file("one")], config={"prompt": "Use my custom recognition instructions."}))
                proposal = (host.prepared if review else host.submissions)[0]
                self.assertEqual((proposal["season"], proposal["episode"]), (0, 1))
                self.assertEqual(rows[0]["detail"]["identity"]["reason"], corrected["reason"])
                chats = [args for method, args in host.calls if method == "ai.chat"]
                self.assertIn("Use my custom recognition instructions.", chats[0]["messages"][0]["content"])
                self.assertIn("不能仅照抄文件名", chats[0]["messages"][0]["content"])
                self.assertIn("TMDB_SEASON_NOT_FOUND", chats[1]["messages"][-1]["content"])
                self.assertEqual([args["season"] for method, args in host.calls if method == "tmdb.season"], [5, 0])
                if review:
                    self.assertFalse(host.submissions)

    def test_unknown_season_mapping_stops_after_bounded_repairs(self):
        host = Host()
        original = {**identity("one"), "mediaType": "tv", "season": 5, "episode": 1}
        host.seasons[(123, 5)] = SDKError("TMDB 未收录第 5 季", "TMDB_SEASON_NOT_FOUND")
        host.replies = [{"content": json.dumps({"items": [original]})} for _ in range(3)]
        rows = Plugin().recognize({"profileId": 7}, host.context(files=[file("one")]))
        self.assertEqual(rows[0]["status"], "needs_review")
        self.assertIn("第 5 季", rows[0]["error"])
        self.assertEqual(len([m for m, _ in host.calls if m == "ai.chat"]), 3)
        self.assertEqual(len([m for m, _ in host.calls if m == "tmdb.season"]), 1)
        self.assertFalse(host.submissions)
        self.assertFalse(host.prepared)

    def test_lookup_failure_does_not_guess_a_different_season_or_block_valid_files(self):
        for code in ("TMDB_LOOKUP_FAILED", "TMDB_AUTH_FAILED", "OPERATION_FAILED"):
            with self.subTest(code=code):
                host = Host()
                tv = {**identity("two"), "mediaType": "tv", "season": 1, "episode": 1}
                host.seasons[(123, 1)] = SDKError("查询失败，尚不能确认目标季是否存在", code, True)
                host.replies = [{"content": json.dumps({"items": [identity("one"), tv]})}]
                rows = Plugin().recognize({"profileId": 7}, host.context(files=[file("one"), file("two")]))
                self.assertEqual([row["status"] for row in rows], ["queued", "needs_review"])
                self.assertEqual([p["fileRef"] for p in host.submissions], ["one"])
                self.assertIn("尚不能确认", rows[1]["error"])
                self.assertEqual(len([m for m, _ in host.calls if m == "ai.chat"]), 1)

    def test_missing_episode_is_repaired_against_actual_episode_list(self):
        host = Host()
        original = {**identity("one"), "mediaType": "tv", "season": 1, "episode": 3}
        host.seasons[(123, 1)] = [1, 2]
        host.replies = [{"content": json.dumps({"items": [item]})} for item in (original, {**original, "episode": 2})]
        Plugin().recognize({"profileId": 7}, host.context(files=[file("one")]))
        self.assertEqual(host.submissions[0]["episode"], 2)
        self.assertEqual(len([m for m, _ in host.calls if m == "tmdb.season"]), 1)

    def test_season_lookup_cancellation_never_submits(self):
        host = Host()
        host.replies = [{"content": json.dumps({"items": [{**identity("one"), "mediaType": "tv", "season": 1, "episode": 1}]})}]
        host.seasons[(123, 1)] = SDKError("Cancelled", "CANCELLED")
        with self.assertRaises(SDKError) as caught:
            Plugin().recognize({"profileId": 7}, host.context(files=[file("one")]))
        self.assertEqual(caught.exception.code, "CANCELLED")
        self.assertFalse(host.submissions)
        self.assertFalse(host.prepared)

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
