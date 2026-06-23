import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.district import discovery  # noqa: E402
from src.district.discovery import build_district_case_row, discover_cases  # noqa: E402
from src.district.seeding import generate_cnr_candidates  # noqa: E402
from src.sources.ecourts_district import ECourtsCaseMetadata  # noqa: E402
from src.sources.ecourts_parser import (  # noqa: E402
    is_case_not_found,
    parse_case_metadata,
    to_iso_date,
)

CASE_HISTORY_HTML = """
<table>
  <tr><td>Case Type</td><td>SC</td></tr>
  <tr><td>Filing Date</td><td>12-03-2018</td></tr>
  <tr><td>Decision Date</td><td>15th August 2020</td></tr>
  <tr><td>Nature of Disposal</td><td>Convicted</td></tr>
</table>
<table>
  <tr><th>Under Act(s)</th><th>Under Section(s)</th></tr>
  <tr><td>Indian Penal Code</td><td>302</td></tr>
</table>
"""

# Minimal inline filter so the test does not depend on the shipped YAML.
FILTER_CONFIG = {"offence_filters": [{"id": "murder", "category": "murder", "sections": ["302"]}]}


class CaseMetadataParserTests(unittest.TestCase):
    def test_parse_case_metadata_fields(self):
        fields = parse_case_metadata(CASE_HISTORY_HTML)
        self.assertEqual(fields["case_type"], "SC")
        self.assertEqual(fields["filing_date"], "2018-03-12")
        self.assertEqual(fields["decision_date"], "2020-08-15")
        self.assertEqual(fields["disposition"], "Convicted")
        self.assertEqual(fields["acts"], ["Indian Penal Code"])
        self.assertEqual(fields["sections"], ["302"])

    def test_to_iso_date_variants(self):
        self.assertEqual(to_iso_date("12-03-2018"), "2018-03-12")
        self.assertEqual(to_iso_date("15th August 2020"), "2020-08-15")
        self.assertIsNone(to_iso_date("not a date"))
        self.assertIsNone(to_iso_date(None))

    def test_is_case_not_found(self):
        self.assertTrue(is_case_not_found("This Record Not Found in the system"))
        self.assertFalse(is_case_not_found(CASE_HISTORY_HTML))


class BuildCaseRowTests(unittest.TestCase):
    def test_criminal_target_row(self):
        row = build_district_case_row("ws1", "UPLU010001232018", {"sections": "302", "case_type": "SC"}, FILTER_CONFIG)
        self.assertTrue(row["is_criminal_target"])
        self.assertEqual(row["offence_categories"], ["murder"])
        self.assertEqual(row["sections_cited"], ["302"])
        self.assertEqual(row["text_status"], "targeted")
        self.assertEqual(row["source_case_id"], "UPLU010001232018")

    def test_non_criminal_row(self):
        row = build_district_case_row("ws1", "UPLU010004202018", {"sections": "420"}, FILTER_CONFIG)
        self.assertFalse(row["is_criminal_target"])
        self.assertEqual(row["text_status"], "metadata_only")


class FakeClient:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def lookup_case_metadata(self, cnr):
        self.calls.append(cnr)
        return self.responses[cnr]


class DiscoverCasesTests(unittest.TestCase):
    def setUp(self):
        self._orig_existing = discovery._existing_cnrs
        self._orig_insert = discovery._insert_cases
        self.candidates = generate_cnr_candidates("UP", "LU", 1, 2018, start=1, count=3)

    def tearDown(self):
        discovery._existing_cnrs = self._orig_existing
        discovery._insert_cases = self._orig_insert

    def test_probe_skip_found_not_found(self):
        discovery._existing_cnrs = lambda ws, cands: {self.candidates[0]}  # first already exists
        discovery._insert_cases = lambda rows: len(rows)
        responses = {
            self.candidates[1]: ECourtsCaseMetadata(outcome="found", cnr=self.candidates[1], fields={"sections": "302"}),
            self.candidates[2]: ECourtsCaseMetadata(outcome="not_found", cnr=self.candidates[2]),
        }
        client = FakeClient(responses)

        summary = discover_cases(
            "ws1", state="UP", establishment="LU", court_code=1, year=2018, start=1, count=3,
            client=client, filter_config=FILTER_CONFIG,
        )

        self.assertEqual(summary["skipped"], 1)
        self.assertEqual(summary["probed"], 2)
        self.assertEqual(summary["found"], 1)
        self.assertEqual(summary["not_found"], 1)
        self.assertEqual(summary["inserted"], 1)
        self.assertEqual(client.calls, [self.candidates[1], self.candidates[2]])

    def test_stops_when_portal_disabled(self):
        discovery._existing_cnrs = lambda ws, cands: set()
        discovery._insert_cases = lambda rows: len(rows)
        responses = {c: ECourtsCaseMetadata(outcome="captcha_required", cnr=c) for c in self.candidates}
        client = FakeClient(responses)

        summary = discover_cases(
            "ws1", state="UP", establishment="LU", court_code=1, year=2018, start=1, count=3,
            client=client, filter_config=FILTER_CONFIG,
        )

        # Should break after the first captcha_required rather than probe all three.
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(summary["errors"], 1)
        self.assertEqual(summary["inserted"], 0)


if __name__ == "__main__":
    unittest.main()
