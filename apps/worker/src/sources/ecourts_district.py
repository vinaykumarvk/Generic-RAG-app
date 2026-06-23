"""eCourts district-court acquisition helpers.

Three fetch modes, selected by configuration:

1. **Automated portal** (``ECOURTS_FETCH_ENABLED`` + an enabled Mode 4 CAPTCHA
   solver): establish a session, solve the CNR-search CAPTCHA via the third-party
   solver, parse the case-history page, and download the detailed judgement PDF.
   This is the wide-coverage path authorized in ``docs/legal/captcha-strategy.md``.
2. **Direct PDF template** (``ECOURTS_DIRECT_FETCH_ENABLED`` + URL template): a
   single GET against a pre-approved direct PDF URL.
3. **Manual fallback** (nothing configured): return ``captcha_required`` so the
   case is routed to the operator queue.

The portal path retains throttling per ``ECOURTS_MIN_DELAY_MS``; broader rate
governance and stop conditions are wired into the poller (Phase 3).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import httpx

from ..config import config
from .captcha_solver import (
    CaptchaSolveError,
    CaptchaSolver,
    CaptchaUnavailableError,
    get_captcha_solver,
)
from .ecourts_parser import (
    extract_hidden_inputs,
    is_case_not_found,
    is_invalid_captcha,
    parse_case_metadata,
    parse_order_links,
    select_judgement,
)

logger = logging.getLogger(__name__)


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
    provider_document_id: str | None = None
    cost_units: float | None = None
    metadata: dict[str, Any] | None = None
    error_message: str | None = None
    http_status: int | None = None


@dataclass(frozen=True)
class ECourtsCaseMetadata:
    """Result of a metadata-only CNR existence probe (enumeration/discovery)."""

    outcome: str  # found | not_found | captcha_required | captcha_failed | rate_limited | http_error
    cnr: str
    fields: dict[str, Any] | None = None
    cost_units: float | None = None
    error_message: str | None = None


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
    """Policy-aware eCourts fetch adapter (automated portal / direct / manual)."""

    def __init__(
        self,
        direct_fetch_enabled: bool | None = None,
        direct_pdf_url_template: str | None = None,
        timeout_s: int | None = None,
        portal_fetch_enabled: bool | None = None,
        captcha_solver: CaptchaSolver | None = None,
    ):
        self.direct_fetch_enabled = config.ECOURTS_DIRECT_FETCH_ENABLED if direct_fetch_enabled is None else direct_fetch_enabled
        self.direct_pdf_url_template = direct_pdf_url_template if direct_pdf_url_template is not None else config.ECOURTS_DIRECT_PDF_URL_TEMPLATE
        self.timeout_s = timeout_s or config.ECOURTS_TIMEOUT_S
        self.portal_fetch_enabled = config.ECOURTS_FETCH_ENABLED if portal_fetch_enabled is None else portal_fetch_enabled
        self._captcha_solver = captcha_solver

    @property
    def captcha_solver(self) -> CaptchaSolver:
        if self._captcha_solver is None:
            self._captcha_solver = get_captcha_solver()
        return self._captcha_solver

    def fetch_case(self, case: dict[str, Any]) -> ECourtsFetchResult:
        cnr = str(case.get("cnr") or "").strip().upper()
        if not cnr:
            return ECourtsFetchResult(outcome="miss", error_message="CNR is required for eCourts direct lookup")

        if self.portal_fetch_enabled:
            return self._fetch_via_portal(cnr)
        if self.direct_fetch_enabled and self.direct_pdf_url_template:
            return self._fetch_via_direct_template(cnr)
        return ECourtsFetchResult(
            outcome="captcha_required",
            metadata={"cnr_payload": cnr_lookup_payload(cnr), "policy": "manual_operator_queue_required"},
            error_message="eCourts automated/direct fetch is not configured; manual operator flow required",
        )

    def lookup_case_metadata(self, cnr: str) -> ECourtsCaseMetadata:
        """Probe whether a CNR resolves to a real case, returning parsed metadata.

        Used by enumeration-based discovery: a CNR is only persisted as a
        ``district_case`` when this returns ``found``.
        """

        cnr = str(cnr or "").strip().upper()
        if not cnr:
            return ECourtsCaseMetadata(outcome="not_found", cnr=cnr, error_message="empty CNR")
        if not self.portal_fetch_enabled:
            return ECourtsCaseMetadata(
                outcome="captcha_required", cnr=cnr, error_message="eCourts portal fetch is not enabled"
            )
        try:
            with self._new_client() as client:
                client.get("/")
                history_html, cost = self._search_with_captcha(client, cnr)
                if history_html is None:
                    return ECourtsCaseMetadata(outcome="captcha_failed", cnr=cnr, cost_units=cost or None)
                if is_case_not_found(history_html):
                    return ECourtsCaseMetadata(outcome="not_found", cnr=cnr, cost_units=cost or None)
                return ECourtsCaseMetadata(
                    outcome="found", cnr=cnr, fields=parse_case_metadata(history_html), cost_units=cost or None
                )
        except CaptchaUnavailableError as exc:
            return ECourtsCaseMetadata(outcome="captcha_required", cnr=cnr, error_message=str(exc))
        except httpx.TimeoutException:
            return ECourtsCaseMetadata(outcome="rate_limited", cnr=cnr, error_message="eCourts portal timed out")
        except httpx.HTTPError as exc:
            return ECourtsCaseMetadata(outcome="http_error", cnr=cnr, error_message=str(exc))

    # --- Mode 1: automated portal -----------------------------------------

    def _new_client(self) -> httpx.Client:
        return httpx.Client(
            base_url=config.ECOURTS_BASE_URL,
            timeout=self.timeout_s,
            follow_redirects=True,
            headers={"User-Agent": config.ECOURTS_USER_AGENT},
        )

    def _fetch_via_portal(self, cnr: str) -> ECourtsFetchResult:
        try:
            with self._new_client() as client:
                client.get("/")  # establish session cookies
                history_html, cost = self._search_with_captcha(client, cnr)
                if history_html is None:
                    return ECourtsFetchResult(
                        outcome="captcha_failed",
                        cost_units=cost or None,
                        error_message="eCourts CAPTCHA could not be solved within the attempt budget",
                        metadata={"cnr_payload": cnr_lookup_payload(cnr)},
                    )
                return self._download_judgement(client, cnr, history_html, cost)
        except CaptchaUnavailableError as exc:
            return ECourtsFetchResult(
                outcome="captcha_required",
                error_message=str(exc),
                metadata={"cnr_payload": cnr_lookup_payload(cnr), "policy": "manual_operator_queue_required"},
            )
        except httpx.TimeoutException:
            return ECourtsFetchResult(outcome="rate_limited", error_message="eCourts portal request timed out")
        except httpx.HTTPError as exc:
            return ECourtsFetchResult(outcome="http_error", error_message=str(exc))

    def _search_with_captcha(self, client: httpx.Client, cnr: str) -> tuple[str | None, float]:
        """Solve the CAPTCHA and POST the CNR search, retrying on rejection."""

        total_cost = 0.0
        for _ in range(config.ECOURTS_CAPTCHA_MAX_ATTEMPTS):
            self._throttle()
            captcha_text, cost = self._solve_captcha(client)
            total_cost += cost
            tokens = self._page_tokens(client)
            self._throttle()
            response = client.post(
                config.ECOURTS_CNR_SEARCH_PATH,
                data={**tokens, "cino": cnr, "fcaptcha_code": captcha_text, "ajax_req": "true"},
            )
            if response.status_code == 429 or response.status_code == 503:
                raise httpx.HTTPError(f"eCourts throttled the search (HTTP {response.status_code})")
            body = response.text
            if is_invalid_captcha(body):
                logger.info("eCourts rejected CAPTCHA for CNR %s; retrying", cnr)
                continue
            return body, total_cost
        return None, total_cost

    def _solve_captcha(self, client: httpx.Client) -> tuple[str, float]:
        self._throttle()
        image_response = client.get(config.ECOURTS_CAPTCHA_PATH)
        image_response.raise_for_status()
        try:
            solution = self.captcha_solver.solve(image_response.content, hint="ecourts-cnr-search")
        except CaptchaSolveError as exc:
            raise httpx.HTTPError(f"CAPTCHA solver failed: {exc}") from exc
        return solution.text, solution.cost_units

    def _page_tokens(self, client: httpx.Client) -> dict[str, str]:
        """Best-effort harvest of hidden tokens from the current search page."""

        try:
            self._throttle()
            page = client.get(config.ECOURTS_CNR_SEARCH_PATH)
            return extract_hidden_inputs(page.text)
        except (httpx.HTTPError, RuntimeError):
            return {}

    def _download_judgement(
        self, client: httpx.Client, cnr: str, history_html: str, cost: float
    ) -> ECourtsFetchResult:
        orders = parse_order_links(history_html)
        judgement = select_judgement(orders)
        if not judgement:
            return ECourtsFetchResult(
                outcome="miss",
                cost_units=cost or None,
                source_url=config.ECOURTS_BASE_URL,
                metadata={"cnr_payload": cnr_lookup_payload(cnr), "order_count": 0},
            )

        self._throttle()
        pdf_url = self._resolve_pdf_url(judgement.pdf_ref)
        response = client.get(pdf_url)
        if response.status_code == 429 or response.status_code == 503:
            return ECourtsFetchResult(outcome="rate_limited", source_url=pdf_url, http_status=response.status_code)
        if response.status_code >= 400 or not response.content:
            return ECourtsFetchResult(
                outcome="miss" if response.status_code == 404 else "http_error",
                source_url=pdf_url,
                http_status=response.status_code,
            )

        return ECourtsFetchResult(
            outcome="hit",
            content=response.content,
            file_name=f"ecourts-{cnr}.pdf",
            mime_type="application/pdf",
            source_url=pdf_url,
            provider_document_id=cnr,
            cost_units=cost or None,
            http_status=response.status_code,
            metadata={
                "cnr_payload": cnr_lookup_payload(cnr),
                "order_count": len(orders),
                "selected_order_date": judgement.order_date,
                "selected_is_judgement": judgement.is_judgement,
                "all_orders": [
                    {"date": o.order_date, "label": o.label, "is_judgement": o.is_judgement}
                    for o in orders
                ],
            },
        )

    def _resolve_pdf_url(self, pdf_ref: str) -> str:
        if pdf_ref.startswith("http://") or pdf_ref.startswith("https://"):
            return pdf_ref
        if pdf_ref.startswith("/") or pdf_ref.startswith("?"):
            return pdf_ref
        return f"{config.ECOURTS_PDF_PATH}&{pdf_ref}" if "=" in pdf_ref else f"/{pdf_ref}"

    @staticmethod
    def _throttle() -> None:
        time.sleep(max(0.0, config.ECOURTS_MIN_DELAY_MS / 1000))

    # --- Mode 2: direct PDF template --------------------------------------

    def _fetch_via_direct_template(self, cnr: str) -> ECourtsFetchResult:
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
