import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pipeline import ocr_provider  # noqa: E402


class OcrProviderTests(unittest.TestCase):
    def test_ocr_pdf_falls_back_to_pytesseract_when_document_ai_fails(self):
        with patch.object(ocr_provider, "_document_ai_enabled", return_value=True), \
                patch.object(ocr_provider, "_ocr_document_ai", side_effect=RuntimeError("docai down")), \
                patch.object(ocr_provider, "_ocr_pytesseract_pdf", return_value=("fallback text", 2)) as pytesseract_ocr, \
                patch.object(ocr_provider, "_update_ocr_metadata") as update_metadata:
            text, page_count = ocr_provider.ocr_pdf("/tmp/sample.pdf", "doc-1")

        self.assertEqual(text, "fallback text")
        self.assertEqual(page_count, 2)
        pytesseract_ocr.assert_called_once_with("/tmp/sample.pdf")
        update_metadata.assert_called_once_with("doc-1", None)

    def test_ocr_pdf_pages_backfills_blank_document_ai_pages(self):
        with patch.object(ocr_provider, "_document_ai_enabled", return_value=True), \
                patch.object(
                    ocr_provider,
                    "_ocr_document_ai_pages",
                    return_value=({0: "docai page 1", 1: "", 2: "   "}, 0.84),
                ), \
                patch.object(
                    ocr_provider,
                    "_ocr_pytesseract_pdf_pages",
                    return_value={1: "fallback page 2", 2: "fallback page 3"},
                ) as pytesseract_ocr, \
                patch.object(ocr_provider, "_update_ocr_metadata") as update_metadata:
            results = ocr_provider.ocr_pdf_pages("/tmp/sample.pdf", "doc-2", [0, 1, 2])

        self.assertEqual(results[0], "docai page 1")
        self.assertEqual(results[1], "fallback page 2")
        self.assertEqual(results[2], "fallback page 3")
        pytesseract_ocr.assert_called_once_with("/tmp/sample.pdf", [1, 2])
        update_metadata.assert_called_once_with("doc-2", 0.84)

    def test_ocr_image_falls_back_when_document_ai_returns_blank_text(self):
        with patch.object(ocr_provider, "_document_ai_enabled", return_value=True), \
                patch.object(ocr_provider, "_ocr_document_ai", return_value=("   ", 1)), \
                patch.object(ocr_provider, "_ocr_pytesseract_image", return_value=("image fallback", 1)) as pytesseract_ocr, \
                patch.object(ocr_provider, "_update_ocr_metadata") as update_metadata:
            text, page_count = ocr_provider.ocr_image("/tmp/image.png", "doc-3", "image/png")

        self.assertEqual(text, "image fallback")
        self.assertEqual(page_count, 1)
        pytesseract_ocr.assert_called_once_with("/tmp/image.png")
        update_metadata.assert_called_once_with("doc-3", None)


if __name__ == "__main__":
    unittest.main()
