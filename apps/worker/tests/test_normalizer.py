import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pipeline import normalizer  # noqa: E402


class NormalizerTests(unittest.TestCase):
    def test_retry_full_pdf_ocr_resets_document_ai_client_after_blank_first_pass(self):
        with patch.object(normalizer, "_document_ai_enabled", return_value=True), \
                patch.object(normalizer, "ocr_pdf", side_effect=[("", 0), ("docai text", 2)]) as ocr_pdf, \
                patch.object(normalizer, "reset_document_ai_client") as reset_client:
            text, page_count = normalizer._retry_full_pdf_ocr("/tmp/sample.pdf", "doc-1", "", 0)

        self.assertEqual(text, "docai text")
        self.assertEqual(page_count, 2)
        self.assertEqual(ocr_pdf.call_count, 2)
        reset_client.assert_called_once_with()

    def test_retry_full_pdf_ocr_keeps_first_usable_full_ocr_result(self):
        with patch.object(normalizer, "_document_ai_enabled", return_value=True), \
                patch.object(normalizer, "ocr_pdf", return_value=("usable text", 2)) as ocr_pdf, \
                patch.object(normalizer, "reset_document_ai_client") as reset_client:
            text, page_count = normalizer._retry_full_pdf_ocr("/tmp/sample.pdf", "doc-2", "", 0)

        self.assertEqual(text, "usable text")
        self.assertEqual(page_count, 2)
        ocr_pdf.assert_called_once_with("/tmp/sample.pdf", "doc-2")
        reset_client.assert_not_called()

    def test_extract_doc_uses_antiword_when_available(self):
        with patch("shutil.which", side_effect=lambda cmd: "/usr/bin/antiword" if cmd == "antiword" else None), \
                patch(
                    "subprocess.run",
                    return_value=subprocess.CompletedProcess(
                        args=["antiword", "/tmp/sample.doc"],
                        returncode=0,
                        stdout="converted text",
                        stderr="",
                    ),
                ) as run:
            text, page_count = normalizer._extract_doc("/tmp/sample.doc")

        self.assertEqual(text, "converted text")
        self.assertEqual(page_count, 1)
        run.assert_called_once_with(
            ["antiword", "/tmp/sample.doc"],
            capture_output=True,
            text=True,
            timeout=60,
        )


if __name__ == "__main__":
    unittest.main()
