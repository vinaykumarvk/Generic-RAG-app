#!/usr/bin/env python3
"""Bootstrap district-court metadata from DDL files.

The command can run in report-only mode, or load into Cloud SQL when a
workspace ID and DATABASE_URL are configured.
"""

from __future__ import annotations

import argparse
import codecs
import csv
from itertools import product
import json
from pathlib import Path
import subprocess
import sys
import tarfile
from typing import Any, Iterable, Iterator
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.db import get_connection  # noqa: E402
from src.district.criminal_filter import classify_case, load_filter_config, sensitive_flags  # noqa: E402
from src.sources.ddl_metadata import (  # noqa: E402
    build_count_report,
    iter_csv_rows,
    iter_duckdb_rows,
    normalize_ddl_row,
    upsert_records,
)

DEFAULT_DDL_STATE_CODES = ("01", "03", "10", "13", "26")
DEFAULT_DDL_YEARS = ("2015", "2016", "2017", "2018")


class CountAccumulator:
    def __init__(self) -> None:
        self.report = build_count_report([])

    def add(self, records: Iterable[Any]) -> None:
        next_report = build_count_report(records)
        self.report["total_rows"] += next_report["total_rows"]
        self.report["criminal_target_rows"] += next_report["criminal_target_rows"]
        self.report["missing_cnr_rows"] += next_report["missing_cnr_rows"]
        total = self.report["total_rows"]
        self.report["missing_cnr_rate"] = (self.report["missing_cnr_rows"] / total) if total else 0
        for key, value in next_report.items():
            if not key.startswith("by_"):
                continue
            target = self.report.setdefault(key, {})
            for bucket, count in value.items():
                target[bucket] = target.get(bucket, 0) + count


def _parse_csv_option(value: str, defaults: tuple[str, ...]) -> set[str]:
    if not value:
        return set(defaults)
    return {part.strip().zfill(2) if part.strip().isdigit() and len(part.strip()) < 2 else part.strip() for part in value.split(",") if part.strip()}


@contextmanager
def _open_binary(source: str):
    if source.startswith(("http://", "https://")):
        proc = subprocess.Popen(["curl", "-L", "--fail", "-s", source], stdout=subprocess.PIPE)
        if proc.stdout is None:
            raise RuntimeError("curl stdout was not available")
        try:
            yield proc.stdout
        finally:
            proc.stdout.close()
            return_code = proc.wait()
            if return_code not in (0, 23, 56):
                raise RuntimeError(f"curl failed for {source} with exit code {return_code}")
    else:
        with open(source, "rb") as handle:
            yield handle


def _stream_tar_csv(source: str, wanted_basenames: set[str] | None = None) -> Iterator[tuple[str, dict[str, str]]]:
    with _open_binary(source) as handle:
        with tarfile.open(fileobj=handle, mode="r|gz") as archive:
            for member in archive:
                if not member.isfile():
                    continue
                basename = Path(member.name).name
                if wanted_basenames and basename not in wanted_basenames:
                    continue
                extracted = archive.extractfile(member)
                if extracted is None:
                    continue
                reader = csv.DictReader(codecs.iterdecode(extracted, "utf-8-sig"))
                for row in reader:
                    yield basename, row


def _load_key_map(path: Path, key_columns: tuple[str, ...], value_column: str) -> dict[tuple[str, ...], str]:
    result: dict[tuple[str, ...], str] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            key = tuple(_clean_code(row.get(column)) for column in key_columns)
            value = (row.get(value_column) or "").strip()
            if value:
                result[key] = value
    return result


def _load_key_maps(key_dir: str) -> dict[str, dict[tuple[str, ...], str]]:
    root = Path(key_dir)
    return {
        "act": _load_key_map(root / "act_key.csv", ("act",), "act_s"),
        "section": _load_key_map(root / "section_key.csv", ("section",), "section_s"),
        "state": _load_key_map(root / "cases_state_key.csv", ("year", "state_code"), "state_name"),
        "district": _load_key_map(root / "cases_district_key.csv", ("year", "state_code", "dist_code"), "district_name"),
        "court": _load_key_map(root / "cases_court_key.csv", ("year", "state_code", "dist_code", "court_no"), "court_name"),
        "type": _load_key_map(root / "type_name_key.csv", ("year", "type_name"), "type_name_s"),
        "purpose": _load_key_map(root / "purpose_name_key.csv", ("year", "purpose_name"), "purpose_name_s"),
        "disposition": _load_key_map(root / "disp_name_key.csv", ("year", "disp_name"), "disp_name_s"),
    }


def _clean_code(value: Any) -> str:
    text = "" if value is None else str(value).strip().strip('"')
    if text.endswith(".0"):
        text = text[:-2]
    return text


def _case_year(source_case_id: str) -> str:
    return source_case_id[-4:] if len(source_case_id) >= 4 else ""


def _case_state_code(source_case_id: str) -> str:
    return source_case_id.split("-", 1)[0].zfill(2)


def _lookup(mapping: dict[tuple[str, ...], str], *keys: Any) -> str | None:
    variants = [_code_variants(key) for key in keys]
    for candidate in product(*variants):
        value = mapping.get(candidate)
        if value:
            return value
    return None


