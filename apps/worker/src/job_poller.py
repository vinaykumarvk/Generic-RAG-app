"""Job poller — polls ingestion_job with SELECT FOR UPDATE SKIP LOCKED."""

import json
import time
import logging
import traceback
from .db import get_connection, get_cursor
from .config import config
from .pipeline.validator import validate_document
from .pipeline.normalizer import normalize_document
from .pipeline.chunker import chunk_document
from .pipeline.embedder import embed_chunks
from .pipeline.kg_extractor import extract_kg
from .pipeline.converter import convert_document
from .pipeline.metadata_extractor import extract_metadata
from .pipeline.pdf_splitter import split_document
from .pipeline.redactor import redact_document
from .pipeline.translator import translate_document

logger = logging.getLogger(__name__)


class NonRetryableJobError(Exception):
    """Raised when retrying cannot make a malformed queue row succeed."""


STEP_HANDLERS = {
    "VALIDATE": validate_document,
    "SPLIT": split_document,
    "NORMALIZE": normalize_document,
    "CONVERT": convert_document,
    "METADATA_EXTRACT": extract_metadata,
    "REDACT": redact_document,
    "TRANSLATE": translate_document,
    "CHUNK": chunk_document,
    "EMBED": embed_chunks,
    "KG_EXTRACT": extract_kg,
}


def _truncate_error(error: Exception | str) -> str:
    return str(error)[:2000]


def _failure_category(error: Exception) -> str:
    if isinstance(error, NonRetryableJobError):
        return "unknown_step"
    return "worker_exception"


def _reclaim_stale_processing_jobs(cur) -> None:
    """Recover worker-crashed PROCESSING rows whose locks have expired."""

    cur.execute(
        """
        WITH stale AS (
            SELECT job_id, attempt, max_attempts
            FROM ingestion_job
            WHERE status = 'PROCESSING'
              AND locked_until IS NOT NULL
              AND locked_until < now()
            ORDER BY locked_until ASC, created_at ASC
            LIMIT %s
            FOR UPDATE SKIP LOCKED
        ),
        updated_jobs AS (
            UPDATE ingestion_job AS job
            SET status = CASE
                  WHEN stale.attempt >= stale.max_attempts THEN 'DEAD_LETTER'
                  ELSE 'RETRYING'
                END,
                locked_until = NULL,
                failure_category = 'stale_processing_lock',
                error_message = 'Worker lock expired before completion',
                reclaimed_at = CASE
                  WHEN stale.attempt < stale.max_attempts THEN now()
                  ELSE job.reclaimed_at
                END,
                dead_lettered_at = CASE
                  WHEN stale.attempt >= stale.max_attempts THEN now()
                  ELSE job.dead_lettered_at
                END,
                updated_at = now()
            FROM stale
            WHERE job.job_id = stale.job_id
            RETURNING job.document_id, job.status
        )
        UPDATE document AS doc
        SET status = 'FAILED',
            error_message = 'Worker lock expired before completion',
            updated_at = now()
        FROM updated_jobs
        WHERE doc.document_id = updated_jobs.document_id
          AND updated_jobs.status = 'DEAD_LETTER'
        """,
        (config.JOB_STALE_REAPER_BATCH_SIZE,),
    )


# State transition map: step -> (next_step, doc_status_while_processing, doc_status_after_completion)
STEP_TRANSITIONS = {
    "VALIDATE": ("SPLIT", "VALIDATING", "VALIDATED"),
    "SPLIT": ("NORMALIZE", "SPLITTING", "NORMALIZING"),
    "NORMALIZE": ("CONVERT", "NORMALIZING", "CONVERTING"),
    "CONVERT": ("METADATA_EXTRACT", "CONVERTING", "METADATA_EXTRACTING"),
    "METADATA_EXTRACT": ("REDACT", "METADATA_EXTRACTING", "REDACTING"),
    "REDACT": ("TRANSLATE", "REDACTING", "TRANSLATING"),
    "TRANSLATE": ("CHUNK", "TRANSLATING", "TRANSLATED"),
    "CHUNK": ("EMBED", "CHUNKING", "CHUNKED"),
    "EMBED": (None, "EMBEDDING", "SEARCHABLE"),
    "KG_EXTRACT": (None, "KG_EXTRACTING", "ACTIVE"),
}


def _kg_extraction_enabled(cur) -> bool:
    cur.execute("SELECT enabled FROM feature_flag WHERE name = 'kg_extraction'")
    flag = cur.fetchone()
    return bool(flag and flag["enabled"])


