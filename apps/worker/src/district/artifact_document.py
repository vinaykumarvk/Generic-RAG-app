"""District judgment storage (Stage 1) and processing (Stage 2).

Fetching and processing are deliberately decoupled:

* **Stage 1** (`store_fetched_artifact`) — store the raw fetched bytes in cloud
  storage and record a `district_text_artifact` row with `document_id = NULL`.
  No document or ingestion job is created, so the (rate-limited, paid) fetch
  path does not block on the (CPU/LLM-heavy) ingestion pipeline.
* **Stage 2** (`process_stored_artifact`) — create the `document` + `ingestion_job`
  for one stored artifact and link `document_id` back. Triggered on demand.
"""

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


def store_fetched_artifact(cur, case: dict[str, Any], payload: DistrictArtifactPayload) -> dict[str, str]:
    """Stage 1: store raw fetched bytes in cloud storage and record the artifact.

    No document row or ingestion job is created here — see module docstring.
    The data needed to build the document later is stashed under
    ``metadata.document_build`` so Stage 2 does not have to re-derive it.
    """

    storage_key = str(uuid.uuid4())
    checksum = hashlib.sha256(payload.content).hexdigest()
    file_path = storage_client.upload_document(
        str(case["workspace_id"]),
        storage_key,
        payload.file_name,
        payload.content,
        content_type=payload.mime_type,
    )
    gcs_uri = file_path if file_path.startswith("gs://") else None

    document_build = {
        "title": _document_title(case, payload),
        "file_name": payload.file_name,
        "mime_type": payload.mime_type,
        "file_size_bytes": len(payload.content),
        "file_path": file_path,
        "gcs_uri": gcs_uri,
        "sha256": checksum,
        "sensitivity_level": _sensitivity_level(case),
        "language": payload.language or "unknown",
        "source_url": payload.source_url,
        "source_name": payload.source_name,
        "metadata": _document_metadata(case, payload, checksum),
    }
    artifact_metadata = {"provider": payload.metadata, "document_build": document_build}

    cur.execute(
        """
        INSERT INTO district_text_artifact (
          workspace_id, district_case_id, document_id, artifact_type, source_name,
          source_url, storage_uri, mime_type, language, ocr_required,
          redaction_status, translation_status, license_classification,
          commercial_safe, checksum_sha256, metadata
        )
        VALUES (%s, %s, NULL, %s, %s, %s, %s, %s, %s, %s,
                'pending', %s, %s, %s, %s, %s)
        RETURNING district_text_artifact_id
        """,
        (
            case["workspace_id"],
            case["district_case_id"],
            payload.artifact_type,
            payload.source_name,
            payload.source_url,
            file_path,
            payload.mime_type,
            payload.language,
            payload.mime_type == "application/pdf",
            "pending" if payload.language and payload.language.lower() not in {"en", "english"} else "not_required",
            payload.license_classification,
            payload.commercial_safe,
            checksum,
            json.dumps(artifact_metadata, default=str),
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

    return {
        "district_text_artifact_id": artifact_id,
        "storage_uri": file_path,
        "checksum_sha256": checksum,
        "stage": "stored",
    }


def process_stored_artifact(cur, artifact: dict[str, Any]) -> dict[str, str]:
    """Stage 2: create the document + ingestion job for one stored artifact.

    ``artifact`` is a ``district_text_artifact`` row whose ``metadata`` carries
    the ``document_build`` block written by Stage 1. Links ``document_id`` back
    to the artifact and enqueues the existing ingestion pipeline.
    """

    metadata = artifact.get("metadata") or {}
    build = metadata.get("document_build") or {}
    workspace_id = artifact["workspace_id"]
    artifact_id = artifact["district_text_artifact_id"]
    district_case_id = artifact["district_case_id"]
    document_id = str(uuid.uuid4())

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
            workspace_id,
            build.get("title") or "District Court judgment",
            build.get("file_name") or f"{artifact.get('source_name')}-{district_case_id}.pdf",
            build.get("mime_type") or artifact.get("mime_type") or "application/pdf",
            build.get("file_size_bytes"),
            build.get("file_path") or artifact.get("storage_uri"),
            build.get("sha256") or artifact.get("checksum_sha256"),
            build.get("source_url") or artifact.get("source_url"),
            json.dumps(build.get("metadata") or {}, default=str),
            ["district-court", artifact.get("source_name")],
            build.get("gcs_uri"),
            build.get("sensitivity_level") or "INTERNAL",
            build.get("language") or artifact.get("language") or "unknown",
        ),
    )

    cur.execute(
        "UPDATE district_text_artifact SET document_id = %s WHERE district_text_artifact_id = %s",
        (document_id, artifact_id),
    )

    cur.execute(
        """
        INSERT INTO ingestion_job (document_id, workspace_id, step, status, metadata)
        VALUES (%s, %s, 'VALIDATE', 'PENDING', %s)
        """,
        (
            document_id,
            workspace_id,
            json.dumps({
                "source": "district_judgment_process",
                "district_case_id": str(district_case_id),
                "district_text_artifact_id": str(artifact_id),
                "source_name": artifact.get("source_name"),
            }),
        ),
    )

    cur.execute(
        """
        UPDATE district_case
        SET text_status = 'text_ready', updated_at = now()
        WHERE district_case_id = %s
          AND text_status NOT IN ('text_ready','blocked','dead')
        """,
        (district_case_id,),
    )

    return {"document_id": document_id, "district_text_artifact_id": str(artifact_id)}


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