def _code_variants(value: Any) -> tuple[str, ...]:
    cleaned = _clean_code(value)
    values = [cleaned]
    if cleaned.isdigit():
        values.extend([str(int(cleaned)), cleaned.zfill(2)])
    deduped = list(dict.fromkeys(values))
    return tuple(deduped)


def _build_act_section_index(
    source: str,
    *,
    key_maps: dict[str, dict[tuple[str, ...], str]],
    filter_config: dict[str, Any],
    state_codes: set[str],
    years: set[str],
    ddl_criminal_flag_only: bool = False,
) -> dict[str, dict[str, set[str]]]:
    index: dict[str, dict[str, set[str]]] = {}
    scanned = 0
    matched = 0
    for _, row in _stream_tar_csv(source, {"acts_sections.csv"}):
        scanned += 1
        if scanned % 1_000_000 == 0:
            print(f"scanned_act_section_rows={scanned} matched_act_section_rows={matched}", flush=True)
        case_id = _clean_code(row.get("ddl_case_id"))
        if not case_id:
            continue
        if _case_year(case_id) not in years or _case_state_code(case_id) not in state_codes:
            continue
        criminal_flag = _clean_code(row.get("criminal"))
        is_ddl_criminal = criminal_flag in {"1", "1.0", "true", "True"}
        if ddl_criminal_flag_only and not is_ddl_criminal:
            continue
        if not ddl_criminal_flag_only and criminal_flag and not is_ddl_criminal:
            continue

        act = _lookup(key_maps["act"], row.get("act")) or _clean_code(row.get("act"))
        section = _lookup(key_maps["section"], row.get("section")) or _clean_code(row.get("section"))
        probe = {"act": act, "section": section}
        matches = [] if ddl_criminal_flag_only else classify_case(probe, filter_config)
        if not matches:
            if not ddl_criminal_flag_only:
                continue

        entry = index.setdefault(case_id, {"acts": set(), "sections": set(), "flags": set()})
        if act:
            entry["acts"].add(act)
        if section:
            entry["sections"].add(section)
        entry["flags"].update(sensitive_flags(matches))
        matched += 1
        if matched % 50_000 == 0:
            print(f"matched_act_section_rows={matched} scanned_act_section_rows={scanned}", flush=True)
    print(f"matched_act_section_rows={matched} scanned_act_section_rows={scanned}", flush=True)
    return index


def _decorate_case_row(
    row: dict[str, str],
    *,
    key_maps: dict[str, dict[tuple[str, ...], str]],
    act_section_index: dict[str, dict[str, set[str]]],
    ddl_criminal_flag_only: bool = False,
) -> dict[str, Any] | None:
    source_case_id = _clean_code(row.get("ddl_case_id"))
    act_section = act_section_index.get(source_case_id)
    if not act_section:
        return None

    year = _clean_code(row.get("year"))
    state_code = _clean_code(row.get("state_code")).zfill(2)
    district_code = _clean_code(row.get("dist_code")).zfill(2)
    court_no = _clean_code(row.get("court_no")).zfill(2)
    decorated = dict(row)
    decorated.update(
        {
            "source_case_id": source_case_id,
            "state_code": state_code,
            "district_code": district_code,
            "state_name": _lookup(key_maps["state"], year, state_code),
            "district_name": _lookup(key_maps["district"], year, state_code, district_code)
            or _lookup(key_maps["district"], "2010", state_code, district_code),
            "court_name": _lookup(key_maps["court"], year, state_code, district_code, court_no)
            or _lookup(key_maps["court"], "2010", state_code, district_code, court_no),
            "case_type": _lookup(key_maps["type"], year, row.get("type_name")),
            "purpose_name_s": _lookup(key_maps["purpose"], year, row.get("purpose_name")),
            "disp_name_s": _lookup(key_maps["disposition"], year, row.get("disp_name")),
            "act": "; ".join(sorted(act_section["acts"])),
            "section": "; ".join(sorted(act_section["sections"])),
            "sensitive_data_flags": sorted(act_section["flags"]),
            "force_criminal_target": "1" if ddl_criminal_flag_only else "",
            "offence_category_override": "criminal" if ddl_criminal_flag_only else "",
            "source_payload_version": "ddl-raw-csv",
        }
    )
    return decorated


