import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pipeline.converter import _extract_table_page_spans  # noqa: E402


class ConverterTablePageTests(unittest.TestCase):
    def test_extract_table_page_spans_for_multi_page_pdf(self):
        text = (
            "<!-- PAGE 1 -->\n"
            "Narrative.\n"
            "<!-- TABLE_START -->\nA | B\n1 | 2\n<!-- TABLE_END -->\f"
            "<!-- PAGE 2 -->\n"
            "More narrative.\n"
            "<!-- TABLE_START -->\nC | D\n3 | 4\n<!-- TABLE_END -->"
        )

        spans = _extract_table_page_spans(text, page_stable=True, page_count=2)

        self.assertEqual(spans, [
            {"page_number": 1, "page_start": 1, "page_end": 1},
            {"page_number": 2, "page_start": 2, "page_end": 2},
        ])

    def test_extract_table_page_spans_for_single_page_stable_source(self):
        text = "Intro\n<!-- TABLE_START -->\nCase | Station\n424 | KKP\n<!-- TABLE_END -->"

        spans = _extract_table_page_spans(text, page_stable=True, page_count=1)

        self.assertEqual(spans, [
            {"page_number": 1, "page_start": 1, "page_end": 1},
        ])

    def test_extract_table_page_spans_omits_unstable_sources(self):
        text = "Intro\n<!-- TABLE_START -->\nCase | Station\n424 | KKP\n<!-- TABLE_END -->"

        spans = _extract_table_page_spans(text, page_stable=False, page_count=1)

        self.assertEqual(spans, [])


if __name__ == "__main__":
    unittest.main()
