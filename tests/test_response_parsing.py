"""Final-response compatibility and diagnostics; all model calls are simulated."""
import json
import unittest

from mt_plugin import SDKError
from plugin import Plugin, parse_identity_result
from test_workflow import Host, file, identity


class ResponseParsingTests(unittest.TestCase):
    def test_complete_json_with_prose_fences_or_array_retains_exact_identity(self):
        item = identity("one")
        document = json.dumps({"items": [item]}, ensure_ascii=False, indent=2)
        for content in [document, "\ufeff" + document, json.dumps([item]),
                        "```json\n" + document + "\n```",
                        "已核对片源，结果如下：\n```JSON\r\n" + document + "\r\n```\n来源：citeexample",
                        "识别结果：\n" + document + "\n已使用网页搜索。"]:
            with self.subTest(content=content[:30]):
                actual, errors, summary = parse_identity_result(content, {"one"})
                self.assertEqual(actual, {"one": item})
                self.assertEqual(errors, {})
                self.assertIn("匹配 1/1", summary)

    def test_ambiguous_truncated_or_wrong_shape_response_is_never_salvaged(self):
        document = json.dumps({"items": [identity("one")]}, indent=2)
        for content in [document + "\n" + document, document + document,
                        "```json\n" + document[:-1] + "\n```", document[:-2],
                        "not JSON", "", None, '{"items": {}}', '{"results": []}']:
            with self.subTest(content=str(content)[:30]):
                actual, errors, summary = parse_identity_result(content, {"one"})
                self.assertEqual(actual, {})
                self.assertIn("one", errors)
                self.assertIn("AI", summary)

    def test_duplicate_foreign_and_missing_references_cannot_match_by_position(self):
        content = json.dumps({"items": [identity("good"), identity("duplicate"), identity("duplicate"),
                                       identity("foreign"), {"fileRef": []}, None]})
        actual, errors, summary = parse_identity_result(content, {"good", "duplicate", "missing"})
        self.assertEqual(actual, {"good": identity("good")})
        self.assertIn("重复引用", errors["duplicate"])
        self.assertIn("缺少", errors["missing"])
        self.assertIn("无效或未知引用 3 项", summary)

    def test_unknown_identity_and_invalid_response_have_distinct_statuses(self):
        host = Host()
        host.replies = [{"content": json.dumps({"items": [{**identity("unknown"), "tmdbId": None}, identity("good")]})}]
        rows = Plugin().recognize({"profileId": 7}, host.context(files=[file("unknown"), file("missing"), file("good")]))
        self.assertEqual([r["status"] for r in rows], ["unrecognized", "failed", "queued"])
        self.assertEqual(rows[1]["recognitionStatus"], "invalid_response")
        self.assertIn("引用不匹配", rows[1]["error"])
        self.assertEqual([a["fileRef"] for a in host.submissions], ["good"])
        self.assertEqual(sum(m == "ai.chat" for m, _ in host.calls), 1)

    def test_invalid_batch_does_not_prevent_later_batch_or_retry_automatically(self):
        host = Host()
        host.replies = [{"content": "invalid JSON"}]
        rows = Plugin().recognize({"profileId": 7}, host.context(files=[file(str(i)) for i in range(9)]))
        self.assertEqual([r["status"] for r in rows], ["failed"] * 8 + ["queued"])
        self.assertEqual([a["fileRef"] for a in host.submissions], ["8"])
        self.assertEqual(sum(m == "ai.chat" for m, _ in host.calls), 2)
        self.assertEqual(host.values["ai/flow/flow"]["responseCount"], 2)

    def test_final_text_saved_before_failure_and_available_for_manual_retry(self):
        host = Host()
        raw = "模型给出了说明，却没有输出识别 JSON。"
        host.chat_results = [{"message": {"content": raw}, "reasoning": "PRIVATE REASONING"}]
        plugin = Plugin()
        ctx = host.context(files=[file("one")])
        with self.assertRaises(SDKError) as caught:
            plugin.recognize({"profileId": 7}, ctx)
        self.assertEqual(caught.exception.code, "AI_RESULT_INVALID")
        answers = plugin.responses({"flowKey": "ai/flow/flow"}, ctx)["items"]
        self.assertEqual(answers[0]["responseText"], raw)
        self.assertIn("JSON", answers[0]["diagnosis"])
        self.assertNotIn("PRIVATE REASONING", json.dumps(host.values))
        self.assertFalse(any(raw in str(args) for method, args in host.calls if method == "log"))
        self.assertEqual(plugin.retry_state({"flowKey": "ai/flow/flow"}, ctx)["count"], 1)
        rows = plugin.retry_recognition({"flowKey": "ai/flow/flow"}, host.context(flow="retry", run="retry"))
        self.assertEqual(rows[0]["status"], "queued")
        self.assertEqual(plugin.responses({"flowKey": "ai/flow/flow"}, ctx)["items"], answers)

    def test_diagnostic_previews_fit_storage_limit_and_preserve_utf8(self):
        host = Host()
        plugin = Plugin()
        flow = {"key": "ai/flow/flow", "instructions": "x" * 16000}
        # Worst-case escaping and multi-byte text, 63 batches per 500 files.
        for index in range(63):
            raw = ("\"\t" * 4094) + "影片" * 5000
            host.replies = [{"content": raw}]
            plugin._identify(host.context(), flow, [file(str(index))])
        self.assertLess(len(json.dumps(flow, ensure_ascii=False).encode("utf-8")), 256 * 1024)
        for answer in (v for k, v in host.values.items() if "/responses/" in k):
            self.assertLessEqual(len(answer["responseText"].encode("utf-8")), 8192)
            self.assertNotIn("\ufffd", answer["responseText"])
            self.assertTrue(answer["truncated"])

    def test_old_or_missing_history_has_no_invented_answer(self):
        host = Host()
        plugin = Plugin()
        ctx = host.context()
        host.values["ai/flow/old"] = {"key": "ai/flow/old"}
        for params in [{}, {"flowKey": "ai/flow/missing"}, {"flowKey": "ai/flow/old"}]:
            self.assertEqual(plugin.responses(params, ctx)["items"], [])
        host.values["other/key"] = {"key": "other/key", "responses": ["not a flow"]}
        with self.assertRaises(SDKError):
            plugin.responses({"flowKey": "other/key"}, ctx)
