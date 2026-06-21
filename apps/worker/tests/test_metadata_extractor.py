import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pipeline import metadata_extractor  # noqa: E402


class MetadataExtractorJudgmentTests(unittest.TestCase):
    def test_judgment_payload_normalizes_core_fields(self):
        metadata = {
            "case_reference": "Criminal Appeal No. 10/2024",
            "legal_sections": ["NDPS 50"],
            "jurisdiction": "Supreme Court of India",
            "judgment": {
                "court_code": "SCI",
                "decision_date": "2024-05-01",
                "incident_date": "2022-01-15",
                "applicable_legal_regime": "ipc_crpc_evidence_act",
                "neutral_citation": "2024 INSC 100",
                "judges": ["A. Judge", "B. Judge"],
                "sections": ["42"],
                "sensitive_data_flags": ["victim_identity"],
                "outcome_details": [
                    {
                        "accused_label": "A1",
                        "section": "50",
                        "final_outcome": "conviction_set_aside",
                        "state_or_police_result": "adverse",
                        "source_span": {"paragraph_number": "21", "quote": "non-compliance"},
                    }
                ],
            },
        }
        context = {
            "file_name": "sci-2024-ndps.pdf",
            "file_path": "uploads/sci-2024-ndps.pdf",
            "source_path": "/judgments/sci/2024/sci-2024-ndps.pdf",
            "gcs_uri": "gs://bucket/sci-2024-ndps.pdf",
            "metadata": {"source": "pilot"},
            "ocr_confidence": 0.91,
        }

        payload = metadata_extractor._judgment_payload(metadata, context, 0.82)

        self.assertEqual(payload["canonical_judgment_id"], "2024 INSC 100")
        self.assertEqual(payload["court_code"], "SCI")
        self.assertEqual(payload["judgment_year"], 2024)
        self.assertIn("NDPS", payload["statutes"])
        self.assertIn("50", payload["sections"])
        self.assertIn("42", payload["sections"])
        self.assertEqual(payload["source_path"], "/judgments/sci/2024/sci-2024-ndps.pdf")
        self.assertEqual(payload["ocr_confidence"], 0.91)
        self.assertEqual(payload["metadata_confidence"], 0.82)
        self.assertTrue(metadata_extractor._has_judgment_signal(payload))

    def test_invalid_statuses_and_dates_are_safely_defaulted(self):
        metadata = {
            "judgment": {
                "decision_date": "1 May 2024",
                "redaction_status": "public",
                "correction_status": "draft",
            }
        }

        payload = metadata_extractor._judgment_payload(metadata, {"file_name": "doc.pdf"}, 0.5)

        self.assertIsNone(payload["decision_date"])
        self.assertIsNone(payload["judgment_year"])
        self.assertEqual(payload["redaction_status"], "not_required")
        self.assertEqual(payload["correction_status"], "uncorrected")

    def test_district_document_metadata_is_preserved_as_deterministic_source(self):
        metadata = {
            "judgment": {
                "court_name": "LLM Court",
            }
        }
        context = {
            "file_name": "district.pdf",
            "metadata": {
                "district": {
                    "cnr": "UPLU010001232018",
                    "court_code": "DC-9-101-2",
                    "court_level": "sessions",
                    "decision_date": "2019-03-01",
                    "disposition": "Acquitted",
                    "acts_cited": ["Indian Penal Code"],
                    "sections_cited": ["302"],
                    "offence_categories": ["murder"],
                    "sensitive_data_flags": ["victim_identity"],
                    "source_license": "ODbL-1.0",
                }
            },
        }

        payload = metadata_extractor._judgment_payload(metadata, context, 0.9)

        self.assertEqual(payload["cnr"], "UPLU010001232018")
        self.assertEqual(payload["court_code"], "DC-9-101-2")
        self.assertEqual(payload["court_level"], "sessions")
        self.assertEqual(payload["decision_date"], "2019-03-01")
        self.assertIn("Indian Penal Code", payload["statutes"])
        self.assertIn("302", payload["sections"])
        self.assertIn("murder", payload["offence_categories"])
        self.assertIn("victim_identity", payload["sensitive_data_flags"])
        self.assertEqual(payload["source_license"], "ODbL-1.0")


if __name__ == "__main__":
    unittest.main()
