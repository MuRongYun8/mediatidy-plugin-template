import json
import unittest
from mt_plugin import SDKError
from plugin import Plugin, metadata_error, tmdb_source
from test_workflow import Host, file, identity


class NativeSearchTests(unittest.TestCase):
    def test_missing_or_forged_source_skips_only_invalid_file(self):
        for url in ["https://example.org/movie/123", "https://themoviedb.org.evil.invalid/movie/123", "https://www.themoviedb.org/movie/999", "https://www.themoviedb.org/tv/123", "https://user@www.themoviedb.org/movie/123", "javascript:alert(1)"]:
            with self.subTest(url=url):
                host=Host()
                good=identity("two")
                host.chat_results=[{"message":{"content":json.dumps({"items":[{**identity("one"),"sources":[url]},good]})},
                                    "nativeWebSearch":{"performed":True,"sources":[{"url":good["sources"][0]}]}}]
                rows=Plugin().recognize({"profileId":7},host.context(files=[file("one"),file("two")]))
                self.assertEqual([r["status"] for r in rows],["unrecognized","queued"])
                self.assertEqual([p["fileRef"] for p in host.submissions],["two"])

    def test_model_link_without_provider_evidence_is_not_trusted(self):
        host=Host()
        host.chat_results=[{"message":{"content":json.dumps({"items":[identity("one")]})},"nativeWebSearch":{"performed":True,"sources":[]}}]
        rows=Plugin().recognize({"profileId":7},host.context(files=[file("one")]))
        self.assertEqual(rows[0]["status"],"unrecognized")
        self.assertFalse(any(m=="tmdb.detail" for m,_ in host.calls))
        self.assertFalse(host.submissions)

    def test_wrong_existing_id_never_becomes_a_ready_draft_or_submission(self):
        for review in (False,True):
            host=Host()
            bad={**identity("one"),"title":"Antonia’s Line","originalTitle":"Antonia","year":1995,"tmdbId":754,"sources":["https://www.themoviedb.org/movie/754"]}
            host.replies=[{"content":json.dumps({"items":[bad,identity("two")]})}]
            host.details[("movie",754)]={"id":754,"title":"变脸","originalTitle":"Face/Off","year":"1997","mediaType":"movie"}
            rows=Plugin().recognize({"profileId":7,"review":review},host.context(files=[file("one"),file("two")]))
            self.assertEqual(rows[0]["status"],"verification_failed")
            self.assertEqual(rows[0]["recognitionStatus"],"recognized")
            self.assertEqual(rows[0]["detail"]["identity"],bad)
            self.assertIn("Antonia’s Line",rows[0]["error"])
            self.assertIn("变脸",rows[0]["error"])
            self.assertEqual([p["fileRef"] for p in host.prepared+host.submissions],["two"])

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
