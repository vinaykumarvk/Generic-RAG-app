import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pipeline.translator import (  # noqa: E402
    LegalGlossary,
    OpenAITranslationProvider,
    TranslationProviderNotConfigured,
    build_translation_provider,
    build_translation_metadata,
    load_glossary,
    resolve_source_language,
    split_for_translation,
    translate_text,
)


class FakeProvider:
    name = "fake"
    model_name = "fake-model"
    provider_version = "v1"

    def translate_batch(self, texts, source_language, target_language, glossary):
        return [f"[{target_language}] {text}" for text in texts]


class DistrictTranslationTests(unittest.TestCase):
    def test_passthrough_for_english_preserves_text(self):
        glossary = LegalGlossary(version="test", target_language="en", terms=[])

        output = translate_text(
            "This is an English order.",
            source_language="en",
            target_language="en",
            glossary=glossary,
        )

        self.assertEqual(output.text, "This is an English order.")
        self.assertEqual(output.provider, "passthrough")
        self.assertEqual(output.confidence, 1.0)

    def test_non_english_requires_configured_provider(self):
        glossary = LegalGlossary(version="test", target_language="en", terms=[])

        with patch("src.pipeline.translator.build_translation_provider", return_value=None):
            with self.assertRaises(TranslationProviderNotConfigured):
                translate_text(
                    "Hindi text",
                    source_language="hi",
                    target_language="en",
                    glossary=glossary,
                )

    def test_provider_translation_tracks_segments_and_glossary_terms(self):
        glossary = LegalGlossary(
            version="test-glossary",
            target_language="en",
            terms=[{"source": "FIR", "target": "FIR"}],
        )

        output = translate_text(
            "FIR paragraph one.\n\nFIR paragraph two.",
            source_language="hi",
            target_language="en",
            glossary=glossary,
            provider=FakeProvider(),
        )

        self.assertIn("[en] FIR paragraph one.", output.text)
        self.assertEqual(output.provider, "fake")
        self.assertEqual(output.metadata["matched_glossary_terms"], ["FIR"])

    def test_openai_translation_provider_uses_openai_api_key(self):
        glossary = LegalGlossary(
            version="test-glossary",
            target_language="en",
            terms=[{"source": "जमानत", "target": "bail"}],
        )
        response = Mock()
        response.json.return_value = {
            "choices": [{"message": {"content": '{"translation":"The bail application is allowed."}'}}],
        }

        with patch("src.pipeline.translator.httpx.post", return_value=response) as post:
            provider = OpenAITranslationProvider(api_key="test-key", model_name="gpt-test")
            translations = provider.translate_batch(["जमानत आवेदन स्वीकार किया जाता है।"], "hi", "en", glossary)

        self.assertEqual(translations, ["The bail application is allowed."])
        request = post.call_args.kwargs
        self.assertEqual(request["headers"]["Authorization"], "Bearer test-key")
        self.assertEqual(request["json"]["model"], "gpt-test")
        self.assertEqual(request["json"]["response_format"], {"type": "json_object"})
        self.assertIn("जमानत", request["json"]["messages"][1]["content"])
        response.raise_for_status.assert_called_once()

    def test_build_translation_provider_accepts_chatgpt_alias(self):
        with patch("src.pipeline.translator.config.TRANSLATION_PROVIDER", "chatgpt"), \
             patch("src.pipeline.translator.config.OPENAI_API_KEY", "test-key"), \
             patch("src.pipeline.translator.config.TRANSLATION_OPENAI_MODEL", "gpt-test"):
            provider = build_translation_provider()

        self.assertIsInstance(provider, OpenAITranslationProvider)
        self.assertEqual(provider.api_key, "test-key")
        self.assertEqual(provider.model_name, "gpt-test")

    def test_build_translation_metadata_marks_provider_output_pending_by_default(self):
        glossary = LegalGlossary(version="test-glossary", target_language="en", terms=[])
        output = translate_text(
            "source",
            source_language="hi",
            target_language="en",
            glossary=glossary,
            provider=FakeProvider(),
        )

        metadata = build_translation_metadata(
            source_text="source",
            translated_text=output.text,
            source_language="hi",
            target_language="en",
            source_extraction_id="source-extraction",
            output=output,
            glossary=glossary,
        )

        self.assertEqual(metadata["source_language"], "hi")
        self.assertEqual(metadata["target_language"], "en")
        self.assertEqual(metadata["provider"], "fake")
        self.assertEqual(metadata["qa_status"], "pending")
        self.assertEqual(metadata["glossary_version"], "test-glossary")
        self.assertTrue(metadata["source_hash"])
        self.assertTrue(metadata["translated_hash"])

    def test_resolves_language_from_script_when_detector_defaults_to_english(self):
        language = resolve_source_language(
            "en",
            {"script": "devanagari"},
        )

        self.assertEqual(language, "hi")

    def test_split_for_translation_keeps_segments_under_limit(self):
        segments = split_for_translation("alpha\n\n" + "b" * 20 + "\n\nomega", max_chars=12)

        self.assertGreater(len(segments), 1)
        self.assertTrue(all(len(segment) <= 12 for segment in segments))

    def test_load_glossary_reads_yaml(self):
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as handle:
            handle.write("version: custom-v1\ntarget_language: en\nterms:\n  - source: FIR\n    target: FIR\n")
            path = handle.name

        glossary = load_glossary(path)

        self.assertEqual(glossary.version, "custom-v1")
        self.assertEqual(glossary.matched_terms("The FIR was filed."), ["FIR"])


if __name__ == "__main__":
    unittest.main()
