"""Deterministic redaction stage for sensitive district-court records."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import logging
import re
from typing import Any

from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)

PROTECTED_FLAGS = {
    "minor_identity",
    "victim_identity",
    "sexual_offence_detail",
    "sealed_record",
    "protected_witness",
}

# Offence-category keywords that imply protected handling even when a case row
# carries no explicit sensitive_data_flags. Matched as substrings (lower-cased)
# so "child_sexual_offence", "POCSO", "minor girl", etc. all resolve. This is the
# POCSO/rape/minor release-gate control: such judgments must not pass redaction
# as "not_required" purely because no PII pattern happened to match.
OFFENCE_PROTECTED_FLAGS = (
    (("child_sexual_offence", "pocso", "child victim", "minor"), ("minor_identity", "sexual_offence_detail")),
    (("rape", "sexual_assault", "sexual_offence", "prosecutrix", "molest"), ("victim_identity", "sexual_offence_detail")),
    (("juvenile", "juvenile_justice", "jj act"), ("minor_identity",)),
    (("sealed", "in_camera", "in camera"), ("sealed_record",)),
)


def derive_protected_flags(offence_categories: list[str] | tuple[str, ...] | set[str] | None) -> list[str]:
    """Map offence categories to protected redaction flags (substring match)."""

    haystack = [str(category).strip().lower() for category in (offence_categories or []) if str(category).strip()]
    flags: set[str] = set()
    for keywords, mapped in OFFENCE_PROTECTED_FLAGS:
        if any(keyword in category for keyword in keywords for category in haystack):
            flags.update(mapped)
    return sorted(flags)

REDACTION_RULES = (
    ("email", re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)),
    ("phone_number", re.compile(r"(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)")),
    ("aadhaar", re.compile(r"(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)")),
    ("pan", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    ("date_of_birth", re.compile(r"\b(?:DOB|Date of Birth)\s*[:\-]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", re.IGNORECASE)),
    ("victim_name_label", re.compile(r"\b(?:victim|prosecutrix|minor girl|child victim)\s+name\s*[:\-]\s*[A-Za-z][A-Za-z .]{1,80}", re.IGNORECASE)),
    ("address_label", re.compile(r"\baddress\s*[:\-]\s*[A-Za-z0-9][A-Za-z0-9, ./#-]{8,120}", re.IGNORECASE)),
)


@dataclass(frozen=True)
class RedactionEntry:
    rule_id: str
    replacement_count: int
    original_hash: str
    redacted_hash: str


def redact_text(text: str) -> tuple[str, list[RedactionEntry]]:
    """Apply deterministic redaction rules without logging raw matched PII."""

    redacted = text
    entries: list[RedactionEntry] = []
    for rule_id, pattern in REDACTION_RULES:
        before = redacted
        redacted, count = pattern.subn(f"[REDACTED:{rule_id}]", redacted)
        if count:
            entries.append(
                RedactionEntry(
                    rule_id=rule_id,
                    replacement_count=count,
                    original_hash=_hash_text(before),
                    redacted_hash=_hash_text(redacted),
                )
            )
    return redacted, entries


def requires_protected_redaction(flags: list[str] | tuple[str, ...] | set[str]) -> bool:
    return bool(PROTECTED_FLAGS.intersection(set(flags)))


def extract_sensitive_flags(*payloads: Any) -> list[str]:
    """Extract sensitive flags from nested metadata payloads."""

    flags: list[str] = []
    offences: list[str] = []
    for payload in payloads:
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                payload = {}
        if not isinstance(payload, dict):
            continue
        flags.extend(_as_list(payload.get("sensitive_data_flags")))
        offences.extend(_as_list(payload.get("offence_categories")))
        for nested_key in ("judgment", "district"):
            nested = payload.get(nested_key)
            if isinstance(nested, dict):
                flags.extend(_as_list(nested.get("sensitive_data_flags")))
                offences.extend(_as_list(nested.get("offence_categories")))
    flags.extend(derive_protected_flags(offences))
    return sorted(set(flag for flag in flags if flag))


def redact_document(document_id: str, workspace_id: str):
    """Insert a REDACTED_TEXT extraction result before chunking."""

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT er.content,
                       d.extracted_metadata,
                       d.metadata
                FROM extraction_result er
                JOIN document d ON d.document_id = er.document_id
                WHERE er.document_id = %s
                  AND er.extraction_type = 'TEXT'
                ORDER BY er.created_at DESC
                LIMIT 1
                """,
                (document_id,),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError(f"No TEXT extraction result for document {document_id}")

    source_text = row["content"]
    flags = extract_sensitive_flags(row.get("extracted_metadata"), row.get("metadata"))
    protected = requires_protected_redaction(flags)
    redacted_text, entries = redact_text(source_text)

    if protected and not entries:
        _flag_manual_review(workspace_id, document_id, flags)
        raise ValueError("Protected district-court record requires manual redaction review")

    status = "redacted" if entries else "not_required"
    metadata = {
        "redaction_status": status,
        "sensitive_data_flags": flags,
        "rules_applied": [entry.rule_id for entry in entries],
    }

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO extraction_result (document_id, extraction_type, content, metadata)
                VALUES (%s, 'REDACTED_TEXT', %s, %s)
                """,
                (document_id, redacted_text, json.dumps(metadata)),
            )
            for entry in entries:
                cur.execute(
                    """
                    INSERT INTO chunk_redaction_log (
                      workspace_id, document_id, rule_id, replacement_count,
                      original_hash, redacted_hash, metadata
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        workspace_id,
                        document_id,
                        entry.rule_id,
                        entry.replacement_count,
                        entry.original_hash,
                        entry.redacted_hash,
                        json.dumps({"stage": "document_redaction"}),
                    ),
                )
            cur.execute(
                """
                UPDATE document
                SET extracted_metadata = jsonb_set(
                      COALESCE(extracted_metadata, '{}'::jsonb),
                      '{redaction}',
                      %s::jsonb,
                      true
                    ),
                    updated_at = now()
                WHERE document_id = %s
                """,
                (json.dumps(metadata), document_id),
            )

    logger.info("Redaction complete for document %s: status=%s rules=%s", document_id, status, len(entries))


def _flag_manual_review(workspace_id: str, document_id: str, flags: list[str]):
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO review_queue (workspace_id, entity_type, entity_id, reason, details)
                VALUES (%s, 'DOCUMENT', %s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                (
                    workspace_id,
                    document_id,
                    "Protected district-court record requires manual redaction review",
                    json.dumps({"sensitive_data_flags": flags}),
                ),
            )
            cur.execute(
                "UPDATE document SET review_required = true, updated_at = now() WHERE document_id = %s",
                (document_id,),
            )


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, tuple):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    return [text] if text else []

