"""Playwright-based eCourts fetcher (browser automation).

Raw HTTP is blocked by eCourts' rotating-session anti-automation; a real browser
passes the captcha->search handshake (see
``docs/district/ecourts-browser-fetch-protocol.md``). This drives headless
Chromium to:

1. load the CNR-search page (establishes the session + securimage captcha),
2. solve the captcha via the configured CaptchaSolver (Document AI in prod),
3. run ``funViewCinoHistory()`` (POST cnr_status/searchByCNR) — retry on
   "Invalid Captcha",
4. open the disposal/judgment business entry (``viewBusiness(...)``) and return
   its order/judgment text.

Returns the same :class:`ECourtsFetchResult` the HTTP client used, so the
acquisition worker / Stage-1 storage path is unchanged.
"""

from __future__ import annotations

import html as _html
import json
import logging
import re
import time
from typing import Any

from ..config import config
from .captcha_solver import CaptchaSolveError, CaptchaSolver, CaptchaUnavailableError, get_captcha_solver
from .ecourts_district import ECourtsFetchResult, cnr_lookup_payload

logger = logging.getLogger(__name__)

_VB_RE = re.compile(r"viewBusiness\([^)]*\)", re.I)
# Target the disposal/judgment entry by its exact quoted flag ('Disposed', not the
# daily 'DisposedP' rows) or a judgment/final-order label.
_DISPOSAL_VB_RE = re.compile(r"viewBusiness\([^)]*'(?:Disposed|Judgement|Judgment|Final[^']*)'[^)]*\)", re.I)
_INVALID_CAPTCHA_RE = re.compile(r"invalid\s*captcha", re.I)
_NOT_FOUND_RE = re.compile(r"record not found|no record found|invalid cnr", re.I)


def select_disposal_onclick(casetype_html: str) -> str | None:
    """Pick the viewBusiness() call for the disposal/judgment entry (else the first)."""

    match = _DISPOSAL_VB_RE.search(casetype_html or "") or _VB_RE.search(casetype_html or "")
    return match.group(0) if match else None


def html_to_text(html: str) -> str:
    """Flatten order/business HTML to clean text for RAG ingestion."""

    if not html:
        return ""
    try:
        from bs4 import BeautifulSoup
        text = BeautifulSoup(html, "html.parser").get_text("\n")
    except ImportError:  # pragma: no cover - bs4 is a worker dependency
        text = re.sub(r"<[^>]+>", " ", html)
    text = _html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


