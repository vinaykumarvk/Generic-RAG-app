"""Enumeration-based district-case discovery.

Turns enumerated candidate CNRs into ``district_case`` rows — but only after the
eCourts portal confirms the CNR resolves to a real case. A guessed CNR that does
not resolve is never persisted, so the case table is not polluted with
non-existent records.

Flow per candidate:
  1. Skip if the CNR already exists for the workspace (any source).
  2. Probe the portal (``ECourtsClient.lookup_case_metadata``).
  3. On ``found``: classify via the criminal filter and upsert a metadata row.

Discovery hits the portal (CAPTCHA + throttle), so it is gated behind the same
flags as acquisition; with the portal disabled the client returns
``captcha_required`` and discovery stops early instead of probing blindly.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..db import get_connection, get_cursor
from ..sources.ecourts_district import ECourtsClient
from .criminal_filter import (
    classify_case,
    load_filter_config,
    normalize_acts,
    normalize_sections,
    offence_categories,
    sensitive_flags,
)
from .seeding import generate_cnr_candidates

logger = logging.getLogger(__name__)

_CASE_INSERT = """
    INSERT INTO district_case (
      workspace_id, cnr, source_case_id, source_name, metadata_source, dataset_version,
      state_code, case_type, filing_date, registration_date, decision_date, disposition,
      court_name, acts_cited, sections_cited, offence_categories, is_criminal_target,
      sensitive_data_flags, source_confidence, text_status, source_payload
    )
    VALUES (
      %(workspace_id)s, %(cnr)s, %(source_case_id)s, 'ecourts', 'ecourts_enumeration', 'ecourts-enumeration',
      %(state_code)s, %(case_type)s, %(filing_date)s, %(registration_date)s, %(decision_date)s, %(disposition)s,
      %(court_name)s, %(acts_cited)s, %(sections_cited)s, %(offence_categories)s, %(is_criminal_target)s,
      %(sensitive_data_flags)s, %(source_confidence)s, %(text_status)s, %(source_payload)s
    )
    ON CONFLICT (workspace_id, source_name, dataset_version, source_case_id) DO NOTHING
"""


def build_district_case_row(
    workspace_id: str, cnr: str, fields: dict[str, Any] | None, filter_config: dict[str, Any]
) -> dict[str, Any]:
    """Build an insert-ready district_case row from portal-parsed metadata (pure)."""

    fields = fields or {}
    matches = classify_case(fields, filter_config)
    is_target = bool(matches)
    return {
        "workspace_id": workspace_id,
        "cnr": cnr,
        "source_case_id": cnr,
        "state_code": _as_int(fields.get("state_code")),
        "case_type": fields.get("case_type"),
        "filing_date": fields.get("filing_date"),
        "registration_date": fields.get("registration_date"),
        "decision_date": fields.get("decision_date"),
        "disposition": fields.get("disposition"),
        "court_name": fields.get("court_name"),
        "acts_cited": normalize_acts(fields.get("acts")),
        "sections_cited": normalize_sections(fields.get("sections")),
        "offence_categories": offence_categories(matches),
        "is_criminal_target": is_target,
        "sensitive_data_flags": sensitive_flags(matches),
        "source_confidence": 0.85,
        "text_status": "targeted" if is_target else "metadata_only",
        "source_payload": json.dumps(fields, default=str),
    }


def discover_cases(
    workspace_id: str,
    *,
    state: str,
    establishment: str,
    court_code: int,
    year: int,
    start: int = 1,
    count: int = 100,
    client: ECourtsClient | None = None,
    filter_config: dict[str, Any] | None = None,
) -> dict[str, int]:
    """Probe a block of enumerated CNRs and persist the ones that resolve."""

    client = client or ECourtsClient()
    cfg = filter_config or load_filter_config()
    candidates = generate_cnr_candidates(state, establishment, court_code, year, start=start, count=count)
    summary = {"probed": 0, "found": 0, "inserted": 0, "not_found": 0, "skipped": 0, "errors": 0}

    existing = _existing_cnrs(workspace_id, candidates)
    pending_rows: list[dict[str, Any]] = []
    for cnr in candidates:
        if cnr in existing:
            summary["skipped"] += 1
            continue
        summary["probed"] += 1
        result = client.lookup_case_metadata(cnr)
        if result.outcome == "found":
            summary["found"] += 1
            pending_rows.append(build_district_case_row(workspace_id, cnr, result.fields, cfg))
        elif result.outcome == "not_found":
            summary["not_found"] += 1
        else:
            summary["errors"] += 1
            if result.outcome == "captcha_required":
                logger.warning("Stopping discovery: portal not enabled/authorized (%s)", result.error_message)
                break

    summary["inserted"] = _insert_cases(pending_rows)
    logger.info("Discovery for workspace %s: %s", workspace_id, summary)
    return summary


def _existing_cnrs(workspace_id: str, candidates: list[str]) -> set[str]:
    if not candidates:
        return set()
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT cnr FROM district_case WHERE workspace_id = %s AND cnr = ANY(%s)",
                (workspace_id, candidates),
            )
            return {row["cnr"] for row in cur.fetchall() if row.get("cnr")}


def _insert_cases(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    inserted = 0
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            for row in rows:
                cur.execute(_CASE_INSERT, row)
                if cur.rowcount and cur.rowcount > 0:
                    inserted += cur.rowcount
    return inserted


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _main(argv: list[str]) -> int:
    """CLI: ``python -m src.district.discovery <ws> <state> <est> <court> <year> [start] [count]``."""

    if len(argv) < 5:
        print("usage: python -m src.district.discovery <workspace_id> <state> <establishment> <court_code> <year> [start] [count]")
        return 2
    workspace_id, state, establishment, court_code, year = argv[:5]
    start = int(argv[5]) if len(argv) > 5 else 1
    count = int(argv[6]) if len(argv) > 6 else 100
    summary = discover_cases(
        workspace_id,
        state=state,
        establishment=establishment,
        court_code=int(court_code),
        year=int(year),
        start=start,
        count=count,
    )
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(_main(sys.argv[1:]))