def _process_streaming_ddl(args: argparse.Namespace) -> dict[str, Any]:
    if not args.key_dir:
        raise ValueError("--key-dir is required when using --ddl-cases-tar")
    if not args.ddl_acts_tar:
        raise ValueError("--ddl-acts-tar is required when using --ddl-cases-tar")

    config = load_filter_config()
    years = _parse_csv_option(args.years, DEFAULT_DDL_YEARS)
    state_codes = _parse_csv_option(args.state_codes, DEFAULT_DDL_STATE_CODES)
    key_maps = _load_key_maps(args.key_dir)
    print(
        f"streaming_ddl years={','.join(sorted(years))} state_codes={','.join(sorted(state_codes))}",
        flush=True,
    )
    act_section_index = _build_act_section_index(
        args.ddl_acts_tar,
        key_maps=key_maps,
        filter_config=config,
        state_codes=state_codes,
        years=years,
        ddl_criminal_flag_only=args.ddl_criminal_flag_only,
    )

    wanted_cases = {f"cases_{year}.csv" for year in years}
    batch = []
    loaded = 0
    seen = 0
    skipped_duplicate_cnrs = 0
    accumulator = CountAccumulator()
    conn = None
    conn_cm = None
    if args.workspace_id:
        conn_cm = get_connection()
        conn = conn_cm.__enter__()
    seen_cnrs = _load_existing_cnrs(conn, args.workspace_id) if conn else set()

    try:
        for _, row in _stream_tar_csv(args.ddl_cases_tar, wanted_cases):
            seen += 1
            state_code = _clean_code(row.get("state_code")).zfill(2)
            if state_code not in state_codes:
                continue
            decorated = _decorate_case_row(
                row,
                key_maps=key_maps,
                act_section_index=act_section_index,
                ddl_criminal_flag_only=args.ddl_criminal_flag_only,
            )
            if not decorated:
                continue
            record = normalize_ddl_row(decorated, filter_config=config, dataset_version=args.dataset_version)
            if args.criminal_only and not record.is_criminal_target:
                continue
            if record.cnr:
                if record.cnr in seen_cnrs:
                    skipped_duplicate_cnrs += 1
                    continue
                seen_cnrs.add(record.cnr)
            batch.append(record)
            if len(batch) >= args.batch_size:
                accumulator.add(batch)
                if conn:
                    loaded += upsert_records(conn, args.workspace_id, batch)
                    conn.commit()
                    print(f"loaded_records={loaded} seen_case_rows={seen}", flush=True)
                batch = []
            if args.limit and accumulator.report["total_rows"] >= args.limit:
                break

        if batch:
            accumulator.add(batch)
            if conn:
                loaded += upsert_records(conn, args.workspace_id, batch)
                conn.commit()
                print(f"loaded_records={loaded} seen_case_rows={seen}", flush=True)
    finally:
        if conn_cm:
            conn_cm.__exit__(*sys.exc_info())

    report = accumulator.report
    report["loaded_records"] = loaded
    report["seen_case_rows"] = seen
    report["act_section_target_case_ids"] = len(act_section_index)
    report["skipped_duplicate_cnrs"] = skipped_duplicate_cnrs
    return report


def _load_existing_cnrs(conn: Any, workspace_id: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT cnr
            FROM district_case
            WHERE workspace_id = %s::uuid
              AND source_name = 'ddl'
              AND cnr IS NOT NULL
            """,
            (workspace_id,),
        )
        return {row[0] for row in cur.fetchall()}


def main() -> int:
    parser = argparse.ArgumentParser(description="Load district court metadata from DDL exports.")
    parser.add_argument("--input", action="append", help="CSV or Parquet input path. Repeatable.")
    parser.add_argument("--ddl-cases-tar", default="", help="Official DDL cases.tar.gz path or URL.")
    parser.add_argument("--ddl-acts-tar", default="", help="Official DDL acts_sections.tar.gz path or URL.")
    parser.add_argument("--key-dir", default="", help="Extracted DDL key CSV directory.")
    parser.add_argument("--years", default=",".join(DEFAULT_DDL_YEARS), help="Comma-separated DDL case years.")
    parser.add_argument("--state-codes", default=",".join(DEFAULT_DDL_STATE_CODES), help="Comma-separated DDL state codes.")
    parser.add_argument("--dataset-version", default="ddl-unknown")
    parser.add_argument("--workspace-id", help="Workspace UUID. Omit for report-only mode.")
    parser.add_argument("--limit", type=int, default=0, help="Optional row limit for pilot runs.")
    parser.add_argument("--batch-size", type=int, default=5000, help="Batch size for streaming upserts.")
    parser.add_argument("--criminal-only", action="store_true", help="Only load rows matching configured criminal filters.")
    parser.add_argument("--ddl-criminal-flag-only", action="store_true", help="Load rows marked criminal by DDL even when they do not match configured serious-offence filters.")
    parser.add_argument("--report", default="", help="Optional JSON report output path.")
    args = parser.parse_args()

    if args.ddl_cases_tar:
        report = _process_streaming_ddl(args)
        print(json.dumps(report, indent=2, sort_keys=True))
        if args.report:
            Path(args.report).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return 0

    if not args.input:
        parser.error("--input is required unless --ddl-cases-tar is provided")

    config = load_filter_config()
    paths = [str(Path(item)) for item in args.input]
    rows = iter_csv_rows(paths[0]) if len(paths) == 1 and paths[0].endswith(".csv") else iter_duckdb_rows(paths)

    records = []
    for index, row in enumerate(rows):
        if args.limit and index >= args.limit:
            break
        records.append(normalize_ddl_row(row, filter_config=config, dataset_version=args.dataset_version))

    report = build_count_report(records)
    print(json.dumps(report, indent=2, sort_keys=True))

    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    if args.workspace_id:
        with get_connection() as conn:
            loaded = upsert_records(conn, args.workspace_id, records)
        print(f"loaded_records={loaded}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