class ECourtsBrowserClient:
    """Headless-Chromium eCourts fetcher."""

    def __init__(self, captcha_solver: CaptchaSolver | None = None, base_url: str | None = None, headless: bool | None = None):
        self.base_url = (base_url or config.ECOURTS_BASE_URL).rstrip("/")
        self._solver = captcha_solver
        self.headless = config.ECOURTS_BROWSER_HEADLESS if headless is None else headless

    @property
    def captcha_solver(self) -> CaptchaSolver:
        if self._solver is None:
            self._solver = get_captcha_solver()
        return self._solver

    def fetch_case(self, case: dict[str, Any]) -> ECourtsFetchResult:
        cnr = str(case.get("cnr") or "").strip().upper()
        if len(cnr) != 16:
            return ECourtsFetchResult(outcome="miss", error_message="eCourts requires a 16-character CNR")
        try:
            import playwright.sync_api  # noqa: F401
        except ImportError as exc:
            return ECourtsFetchResult(outcome="blocked_by_policy", error_message=f"playwright not installed: {exc}")
        try:
            return self._run(cnr)
        except CaptchaUnavailableError as exc:
            return ECourtsFetchResult(
                outcome="captcha_required",
                error_message=str(exc),
                metadata={"cnr_payload": cnr_lookup_payload(cnr), "policy": "manual_operator_queue_required"},
            )
        except Exception as exc:  # pragma: no cover - browser/runtime boundary
            logger.exception("eCourts browser fetch failed for %s", cnr)
            return ECourtsFetchResult(outcome="http_error", error_message=str(exc)[:500])

    def _run(self, cnr: str) -> ECourtsFetchResult:
        from playwright.sync_api import TimeoutError as PWTimeout, sync_playwright

        total_cost = 0.0
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=self.headless, args=["--no-sandbox", "--disable-dev-shm-usage"])
            try:
                page = browser.new_context(user_agent=config.ECOURTS_USER_AGENT).new_page()
                page.goto(f"{self.base_url}/", wait_until="domcontentloaded", timeout=config.ECOURTS_TIMEOUT_S * 1000)
                page.wait_for_selector("#cino", timeout=20000)

                search = None
                for _ in range(config.ECOURTS_CAPTCHA_MAX_ATTEMPTS):
                    self._throttle()
                    page.fill("#cino", cnr)  # the site clears #cino after each attempt
                    total_cost += self._solve_into_field(page)
                    try:
                        with page.expect_response(
                            lambda r: "cnr_status/searchByCNR" in r.url and r.request.method == "POST",
                            timeout=config.ECOURTS_TIMEOUT_S * 1000,
                        ) as info:
                            page.evaluate("() => { if (typeof funViewCinoHistory === 'function') funViewCinoHistory(); }")
                        data = json.loads(info.value.text())
                    except (PWTimeout, ValueError):
                        continue
                    if str(data.get("status")) == "1" and data.get("casetype_list"):
                        search = data
                        break
                    if _INVALID_CAPTCHA_RE.search(data.get("errormsg", "")):
                        continue  # site auto-refreshes the captcha; retry
                    if _NOT_FOUND_RE.search(data.get("errormsg", "")):
                        return ECourtsFetchResult(outcome="miss", cost_units=total_cost or None,
                                                  metadata={"cnr_payload": cnr_lookup_payload(cnr)})

                if not search:
                    return ECourtsFetchResult(outcome="captcha_failed", cost_units=total_cost or None,
                                              error_message="eCourts captcha not solved within attempt budget",
                                              metadata={"cnr_payload": cnr_lookup_payload(cnr)})

                return self._fetch_judgment(page, cnr, search["casetype_list"], total_cost)
            finally:
                browser.close()

    # Order rows in the rendered results, most-specific (disposal/judgment) first.
    _ORDER_SELECTORS = (
        "[onclick*=\"'Disposed'\"]",
        "[onclick*='Judgement']",
        "[onclick*='Judgment']",
        "[onclick*='viewBusiness']",
    )

    def _fetch_judgment(self, page, cnr: str, casetype_html: str, cost: float) -> ECourtsFetchResult:
        from playwright.sync_api import TimeoutError as PWTimeout

        target = self._disposal_locator(page) if select_disposal_onclick(casetype_html) else None
        if target is not None:
            self._throttle()
            try:
                with page.expect_response(
                    lambda r: "viewBusiness" in r.url and r.request.method == "POST",
                    timeout=config.ECOURTS_TIMEOUT_S * 1000,
                ) as info:
                    target.click()  # fire the row's native viewBusiness() handler — no eval
                business = json.loads(info.value.text())
                text = html_to_text(business.get("data_list", ""))
                if text:
                    return self._hit(cnr, text, cost, "order")
            except (PWTimeout, ValueError):
                pass
        # No order entry or order fetch failed — fall back to the case-details text.
        text = html_to_text(casetype_html)
        if not text:
            return ECourtsFetchResult(outcome="miss", cost_units=cost or None,
                                      metadata={"cnr_payload": cnr_lookup_payload(cnr)})
        return self._hit(cnr, text, cost, "case_details")

    def _disposal_locator(self, page):
        for selector in self._ORDER_SELECTORS:
            locator = page.locator(selector)
            try:
                if locator.count() > 0:
                    return locator.first
            except Exception:  # pragma: no cover - locator probing
                continue
        return None

    def _solve_into_field(self, page) -> float:
        image = self._capture_captcha(page)
        try:
            solution = self.captcha_solver.solve(image, hint="ecourts-cnr-search")
        except CaptchaSolveError as exc:
            raise RuntimeError(f"captcha solver failed: {exc}") from exc
        page.fill("#fcaptcha_code", solution.text)
        return solution.cost_units or 0.0

    def _capture_captcha(self, page) -> bytes:
        for _ in range(8):
            handle = page.evaluate_handle(
                "() => { const c = [...document.querySelectorAll('#captcha_image, #div_captcha_cnr img')];"
                " return c.find(e => e.getBoundingClientRect().height >= 40) || null; }"
            )
            element = handle.as_element()
            if element:
                box = element.bounding_box()
                if box and box["height"] >= 40:
                    return element.screenshot()
            page.wait_for_timeout(1000)
        raise CaptchaSolveError("eCourts captcha image did not render")

    def _hit(self, cnr: str, text: str, cost: float, kind: str) -> ECourtsFetchResult:
        return ECourtsFetchResult(
            outcome="hit",
            content=text.encode("utf-8"),
            file_name=f"ecourts-{cnr}.txt",
            mime_type="text/plain",
            source_url=f"{self.base_url}/?p=cnr_status/searchByCNR",
            provider_document_id=cnr,
            cost_units=cost or None,
            metadata={"cnr_payload": cnr_lookup_payload(cnr), "fetch_kind": kind, "fetch_mode": "browser"},
        )

    @staticmethod
    def _throttle() -> None:
        time.sleep(max(0.0, config.ECOURTS_MIN_DELAY_MS / 1000))
