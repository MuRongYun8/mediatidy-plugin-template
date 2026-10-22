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
