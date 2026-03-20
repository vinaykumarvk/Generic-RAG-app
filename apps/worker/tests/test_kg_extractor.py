import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from langextract.core import data as lx_core_data

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pipeline import kg_extractor  # noqa: E402


class KgExtractorTests(unittest.TestCase):
    def test_gpt5_models_use_max_completion_tokens(self):
        params = kg_extractor._build_langextract_openai_api_params(
            model_id="gpt-5.2",
            prompt="Extract entities",
            normalized_config={"max_output_tokens": 321, "temperature": 0.2},
            default_temperature=None,
            format_type=lx_core_data.FormatType.JSON,
        )

        self.assertEqual(params["max_completion_tokens"], 321)
        self.assertNotIn("max_tokens", params)
        self.assertEqual(params["temperature"], 0.2)
        self.assertEqual(params["response_format"], {"type": "json_object"})

    def test_gpt4_models_keep_max_tokens(self):
        params = kg_extractor._build_langextract_openai_api_params(
            model_id="gpt-4o",
            prompt="Extract entities",
            normalized_config={"max_output_tokens": 111},
            default_temperature=0.3,
            format_type=lx_core_data.FormatType.JSON,
        )

        self.assertEqual(params["max_tokens"], 111)
        self.assertNotIn("max_completion_tokens", params)
        self.assertEqual(params["temperature"], 0.3)

    def test_lx_extract_falls_back_to_direct_json_extraction(self):
        fallback = [kg_extractor._FallbackExtraction("Shaik Shahid Pasha", "person", "Officer")]
        with patch.object(kg_extractor, "_patch_langextract_openai_provider"), \
                patch.object(kg_extractor.lx, "extract", side_effect=RuntimeError("resolver failed")), \
                patch.object(kg_extractor, "_extract_with_direct_json_fallback", return_value=fallback) as fallback_call:
            result = kg_extractor._lx_extract("sample text", "sample prompt", [])

        self.assertEqual(result, fallback)
        fallback_call.assert_called_once_with("sample text", "sample prompt", [])

    def test_lx_extract_uses_gemini_for_kg_when_configured(self):
        with patch.object(kg_extractor.config, "KG_LLM_PROVIDER", "gemini"), \
                patch.object(kg_extractor.config, "KG_MODEL_ID", "gemini-2.0-flash"), \
                patch.object(kg_extractor.config, "GEMINI_API_KEY", "gemini-key"), \
                patch.object(kg_extractor.lx, "extract", return_value=[]) as lx_extract, \
                patch.object(kg_extractor, "_patch_langextract_openai_provider") as openai_patch:
            result = kg_extractor._lx_extract("sample text", "sample prompt", [])

        self.assertEqual(result, [])
        openai_patch.assert_not_called()
        self.assertEqual(lx_extract.call_args.kwargs["model_id"], "gemini-2.0-flash")
        self.assertEqual(lx_extract.call_args.kwargs["api_key"], "gemini-key")
        self.assertTrue(lx_extract.call_args.kwargs["use_schema_constraints"])
        self.assertIsNone(lx_extract.call_args.kwargs["fence_output"])

    def test_direct_json_fallback_uses_gemini_when_configured(self):
        payload = {
            "extractions": [
                {
                    "extraction_text": "Lallaguda Police Station",
                    "extraction_class": "organization",
                    "description": "Police station",
                }
            ]
        }
        with patch.object(kg_extractor.config, "KG_LLM_PROVIDER", "gemini"), \
                patch.object(kg_extractor, "_call_gemini_json", return_value=payload) as call_gemini:
            result = kg_extractor._extract_with_direct_json_fallback("sample text", "sample prompt", [])

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].extraction_text, "Lallaguda Police Station")
        self.assertEqual(result[0].extraction_class, "organization")
        call_gemini.assert_called_once()


if __name__ == "__main__":
    unittest.main()
