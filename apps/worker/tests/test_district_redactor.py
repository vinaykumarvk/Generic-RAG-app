import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pipeline.redactor import (  # noqa: E402
    extract_sensitive_flags,
    redact_text,
    requires_protected_redaction,
)


class DistrictRedactorTests(unittest.TestCase):
    def test_redacts_common_identifiers_without_exposing_values(self):
        text = (
            "Victim name: Jane Doe appeared. Phone 9876543210, "
            "email jane@example.com, Aadhaar 1234 5678 9012, PAN ABCDE1234F."
        )

        redacted, entries = redact_text(text)

        self.assertNotIn("Jane Doe", redacted)
        self.assertNotIn("9876543210", redacted)
        self.assertNotIn("jane@example.com", redacted)
        self.assertNotIn("1234 5678 9012", redacted)
        self.assertNotIn("ABCDE1234F", redacted)
        self.assertGreaterEqual(len(entries), 5)
        self.assertTrue(all(entry.original_hash and entry.redacted_hash for entry in entries))

    def test_detects_protected_flags_from_nested_metadata(self):
        flags = extract_sensitive_flags(
            {"judgment": {"sensitive_data_flags": ["victim_identity"]}},
            {"district": {"sensitive_data_flags": ["minor_identity"]}},
        )

        self.assertEqual(flags, ["minor_identity", "victim_identity"])
        self.assertTrue(requires_protected_redaction(flags))

    def test_non_sensitive_metadata_does_not_require_protected_redaction(self):
        self.assertFalse(requires_protected_redaction(["public_record"]))


if __name__ == "__main__":
    unittest.main()

