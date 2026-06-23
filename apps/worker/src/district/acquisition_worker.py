"""District judgment acquisition worker."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict
from datetime import datetime
from typing import Any

from ..config import config
from ..db import get_connection, get_cursor
from ..sources.ecourts_district import ECourtsClient, next_retry_at
from ..sources.indian_kanoon_district import IndianKanoonClient
from .artifact_document import DistrictArtifactPayload, store_fetched_artifact
from .acquisition_queue import attempt_to_case_status
from .rate_governor import paused_sources

logger = logging.getLogger(__name__)


def _reclaim_stale_processing_rows(cur) -> None:
    """Recover district acquisition rows abandoned by a crashed worker."""

    cur.execute(
        """
        WITH stale AS (
            SELECT district_acquisition_queue_id, attempt_count, max_attempts
            FROM district_acquisition_queue
            WHERE status = 'processing'
              AND locked_until IS NOT NULL
              AND locked_until < now()
            ORDER BY locked_until ASC, created_at ASC
            LIMIT %s
            FOR UPDATE SKIP LOCKED
        )
        UPDATE district_acquisition_queue AS queue
        SET status = CASE
              WHEN stale.attempt_count >= stale.max_attempts THEN 'failed'
              ELSE 'rate_limited'
            END,
            locked_until = NULL,
            next_attempt_at = CASE
              WHEN stale.attempt_count >= stale.max_attempts THEN NULL
              ELSE now()
            END,
            error_message = 'District acquisition worker lock expired before completion',
            result_metadata = result_metadata || '{"failure_category":"stale_processing_lock"}'::jsonb,
            updated_at = now()
        FROM stale
        WHERE queue.district_acquisition_queue_id = stale.district_acquisition_queue_id
        """,
        (config.DISTRICT_ACQUISITION_STALE_REAPER_BATCH_SIZE,),
    )


def poll_once(source_clients: dict[str, Any] | None = None) -> bool:
    """Poll and process one district acquisition queue row."""

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            _reclaim_stale_processing_rows(cur)

            paused = sorted(paused_sources(cur))

            cur.execute(
                """
                SELECT q.district_acquisition_queue_id,
                       q.source_name AS queue_source_name,
                       q.attempt_count,
                       q.max_attempts,
                       q.requested_metadata,
                       dc.*
                FROM district_acquisition_queue q
                JOIN district_case dc ON dc.district_case_id = q.district_case_id
                WHERE q.status IN ('pending','rate_limited')
                  AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= now())
                  AND (q.locked_until IS NULL OR q.locked_until < now())
                  AND NOT (q.source_name = ANY(%s))
                ORDER BY q.priority DESC, q.created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                """,
                (paused,),
            )
            row = cur.fetchone()
            if not row:
                return False

            queue_id = row["district_acquisition_queue_id"]
            attempt_count = int(row["attempt_count"] or 0) + 1
            cur.execute(
                """
                UPDATE district_acquisition_queue
                SET status = 'processing',
                    attempt_count = %s,
                    last_attempt_at = now(),
                    locked_until = now() + make_interval(mins => %s),
                    updated_at = now()
                WHERE district_acquisition_queue_id = %s
                """,
                (attempt_count, config.DISTRICT_ACQUISITION_LOCK_TIMEOUT_MINUTES, queue_id),
            )
            conn.commit()

    source_name = row["queue_source_name"]
    logger.info("Processing district acquisition row %s source=%s", queue_id, source_name)

    try:
        result = _fetch_source(row, source_clients or {})
        _persist_result(row, result, attempt_count)
        return True
    except Exception as exc:  # pragma: no cover - defensive worker boundary
        logger.exception("District acquisition failed for queue row %s", queue_id)
        _persist_exception(row, exc, attempt_count)
        return True


def run_acquisition_poller(worker_name: str = "district-acquisition-poller"):
    logger.info("%s started (interval=%ss)", worker_name, config.DISTRICT_ACQUISITION_POLL_INTERVAL_S)
    while True:
        try:
            had_work = poll_once()
            if not had_work:
                time.sleep(config.DISTRICT_ACQUISITION_POLL_INTERVAL_S)
        except Exception:
            logger.exception("%s error", worker_name)
            time.sleep(config.DISTRICT_ACQUISITION_POLL_INTERVAL_S * 2)


def _fetch_source(row: dict[str, Any], source_clients: dict[str, Any]):
    source_name = row["queue_source_name"]
    if source_name == "indian_kanoon":
        return source_clients.get("indian_kanoon", IndianKanoonClient()).fetch_case(row)
    if source_name == "ecourts":
        return source_clients.get("ecourts", ECourtsClient()).fetch_case(row)
    if source_name == "hldc":
        return _blocked_result(
            "HLDC live lookup is not configured; bulk HLDC ingestion must run through the non-commercial corpus loader",
        )
    return _blocked_result(f"Unsupported district judgment source: {source_name}")


def _persist_result(row: dict[str, Any], result: Any, attempt_count: int):
    outcome = _safe_outcome(getattr(result, "outcome", "http_error"))
    source_name = row["queue_source_name"]
    metadata = _result_metadata(result)
    queue_status = _queue_status(outcome, attempt_count, int(row.get("max_attempts") or 3))
    error_message = getattr(result, "error_message", None)
    link_metadata: dict[str, Any] | None = None

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO district_fetch_attempt (
                  workspace_id, district_case_id, source_name, outcome, http_status,
                  bytes, captcha_outcome, cost_units, notes, metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    row["workspace_id"],
                    row["district_case_id"],
                    source_name,
                    outcome,
                    getattr(result, "http_status", None),
                    len(getattr(result, "content", b"") or b"") or None,
                    "required" if outcome == "captcha_required" else None,
                    getattr(result, "cost_units", None),
                    error_message,
                    json.dumps(metadata, default=str),
                ),
            )

            if outcome == "hit":
                payload = _artifact_payload(row, result)
                link_metadata = store_fetched_artifact(cur, row, payload)

            next_attempt = None
            if queue_status == "rate_limited":
                next_attempt = next_retry_at(attempt_count)

            cur.execute(
                """
                UPDATE district_acquisition_queue
                SET status = %s,
                    locked_until = NULL,
                    next_attempt_at = %s,
                    error_message = %s,
                    result_metadata = result_metadata || %s::jsonb,
                    updated_at = now()
                WHERE district_acquisition_queue_id = %s
                """,
                (
                    queue_status,
                    next_attempt,
                    error_message,
                    json.dumps({**metadata, **(link_metadata or {})}, default=str),
                    row["district_acquisition_queue_id"],
                ),
            )

            case_status = _case_status_for_attempt(source_name, outcome)
            if case_status:
                cur.execute(
                    """
                    UPDATE district_case
                    SET text_status = %s,
                        updated_at = now()
                    WHERE district_case_id = %s
                      AND text_status NOT IN ('text_ready','blocked','dead')
                    """,
                    (case_status, row["district_case_id"]),
                )


def _persist_exception(row: dict[str, Any], exc: Exception, attempt_count: int):
    max_attempts = int(row.get("max_attempts") or 3)
    status = "failed" if attempt_count >= max_attempts else "rate_limited"
    next_attempt = None if status == "failed" else next_retry_at(attempt_count)
    message = str(exc)[:2000]
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO district_fetch_attempt (
                  workspace_id, district_case_id, source_name, outcome, notes, metadata
                )
                VALUES (%s, %s, %s, 'http_error', %s, %s)
                """,
                (
                    row["workspace_id"],
                    row["district_case_id"],
                    row["queue_source_name"],
                    message,
                    json.dumps({"exception": type(exc).__name__}),
                ),
            )
            cur.execute(
                """
                UPDATE district_acquisition_queue
                SET status = %s,
                    locked_until = NULL,
                    next_attempt_at = %s,
                    error_message = %s,
                    updated_at = now()
                WHERE district_acquisition_queue_id = %s
                """,
                (status, next_attempt, message, row["district_acquisition_queue_id"]),
            )


