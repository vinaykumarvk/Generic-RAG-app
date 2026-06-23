"""Stage 2: process stored district judgments into the ingestion pipeline.

Picks up artifacts stored by Stage 1 (``district_text_artifact`` rows with
``document_id IS NULL``) and processes them one at a time — each in its own
transaction so one failure doesn't abort the batch. Triggered on demand via the
``process`` batch job.
"""

from __future__ import annotations

import logging

from ..db import get_connection, get_cursor
from .artifact_document import process_stored_artifact

logger = logging.getLogger(__name__)

_SELECT_IDS = """
    SELECT district_text_artifact_id
    FROM district_text_artifact
    WHERE workspace_id = %s
      AND document_id IS NULL
      AND storage_uri IS NOT NULL
    ORDER BY created_at ASC
    LIMIT %s
"""

_LOCK_ROW = """
    SELECT district_text_artifact_id, workspace_id, district_case_id, source_name,
           source_url, storage_uri, mime_type, language, checksum_sha256, metadata
    FROM district_text_artifact
    WHERE district_text_artifact_id = %s
      AND document_id IS NULL
    FOR UPDATE SKIP LOCKED
"""


def process_stored_cases(workspace_id: str, *, limit: int = 100) -> dict[str, int]:
    """Process up to ``limit`` stored artifacts, one by one. Returns a summary."""

    ids = _select_stored_ids(workspace_id, limit)
    summary = {"selected": len(ids), "processed": 0, "errors": 0}
    for artifact_id in ids:
        try:
            if _process_one(artifact_id):
                summary["processed"] += 1
        except Exception:  # pragma: no cover - defensive per-item boundary
            logger.exception("Stage-2 processing failed for artifact %s", artifact_id)
            summary["errors"] += 1
    logger.info("Stage-2 processing for workspace %s: %s", workspace_id, summary)
    return summary


def _select_stored_ids(workspace_id: str, limit: int) -> list[str]:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(_SELECT_IDS, (workspace_id, limit))
            return [row["district_text_artifact_id"] for row in cur.fetchall()]


def _process_one(artifact_id: str) -> bool:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(_LOCK_ROW, (artifact_id,))
            row = cur.fetchone()
            if not row:
                return False
            process_stored_artifact(cur, dict(row))
            return True
