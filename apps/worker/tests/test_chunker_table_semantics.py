import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pipeline.chunker import _build_table_chunks  # noqa: E402


class ChunkerTableSemanticsTests(unittest.TestCase):
    def test_build_table_chunks_uses_semantic_metadata(self):
        table_extractions = [
            {
                "content": "fallback table content",
                "metadata": {
                    "table_index": 3,
                    "caption": "Arrest details",
                    "page_start": 7,
                    "page_end": 7,
                    "headers": ["Name", "Status"],
                    "row_objects": [
                        {
                            "row_index": 1,
                            "cells": [
                                {"header": "Name", "key": "name", "value": "Mujahid"},
                                {"header": "Status", "key": "status", "value": "Absconding"},
                            ],
                        },
                        {
                            "row_index": 2,
                            "cells": [
                                {"header": "Name", "key": "name", "value": "Firoz"},
                                {"header": "Status", "key": "status", "value": "Arrested"},
                            ],
                        },
                    ],
                },
            }
        ]

        chunks = _build_table_chunks(table_extractions, target_chars=300)

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0]["type"], "TABLE")
        self.assertEqual(chunks[0]["heading_path"], "Arrest details")
        self.assertEqual(chunks[0]["page_start"], 7)
        self.assertEqual(chunks[0]["page_end"], 7)
        self.assertIn("Table 3: Arrest details", chunks[0]["content"])
        self.assertIn("Row 1. Name is Mujahid. Status is Absconding.", chunks[0]["content"])
        self.assertIn("Row 2. Name is Firoz. Status is Arrested.", chunks[0]["content"])

    def test_build_table_chunks_falls_back_to_content_without_metadata(self):
        table_extractions = [
            {
                "content": "Table 1\n\nCase Number: 424/2021",
                "metadata": {},
            }
        ]

        chunks = _build_table_chunks(table_extractions, target_chars=300)

        self.assertEqual(chunks, [
            {
                "content": "Table 1\n\nCase Number: 424/2021",
                "type": "TABLE",
                "heading_path": "Table 1",
                "page_start": None,
                "page_end": None,
            }
        ])


if __name__ == "__main__":
    unittest.main()
