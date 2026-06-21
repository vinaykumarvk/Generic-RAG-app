import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.district.criminal_filter import (  # noqa: E402
    classify_case,
    load_filter_config,
    normalize_sections,
    sensitive_flags,
)
from src.sources.ddl_metadata import build_count_report, infer_court_level, normalize_ddl_row  # noqa: E402


class DistrictMetadataLoaderTests(unittest.TestCase):
    def setUp(self):
        self.config = load_filter_config()

    def test_classifies_pocso_case_with_sensitive_flags(self):
        row = {
            "act": "Protection of Children from Sexual Offences Act; Indian Penal Code",
            "section": "4; 376",
            "case_type": "Sessions Trial",
            "disp_name": "Convicted",
        }

        matches = classify_case(row, self.config)

        self.assertTrue(matches)
        self.assertIn("victim_identity", sensitive_flags(matches))
        self.assertIn("sexual_offence_detail", sensitive_flags(matches))
        self.assertEqual({match.category for match in matches}, {"child_sexual_offence", "rape"})

    def test_normalizes_sections_from_mixed_source_text(self):
        self.assertEqual(
            normalize_sections("IPC 302; Section 354A; BNS 103"),
            ["302", "354A", "103"],
        )

    def test_non_matching_case_is_not_criminal_target(self):
        row = {
            "act": "Negotiable Instruments Act",
            "section": "138",
            "case_type": "Complaint Case",
        }

        self.assertEqual(classify_case(row, self.config), [])

    def test_normalizes_ddl_row_without_creating_document_contract(self):
        row = {
            "ddl_case_id": "ddl-1",
            "cino": "UPLU010001232018",
            "state_code": "9",
            "district_code": "101",
            "court_no": "2",
            "case_type": "SC",
            "filing_date": "2018-01-02",
            "registration_date": "2018-01-05",
            "decision_date": "2019-03-01",
            "disp_name": "Acquitted",
            "section": "302; 376",
            "act": "Indian Penal Code",
            "judge_position": "Additional Sessions Judge",
            "bailable": "false",
            "under_trial": "true",
        }

        record = normalize_ddl_row(row, filter_config=self.config, dataset_version="ddl-test")

        self.assertEqual(record.source_case_id, "ddl-1")
        self.assertEqual(record.cnr, "UPLU010001232018")
        self.assertEqual(record.state_name, "Uttar Pradesh")
        self.assertEqual(record.court_level, "sessions")
        self.assertEqual(record.decision_date.isoformat(), "2019-03-01")
        self.assertTrue(record.is_criminal_target)
        self.assertIn("murder", record.offence_categories)
        self.assertIn("rape", record.offence_categories)
        self.assertNotIn("sexual_assault", record.offence_categories)
        self.assertNotIn("kidnapping_abduction", record.offence_categories)
        self.assertFalse(record.bailable)
        self.assertTrue(record.under_trial)

    def test_build_count_report_summarizes_targets(self):
        rows = [
            normalize_ddl_row(
                {
                    "ddl_case_id": "ddl-1",
                    "cino": "UP1",
                    "state_code": "9",
                    "decision_date": "2019-03-01",
                    "section": "302",
                    "act": "IPC",
                    "disp_name": "Convicted",
                },
                filter_config=self.config,
                dataset_version="ddl-test",
            ),
            normalize_ddl_row(
                {
                    "ddl_case_id": "ddl-2",
                    "state_code": "27",
                    "decision_date": "2019-04-01",
                    "section": "138",
                    "act": "Negotiable Instruments Act",
                    "disp_name": "Disposed",
                },
                filter_config=self.config,
                dataset_version="ddl-test",
            ),
        ]

        report = build_count_report(rows)

        self.assertEqual(report["total_rows"], 2)
        self.assertEqual(report["criminal_target_rows"], 1)
        self.assertEqual(report["missing_cnr_rows"], 1)
        self.assertEqual(report["by_offence_category"]["murder"], 1)
        self.assertEqual(report["by_state_code"]["9"], 1)
        self.assertEqual(report["by_section"]["302"], 1)
        self.assertEqual(report["by_source"]["ddl"], 2)
        self.assertEqual(report["by_license_classification"]["commercial_safe"], 2)

    def test_infers_common_court_levels(self):
        self.assertEqual(infer_court_level("Additional Sessions Judge"), "sessions")
        self.assertEqual(infer_court_level("Judicial Magistrate First Class"), "magistrate")
        self.assertEqual(infer_court_level("POCSO Special Court"), "special_pocso")


if __name__ == "__main__":
    unittest.main()