def poll_once():
    """Poll for one pending job and process it."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            _reclaim_stale_processing_jobs(cur)

            cur.execute("""
                SELECT job_id, document_id, workspace_id, step, attempt, max_attempts, metadata
                FROM ingestion_job
                WHERE status IN ('PENDING', 'RETRYING')
                  AND (locked_until IS NULL OR locked_until < now())
                ORDER BY priority DESC, created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            """)
            job = cur.fetchone()

            if not job:
                return False

            job_id = job["job_id"]
            doc_id = job["document_id"]
            workspace_id = job["workspace_id"]
            step = job["step"]
            attempt = job["attempt"] + 1
            # Propagate job metadata (e.g. chunking_strategy) to subsequent steps
            job_metadata = job.get("metadata") or {}
            if isinstance(job_metadata, str):
                try:
                    job_metadata = json.loads(job_metadata)
                except (json.JSONDecodeError, TypeError):
                    job_metadata = {}

            logger.info(f"Processing job {job_id}: step={step}, doc={doc_id}, attempt={attempt}")

            # Mark job as processing
            cur.execute("""
                UPDATE ingestion_job
                SET status = 'PROCESSING', attempt = %s, started_at = now(), updated_at = now(),
                    locked_until = now() + make_interval(mins => %s)
                WHERE job_id = %s
            """, (attempt, config.JOB_LOCK_TIMEOUT_MINUTES, job_id))

            # Update document status
            transition = STEP_TRANSITIONS.get(step)
            if transition:
                cur.execute("UPDATE document SET status = %s, updated_at = now() WHERE document_id = %s",
                           (transition[1], doc_id))

            conn.commit()

    # Process outside the lock
    try:
        handler = STEP_HANDLERS.get(step)
        if not handler:
            raise NonRetryableJobError(f"Unknown step: {step}")

        handler(doc_id, workspace_id)

        with get_connection() as conn:
            with get_cursor(conn) as cur:
                # Mark job completed
                cur.execute("""
                    UPDATE ingestion_job
                    SET status = 'COMPLETED',
                        progress = 100,
                        completed_at = now(),
                        locked_until = NULL,
                        failure_category = NULL,
                        updated_at = now()
                    WHERE job_id = %s
                """, (job_id,))

                transition = STEP_TRANSITIONS.get(step)
                if transition:
                    next_step = transition[0]
                    completion_doc_status = transition[2]

                    # If SPLIT step completed and the splitter set SPLIT_COMPLETE,
                    # the parent doc should not proceed — children handle their own pipeline.
                    if step == "SPLIT":
                        cur.execute("SELECT status FROM document WHERE document_id = %s", (doc_id,))
                        doc_row = cur.fetchone()
                        if doc_row and doc_row["status"] == "SPLIT_COMPLETE":
                            logger.info("Document %s was split; skipping NORMALIZE for parent", doc_id)
                            conn.commit()
                            return True

                    # Reflect the completed step. The next step is only marked active once claimed.
                    cur.execute("UPDATE document SET status = %s, updated_at = now() WHERE document_id = %s",
                               (completion_doc_status, doc_id))

                    # Create next job if there's a next step (propagate metadata for chunking_strategy etc.)
                    metadata_json = json.dumps(job_metadata) if job_metadata else "{}"
                    if next_step:
                        cur.execute("""
                            INSERT INTO ingestion_job (document_id, workspace_id, step, status, metadata)
                            VALUES (%s, %s, %s, 'PENDING', %s)
                        """, (doc_id, workspace_id, next_step, metadata_json))
                    elif step == "EMBED" and _kg_extraction_enabled(cur):
                        cur.execute("""
                            INSERT INTO ingestion_job (document_id, workspace_id, step, status, metadata)
                            VALUES (%s, %s, 'KG_EXTRACT', 'PENDING', %s)
                        """, (doc_id, workspace_id, metadata_json))

                conn.commit()

        logger.info(f"Job {job_id} completed: step={step}")
        return True

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}\n{traceback.format_exc()}")

        with get_connection() as conn:
            with get_cursor(conn) as cur:
                max_attempts = int(job.get("max_attempts") or config.MAX_RETRIES)
                message = _truncate_error(e)
                category = _failure_category(e)
                should_dead_letter = isinstance(e, NonRetryableJobError) or attempt >= max_attempts

                if should_dead_letter:
                    terminal_category = category if isinstance(e, NonRetryableJobError) else "max_attempts_exceeded"
                    cur.execute("""
                        UPDATE ingestion_job
                        SET status = 'DEAD_LETTER',
                            error_message = %s,
                            failure_category = %s,
                            locked_until = NULL,
                            dead_lettered_at = now(),
                            updated_at = now()
                        WHERE job_id = %s
                    """, (message, terminal_category, job_id))
                    cur.execute("""
                        UPDATE document SET status = 'FAILED', error_message = %s, updated_at = now()
                        WHERE document_id = %s
                    """, (message, doc_id))
                else:
                    backoff_seconds = 2 ** attempt * 5
                    cur.execute("""
                        UPDATE ingestion_job
                        SET status = 'RETRYING',
                            error_message = %s,
                            failure_category = %s,
                            updated_at = now(),
                            locked_until = now() + make_interval(secs => %s)
                        WHERE job_id = %s
                    """, (message, category, backoff_seconds, job_id))
                conn.commit()

        return True


def run_poller(worker_name: str = "job-poller"):
    """Main polling loop."""
    logger.info("%s started (interval=%ss)", worker_name, config.POLL_INTERVAL_S)
    while True:
        try:
            had_work = poll_once()
            if not had_work:
                time.sleep(config.POLL_INTERVAL_S)
        except Exception as e:
            logger.error("%s error: %s\n%s", worker_name, e, traceback.format_exc())
            time.sleep(config.POLL_INTERVAL_S * 2)
