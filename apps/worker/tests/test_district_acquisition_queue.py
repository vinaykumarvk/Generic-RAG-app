import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.district.acquisition_queue import attempt_to_case_status, plan_text_acquisition  # noqa: E402
from src.district import acquisition_worker  # noqa: E402
from src.district.criminal_filter import load_filter_config  # noqa: E402
from src.sources.ecourts_district import ECourtsClient, cnr_lookup_payload, next_retry_at, should_stop_window  # noqa: E402
from src.sources.hldc import normalize_hldc_record  # noqa: E402
from src.sources.indian_kanoon_district import IndianKanoonClient, build_cnr_search_query, classify_candidate  # noqa: E402


class FakeCursor:
    def __init__(self):
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))


class DistrictAcquisitionQueueTests(unittest.TestCase):
    def setUp(self):
        self.config = load_filter_config()

    def test_plans_enabled_sources_for_criminal_target(self):
        case = {
            "cnr": "UPLU010001232018",
            "state_code": 9,
            "district_code": 101,
            "case_type": "SC",
            "decision_date": "2019-03-01",
            "offence_categories": ["murder"],
            "is_criminal_target": True,
            "text_status": "targeted",
        }

        plan = plan_text_acquisition(case, self.config)

        self.assertEqual([item.source_name for item in plan], ["ecourts"])
        self.assertEqual(plan[0].requested_metadata["cnr"], "UPLU010001232018")

    def test_skips_non_criminal_or_completed_cases(self):
        self.assertEqual(plan_text_acquisition({"is_criminal_target": False}, self.config), [])
        self.assertEqual(plan_text_acquisition({"is_criminal_target": True, "text_status": "text_ready"}, self.config), [])

    def test_attempt_outcomes_map_to_case_status(self):
        self.assertEqual(attempt_to_case_status("indian_kanoon", "miss"), "ik_miss")
        self.assertEqual(attempt_to_case_status("ecourts", "hit"), "ecourts_hit")
        self.assertEqual(attempt_to_case_status("indian_kanoon", "hit"), "ik_hit")
        self.assertEqual(attempt_to_case_status("ecourts", "captcha_required"), "ecourts_pending")
        self.assertEqual(attempt_to_case_status("ecourts", "captcha_failed"), "blocked")

    def test_indian_kanoon_candidate_classification_prefers_cnr(self):
        query = build_cnr_search_query("UPLU010001232018")
        candidate = classify_candidate("UPLU010001232018", {"title": "Case UPLU010001232018", "docid": "123"})

        self.assertEqual(query, '"UPLU010001232018"')
        self.assertEqual(candidate.matched_on, "cnr")
        self.assertGreater(candidate.match_confidence, 0.9)

    def test_ecourts_rate_limit_helpers(self):
        now = datetime(2026, 5, 22, 10, 0, 0)
        self.assertEqual(cnr_lookup_payload("uplu010001232018"), {"cino": "UPLU010001232018"})
        self.assertEqual(next_retry_at(1, now=now).second, 3)
        self.assertTrue(should_stop_window(captcha_failure_rate=0.21, rate_limit_failure_rate=0.0))

    def test_source_clients_are_policy_safe_without_credentials_or_direct_fetch(self):
        ik_result = IndianKanoonClient(api_token="").fetch_case({"cnr": "UPLU010001232018"})
        ecourts_result = ECourtsClient(direct_fetch_enabled=False, direct_pdf_url_template="").fetch_case({"cnr": "UPLU010001232018"})

        self.assertEqual(ik_result.outcome, "blocked_by_policy")
        self.assertEqual(ecourts_result.outcome, "captcha_required")
        self.assertEqual(ecourts_result.metadata["policy"], "manual_operator_queue_required")

    def test_hldc_is_always_non_commercial(self):
        record = normalize_hldc_record({"id": "hldc-1", "text": "Hindi judgment text"})

        self.assertFalse(record.commercial_safe)
        self.assertEqual(record.license_classification, "non_commercial")
        self.assertEqual(record.language, "hi")

    def test_district_acquisition_reclaims_stale_processing_rows(self):
        cursor = FakeCursor()

        acquisition_worker._reclaim_stale_processing_rows(cursor)

        sql, params = cursor.executed[0]
        self.assertIn("WITH stale AS", sql)
        self.assertIn("status = 'processing'", sql)
        self.assertIn("'rate_limited'", sql)
        self.assertIn("'failed'", sql)
        self.assertIn("stale_processing_lock", sql)
        self.assertEqual(params, (acquisition_worker.config.DISTRICT_ACQUISITION_STALE_REAPER_BATCH_SIZE,))


if __name__ == "__main__":
    unittest.main()