def _artifact_payload(row: dict[str, Any], result: Any) -> DistrictArtifactPayload:
    source_name = row["queue_source_name"]
    mime_type = getattr(result, "mime_type", "text/plain")
    artifact_type = "source_pdf" if mime_type == "application/pdf" else "source_text"
    provider_document_id = getattr(result, "provider_document_id", None)
    license_text = "Indian Kanoon API ToS" if source_name == "indian_kanoon" else "eCourts public order, internal use"
    return DistrictArtifactPayload(
        content=getattr(result, "content"),
        file_name=getattr(result, "file_name") or f"{source_name}-{row.get('cnr') or row.get('source_case_id')}.txt",
        mime_type=mime_type,
        artifact_type=artifact_type,
        source_name=source_name,
        source_url=getattr(result, "source_url", None),
        language="en" if source_name == "indian_kanoon" else None,
        license_text=license_text,
        license_classification="internal_only",
        commercial_safe=False,
        source_case_id=provider_document_id or row.get("cnr") or row.get("source_case_id"),
        dataset_version=f"{source_name}-live",
        metadata=_result_metadata(result),
    )


def _queue_status(outcome: str, attempt_count: int, max_attempts: int) -> str:
    if outcome == "hit":
        return "succeeded"
    if outcome == "miss":
        return "miss"
    if outcome == "rate_limited":
        return "rate_limited" if attempt_count < max_attempts else "failed"
    if outcome in {"captcha_required", "captcha_failed", "blocked_by_policy"}:
        return "blocked"
    return "failed" if attempt_count >= max_attempts else "rate_limited"


def _case_status_for_attempt(source_name: str, outcome: str) -> str | None:
    if outcome == "blocked_by_policy" and source_name != "ecourts":
        return None
    if outcome == "http_error":
        return None
    return attempt_to_case_status(source_name, outcome)


def _safe_outcome(outcome: str) -> str:
    allowed = {
        "hit",
        "miss",
        "captcha_required",
        "captcha_failed",
        "rate_limited",
        "http_error",
        "ocr_failed",
        "blocked_by_policy",
        "duplicate",
    }
    return outcome if outcome in allowed else "http_error"


def _result_metadata(result: Any) -> dict[str, Any]:
    metadata = getattr(result, "metadata", None) or {}
    if hasattr(result, "__dataclass_fields__"):
        metadata = {**metadata, "result": {k: v for k, v in asdict(result).items() if k != "content"}}
    return metadata


def _blocked_result(message: str):
    class BlockedResult:
        outcome = "blocked_by_policy"
        error_message = message
        metadata = {"policy": "blocked_by_policy"}
        content = None
        http_status = None
        cost_units = None

    return BlockedResult()
