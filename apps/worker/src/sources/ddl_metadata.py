"""Development Data Lab district-court metadata loader."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Iterator
import csv
import hashlib
import json

import psycopg2.extras

from ..district.criminal_filter import (
    classify_case,
    load_filter_config,
    normalize_acts,
    normalize_sections,
    normalize_text_list,
    offence_categories,
    sensitive_flags,
)


@dataclass(frozen=True)
class DistrictCaseRecord:
    """Normalized metadata-only district case."""

    source_case_id: str
    cnr: str | None
    source_name: str
    metadata_source: str
    dataset_version: str
    state_code: int | None
    state_name: str | None
    district_code: int | None
    district_name: str | None
    court_no: int | None
    court_code: str | None
    court_name: str | None
    court_level: str | None
    case_type: str | None
    filing_date: date | None
    registration_date: date | None
    decision_date: date | None
    disposition: str | None
    purpose_name: str | None
    judge_position: str | None
    bailable: bool | None
    under_trial: bool | None
    acts_cited: tuple[str, ...]
    sections_cited: tuple[str, ...]
    offence_categories: tuple[str, ...]
    is_criminal_target: bool
    source_confidence: float
    commercial_safe: bool
    license_classification: str
    sensitive_data_flags: tuple[str, ...]
    source_payload: dict[str, Any]

    def row_checksum(self) -> str:
        payload = json.dumps(self.source_payload, sort_keys=True, default=str)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def normalize_ddl_row(
    row: dict[str, Any],
    *,
    filter_config: dict[str, Any] | None = None,
    dataset_version: str = "ddl-unknown",
) -> DistrictCaseRecord:
    """Normalize one DDL row into the district metadata contract."""

    cfg = filter_config or load_filter_config()
    matches = classify_case(row, cfg)
    forced_criminal = _as_bool(row.get("force_criminal_target"))
    override_categories = normalize_text_list(row.get("offence_category_override"))
    source_case_id = _first_text(row, "ddl_case_id", "case_id", "cino", "cnr")
    if not source_case_id:
        source_case_id = _stable_source_id(row)

    cnr = _first_text(row, "cino", "cnr")
    state_code = _as_int(row.get("state_code"))
    district_code = _as_int(row.get("district_code") or row.get("dist_code"))
    court_no = _as_int(row.get("court_no"))
    judge_position = _first_text(row, "judge_position")
    case_type = _first_text(row, "case_type", "type_name_s", "type_name")
    court_level = infer_court_level(judge_position, case_type)

    return DistrictCaseRecord(
        source_case_id=source_case_id,
        cnr=cnr,
        source_name="ddl",
        metadata_source="ddl",
        dataset_version=dataset_version,
        state_code=state_code,
        state_name=_first_text(row, "state_name") or _state_name_from_config(state_code, cfg),
        district_code=district_code,
        district_name=_first_text(row, "district_name"),
        court_no=court_no,
        court_code=_court_code(state_code, district_code, court_no),
        court_name=_first_text(row, "court_name"),
        court_level=court_level,
        case_type=case_type,
        filing_date=_as_date(row.get("filing_date") or row.get("date_of_filing")),
        registration_date=_as_date(row.get("registration_date")),
        decision_date=_as_date(row.get("decision_date") or row.get("date_of_decision")),
        disposition=_first_text(row, "disp_name_s", "disp_name", "disposition"),
        purpose_name=_first_text(row, "purpose_name_s", "purpose_name"),
        judge_position=judge_position,
        bailable=_as_bool(row.get("bailable")),
        under_trial=_as_bool(row.get("under_trial")),
        acts_cited=tuple(normalize_acts(row.get("act") or row.get("acts_cited"))),
        sections_cited=tuple(normalize_sections(row.get("section") or row.get("sections_cited"))),
        offence_categories=tuple(_dedupe([*offence_categories(matches), *override_categories])),
        is_criminal_target=bool(matches) or bool(forced_criminal),
        source_confidence=1.0,
        commercial_safe=True,
        license_classification="commercial_safe",
        sensitive_data_flags=tuple(sensitive_flags(matches)),
        source_payload=dict(row),
    )


def infer_court_level(judge_position: str | None, case_type: str | None = None) -> str | None:
    """Infer broad district-court level from DDL labels."""

    text = " ".join(part for part in [judge_position, case_type] if part).lower()
    if not text:
        return None
    if "pocso" in text:
        return "special_pocso"
    if "session" in text or "sessions" in text:
        return "sessions"
    if "magistrate" in text or re_search(r"\bjmfc\b|\bcjm\b|\bmm\b", text):
        return "magistrate"
    if "family" in text:
        return "family"
    return "district"


def build_count_report(records: Iterable[DistrictCaseRecord]) -> dict[str, Any]:
    """Build a compact metadata count report for pilot validation."""

    total = 0
    criminal = 0
    missing_cnr = 0
    by_state: Counter[str] = Counter()
    by_district: Counter[str] = Counter()
    by_court_level: Counter[str] = Counter()
    by_year: Counter[str] = Counter()
    by_statute: Counter[str] = Counter()
    by_section: Counter[str] = Counter()
    by_offence: Counter[str] = Counter()
    by_disposition: Counter[str] = Counter()
    by_source: Counter[str] = Counter()
    by_license: Counter[str] = Counter()
    for record in records:
        total += 1
        if record.is_criminal_target:
            criminal += 1
        if not record.cnr:
            missing_cnr += 1
        by_state[str(record.state_code or "unknown")] += 1
        by_district[str(record.district_code or "unknown")] += 1
        by_court_level[record.court_level or "unknown"] += 1
        by_year[str(record.decision_date.year if record.decision_date else "unknown")] += 1
        by_disposition[record.disposition or "unknown"] += 1
        by_source[record.source_name] += 1
        by_license[record.license_classification] += 1
        for act in record.acts_cited:
            by_statute[act] += 1
        for section in record.sections_cited:
            by_section[section] += 1
        for category in record.offence_categories:
            by_offence[category] += 1

    return {
        "total_rows": total,
        "criminal_target_rows": criminal,
        "missing_cnr_rows": missing_cnr,
        "missing_cnr_rate": (missing_cnr / total) if total else 0,
        "by_state_code": dict(by_state),
        "by_district_code": dict(by_district),
        "by_court_level": dict(by_court_level),
        "by_decision_year": dict(by_year),
        "by_statute": dict(by_statute),
        "by_section": dict(by_section),
        "by_offence_category": dict(by_offence),
        "by_disposition": dict(by_disposition),
        "by_source": dict(by_source),
        "by_license_classification": dict(by_license),
    }


def iter_csv_rows(path: str | Path) -> Iterator[dict[str, Any]]:
    """Yield source rows from a CSV file."""

    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def iter_duckdb_rows(paths: list[str], *, table_expression: str | None = None) -> Iterator[dict[str, Any]]:
    """Yield rows from Parquet/CSV files using DuckDB.

    DuckDB is imported lazily so unit tests and lightweight deployments can use
    the normalizer without the bulk-load dependency.
    """

    import duckdb

    expression = table_expression
    if not expression:
        quoted = ", ".join("'" + path.replace("'", "''") + "'" for path in paths)
        reader = "read_parquet" if all(path.endswith(".parquet") for path in paths) else "read_csv_auto"
        expression = f"{reader}([{quoted}], union_by_name=true)"

    conn = duckdb.connect(database=":memory:")
    try:
        result = conn.execute(f"SELECT * FROM {expression}")
        columns = [col[0] for col in result.description]
        while True:
            rows = result.fetchmany(10_000)
            if not rows:
                break
            for row in rows:
                yield dict(zip(columns, row))
    finally:
        conn.close()


def upsert_records(conn: Any, workspace_id: str, records: list[DistrictCaseRecord]) -> int:
    """Bulk upsert district metadata records into ``district_case``."""

    if not records:
        return 0

    values = [
        (
            workspace_id,
            record.cnr,
            record.source_case_id,
            record.source_name,
            record.metadata_source,
            record.dataset_version,
            record.state_code,
            record.state_name,
            record.district_code,
            record.district_name,
            record.court_no,
            record.court_code,
            record.court_name,
            record.court_level,
            record.case_type,
            record.filing_date,
            record.registration_date,
            record.decision_date,
            record.disposition,
            record.purpose_name,
            record.judge_position,
            record.bailable,
            record.under_trial,
            list(record.acts_cited),
            list(record.sections_cited),
            list(record.offence_categories),
            record.is_criminal_target,
            record.source_confidence,
            record.commercial_safe,
            record.license_classification,
            list(record.sensitive_data_flags),
            json.dumps(record.source_payload, default=str),
        )
        for record in records
    ]

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO district_case (
              workspace_id, cnr, source_case_id, source_name, metadata_source,
              dataset_version, state_code, state_name, district_code, district_name,
              court_no, court_code, court_name, court_level, case_type,
              filing_date, registration_date, decision_date, disposition, purpose_name,
              judge_position, bailable, under_trial, acts_cited, sections_cited,
              offence_categories, is_criminal_target, source_confidence, commercial_safe,
              license_classification, sensitive_data_flags, source_payload
            ) VALUES %s
            ON CONFLICT (workspace_id, source_name, dataset_version, source_case_id)
            DO UPDATE SET
              cnr = EXCLUDED.cnr,
              state_code = EXCLUDED.state_code,
              state_name = EXCLUDED.state_name,
              district_code = EXCLUDED.district_code,
              district_name = EXCLUDED.district_name,
              court_no = EXCLUDED.court_no,
              court_code = EXCLUDED.court_code,
              court_name = EXCLUDED.court_name,
              court_level = EXCLUDED.court_level,
              case_type = EXCLUDED.case_type,
              filing_date = EXCLUDED.filing_date,
              registration_date = EXCLUDED.registration_date,
              decision_date = EXCLUDED.decision_date,
              disposition = EXCLUDED.disposition,
              purpose_name = EXCLUDED.purpose_name,
              judge_position = EXCLUDED.judge_position,
              bailable = EXCLUDED.bailable,
              under_trial = EXCLUDED.under_trial,
              acts_cited = EXCLUDED.acts_cited,
              sections_cited = EXCLUDED.sections_cited,
              offence_categories = EXCLUDED.offence_categories,
              is_criminal_target = EXCLUDED.is_criminal_target,
              sensitive_data_flags = EXCLUDED.sensitive_data_flags,
              source_payload = EXCLUDED.source_payload,
              updated_at = now()
            """,
            values,
        )
    return len(records)


def _first_text(row: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text and text.lower() not in {"none", "nan", "null"}:
            return text
    return None


def _dedupe(values: Iterable[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value).strip()
        if not text:
            continue
        key = text.lower()
        if key not in seen:
            seen.add(key)
            result.append(text)
    return result


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return None


def _as_bool(value: Any) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"true", "t", "1", "yes", "y"}:
        return True
    if text in {"false", "f", "0", "no", "n"}:
        return False
    return None


def _as_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    return None


def _state_name_from_config(state_code: int | None, cfg: dict[str, Any]) -> str | None:
    states = ((cfg.get("scope") or {}).get("states") or {}).get("include") or []
    for state in states:
        if _as_int(state.get("code")) == state_code:
            return str(state.get("name"))
    return None


def _court_code(state_code: int | None, district_code: int | None, court_no: int | None) -> str | None:
    if state_code is None and district_code is None and court_no is None:
        return None
    return "DC-" + "-".join(str(part) for part in (state_code, district_code, court_no) if part is not None)


def _stable_source_id(row: dict[str, Any]) -> str:
    payload = json.dumps(row, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def re_search(pattern: str, text: str) -> bool:
    import re

    return bool(re.search(pattern, text))
