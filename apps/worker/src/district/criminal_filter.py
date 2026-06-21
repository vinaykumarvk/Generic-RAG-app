"""Deterministic criminal-law filters for district-court metadata rows."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any

import yaml

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "district_filters.yaml"


@dataclass(frozen=True)
class OffenceMatch:
    """One deterministic offence-filter match."""

    filter_id: str
    category: str
    matched_on: str
    sensitive_flags: tuple[str, ...] = ()


def load_filter_config(path: str | Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    """Load the district filter YAML."""

    with open(path, "r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle) or {}
    if not isinstance(loaded, dict):
        raise ValueError("District filter config must be a mapping")
    return loaded


def normalize_text_list(value: Any) -> list[str]:
    """Normalize scalar/list source values into clean string tokens."""

    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        raw_items = value
    else:
        raw = str(value)
        raw_items = re.split(r"[;,|]\s*|\n+", raw)
    items: list[str] = []
    for item in raw_items:
        text = str(item).strip()
        if text and text.lower() not in {"none", "nan", "null"}:
            items.append(text)
    return items


def normalize_sections(value: Any) -> list[str]:
    """Extract section identifiers from source section strings."""

    sections: list[str] = []
    for item in normalize_text_list(value):
        candidates = re.findall(r"\b\d{2,4}[A-Z]?(?:-[A-Z])?\b", item.upper())
        if candidates:
            sections.extend(candidates)
        elif item:
            sections.append(item.upper())
    return _dedupe(sections)


def normalize_acts(value: Any) -> list[str]:
    """Normalize common act labels without losing source text."""

    acts = []
    for item in normalize_text_list(value):
        compact = re.sub(r"\s+", " ", item).strip()
        if compact:
            acts.append(compact)
    return _dedupe(acts)


def classify_case(row: dict[str, Any], config: dict[str, Any] | None = None) -> list[OffenceMatch]:
    """Classify one district case row against the configured offence filters."""

    cfg = config or load_filter_config()
    filters = cfg.get("offence_filters") or []
    acts = normalize_acts(row.get("act") or row.get("acts") or row.get("acts_cited"))
    sections = normalize_sections(row.get("section") or row.get("sections") or row.get("sections_cited"))
    haystack = " ".join(
        normalize_text_list(
            [
                row.get("act"),
                row.get("section"),
                row.get("case_type"),
                row.get("purpose_name"),
                row.get("disp_name"),
                row.get("disposition"),
                row.get("judge_position"),
                row.get("title"),
                row.get("description"),
            ]
        )
    ).lower()

    matches: list[OffenceMatch] = []
    for offence_filter in filters:
        filter_id = str(offence_filter.get("id") or "")
        category = str(offence_filter.get("category") or "unknown")
        sensitive_flags = tuple(str(flag) for flag in offence_filter.get("sensitivity_flags") or [])

        matched_on = _match_filter(offence_filter, acts, sections, haystack)
        if matched_on:
            matches.append(
                OffenceMatch(
                    filter_id=filter_id,
                    category=category,
                    matched_on=matched_on,
                    sensitive_flags=sensitive_flags,
                )
            )
    return matches


def is_criminal_target(row: dict[str, Any], config: dict[str, Any] | None = None) -> bool:
    """Return whether the row matches at least one configured offence filter."""

    return bool(classify_case(row, config))


def offence_categories(matches: list[OffenceMatch]) -> list[str]:
    return _dedupe(match.category for match in matches)


def sensitive_flags(matches: list[OffenceMatch]) -> list[str]:
    flags: list[str] = []
    for match in matches:
        flags.extend(match.sensitive_flags)
    return _dedupe(flags)


def _match_filter(
    offence_filter: dict[str, Any],
    acts: list[str],
    sections: list[str],
    haystack: str,
) -> str | None:
    configured_sections = {str(section).upper() for section in offence_filter.get("sections") or []}
    if configured_sections and configured_sections.intersection(set(sections)):
        return "section"
    if configured_sections:
        return None

    configured_acts = [str(act).lower() for act in offence_filter.get("acts") or []]
    if configured_acts:
        act_text = " ".join(acts).lower()
        if any(act in act_text or act in haystack for act in configured_acts):
            return "act"

    keywords = [str(keyword).lower() for keyword in offence_filter.get("keywords") or []]
    if keywords and any(keyword in haystack for keyword in keywords):
        return "keyword"

    return None


def _dedupe(values: Any) -> list[str]:
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
