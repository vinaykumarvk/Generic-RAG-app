import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pipeline.table_semantics import (  # noqa: E402
    build_semantic_table_chunks,
    build_semantic_table_record,
    strip_table_json_blocks,
)


class TableSemanticsTests(unittest.TestCase):
    def test_build_semantic_table_record_generates_row_facts(self):
        record = build_semantic_table_record(
            {
                "headers": ["Name", "Role", "Station"],
                "rows": [
                    ["Ajeeth", "Witness", "Madhapur"],
                    ["Mujahid", "Accused", "Kukatpally"],
                ],
                "caption": "Persons of interest",
            },
            table_index=2,
        )

        self.assertEqual(record["metadata"]["table_index"], 2)
        self.assertEqual(record["metadata"]["headers"], ["Name", "Role", "Station"])
        self.assertEqual(record["metadata"]["header_keys"], ["name", "role", "station"])
        self.assertEqual(record["metadata"]["row_count"], 2)
        self.assertIn("Table 2: Persons of interest", record["content"])
        self.assertIn("Columns: Name; Role; Station.", record["content"])
        self.assertIn("Row 1. Name is Ajeeth. Role is Witness. Station is Madhapur.", record["content"])
        self.assertIn("Row 2. Name is Mujahid. Role is Accused. Station is Kukatpally.", record["content"])

    def test_build_semantic_table_record_normalizes_blank_and_duplicate_headers(self):
        record = build_semantic_table_record(
            {
                "headers": ["Date", "", "Date"],
                "rows": [["2024-01-01", "City Civil Court", "2024-02-01"]],
            },
            table_index=1,
        )

        self.assertEqual(record["metadata"]["headers"], ["Date", "Column 2", "Date"])
        self.assertEqual(record["metadata"]["header_keys"], ["date", "column_2", "date_2"])
        self.assertEqual(
            record["metadata"]["row_objects"][0]["cells"],
            [
                {"header": "Date", "key": "date", "value": "2024-01-01"},
                {"header": "Column 2", "key": "column_2", "value": "City Civil Court"},
                {"header": "Date", "key": "date_2", "value": "2024-02-01"},
            ],
        )

    def test_build_semantic_table_chunks_batches_rows(self):
        record = build_semantic_table_record(
            {
                "headers": ["Item", "Value"],
                "rows": [
                    ["Case Number", "424/2021"],
                    ["Police Station", "Kukatpally"],
                    ["Offence", "Murder"],
                ],
            },
            table_index=1,
        )

        chunks = build_semantic_table_chunks(record["metadata"], max_chars=2000, max_rows=2)

        self.assertEqual(len(chunks), 2)
        self.assertIn("Row 1. Item is Case Number. Value is 424/2021.", chunks[0])
        self.assertIn("Row 2. Item is Police Station. Value is Kukatpally.", chunks[0])
        self.assertNotIn("Row 3. Item is Offence. Value is Murder.", chunks[0])
        self.assertIn("Row 3. Item is Offence. Value is Murder.", chunks[1])

    def test_strip_table_json_blocks_removes_embedded_json_noise(self):
        text = (
            "Intro paragraph.\n\n"
            "[TABLE_JSON]\n{\n  \"headers\": [\"Case\", \"Station\"]\n}\n[/TABLE_JSON]\n\n"
            "Closing paragraph."
        )

        self.assertEqual(
            strip_table_json_blocks(text),
            "Intro paragraph.\n\nClosing paragraph.",
        )


if __name__ == "__main__":
    unittest.main()
