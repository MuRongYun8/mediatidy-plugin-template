"""Scan-limit failures must be actionable and must not start AI or organization."""
import unittest
from copy import deepcopy

from mt_plugin import SDKError
from plugin import Plugin
from test_workflow import Host, file


class DirectoryHost(Host):
    def __init__(self, counts):
        super().__init__()
        self.directories = {str(index): [file(f"{index}-{n}") for n in range(count)]
                            for index, count in enumerate(counts)}

    def call(self, invocation, method, args):
        if method == "files.scan":
            self.calls.append((method, deepcopy(args)))
            return {"ref": args["path"], "status": "queued"}
        if method == "tasks.items":
            self.calls.append((method, deepcopy(args)))
            return {"items": [{"file": item} for item in self.directories[args["ref"]]], "nextOffset": 0}
        return super().call(invocation, method, args)


class ScanLimitTests(unittest.TestCase):
    def start(self, host):
        plugin = Plugin()
        plugin.recognize({"profileId": 7, "review": True}, host.context(
            files=[file(ref, directory=True) for ref in host.directories]))
        event = {"parentRunId": "run-start", "tasks": [
            {"ref": ref, "status": "done"} for ref in host.directories]}
        return plugin, host.context(run="scan-complete", event=event)

    def test_reported_four_directories_106_files_fail_before_ai_and_keep_consistent_storage(self):
        host = DirectoryHost([12, 46, 1, 47])
        plugin, ctx = self.start(host)
        with self.assertRaises(SDKError) as caught:
            plugin.scan_complete({"flowKey": "ai/flow/flow"}, ctx)
        self.assertEqual(caught.exception.code, "FILE_LIMIT_EXCEEDED")
        self.assertIn("106", str(caught.exception))
        self.assertIn("分批选择", str(caught.exception))
        self.assertFalse(caught.exception.retryable)
        flow = host.values["ai/flow/flow"]
        self.assertEqual(flow["stage"], "scan_failed")
        self.assertEqual(flow["scanFileCount"], 106)
        self.assertEqual(len(flow["refs"]), 59)
        rows = {key: value for key, value in host.values.items() if key.startswith("ai/flow/flow/")}
        self.assertEqual(len(rows), len(flow["refs"]))
        self.assertTrue(all(row["status"] == "failed" and "106" in row["error"] for row in rows.values()))
        self.assertFalse(any(method == "ai.chat" for method, _ in host.calls))
        self.assertFalse(host.prepared or host.submissions)
        published = [args["value"] for method, args in host.calls if method == "runtime.result"][-1]
        self.assertEqual(len(published), 59)
        self.assertEqual(plugin.retry_state({"flowKey": "ai/flow/flow"}, ctx)["count"], 0)
        before = deepcopy(host.values)
        with self.assertRaises(SDKError):
            plugin.scan_complete({"flowKey": "ai/flow/flow"}, ctx)
        self.assertEqual(host.values, before)

    def test_exactly_100_videos_still_process_all_batches(self):
        host = DirectoryHost([47, 1, 40, 12])
        plugin, ctx = self.start(host)
        rows = plugin.scan_complete({"flowKey": "ai/flow/flow"}, ctx)
        self.assertEqual(len(rows), 100)
        self.assertTrue(all(row["status"] == "ready" for row in rows))
        self.assertEqual(len(host.prepared), 100)
        self.assertEqual(sum(method == "ai.chat" for method, _ in host.calls), 13)

    def test_duplicate_refs_within_and_across_pages_do_not_trigger_limit(self):
        host = DirectoryHost([60, 40])
        host.directories["1"] += [host.directories["0"][0], host.directories["1"][0]]
        plugin, ctx = self.start(host)
        self.assertEqual(len(plugin.scan_complete({"flowKey": "ai/flow/flow"}, ctx)), 100)

    def test_oversized_initial_page_does_not_write_orphan_file_rows(self):
        host = DirectoryHost([101])
        plugin, ctx = self.start(host)
        with self.assertRaises(SDKError) as caught:
            plugin.scan_complete({"flowKey": "ai/flow/flow"}, ctx)
        self.assertIn("101", str(caught.exception))
        self.assertEqual(host.values["ai/flow/flow"]["refs"], [])
        self.assertFalse(any(key.startswith("ai/flow/flow/") for key in host.values))
        self.assertFalse(any(method == "ai.chat" for method, _ in host.calls))

    def test_failed_scan_task_surfaces_actionable_error_before_reading_any_items(self):
        host = DirectoryHost([47, 12])
        plugin, ctx = self.start(host)
        ctx.event["tasks"][-1]["status"] = "failed"
        with self.assertRaises(SDKError) as caught:
            plugin.scan_complete({"flowKey": "ai/flow/flow"}, ctx)
        self.assertEqual(caught.exception.code, "SCAN_FAILED")
        self.assertIn("目录扫描未成功", str(caught.exception))
        self.assertEqual(host.values["ai/flow/flow"]["stage"], "scan_failed")
        self.assertFalse(any(method in ("tasks.items", "ai.chat") for method, _ in host.calls))

    def test_single_directory_host_limit_also_requests_split_selection(self):
        host = DirectoryHost([100])
        plugin, ctx = self.start(host)
        ctx.event["tasks"][0].update(status="failed", completed=100,
            error={"code": "QUOTA_EXCEEDED", "message": "扫描达到文件上限，已有结果已保留"})
        with self.assertRaises(SDKError) as caught:
            plugin.scan_complete({"flowKey": "ai/flow/flow"}, ctx)
        self.assertEqual(caught.exception.code, "FILE_LIMIT_EXCEEDED")
        self.assertIn("至少 101", str(caught.exception))
        self.assertIn("分批选择", str(caught.exception))
        self.assertFalse(any(method in ("tasks.items", "ai.chat") for method, _ in host.calls))
