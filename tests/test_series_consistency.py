"""Replay conflicting series mappings without contacting AI, TMDB or cloud files."""
import json
import unittest

from mt_plugin import SDKError
from plugin import Plugin, series_groups, series_key
from test_workflow import Host, file, identity
from test_scan_limits import DirectoryHost


def episode_file(number, *, root="media", parent="2019 假面骑士 Zero-One 零一", name=None):
    name = name or f"E0{number}.mkv"
    return {**file(f"{root}-{parent}-{name}"), "rootId": root, "name": name, "path": parent+"/"+name}


def tv_identity(source, *, tmdb=2661, season=30, episode=1):
    return {**identity(source["ref"]), "mediaType": "tv", "tmdbId": tmdb,
            "season": season, "episode": episode, "sources": []}


def replies(host, identities):
    host.replies = [{"content": json.dumps({"items": identities[i:i+8]})} for i in range(0, len(identities), 8)]


class SeriesConsistencyTests(unittest.TestCase):
    def test_reported_mapping_change_is_blocked_before_any_draft_or_submission(self):
        # Actual lexical scan order: E017 is file 9, the start of the SECOND batch.
        numbers = [1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 2, 20, 21, 22, 23]
        files = [episode_file(n) for n in numbers]
        identities = [tv_identity(f, tmdb=2661 if i < 8 else 155371, season=30 if i < 8 else 1, episode=numbers[i])
                      for i, f in enumerate(files)]
        for review in (True, False):
            with self.subTest(review=review):
                host = Host(); replies(host, identities)
                plugin = Plugin(); ctx = host.context(files=files, config={"prompt": "保持我的自定义提示词"})
                with self.assertRaises(SDKError) as caught:
                    plugin.recognize({"profileId": 7, "review": review}, ctx)
                self.assertEqual(caught.exception.code, "AI_SERIES_CONFLICT")
                self.assertFalse(host.prepared or host.submissions)
                rows = plugin.results({"flowKey": "ai/flow/flow"}, ctx)["items"]
                self.assertEqual([r["status"] for r in rows], ["identity_conflict"]*16)
                self.assertEqual([r["detail"]["identity"]["tmdbId"] for r in rows], [2661]*8 + [155371]*8)
                self.assertIn("S30", rows[0]["error"])
                self.assertIn("S1", rows[0]["error"])
                self.assertEqual(plugin.retry_state({"flowKey": "ai/flow/flow"}, ctx)["count"], 16)
                chats = [args for method, args in host.calls if method == "ai.chat"]
                self.assertEqual(len(chats), 2)
                first, second = [json.loads(c["messages"][1]["content"]) for c in chats]
                self.assertNotIn("seriesContext", first)
                context = second["seriesContext"][0]
                self.assertEqual(context["previousCandidates"][0]["tmdbId"], 2661)
                self.assertEqual(context["previousCandidates"][0]["season"], 30)
                self.assertNotIn("episode", context["previousCandidates"][0])
                self.assertEqual({f["seriesGroup"] for f in first["files"]+second["files"]}, {context["seriesGroup"]})
                self.assertIn("不是已确认事实", chats[1]["messages"][0]["content"])
                self.assertTrue(chats[1]["messages"][0]["content"].startswith("保持我的自定义提示词\n"))

    def test_same_batch_conflict_and_season_only_conflict_are_also_blocked(self):
        files = [episode_file(1), episode_file(2)]
        for ids in ([tv_identity(files[0]), tv_identity(files[1], tmdb=155371, season=1)],
                    [tv_identity(files[0]), tv_identity(files[1], season=1)]):
            host = Host(); replies(host, ids)
            with self.assertRaises(SDKError) as caught:
                Plugin().recognize({"profileId": 7}, host.context(files=files))
            self.assertEqual(caught.exception.code, "AI_SERIES_CONFLICT")
            self.assertFalse(host.prepared or host.submissions)

    def test_consistent_series_waits_for_all_batches_and_keeps_individual_episode_numbers(self):
        files = [episode_file(n) for n in range(1, 26)]
        class GuardedHost(Host):
            def call(self, invocation, method, args):
                if method in ("organize.manual.prepare", "organize.manual.run"):
                    assert sum(m == "ai.chat" for m, _ in self.calls) == 4
                return super().call(invocation, method, args)
        for review in (True, False):
            host = GuardedHost(); replies(host, [tv_identity(f, episode=i+1) for i, f in enumerate(files)])
            Plugin().recognize({"profileId": 7, "review": review}, host.context(files=files))
            proposals = host.prepared + host.submissions
            self.assertEqual(len(proposals), 25)
            self.assertEqual({(p["tmdbId"], p["season"]) for p in proposals}, {(2661, 30)})
            self.assertEqual([p["episode"] for p in proposals], list(range(1, 26)))
            self.assertEqual(sum(m == "tmdb.detail" for m, _ in host.calls), 1)

    def test_incomplete_group_is_retryable_as_a_whole_and_keeps_independent_files(self):
        files = [file("movie"), *[episode_file(n) for n in range(1, 10)]]
        host = Host()
        host.chat_results = [{"message": {"content": json.dumps({"items": [identity("movie"), *[tv_identity(f) for f in files[1:8]]]})}},
                             SDKError("synthetic timeout", "AI_TIMEOUT", True)]
        plugin = Plugin(); ctx = host.context(files=files)
        plugin.recognize({"profileId": 7}, ctx)
        self.assertEqual([p["fileRef"] for p in host.submissions], ["movie"])
        event = {"parentRunId": "run-start", "tasks": [{"ref": "task-movie", "status": "done"}]}
        plugin.organize_complete({"flowKey": "ai/flow/flow"}, host.context(run="complete", event=event))
        self.assertEqual(plugin.retry_state({"flowKey": "ai/flow/flow"}, ctx)["count"], 9)
        host.stat_results = {f["path"]: f for f in files[1:]}
        replies(host, [tv_identity(f, episode=i+1) for i, f in enumerate(files[1:])])
        plugin.retry_recognition({"flowKey": "ai/flow/flow"}, host.context(run="retry", flow="retry"))
        self.assertEqual(len(host.submissions), 10)
        self.assertEqual(len({p["fileRef"] for p in host.submissions}), 10)

    def test_grouping_isolates_roots_directories_prefixes_and_file_seasons(self):
        groups = [
            [episode_file(n) for n in (1, 2)],
            [episode_file(n, root="other") for n in (1, 2)],
            [episode_file(n, parent="Another show") for n in (1, 2)],
            [episode_file(n, parent="Mixed", name=f"Alpha.S01E{n:02}.mkv") for n in (1, 2)],
            [episode_file(n, parent="Mixed", name=f"Beta.S01E{n:02}.mkv") for n in (1, 2)],
            [episode_file(n, parent="Mixed", name=f"Alpha.S02E{n:02}.mkv") for n in (1, 2)],
        ]
        files = [f for group in groups for f in group]
        ids = [tv_identity(f, tmdb=100+i, season=i+1, episode=n+1) for i, group in enumerate(groups) for n, f in enumerate(group)]
        host = Host(); replies(host, ids)
        Plugin().recognize({"profileId": 7, "review": True}, host.context(files=files))
        self.assertEqual(len(host.prepared), 12)
        mapping = series_groups([{"file": f} for f in files])
        self.assertEqual(len(set(mapping.values())), 6)
        for group in groups:
            self.assertEqual(len({mapping[f["ref"]] for f in group}), 1)
        for name in ("001.mkv", "Movie.2024.mkv", "E01-E02.mkv", "Show.S01E01E02.mkv", "E01-02.mkv"):
            self.assertIsNone(series_key(episode_file(1, name=name)))

    def test_missing_or_unknown_episode_blocks_other_episodes_before_prepare(self):
        files = [episode_file(1), episode_file(2)]
        for second in (None, {**tv_identity(files[1]), "tmdbId": None}):
            host = Host(); replies(host, [tv_identity(files[0])] + ([second] if second else []))
            with self.assertRaises(SDKError) as caught:
                Plugin().recognize({"profileId": 7, "review": True}, host.context(files=files))
            self.assertEqual(caught.exception.code, "AI_SERIES_INCOMPLETE")
            self.assertFalse(host.prepared or host.submissions)
            self.assertEqual(Plugin().retry_state({"flowKey": "ai/flow/flow"}, host.context())["count"], 2)

    def test_cancellation_while_later_batch_is_running_never_submits_earlier_group_members(self):
        files = [episode_file(n) for n in range(1, 10)]
        host = Host()
        host.chat_results = [{"message": {"content": json.dumps({"items": [tv_identity(f) for f in files[:8]]})}},
                             SDKError("Cancelled", "CANCELLED")]
        with self.assertRaises(SDKError) as caught:
            Plugin().recognize({"profileId": 7}, host.context(files=files))
        self.assertEqual(caught.exception.code, "CANCELLED")
        self.assertFalse(host.submissions or host.prepared)
        self.assertTrue(all(host.values['ai/flow/flow/'+f['ref']]['status'] == 'group_pending' for f in files[:8]))

    def test_500_grouped_episodes_fit_sdk_call_and_storage_quotas(self):
        files = [{**episode_file(n), "ref": f"episode-{n}"} for n in range(1, 501)]
        host = DirectoryHost([])
        replies(host, [tv_identity(f, episode=i+1) for i, f in enumerate(files)])
        Plugin().recognize({"profileId": 7}, host.context(files=files))
        self.assertEqual(len(host.submissions), 500)
        self.assertEqual(sum(m == 'ai.chat' for m, _ in host.calls), 63)
        self.assertEqual(len(host.waits[-1]['refs']), 500)
