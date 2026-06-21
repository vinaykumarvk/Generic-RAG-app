"""eCourts district-court acquisition helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import httpx

from ..config import config


@dataclass(frozen=True)
class ECourtsRateLimit:
    min_delay_ms: int = 3000
    max_workers: int = 1
    max_retries: int = 3
    backoff_multiplier: int = 2


@dataclass(frozen=True)
class ECourtsFetchResult:
    outcome: str
    content: bytes | None = None
    file_name: str | None = None
    mime_type: str = "application/pdf"
    source_url: str | None = None
    metadata: dict[str, Any] | None = None
    error_message: str | None = None
    http_status: int | None = None


def cnr_lookup_payload(cnr: str) -> dict[str, str]:
    """Build a CNR lookup payload shape for the eCourts adapter."""

    return {"cino": cnr.strip().upper()}


def next_retry_at(attempt_count: int, *, now: datetime | None = None, rate_limit: ECourtsRateLimit | None = None) -> datetime:
    """Calculate the next retry time using the approved backoff policy."""

    current = now or datetime.utcnow()
    limits = rate_limit or ECourtsRateLimit()
    delay_seconds = max(1, limits.min_delay_ms / 1000) * (limits.backoff_multiplier ** max(0, attempt_count - 1))
    return current + timedelta(seconds=delay_seconds)


def should_stop_window(captcha_failure_rate: float, rate_limit_failure_rate: float) -> bool:
    """Return whether the operator should stop the eCourts worker window."""

    return captcha_failure_rate > 0.20 or rate_limit_failure_rate > 0.10


class ECourtsClient:
    """Policy-aware eCourts fetch adapter.

    The default path does not bypass CAPTCHA. A direct PDF URL template can be
    supplied for controlled pilots where the URL has already been approved.
    """

    def __init__(
        self,
        direct_fetch_enabled: bool | None = None,
        direct_pdf_url_template: str | None = None,
        timeout_s: int | None = None,
    ):
        self.direct_fetch_enabled = config.ECOURTS_DIRECT_FETCH_ENABLED if direct_fetch_enabled is None else direct_fetch_enabled
        self.direct_pdf_url_template = direct_pdf_url_template if direct_pdf_url_template is not None else config.ECOURTS_DIRECT_PDF_URL_TEMPLATE
        self.timeout_s = timeout_s or config.ECOURTS_TIMEOUT_S

    def fetch_case(self, case: dict[str, Any]) -> ECourtsFetchResult:
        cnr = str(case.get("cnr") or "").strip().upper()
        if not cnr:
            return ECourtsFetchResult(outcome="miss", error_message="CNR is required for eCourts direct lookup")

        if not self.direct_fetch_enabled or not self.direct_pdf_url_template:
            return ECourtsFetchResult(
                outcome="captcha_required",
                metadata={
                    "cnr_payload": cnr_lookup_payload(cnr),
                    "policy": "manual_operator_queue_required",
                },
                error_message="eCourts CAPTCHA/manual operator flow is required; direct fetch is not configured",
            )

        source_url = self.direct_pdf_url_template.format(cnr=cnr)
        try:
            with httpx.Client(timeout=self.timeout_s, follow_redirects=True) as client:
                response = client.get(source_url)
        except httpx.TimeoutException:
            return ECourtsFetchResult(outcome="rate_limited", source_url=source_url, error_message="eCourts request timed out")
        except httpx.HTTPError as exc:
            return ECourtsFetchResult(outcome="http_error", source_url=source_url, error_message=str(exc))

        if response.status_code == 429:
            return ECourtsFetchResult(outcome="rate_limited", source_url=source_url, http_status=429)
        if response.status_code == 404:
            return ECourtsFetchResult(outcome="miss", source_url=source_url, http_status=404)
        if response.status_code >= 400:
            return ECourtsFetchResult(outcome="http_error", source_url=source_url, http_status=response.status_code)

        content_type = response.headers.get("content-type", "application/pdf").split(";")[0].strip().lower()
        content = response.content
        if not content:
            return ECourtsFetchResult(outcome="miss", source_url=source_url, http_status=response.status_code)

        mime_type = "application/pdf" if "pdf" in content_type else content_type or "application/pdf"
        extension = ".pdf" if mime_type == "application/pdf" else ".bin"
        return ECourtsFetchResult(
            outcome="hit",
            content=content,
            file_name=f"ecourts-{cnr}{extension}",
            mime_type=mime_type,
            source_url=source_url,
            http_status=response.status_code,
            metadata={"cnr_payload": cnr_lookup_payload(cnr), "content_type": content_type},
        )
