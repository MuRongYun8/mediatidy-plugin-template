import json
import unittest
from mt_plugin import SDKError
from plugin import Plugin, metadata_error, tmdb_source
from test_workflow import Host, file, identity


class NativeSearchTests(unittest.TestCase):
    def test_forged_source_does_not_bypass_or_prevent_metadata_check(self):
        for url in ["https://example.org/movie/123", "https://themoviedb.org.evil.invalid/movie/123", "https://www.themoviedb.org/movie/999", "https://www.themoviedb.org/tv/123", "https://user@www.themoviedb.org/movie/123", "javascript:alert(1)"]:
            with self.subTest(url=url):
                host=Host()
                good=identity("two")
                host.chat_results=[{"message":{"content":json.dumps({"items":[{**identity("one"),"sources":[url]},good]})},
                                    "nativeWebSearch":{"performed":True,"sources":[{"url":good["sources"][0]}]}}]
                rows=Plugin().recognize({"profileId":7},host.context(files=[file("one"),file("two")]))
                self.assertEqual([r["status"] for r in rows],["queued","queued"])
                self.assertEqual([p["fileRef"] for p in host.submissions],["one","two"])
                self.assertEqual(sum(m=="tmdb.detail" for m,_ in host.calls),1)
                self.assertEqual(rows[0]["detail"]["sourceMarkdown"],"[TMDB 核对条目](https://www.themoviedb.org/movie/123)")
                self.assertEqual(rows[1]["detail"]["sourceMarkdown"],"[TMDB 搜索依据](https://www.themoviedb.org/movie/123)")

    def test_missing_citations_still_check_id_without_claiming_search_evidence(self):
        for claimed in ("missing", [], None, "https://www.themoviedb.org/movie/123", ["https://www.themoviedb.org/movie/123"]):
            for provider in ({}, {"sources":[]}, {"sources":[{"url":"https://example.org/other"}]}):
                with self.subTest(claimed=claimed,provider=provider):
                    host=Host();item=identity("one")
                    item.pop("sources")
                    if claimed != "missing":
                        item["sources"]=claimed
                    host.chat_results=[{"message":{"content":json.dumps({"items":[item]})},"nativeWebSearch":{"performed":True,**provider}}]
                    rows=Plugin().recognize({"profileId":7},host.context(files=[file("one")]))
                    self.assertEqual(rows[0]["status"],"queued")
                    self.assertTrue(rows[0]["detail"]["identityVerified"])
                    self.assertEqual(rows[0]["detail"]["identity"],item)
                    self.assertEqual(rows[0]["detail"]["sourceMarkdown"],"[TMDB 核对条目](https://www.themoviedb.org/movie/123)")
                    self.assertEqual(sum(m=="tmdb.detail" for m,_ in host.calls),1)
                    self.assertEqual(sum(m=="ai.chat" for m,_ in host.calls),1)
                    # Before the detail response, no unverified link or passed badge is published.
                    first=next(args["value"][0] for m,args in host.calls if m=="runtime.result")
                    self.assertEqual(first["detail"]["sourceMarkdown"],"")
                    self.assertFalse(first["detail"]["identityVerified"])

    def test_wrong_existing_id_never_becomes_a_ready_draft_or_submission(self):
        for review in (False,True):
            host=Host()
            bad={**identity("one"),"title":"Antonia’s Line","originalTitle":"Antonia","year":1995,"tmdbId":754,"sources":[]}
            host.replies=[{"content":json.dumps({"items":[bad,identity("two")]})}]
            host.details[("movie",754)]={"id":754,"title":"变脸","originalTitle":"Face/Off","year":"1997","mediaType":"movie"}
            rows=Plugin().recognize({"profileId":7,"review":review},host.context(files=[file("one"),file("two")]))
            self.assertEqual(rows[0]["status"],"verification_failed")
            self.assertEqual(rows[0]["recognitionStatus"],"recognized")
            self.assertEqual(rows[0]["detail"]["identity"],bad)
            self.assertIn("Antonia’s Line",rows[0]["error"])
            self.assertIn("变脸",rows[0]["error"])
            self.assertFalse(rows[0]["detail"]["identityVerified"])
            self.assertEqual(rows[0]["detail"]["sourceMarkdown"],"")
            self.assertEqual([p["fileRef"] for p in host.prepared+host.submissions],["two"])

    def test_alias_and_platform_files_use_one_request_and_verify_ids_without_citations(self):
        # Replay the reported filenames with simulated AI/TMDB responses; no live services.
        files=[{**file("tv"),"name":"A.Prophet.2026.S01E06.2160p.TX.WEB-DL.DDP5.1.HFR.H.265-FGTWeb.mkv",
                "path":"未识别/我不是大师/长风起/A.Prophet.2026.S01E06.mkv"},
               {**file("movie"),"name":"Animales.2026.2160p.NF.WEB-DL.H265.DV.DDP.5.1.Atmos.mkv"}]
        items=[{**identity("tv"),"title":"我不是大师","originalTitle":"我不是大师","year":2026,"mediaType":"tv","tmdbId":289078,
                "season":1,"episode":6,"reason":"目录中文别名与 TX 平台线索一致，S01E06 提供季集编号","sources":[]},
               {**identity("movie"),"title":"Animals","originalTitle":"Animals","year":2026,"tmdbId":1236045,
                "reason":"西班牙语发行名及 NF 平台线索对应 Animals","sources":[]}]
        for review in (False,True):
            host=Host()
            host.chat_results=[{"message":{"content":json.dumps({"items":items})},"nativeWebSearch":{"performed":True,"sources":[]}}]
            for item in items:
                host.details[(item["mediaType"],item["tmdbId"])]=dict(id=item["tmdbId"],title=item["title"],
                    originalTitle=item["originalTitle"],year="2026",mediaType=item["mediaType"])
            rows=Plugin().recognize({"profileId":7,"review":review},host.context(files=files))
            self.assertEqual([r["status"] for r in rows],["ready" if review else "queued"]*2)
            calls=[args for method,args in host.calls if method=="ai.chat"]
            self.assertEqual(len(calls),1)
            self.assertIs(calls[0]["singleRequest"],True)
            self.assertIs(calls[0]["nativeWebSearch"],True)
            self.assertNotIn("tools",calls[0])
            clues=json.loads(calls[0]["messages"][1]["content"])["files"]
            self.assertEqual(clues[0]["directory"],"未识别/我不是大师/长风起")
            self.assertEqual([c["name"] for c in clues],[f["name"] for f in files])
            prompt=calls[0]["messages"][0]["content"]
            for guidance in ("别名","原文名","TX","WeTV","NF","Netflix","S01E06","可为空"):
                self.assertIn(guidance,prompt)
            self.assertEqual([(a["mediaType"],a["id"]) for m,a in host.calls if m=="tmdb.detail"],[("tv",289078),("movie",1236045)])
            submitted=host.prepared+host.submissions
            self.assertEqual([a["tmdbId"] for a in submitted],[289078,1236045])
            self.assertEqual((submitted[0]["season"],submitted[0]["episode"]),(1,6))
            self.assertFalse(any(m in ("tmdb.search","tmdb.season","ai.web.search","ai.capabilities") for m,_ in host.calls))

    def test_missing_id_preserves_known_alias_without_blocking_other_files(self):
        host=Host()
        unknown={**identity("one"),"title":"已确认的作品名","tmdbId":None,"sources":[]}
        valid={**identity("two"),"sources":[]}
        host.replies=[{"content":json.dumps({"items":[unknown,valid]})}]
        rows=Plugin().recognize({"profileId":7},host.context(files=[file("one"),file("two")]))
        self.assertEqual([r["status"] for r in rows],["unrecognized","queued"])
        self.assertEqual(rows[0]["title"],unknown["title"])
        self.assertEqual(rows[0]["detail"]["identity"],unknown)
        self.assertEqual([a["fileRef"] for a in host.submissions],["two"])
        self.assertEqual(sum(m=="ai.chat" for m,_ in host.calls),1)
        self.assertEqual(sum(m=="tmdb.detail" for m,_ in host.calls),1)
        self.assertFalse(any(m=="tmdb.search" for m,_ in host.calls))

    def test_metadata_failure_deduplicates_and_never_restarts_ai(self):
        for failure in [SDKError("TMDB 暂时不可用","TMDB_LOOKUP_FAILED"),
                        {"id":123,"title":"Example","originalTitle":"Example","mediaType":"tv","year":"2024"},
                        {"id":123,"title":"Example","originalTitle":"Example","mediaType":"movie","year":"2025"},
                        {"id":123,"title":"Example","originalTitle":"Example","mediaType":"movie","year":"0"}]:
            host=Host();host.details[("movie",123)]=failure
            rows=Plugin().recognize({"profileId":7},host.context(files=[file(str(i)) for i in range(9)]))
            self.assertTrue(all(r["status"]=="verification_failed" for r in rows))
            self.assertEqual(sum(m=="tmdb.detail" for m,_ in host.calls),1)
            self.assertEqual(sum(m=="ai.chat" for m,_ in host.calls),2)
            self.assertFalse(host.submissions)

    def test_original_name_allows_translations_and_normalizes_punctuation(self):
        ai={**identity("one"),"title":"艾米丽","originalTitle":"ＡＭÉＬＩＥ’s Story"}
        media={"id":123,"title":"天使爱美丽","originalTitle":"AméLie's story","year":"2024","mediaType":"movie"}
        self.assertEqual(metadata_error(ai,media),"")
        self.assertEqual(tmdb_source("https://themoviedb.org/movie/123-name?language=zh-CN"),("movie",123))

    def test_search_must_be_confirmed_and_missing_identity_fields_never_submit(self):
        host=Host();host.chat_results=[{"message":{"content":"{}"},"nativeWebSearch":{"performed":False,"sources":[]}}]
        with self.assertRaises(SDKError):
            Plugin().recognize({"profileId":7},host.context(files=[file("one")]))
        self.assertEqual(sum(m=="ai.chat" for m,_ in host.calls),1)
        for patch in ({"tmdbId":None},{"originalTitle":None},{"year":None}):
            host=Host();host.replies=[{"content":json.dumps({"items":[{**identity("one"),**patch}]})}]
            Plugin().recognize({"profileId":7},host.context(files=[file("one")]))
            self.assertFalse(host.submissions)
            self.assertFalse(any(m=="tmdb.detail" for m,_ in host.calls))

    def test_results_published_before_metadata_and_cancellation_never_submits(self):
        host=Host()
        Plugin().recognize({"profileId":7},host.context(files=[file("one"),file("two")]))
        methods=[m for m,_ in host.calls]
        self.assertLess(methods.index("runtime.result"),methods.index("tmdb.detail"))
        self.assertEqual(methods.count("tmdb.detail"),1)
        self.assertTrue(all(v.get("identityVerified") for k,v in host.values.items() if k in ("ai/flow/flow/one","ai/flow/flow/two")))
        host=Host();host.details[("movie",123)]=SDKError("Cancelled","CANCELLED")
        ctx=host.context(files=[file("one")]);plugin=Plugin()
        with self.assertRaises(SDKError):
            plugin.recognize({"profileId":7},ctx)
        plugin.recognize({"profileId":7},ctx)
        self.assertFalse(host.submissions)
        self.assertEqual(sum(m=="ai.chat" for m,_ in host.calls),1)


if __name__ == "__main__":
    unittest.main()
