"""District batch-job worker.

Executes API-requested bulk operations recorded in ``district_batch_job``:

* ``seed``     -> :func:`seeding.seed_from_existing_cases`
* ``discover`` -> :func:`discovery.discover_cases`

The API only enqueues these jobs; this worker is the single executor so the
planner and portal/CAPTCHA logic live in one place (no cross-language drift).
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable

from ..config import config
from ..db import get_connection, get_cursor
from .criminal_filter import load_filter_config
from .discovery import discover_cases
from .processing import process_stored_cases
from .seeding import seed_from_existing_cases

logger = logging.getLogger(__name__)


def poll_batch_once(handlers: dict[str, Callable[..., Any]] | None = None) -> bool:
    """Claim and run one pending batch job. Returns True if work was processed."""

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT district_batch_job_id, workspace_id, job_type, params,
                       attempt_count, max_attempts
                FROM district_batch_job
                WHERE status = 'pending'
                  AND (locked_until IS NULL OR locked_until < now())
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                """
            )
            row = cur.fetchone()
            if not row:
                return False
            job_id = row["district_batch_job_id"]
            cur.execute(
                """
                UPDATE district_batch_job
                SET status = 'processing',
                    attempt_count = attempt_count + 1,
                    locked_until = now() + make_interval(mins => %s),
                    updated_at = now()
                WHERE district_batch_job_id = %s
                """,
                (config.DISTRICT_ACQUISITION_LOCK_TIMEOUT_MINUTES, job_id),
            )
            conn.commit()

    try:
        result = dispatch_batch_job(row, handlers or {})
        _finish(job_id, "succeeded", result, None)
    except Exception as exc:  # pragma: no cover - defensive worker boundary
        logger.exception("District batch job %s failed", job_id)
        _finish(job_id, "failed", {}, str(exc)[:2000])
    return True


def dispatch_batch_job(row: dict[str, Any], handlers: dict[str, Callable[..., Any]]) -> dict[str, Any]:
    """Route a batch-job row to its handler and return a JSON-serializable result."""

    job_type = row["job_type"]
    params = row.get("params") or {}
    workspace_id = str(row["workspace_id"])
    cfg = load_filter_config()

    if job_type == "seed":
        seed = handlers.get("seed", seed_from_existing_cases)
        queued = seed(
            workspace_id,
            cfg,
            limit=int(params.get("limit") or 1000),
            state_code=_optional_int(params.get("state_code")),
            year=_optional_int(params.get("year")),
        )
        return {"queued": queued}

    if job_type == "discover":
        discover = handlers.get("discover", discover_cases)
        return discover(
            workspace_id,
            state=params["state"],
            establishment=params["establishment"],
            court_code=int(params["court_code"]),
            year=int(params["year"]),
            start=int(params.get("start") or 1),
            count=int(params.get("count") or 100),
            filter_config=cfg,
        )

    if job_type == "process":
        process = handlers.get("process", process_stored_cases)
        return process(workspace_id, limit=int(params.get("limit") or 100))

    raise ValueError(f"Unsupported district batch job type: {job_type}")


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _finish(job_id: str, status: str, result: dict[str, Any], error: str | None) -> None:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE district_batch_job
                SET status = %s,
                    result = %s::jsonb,
                    error_message = %s,
                    locked_until = NULL,
                    updated_at = now()
                WHERE district_batch_job_id = %s
                """,
                (status, json.dumps(result, default=str), error, job_id),
            )


def run_batch_poller(worker_name: str = "district-batch-poller"):
    logger.info("%s started (interval=%ss)", worker_name, config.DISTRICT_ACQUISITION_POLL_INTERVAL_S)
    while True:
        try:
            if not poll_batch_once():
                time.sleep(config.DISTRICT_ACQUISITION_POLL_INTERVAL_S)
        except Exception:
            logger.exception("%s error", worker_name)
            time.sleep(config.DISTRICT_ACQUISITION_POLL_INTERVAL_S * 2)
