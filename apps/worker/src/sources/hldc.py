"""HLDC corpus normalization helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class HldcRecord:
    source_case_id: str
    text: str
    language: str
    commercial_safe: bool
    license_classification: str
    metadata: dict[str, Any]


def normalize_hldc_record(raw: dict[str, Any]) -> HldcRecord:
    """Normalize one HLDC JSON record and enforce non-commercial partitioning."""

    source_case_id = str(raw.get("id") or raw.get("case_id") or raw.get("doc_id") or "")
    if not source_case_id:
        raise ValueError("HLDC record missing stable id")

    text = str(raw.get("text") or raw.get("body") or raw.get("judgment") or "")
    if not text.strip():
        raise ValueError("HLDC record missing text")

    return HldcRecord(
        source_case_id=source_case_id,
        text=text,
        language=str(raw.get("language") or "hi"),
        commercial_safe=False,
        license_classification="non_commercial",
        metadata=dict(raw),
    )

