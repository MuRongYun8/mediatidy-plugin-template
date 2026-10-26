from copy import deepcopy
import json
import unittest

from mt_plugin import SDKError
from plugin import Plugin
from test_workflow import Host, file, identity


class RetryTests(unittest.TestCase):
    def failed_flow(self, host, review=False):
        host.chat_results = [SDKError("文件引用无效", "AI_FILE_REFERENCE_INVALID")]
        with self.assertRaises(SDKError):
            Plugin().recognize({"profileId": 7, "instructions": "保留线索", "review": review},
                               host.context(files=[file("one"), file("two")]))
        return {"flowKey": "ai/flow/flow"}

    def test_manual_retry_preserves_inputs_history_and_cannot_replay(self):
        for review in (False, True):
            with self.subTest(review=review):
                host = Host()
                request = self.failed_flow(host, review)
                plugin = Plugin()
                original = deepcopy(host.values["ai/flow/flow/one"])
                self.assertEqual(plugin.retry_state(request, host.context())["count"], 2)
                ctx = host.context(run="retry-run", flow="retry")
                rows = plugin.retry_recognition(request, ctx)
                self.assertEqual(len(rows), 2)
                self.assertEqual(host.values["ai/flow/retry"]["profileId"], 7)
                self.assertEqual(host.values["ai/flow/retry"]["instructions"], "保留线索")
                self.assertEqual(host.values["ai/flow/retry"]["review"], review)
                self.assertEqual(host.values["ai/flow/flow/one"], original)
                self.assertEqual(plugin.retry_state(request, ctx)["count"], 0)
                self.assertEqual(len(host.prepared if review else host.submissions), 2)
                self.assertEqual(plugin.retry_recognition(request, ctx), rows)
                with self.assertRaises(SDKError) as error:
                    plugin.retry_recognition(request, host.context(run="stale", flow="stale"))
                self.assertEqual(error.exception.code, "NOTHING_TO_RETRY")
                self.assertEqual(len([1 for m, _ in host.calls if m == "ai.chat"]), 2)
                self.assertFalse(any(m == "files.scan" for m, _ in host.calls))

    def test_partial_success_retries_only_failed_files_and_waits_for_new_tasks(self):
        host = Host()
        host.chat_results = [{"message": {"content": json.dumps({"items": [identity(str(i)) for i in range(8)]})}},
                             SDKError("临时不可用", "AI_SERVICE_UNAVAILABLE", True)]
        plugin = Plugin()
        plugin.recognize({"profileId": 7}, host.context(files=[file(str(i)) for i in range(10)]))
        request = {"flowKey": "ai/flow/flow"}
        self.assertEqual(plugin.retry_state(request, host.context())["count"], 0)
        with self.assertRaises(SDKError):
            plugin.retry_recognition(request, host.context(flow="too-early"))
        event = {"parentRunId": "run-start", "tasks": [{"ref": ref, "status": "done"} for ref in host.waits[-1]["refs"]]}
        plugin.organize_complete(request, host.context(event=event))
        self.assertEqual(plugin.retry_state(request, host.context())["count"], 2)
        rows = plugin.retry_recognition(request, host.context(run="retry-run", flow="retry"))
        self.assertEqual([row["fileRef"] for row in rows], ["8", "9"])
        self.assertEqual([p["fileRef"] for p in host.submissions], [str(i) for i in range(10)])
        self.assertEqual(host.waits[-1]["refs"], ["task-8", "task-9"])
        event = {"parentRunId": "retry-run", "tasks": [{"ref": ref, "status": "done"} for ref in host.waits[-1]["refs"]]}
        rows = plugin.organize_complete({"flowKey": "ai/flow/retry"}, host.context(run="retry-complete", flow="retry", event=event))
        self.assertTrue(all(row["status"] == "done" for row in rows))

    def test_failed_manual_retry_can_be_retried_from_its_own_record(self):
        host = Host()
        request = self.failed_flow(host)
        host.chat_results = [SDKError("超时", "AI_TIMEOUT", True)]
        plugin = Plugin()
        with self.assertRaises(SDKError):
            plugin.retry_recognition(request, host.context(flow="retry"))
        request = {"flowKey": "ai/flow/retry"}
        self.assertEqual(plugin.retry_state(request, host.context())["count"], 2)
        plugin.retry_recognition(request, host.context(flow="retry-again"))
        self.assertEqual(len(host.submissions), 2)

    def test_only_unidentified_and_never_submitted_files_are_eligible(self):
        host = Host()
        request = self.failed_flow(host)
        base = host.values["ai/flow/flow/one"]
        scenarios = [({}, True), ({"status": "unrecognized"}, True), ({"taskRef": "task"}, False),
                     ({"draftId": "draft"}, False), ({"recognitionStatus": "recognized"}, False),
                     ({"identityVerified": True}, False)]
        scenarios += [({"status": status}, False) for status in
                      ("done", "ready", "organize_failed", "outcome_unknown", "verification_failed", "pending")]
        for changes, allowed in scenarios:
            with self.subTest(changes=changes):
                host.values["ai/flow/flow/one"] = {**base, **changes}
                self.assertEqual(Plugin().retry_state(request, host.context())["count"], 2 if allowed else 1)

    def test_cancel_changed_file_and_revoked_access_do_not_consume_retry(self):
        for scenario in ("cancel", "changed", "directory", "revoked"):
            with self.subTest(scenario=scenario):
                host = Host()
                request = self.failed_flow(host)
                if scenario == "cancel":
                    host.checkpoint_error = SDKError("取消", "CANCELLED")
                elif scenario == "changed":
                    host.values["ai/flow/flow/one"]["file"]["version"] = "original"
                    host.stat_results["one"] = {**file("one"), "version": "changed"}
                elif scenario == "directory":
                    host.stat_results["one"] = file("one", directory=True)
                else:
                    host.stat_results["one"] = SDKError("读取授权已撤销", "PERMISSION_DENIED")
                with self.assertRaises(SDKError):
                    Plugin().retry_recognition(request, host.context(flow="retry"))
                self.assertNotIn("retriedBy", host.values["ai/flow/flow"])
                self.assertFalse(host.submissions)
                self.assertEqual(len([1 for m, _ in host.calls if m == "ai.chat"]), 1)

    def test_missing_history_has_no_retry_and_bad_flow_key_is_rejected(self):
        host = Host()
        plugin = Plugin()
        for key in ("", "ai/flow/old"):
            self.assertEqual(plugin.retry_state({"flowKey": key}, host.context())["count"], 0)
        with self.assertRaises(SDKError):
            plugin.retry_recognition({"flowKey": "ai/flow/flow/one"}, host.context())
