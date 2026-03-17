"""Job poller — polls ingestion_job with SELECT FOR UPDATE SKIP LOCKED."""

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

logger = logging.getLogger(__name__)

STEP_HANDLERS = {
    "VALIDATE": validate_document,
    "NORMALIZE": normalize_document,
    "CHUNK": chunk_document,
    "EMBED": embed_chunks,
    "KG_EXTRACT": extract_kg,
}

# State transition map: step → (next_step, doc_status_after_step, doc_status_during_next)
STEP_TRANSITIONS = {
    "VALIDATE": ("NORMALIZE", "VALIDATING", "NORMALIZING"),
    "NORMALIZE": ("CHUNK", "NORMALIZING", "CHUNKING"),
    "CHUNK": ("EMBED", "CHUNKING", "EMBEDDING"),
    "EMBED": (None, "EMBEDDING", "SEARCHABLE"),
}


def poll_once():
    """Poll for one pending job and process it."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT job_id, document_id, workspace_id, step, attempt, max_attempts
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

            logger.info(f"Processing job {job_id}: step={step}, doc={doc_id}, attempt={attempt}")

            # Mark job as processing
            cur.execute("""
                UPDATE ingestion_job
                SET status = 'PROCESSING', attempt = %s, started_at = now(), updated_at = now(),
                    locked_until = now() + interval '5 minutes'
                WHERE job_id = %s
            """, (attempt, job_id))

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
            raise ValueError(f"Unknown step: {step}")

        handler(doc_id, workspace_id)

        with get_connection() as conn:
            with get_cursor(conn) as cur:
                # Mark job completed
                cur.execute("""
                    UPDATE ingestion_job
                    SET status = 'COMPLETED', progress = 100, completed_at = now(), updated_at = now()
                    WHERE job_id = %s
                """, (job_id,))

                transition = STEP_TRANSITIONS.get(step)
                if transition:
                    next_step = transition[0]
                    next_doc_status = transition[2]

                    # Update document status
                    cur.execute("UPDATE document SET status = %s, updated_at = now() WHERE document_id = %s",
                               (next_doc_status, doc_id))

                    # Create next job if there's a next step
                    if next_step:
                        cur.execute("""
                            INSERT INTO ingestion_job (document_id, workspace_id, step, status)
                            VALUES (%s, %s, %s, 'PENDING')
                        """, (doc_id, workspace_id, next_step))
                    else:
                        # Check if KG extraction is enabled
                        cur.execute("SELECT enabled FROM feature_flag WHERE name = 'kg_extraction'")
                        flag = cur.fetchone()
                        if flag and flag["enabled"]:
                            cur.execute("""
                                INSERT INTO ingestion_job (document_id, workspace_id, step, status)
                                VALUES (%s, %s, 'KG_EXTRACT', 'PENDING')
                            """, (doc_id, workspace_id))
                            cur.execute("UPDATE document SET status = 'KG_EXTRACTING', updated_at = now() WHERE document_id = %s",
                                       (doc_id,))

                conn.commit()

        logger.info(f"Job {job_id} completed: step={step}")
        return True

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}\n{traceback.format_exc()}")

        with get_connection() as conn:
            with get_cursor(conn) as cur:
                max_attempts = config.MAX_RETRIES
                if attempt >= max_attempts:
                    cur.execute("""
                        UPDATE ingestion_job
                        SET status = 'FAILED', error_message = %s, updated_at = now()
                        WHERE job_id = %s
                    """, (str(e)[:2000], job_id))
                    cur.execute("""
                        UPDATE document SET status = 'FAILED', error_message = %s, updated_at = now()
                        WHERE document_id = %s
                    """, (str(e)[:2000], doc_id))
                else:
                    cur.execute("""
                        UPDATE ingestion_job
                        SET status = 'RETRYING', error_message = %s, updated_at = now(),
                            locked_until = now() + interval '%s seconds'
                        WHERE job_id = %s
                    """, (str(e)[:2000], 2 ** attempt * 5, job_id))
                conn.commit()

        return True


def run_poller():
    """Main polling loop."""
    logger.info(f"Job poller started (interval={config.POLL_INTERVAL_S}s)")
    while True:
        try:
            had_work = poll_once()
            if not had_work:
                time.sleep(config.POLL_INTERVAL_S)
        except Exception as e:
            logger.error(f"Poller error: {e}\n{traceback.format_exc()}")
            time.sleep(config.POLL_INTERVAL_S * 2)
