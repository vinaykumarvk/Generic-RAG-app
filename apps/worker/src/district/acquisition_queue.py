"""Planning helpers for district-court text acquisition."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AcquisitionPlanItem:
    """One queued source attempt for a district case."""

    source_name: str
    priority: int
    reason: str
    requested_metadata: dict[str, Any]


DEFAULT_SOURCE_ORDER = ("indian_kanoon", "ecourts", "hldc")


def plan_text_acquisition(case: dict[str, Any], config: dict[str, Any]) -> list[AcquisitionPlanItem]:
    """Build an ordered acquisition plan for one normalized district case."""

    if not case.get("is_criminal_target"):
        return []
    if case.get("text_status") in {"text_ready", "blocked", "dead"}:
        return []

    source_policy = config.get("source_policy") or {}
    items: list[AcquisitionPlanItem] = []
    for index, source_name in enumerate(DEFAULT_SOURCE_ORDER):
        policy = source_policy.get(source_name) or {}
        if not policy.get("enabled", False):
            continue
        if policy.get("license_classification") == "blocked":
            continue
        if source_name == "hldc" and case.get("state_code") != 9:
            continue

        items.append(
            AcquisitionPlanItem(
                source_name=source_name,
                priority=100 - index * 10,
                reason=_reason_for_source(source_name),
                requested_metadata={
                    "cnr": case.get("cnr"),
                    "state_code": case.get("state_code"),
                    "district_code": case.get("district_code"),
                    "case_type": case.get("case_type"),
                    "decision_date": case.get("decision_date"),
                    "offence_categories": case.get("offence_categories") or [],
                },
            )
        )
    return items


def attempt_to_case_status(source_name: str, outcome: str) -> str:
    """Map a source attempt outcome to the case-level text status."""

    if outcome == "hit":
        return "text_ready"
    if outcome == "miss" and source_name == "indian_kanoon":
        return "ik_miss"
    if outcome == "rate_limited":
        return "ecourts_pending" if source_name == "ecourts" else "ik_pending"
    if outcome == "captcha_required":
        return "ecourts_pending"
    if outcome in {"blocked_by_policy", "captcha_failed"}:
        return "blocked"
    if outcome in {"http_error", "ocr_failed"}:
        return "dead"
    return "targeted"


def queue_rows_for_case(
    workspace_id: str,
    district_case_id: str,
    case: dict[str, Any],
    config: dict[str, Any],
) -> list[tuple[Any, ...]]:
    """Return DB-ready queue rows without mutating the database."""

    return [
        (
            workspace_id,
            district_case_id,
            item.source_name,
            "pending",
            item.priority,
            item.requested_metadata,
        )
        for item in plan_text_acquisition(case, config)
    ]


def _reason_for_source(source_name: str) -> str:
    if source_name == "indian_kanoon":
        return "clean_text_first"
    if source_name == "ecourts":
        return "official_cnr_fallback"
    if source_name == "hldc":
        return "up_hindi_non_commercial_parallel"
    return "configured_source"
