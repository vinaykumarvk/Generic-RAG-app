"""Create linked document and artifact rows for fetched district judgments."""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from typing import Any

from ..storage import storage_client


@dataclass(frozen=True)
class DistrictArtifactPayload:
    content: bytes
    file_name: str
    mime_type: str
    artifact_type: str
    source_name: str
    source_url: str | None
    language: str | None = None
    license_text: str | None = None
    license_classification: str = "internal_only"
    commercial_safe: bool = False
    source_case_id: str | None = None
    dataset_version: str = "live-fetch"
    metadata: dict[str, Any] = field(default_factory=dict)


def create_document_for_artifact(cur, case: dict[str, Any], payload: DistrictArtifactPayload) -> dict[str, str]:
    """Persist fetched content as a document and district text artifact."""

    document_id = str(uuid.uuid4())
    checksum = hashlib.sha256(payload.content).hexdigest()
    file_path = storage_client.upload_document(
        str(case["workspace_id"]),
        document_id,
        payload.file_name,
        payload.content,
        content_type=payload.mime_type,
    )
    gcs_uri = file_path if file_path.startswith("gs://") else None
    file_size = len(payload.content)
    title = _document_title(case, payload)
    metadata = _document_metadata(case, payload, checksum)
    sensitivity_level = _sensitivity_level(case)

    cur.execute(
        """
        INSERT INTO document (
          document_id, workspace_id, title, file_name, mime_type, file_size_bytes,
          file_path, sha256, category, subcategory, source_path, metadata,
          custom_tags, gcs_uri, sensitivity_level, language
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'judgment', 'district_court',
                %s, %s, %s, %s, %s, %s)
        """,
        (
            document_id,
            case["workspace_id"],
            title,
            payload.file_name,
            payload.mime_type,
            file_size,
            file_path,
            checksum,
            payload.source_url,
            json.dumps(metadata, default=str),
            ["district-court", payload.source_name],
            gcs_uri,
            sensitivity_level,
            payload.language or "unknown",
        ),
    )

    cur.execute(
        """
        INSERT INTO district_text_artifact (
          workspace_id, district_case_id, document_id, artifact_type, source_name,
          source_url, storage_uri, mime_type, language, ocr_required,
          redaction_status, translation_status, license_classification,
          commercial_safe, checksum_sha256, metadata
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                'pending', %s, %s, %s, %s, %s)
        RETURNING district_text_artifact_id
        """,
        (
            case["workspace_id"],
            case["district_case_id"],
            document_id,
            payload.artifact_type,
            payload.source_name,
            payload.source_url,
            gcs_uri or file_path,
            payload.mime_type,
            payload.language,
            payload.mime_type == "application/pdf",
            "pending" if payload.language and payload.language.lower() not in {"en", "english"} else "not_required",
            payload.license_classification,
            payload.commercial_safe,
            checksum,
            json.dumps(payload.metadata, default=str),
        ),
    )
    artifact_id = str(cur.fetchone()["district_text_artifact_id"])

    cur.execute(
        """
        INSERT INTO district_case_source (
          workspace_id, district_case_id, source_name, source_url, source_case_id,
          license, license_classification, dataset_version, retrieved_at,
          checksum_sha256, raw_storage_uri, commercial_safe, metadata
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now(), %s, %s, %s, %s)
        ON CONFLICT (workspace_id, source_name, dataset_version, source_case_id)
        DO UPDATE SET
          retrieved_at = EXCLUDED.retrieved_at,
          checksum_sha256 = EXCLUDED.checksum_sha256,
          raw_storage_uri = EXCLUDED.raw_storage_uri,
          metadata = district_case_source.metadata || EXCLUDED.metadata
        """,
        (
            case["workspace_id"],
            case["district_case_id"],
            payload.source_name,
            payload.source_url,
            payload.source_case_id or case.get("cnr") or case.get("source_case_id"),
            payload.license_text,
            payload.license_classification,
            payload.dataset_version,
            checksum,
            gcs_uri or file_path,
            payload.commercial_safe,
            json.dumps(payload.metadata, default=str),
        ),
    )

    cur.execute(
        """
        INSERT INTO ingestion_job (document_id, workspace_id, step, status, metadata)
        VALUES (%s, %s, 'VALIDATE', 'PENDING', %s)
        """,
        (
            document_id,
            case["workspace_id"],
            json.dumps({
                "source": "district_judgment_fetch",
                "district_case_id": str(case["district_case_id"]),
                "district_text_artifact_id": artifact_id,
                "source_name": payload.source_name,
            }),
        ),
    )

    return {
        "document_id": document_id,
        "district_text_artifact_id": artifact_id,
        "file_path": file_path,
        "checksum_sha256": checksum,
    }


def _document_title(case: dict[str, Any], payload: DistrictArtifactPayload) -> str:
    cnr = case.get("cnr") or case.get("source_case_id") or "district-case"
    court = case.get("court_name") or case.get("court_level") or "District Court"
    return f"{court} judgment {cnr} ({payload.source_name})"


def _document_metadata(case: dict[str, Any], payload: DistrictArtifactPayload, checksum: str) -> dict[str, Any]:
    return {
        "source": "district_judgment_fetch",
        "district": {
            "district_case_id": str(case.get("district_case_id")),
            "cnr": case.get("cnr"),
            "source_case_id": case.get("source_case_id"),
            "state_code": case.get("state_code"),
            "state_name": case.get("state_name"),
            "district_code": case.get("district_code"),
            "district_name": case.get("district_name"),
            "court_code": case.get("court_code"),
            "court_name": case.get("court_name"),
            "court_level": case.get("court_level"),
            "case_type": case.get("case_type"),
            "decision_date": _stringify(case.get("decision_date")),
            "disposition": case.get("disposition"),
            "acts_cited": case.get("acts_cited") or [],
            "sections_cited": case.get("sections_cited") or [],
            "offence_categories": case.get("offence_categories") or [],
            "sensitive_data_flags": case.get("sensitive_data_flags") or [],
            "source_license": payload.license_text,
            "source_uri": payload.source_url,
            "license_classification": payload.license_classification,
            "commercial_safe": payload.commercial_safe,
            "checksum_sha256": checksum,
        },
        "provider": payload.metadata,
    }


def _sensitivity_level(case: dict[str, Any]) -> str:
    categories = {str(value).lower() for value in case.get("offence_categories") or []}
    flags = {str(value).lower() for value in case.get("sensitive_data_flags") or []}
    if categories & {"child_sexual_offence", "rape", "sexual_assault", "sexual_offence", "juvenile_justice"}:
        return "RESTRICTED"
    if flags:
        return "RESTRICTED"
    return "INTERNAL"


def _stringify(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)
