"""Wide-coverage seeding for district-court acquisition.

Two feeders populate ``district_acquisition_queue``:

1. :func:`seed_from_existing_cases` — enqueue the already-loaded ``district_case``
   universe (criminal targets not yet ``text_ready``). Highest confidence, no
   guessing; this is the primary wide-coverage path.
2. CNR enumeration helpers (:func:`format_cnr`, :func:`generate_cnr_candidates`)
   — generate candidate CNRs by state / establishment / court / year / sequence
   for cases absent from metadata. These are pure so they can be validated
   before any write; creating ``district_case`` rows from enumerated CNRs is a
   gated follow-up (it must validate against the portal to avoid polluting the
   case table), so this module deliberately does not insert cases.

Seeding is idempotent: the queue's ``UNIQUE (workspace_id, district_case_id,
source_name)`` constraint plus ``ON CONFLICT DO NOTHING`` makes re-runs safe.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..db import get_connection, get_cursor
from .acquisition_queue import queue_rows_for_case

logger = logging.getLogger(__name__)

_CASE_SELECT = """
    SELECT dc.district_case_id, dc.cnr, dc.state_code, dc.district_code,
           dc.case_type, dc.decision_date, dc.offence_categories,
           dc.is_criminal_target, dc.text_status
    FROM district_case dc
    WHERE dc.workspace_id = %(workspace_id)s
      AND dc.is_criminal_target = true
      AND dc.text_status NOT IN ('text_ready','blocked','dead')
      AND (%(state_code)s::int IS NULL OR dc.state_code = %(state_code)s::int)
      AND (%(year)s::int IS NULL OR EXTRACT(YEAR FROM dc.decision_date) = %(year)s::int)
      AND NOT EXISTS (
        SELECT 1 FROM district_acquisition_queue q
        WHERE q.district_case_id = dc.district_case_id
      )
    ORDER BY dc.decision_date DESC NULLS LAST
    LIMIT %(limit)s
"""

_QUEUE_INSERT = """
    INSERT INTO district_acquisition_queue
      (workspace_id, district_case_id, source_name, status, priority, requested_metadata)
    VALUES (%s, %s, %s, %s, %s, %s)
    ON CONFLICT (workspace_id, district_case_id, source_name) DO NOTHING
"""


def seed_from_existing_cases(
    workspace_id: str,
    filter_config: dict[str, Any],
    *,
    limit: int = 1000,
    state_code: int | None = None,
    year: int | None = None,
) -> int:
    """Enqueue acquisition rows for un-queued criminal-target cases. Returns count inserted.

    Always criminal-only (``is_criminal_target = true``). Optionally narrowed to a
    state and a judgement (decision) year — this is the state+year fetch driver.
    """

    inserted = 0
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                _CASE_SELECT,
                {"workspace_id": workspace_id, "state_code": state_code, "year": year, "limit": limit},
            )
            cases = cur.fetchall()
            for case in cases:
                rows = queue_rows_for_case(workspace_id, case["district_case_id"], dict(case), filter_config)
                inserted += _insert_rows(cur, rows)
    logger.info("Seeded %s acquisition rows for workspace %s (scanned %s cases)", inserted, workspace_id, len(cases))
    return inserted


def _insert_rows(cur, rows: list[tuple[Any, ...]]) -> int:
    count = 0
    for workspace_id, case_id, source_name, status, priority, metadata in rows:
        cur.execute(
            _QUEUE_INSERT,
            (workspace_id, case_id, source_name, status, priority, json.dumps(metadata, default=str)),
        )
        if cur.rowcount and cur.rowcount > 0:
            count += cur.rowcount
    return count


def format_cnr(state: str, establishment: str, court_code: int, sequence: int, year: int) -> str:
    """Build a 16-char CNR: state(2) + establishment(2) + court(2) + sequence(6) + year(4)."""

    state = str(state).strip().upper()
    establishment = str(establishment).strip().upper()
    if len(state) != 2 or len(establishment) != 2:
        raise ValueError("state and establishment must each be 2 characters")
    if not (0 <= court_code <= 99):
        raise ValueError("court_code must be a 2-digit value")
    return f"{state}{establishment}{court_code:02d}{sequence:06d}{year:04d}"


def generate_cnr_candidates(
    state: str,
    establishment: str,
    court_code: int,
    year: int,
    *,
    start: int = 1,
    count: int = 100,
) -> list[str]:
    """Generate a contiguous block of candidate CNRs for enumeration-based coverage."""

    if count < 0 or start < 1:
        raise ValueError("start must be >= 1 and count must be >= 0")
    return [format_cnr(state, establishment, court_code, seq, year) for seq in range(start, start + count)]


def _main(argv: list[str]) -> int:
    """CLI: ``python -m src.district.seeding <workspace_id> [limit]``."""

    from .criminal_filter import load_filter_config

    if not argv:
        print("usage: python -m src.district.seeding <workspace_id> [limit]")
        return 2
    workspace_id = argv[0]
    limit = int(argv[1]) if len(argv) > 1 else 1000
    queued = seed_from_existing_cases(workspace_id, load_filter_config(), limit=limit)
    print(json.dumps({"workspace_id": workspace_id, "queued": queued, "limit": limit}))
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(_main(sys.argv[1:]))
