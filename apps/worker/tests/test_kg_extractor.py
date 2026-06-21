import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from langextract.core import data as lx_core_data

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pipeline import kg_extractor  # noqa: E402


JUDGMENT_ONTOLOGY = {
    "version": "judgment-legal-ontology-v1",
    "domain": "Indian criminal judgments and police court-readiness analysis",
    "nodeTypes": [
        {"type": "judgment", "label": "Judgment"},
        {"type": "party", "label": "Party"},
        {"type": "outcome", "label": "Outcome"},
    ],
    "edgeTypes": [
        {"type": "outcome_for_party", "label": "Outcome for party", "directed": True},
        {"type": "supports_acquittal", "label": "Supports acquittal", "directed": True},
        {"type": "outcome_caused_by", "label": "Outcome caused by", "directed": True},
        {"type": "non_compliance_with", "label": "Non-compliance with", "directed": True},
        {"type": "lapse_caused_doubt", "label": "Lapse caused doubt", "directed": True},
        {"type": "concerns_issue", "label": "Concerns issue", "directed": True},
        {"type": "follows", "label": "Follows", "directed": True},
        {"type": "distinguishes", "label": "Distinguishes", "directed": True},
    ],
    "assertionTypes": ["finding_of_law", "outcome_reason"],
    "extractionRules": [
        "Do not treat a party submission as a court finding.",
        "High-risk causal edges require a quoted source span.",
    ],
    "phase0EvidenceContract": {"pilotScope": {"domain": "NDPS Section 50"}},
}


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

    def test_workspace_ontology_loads_judgment_settings(self):
        class FakeCursor:
            def execute(self, *_args, **_kwargs):
                return None

            def fetchone(self):
                return {
                    "settings": {
                        "workspaceKind": "judgments",
                        "kgOntologyVersion": "judgment-legal-ontology-v1",
                        "kgOntology": JUDGMENT_ONTOLOGY,
                    }
                }

        @contextmanager
        def fake_connection():
            yield object()

        @contextmanager
        def fake_cursor(_conn):
            yield FakeCursor()

        with patch.object(kg_extractor, "get_connection", fake_connection), \
                patch.object(kg_extractor, "get_cursor", fake_cursor):
            ontology = kg_extractor._get_workspace_ontology("workspace-1")

        self.assertEqual(ontology["version"], "judgment-legal-ontology-v1")
        self.assertIn({"type": "judgment", "label": "Judgment"}, ontology["nodeTypes"])
        self.assertTrue(kg_extractor._is_closed_schema_ontology(ontology))

    def test_judgment_relationship_prompt_is_closed_schema(self):
        prompt = kg_extractor._build_relationship_prompt(JUDGMENT_ONTOLOGY, ["State", "Accused"])

        self.assertIn("outcome_for_party", prompt)
        self.assertIn("Do not introduce new relationship types", prompt)
        self.assertIn("High-risk causal edges require a quoted source span.", prompt)

    def test_closed_schema_relationship_extraction_rejects_unknown_edges(self):
        extractions = [
            kg_extractor._FallbackExtraction(
                "State invented_relation Accused",
                "invented_relation",
                "Unsupported edge type",
            ),
            kg_extractor._FallbackExtraction(
                "State supports acquittal Accused",
                "supports_acquittal",
                "Court found the lapse created doubt",
            ),
        ]

        edges = kg_extractor._convert_extractions_to_edges(
            extractions,
            "chunk-1",
            ["State", "Accused"],
            {"supports_acquittal"},
            closed_schema=True,
        )

        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["type"], "supports_acquittal")
        self.assertTrue(edges[0]["high_impact"])
        self.assertEqual(edges[0]["review_status"], "needs_review")
        self.assertIn("quote", edges[0]["source_span"])

    def test_judgment_ontology_uses_legal_few_shots(self):
        entity_examples = kg_extractor._build_entity_examples(JUDGMENT_ONTOLOGY)
        relationship_examples = kg_extractor._build_relationship_examples(JUDGMENT_ONTOLOGY)

        entity_text = " ".join(example.text for example in entity_examples)
        relationship_classes = {
            extraction.extraction_class
            for example in relationship_examples
            for extraction in example.extractions
        }

        self.assertIn("Section 50", entity_text)
        self.assertIn("Sessions Court", entity_text)
        self.assertIn("outcome_caused_by", relationship_classes)
        self.assertIn("non_compliance_with", relationship_classes)
        self.assertIn("denies_relief", relationship_classes)
        self.assertIn("sentenced_to", relationship_classes)


if __name__ == "__main__":
    unittest.main()
