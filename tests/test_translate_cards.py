import argparse
import contextlib
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from email.message import Message
from urllib.error import HTTPError

import translate_cards as t


GLOSSARY = json.loads((t.ROOT / "translation_glossary.json").read_text())


def options(**overrides):
    defaults = dict(model=t.DEFAULT_MODEL, max_output_tokens=4096, max_requests=20,
                    all=True, limit=100, fields=list(t.FIELDS), card_id=None,
                    dry_run=False, rules_only=False, retry_failed=False, retry_review=False)
    return argparse.Namespace(**(defaults | overrides))


class ArchiveTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "cards.db"
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.execute("CREATE TABLE cards(card_id INTEGER PRIMARY KEY, name TEXT, card_type TEXT, attributes TEXT, effect_text TEXT, flavor_text TEXT, cost TEXT, set_name TEXT, tags TEXT)")
        self.db.executemany("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?)", [
            (1, "カード", "ユニット/バスター", "人間", "１枚引く。", "", "(黒0)/(無3)", "BT1", '["official"]'),
            (2, "カード", "ユニット/バスター", "人間", "１枚引く。", "", "(黒0)/(無3)", "BT1", '["official"]'),
        ])
        self.db.commit()
        self.original = [tuple(r) for r in self.db.execute("SELECT * FROM cards")]
        self.output = io.StringIO()
        self.quiet = contextlib.redirect_stdout(self.output)
        self.quiet.__enter__()
        self.addCleanup(self.quiet.__exit__, None, None, None)
        t.migrate(self.db, self.path)

    def card(self, card_id=1):
        return dict(self.db.execute("SELECT * FROM cards WHERE card_id=?", (card_id,)).fetchone())

    def test_migration_preserves_original_and_backup_is_idempotent(self):
        before = list(Path(self.folder.name).glob("*.before-translation-*.db"))
        self.assertEqual(len(before), 1)
        with contextlib.closing(sqlite3.connect(before[0])) as backup:
            self.assertEqual(backup.execute("SELECT * FROM cards").fetchall(), self.original)
        t.migrate(self.db, self.path)
        self.assertEqual(len(list(Path(self.folder.name).glob("*.before-translation-*.db"))), 1)
        columns = {r["name"] for r in self.db.execute("PRAGMA table_info(cards)")}
        self.assertTrue(all(f + "_en" in columns for f in t.FIELDS))

    def test_rules_never_call_api_and_resume_without_writes(self):
        with patch.object(t, "OpenAITranslator", side_effect=AssertionError("API called")):
            t.run(self.db, GLOSSARY, options(rules_only=True))
            before = self.db.total_changes
            t.run(self.db, GLOSSARY, options(rules_only=True))
        self.assertEqual(self.db.total_changes, before)
        self.assertEqual(self.card()["cost_en"], "(Black 0)/(Colorless 3)")
        self.assertEqual(self.card()["card_type_en"], "Unit/Buster")
        self.assertEqual(self.card()["flavor_text_en"], "")
        self.assertEqual(self.card()["effect_text"], "１枚引く。")

    def test_valid_results_cached_and_restart_does_not_call_provider(self):
        result = {"translation": "Draw 1 card.", "issues": [], "usage": {"input_tokens": 10}, "response_id": "r1"}
        with patch.object(t.OpenAITranslator, "__init__", return_value=None), patch.object(t.OpenAITranslator, "translate", return_value=result) as api:
            t.run(self.db, GLOSSARY, options(fields=["effect_text"]))
            self.assertEqual(api.call_count, 1)
            t.run(self.db, GLOSSARY, options(fields=["effect_text"]))
            self.assertEqual(api.call_count, 1)
        self.assertEqual(self.card(2)["effect_text_en"], "Draw 1 card.")

    def test_different_game_context_is_not_reused(self):
        self.db.execute("UPDATE cards SET tags='[\"bright\"]' WHERE card_id=2")
        self.db.commit()
        result = {"translation": "Draw 1 card.", "issues": [], "usage": {}, "response_id": "r1"}
        with patch.object(t.OpenAITranslator, "__init__", return_value=None), patch.object(t.OpenAITranslator, "translate", return_value=result) as api:
            t.run(self.db, GLOSSARY, options(fields=["effect_text"]))
            self.assertEqual(api.call_count, 2)

    def test_review_candidates_are_not_published_or_automatically_retried(self):
        result = {"translation": "Draw 2 cards.", "issues": ["Numeric quantities changed"], "usage": {}, "response_id": "r1"}
        with patch.object(t.OpenAITranslator, "__init__", return_value=None), patch.object(t.OpenAITranslator, "translate", return_value=result) as api:
            t.run(self.db, GLOSSARY, options(fields=["effect_text"]))
            self.assertIsNone(self.card()["effect_text_en"])
            t.run(self.db, GLOSSARY, options(fields=["effect_text"]))
            self.assertEqual(api.call_count, 2)
        job = self.db.execute("SELECT * FROM translation_jobs WHERE card_id=1").fetchone()
        self.assertEqual(job["translation"], "Draw 2 cards.")
        self.assertEqual(job["status"], "needs_review")

    def test_manual_review_survives_glossary_and_model_changes(self):
        t.save_job(self.db, self.card(), "effect_text", t.digest(GLOSSARY), "manual", "manual", "reviewed", "Draw 1 card.")
        job = dict(self.db.execute("SELECT * FROM translation_jobs").fetchone())
        self.assertFalse(t.pending(self.card(), "effect_text", job, "different", "different", options()))

    def test_provider_failure_stops_and_requires_explicit_retry(self):
        with patch.object(t.OpenAITranslator, "__init__", return_value=None), patch.object(t.OpenAITranslator, "translate", side_effect=RuntimeError("HTTP 401")) as api:
            self.assertEqual(t.run(self.db, GLOSSARY, options(fields=["effect_text"])), 1)
            self.assertEqual(api.call_count, 1)
        job = dict(self.db.execute("SELECT * FROM translation_jobs").fetchone())
        self.assertFalse(t.pending(self.card(), "effect_text", job, t.digest(GLOSSARY), t.DEFAULT_MODEL, options()))
        self.assertTrue(t.pending(self.card(), "effect_text", job, t.digest(GLOSSARY), t.DEFAULT_MODEL, options(retry_failed=True)))

    def test_dry_run_does_not_write_or_call_api(self):
        before = self.db.total_changes
        with patch.object(t, "OpenAITranslator", side_effect=AssertionError("API called")):
            t.run(self.db, GLOSSARY, options(dry_run=True))
        self.assertEqual(self.db.total_changes, before)

    def test_request_limit_stops_without_marking_remaining_as_failed(self):
        result = {"translation": "Card", "issues": [], "usage": {}, "response_id": "r1"}
        with patch.object(t.OpenAITranslator, "__init__", return_value=None), patch.object(t.OpenAITranslator, "translate", return_value=result) as api:
            t.run(self.db, GLOSSARY, options(fields=["name", "effect_text"], max_requests=1))
            self.assertEqual(api.call_count, 1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM translation_jobs").fetchone()[0], 1)

    def test_bulk_deduplicates_and_accounts_for_batch_usage_once(self):
        def translate_many(items, glossary):
            return {"items": {item["key"]: {"translation": "Draw 1 card.", "issues": []} for item in items},
                    "usage": {"input_tokens": 50, "output_tokens": 10}, "response_id": "bulk1"}
        with patch.object(t.OpenAITranslator, "__init__", return_value=None), patch.object(t.OpenAITranslator, "translate_many", side_effect=translate_many) as api:
            t.run(self.db, GLOSSARY, options(fields=["effect_text"], workers=2, batch_size=3))
            self.assertEqual(api.call_count, 1)
            self.assertEqual(len(api.call_args.args[0]), 1)
        self.assertEqual(self.card()["effect_text_en"], "Draw 1 card.")
        self.assertEqual(self.card(2)["effect_text_en"], "Draw 1 card.")
        usages = [json.loads(r[0]) for r in self.db.execute("SELECT usage_json FROM translation_jobs")]
        self.assertEqual(sum(u.get("input_tokens", 0) for u in usages), 50)

    def test_bulk_preserves_reviewed_field(self):
        t.save_job(self.db, self.card(), "effect_text", "old-glossary", "manual", "manual", "reviewed", "Reviewed text.")
        def translate_many(items, glossary):
            return {"items": {item["key"]: {"translation": "Draw 1 card.", "issues": []} for item in items}, "usage": {}, "response_id": "bulk2"}
        with patch.object(t.OpenAITranslator, "__init__", return_value=None), patch.object(t.OpenAITranslator, "translate_many", side_effect=translate_many):
            t.run(self.db, GLOSSARY, options(fields=["effect_text"], workers=2, batch_size=3))
        self.assertEqual(self.card()["effect_text_en"], "Reviewed text.")
        self.assertEqual(self.card(2)["effect_text_en"], "Draw 1 card.")

    def test_provider_failure_does_not_erase_published_translation(self):
        t.save_job(self.db, self.card(), "effect_text", "old", t.DEFAULT_MODEL, "openai", "validated", "Draw 1 card.")
        t.save_job(self.db, self.card(), "effect_text", "new", t.DEFAULT_MODEL, "openai", "failed", None, "Rate limit")
        self.assertEqual(self.card()["effect_text_en"], "Draw 1 card.")
        self.db.execute("UPDATE cards SET effect_text='２枚引く。' WHERE card_id=1")
        self.db.commit()
        t.save_job(self.db, self.card(), "effect_text", "new", t.DEFAULT_MODEL, "openai", "failed", None, "Rate limit")
        self.assertIsNone(self.card()["effect_text_en"])


class ProviderTest(unittest.TestCase):
    def response(self, answer, status="completed", usage=None):
        data = {"status": status, "id": "response1", "usage": usage or {}, "output": [
            {"type": "message", "content": [{"type": "output_text", "text": json.dumps(answer)}]}]}
        return io.BytesIO(json.dumps(data).encode())

    def translator(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
            return t.OpenAITranslator(t.DEFAULT_MODEL)

    def test_responses_request_and_protected_marker_restoration(self):
        answer = {"translation": "__BD_TOKEN_000__Draw 1 card.", "needs_review": False, "notes": ""}
        with patch.object(t, "urlopen", return_value=self.response(answer)) as request:
            result = self.translator().translate("effect_text", "⁅自動⁆１枚引く。", {}, GLOSSARY)
        self.assertEqual(result["translation"], "⁅Auto⁆Draw 1 card.")
        self.assertEqual(result["issues"], [])
        body = json.loads(request.call_args.args[0].data)
        self.assertEqual(body["model"], "gpt-6-luna")
        self.assertTrue(body["text"]["format"]["strict"])
        self.assertFalse(body["store"])
        self.assertEqual(json.loads(body["input"])["protected_markers"]["__BD_TOKEN_000__"]["japanese"], "自動")

    def test_missing_or_duplicated_markers_require_review(self):
        for text in ["Draw 1 card.", "__BD_TOKEN_000____BD_TOKEN_000__Draw 1 card."]:
            with self.subTest(text=text), patch.object(t, "urlopen", return_value=self.response({"translation": text, "needs_review": False, "notes": ""})):
                result = self.translator().translate("effect_text", "⁅自動⁆１枚引く。", {}, GLOSSARY)
                self.assertIn("Protected markers changed or omitted", result["issues"])

    def test_numeric_drift_is_rejected_even_if_model_claims_valid(self):
        with patch.object(t, "urlopen", return_value=self.response({"translation": "Draw 2 cards.", "needs_review": False, "notes": ""})):
            result = self.translator().translate("effect_text", "１枚引く。", {}, GLOSSARY)
        self.assertIn("Numeric quantities changed", result["issues"])

    def test_incomplete_and_refusal_are_not_publishable(self):
        with patch.object(t, "urlopen", return_value=self.response({}, status="incomplete", usage={"input_tokens": 8})):
            result = self.translator().translate("name", "名前", {}, GLOSSARY)
        self.assertIsNone(result["translation"])
        self.assertEqual(result["usage"]["input_tokens"], 8)
        refused = io.BytesIO(json.dumps({"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal"}]}]}).encode())
        with patch.object(t, "urlopen", return_value=refused):
            self.assertIsNone(self.translator().translate("name", "名前", {}, GLOSSARY)["translation"])

    def test_unknown_markers_are_preserved_for_review(self):
        source, mapping = t.protect("⁅未知⁆", GLOSSARY)
        self.assertEqual(mapping[source], "⁅未知⁆")
        self.assertIn("Japanese remains; check terminology", t.validation_issues("effect_text", "⁅未知⁆", "⁅未知⁆"))

    def test_unknown_dictionary_terms_do_not_get_partial_translations(self):
        self.assertIsNone(t.rule_translation("attributes", "人間/未知", GLOSSARY))
        self.assertIsNone(t.rule_translation("cost", "(緑1)", GLOSSARY))

    def test_list_bullets_are_not_japanese_residue(self):
        self.assertEqual(t.validation_issues("effect_text", "・１枚引く。", "・Draw 1 card."), [])

    def test_batch_validation_is_independent_per_field(self):
        items = [{"key": "a", "field": "effect_text", "source": "１枚引く。", "context": {}},
                 {"key": "b", "field": "effect_text", "source": "２枚引く。", "context": {}}]
        answer = {"a": {"translation": "Draw 1 card.", "needs_review": False, "notes": ""},
                  "b": {"translation": "Draw 3 cards.", "needs_review": False, "notes": ""}}
        with patch.object(t, "urlopen", return_value=self.response(answer)):
            result = self.translator().translate_many(items, GLOSSARY)
        self.assertEqual(result["items"]["a"]["issues"], [])
        self.assertIn("Numeric quantities changed", result["items"]["b"]["issues"])

    def test_batch_missing_key_never_publishes_misaligned_results(self):
        items = [{"key": "a", "field": "name", "source": "名前", "context": {}}]
        with patch.object(t, "urlopen", return_value=self.response({"wrong": {"translation": "Name", "needs_review": False, "notes": ""}})):
            result = self.translator().translate_many(items, GLOSSARY)
        self.assertIsNone(result["items"]["a"]["translation"])

    def test_long_rate_limit_stops_without_repeated_requests(self):
        headers = Message()
        headers["retry-after"] = "1728"
        error = HTTPError("https://api.openai.com/v1/responses", 429, "Too Many Requests", headers,
                          io.BytesIO(b'{"error":{"code":"rate_limit_exceeded"}}'))
        with patch.object(t, "urlopen", side_effect=error) as api, patch.object(t.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "Retry-After=1728s"):
                self.translator().translate("name", "名前", {}, GLOSSARY)
        self.assertEqual(api.call_count, 1)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
