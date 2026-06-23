"""Pluggable CAPTCHA solver abstraction for district-court acquisition.

Mode 4 (approved third-party solving service) per ``docs/legal/captcha-strategy.md``.
The automated path is gated by ``ECOURTS_COMMERCIAL_CAPTCHA_SOLVER_ENABLED``
(default OFF). When disabled, :class:`DisabledSolver` is returned and callers
fall back to the manual operator-queue signal, preserving prior behavior.

The solver only ever receives the raw CAPTCHA image bytes — never case PII.
"""

from __future__ import annotations

import base64
import logging
import re
import time
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx

from ..config import config

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CaptchaSolution:
    """A solved CAPTCHA and its billing/provenance metadata."""

    text: str
    provider: str
    cost_units: float = 0.0


class CaptchaUnavailableError(RuntimeError):
    """No approved/configured solver can handle the challenge (fall back to manual)."""


class CaptchaSolveError(RuntimeError):
    """An enabled solver was unable to return a solution."""


@runtime_checkable
class CaptchaSolver(Protocol):
    """Solve an image CAPTCHA and return the recognized text."""

    def solve(self, image_bytes: bytes, *, hint: str = "") -> CaptchaSolution: ...


class DisabledSolver:
    """Default solver: refuses, so callers keep the manual-operator fallback."""

    provider = "disabled"

    def solve(self, image_bytes: bytes, *, hint: str = "") -> CaptchaSolution:
        raise CaptchaUnavailableError(
            "Automated CAPTCHA solving is disabled (ECOURTS_COMMERCIAL_CAPTCHA_SOLVER_ENABLED=false)"
        )


class TwoCaptchaSolver:
    """Third-party solving-service client using the 2Captcha-compatible API.

    Submit/poll flow:
      POST  {base}/in.php   (method=base64, body=<b64 image>) -> request id
      GET   {base}/res.php  (action=get, id=<id>)            -> solved text
    """

    provider = "twocaptcha"

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout_s: int | None = None,
        poll_interval_s: int | None = None,
        cost_units: float | None = None,
    ):
        self.api_key = (api_key if api_key is not None else config.CAPTCHA_SOLVER_API_KEY).strip()
        self.base_url = (base_url or config.CAPTCHA_SOLVER_BASE_URL).rstrip("/")
        self.timeout_s = timeout_s or config.CAPTCHA_SOLVER_TIMEOUT_S
        self.poll_interval_s = poll_interval_s or config.CAPTCHA_SOLVER_POLL_INTERVAL_S
        self.cost_units = config.CAPTCHA_SOLVER_COST_UNITS if cost_units is None else cost_units

    def solve(self, image_bytes: bytes, *, hint: str = "") -> CaptchaSolution:
        if not self.api_key:
            raise CaptchaUnavailableError("CAPTCHA_SOLVER_API_KEY is not configured")
        if not image_bytes:
            raise CaptchaSolveError("Empty CAPTCHA image supplied to solver")

        with httpx.Client(base_url=self.base_url, timeout=self.timeout_s) as client:
            captcha_id = self._submit(client, image_bytes)
            text = self._poll(client, captcha_id)

        return CaptchaSolution(text=text, provider=self.provider, cost_units=self.cost_units)

    def _submit(self, client: httpx.Client, image_bytes: bytes) -> str:
        response = client.post(
            "/in.php",
            data={
                "key": self.api_key,
                "method": "base64",
                "body": base64.b64encode(image_bytes).decode("ascii"),
                "json": "1",
            },
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") != 1:
            raise CaptchaSolveError(f"Solver submit failed: {payload.get('request')}")
        return str(payload["request"])

    def _poll(self, client: httpx.Client, captcha_id: str) -> str:
        deadline = self.timeout_s / max(self.poll_interval_s, 1)
        for _ in range(int(deadline) + 1):
            time.sleep(self.poll_interval_s)
            response = client.get(
                "/res.php",
                params={"key": self.api_key, "action": "get", "id": captcha_id, "json": "1"},
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("status") == 1:
                return str(payload["request"]).strip()
            if payload.get("request") != "CAPCHA_NOT_READY":
                raise CaptchaSolveError(f"Solver error: {payload.get('request')}")
        raise CaptchaSolveError("Solver timed out waiting for CAPTCHA result")


def _clean_captcha_text(text: str) -> str:
    """Reduce OCR output to the captcha charset (alphanumeric, no whitespace)."""

    return re.sub(r"[^A-Za-z0-9]", "", text or "")


def _guess_image_mime(content: bytes) -> str:
    if content[:8].startswith(b"\x89PNG"):
        return "image/png"
    if content[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "image/png"


class DocumentAiSolver:
    """Solve captchas by OCR'ing the image with the worker's Google Document AI processor.

    Reuses the already-configured Document AI client/processor/credentials
    (see pipeline/ocr_provider.py) — no extra vendor or key. Document AI is
    general OCR, not captcha-tuned, so accuracy varies; the caller retries on
    misses (ECOURTS_CAPTCHA_MAX_ATTEMPTS).
    """

    provider = "documentai"

    def __init__(self, cost_units: float | None = None):
        self.cost_units = config.CAPTCHA_SOLVER_COST_UNITS if cost_units is None else cost_units

    def solve(self, image_bytes: bytes, *, hint: str = "") -> CaptchaSolution:
        if not image_bytes:
            raise CaptchaSolveError("Empty CAPTCHA image supplied to solver")
        if not (config.DOCUMENT_AI_PROJECT_ID and config.DOCUMENT_AI_PROCESSOR_ID):
            raise CaptchaUnavailableError("Document AI is not configured (DOCUMENT_AI_PROJECT_ID/PROCESSOR_ID)")
        try:
            from ..pipeline.ocr_provider import (
                _get_document_ai_client,
                _get_documentai_module,
                _get_processor_name,
            )
        except Exception as exc:  # pragma: no cover - import guard
            raise CaptchaUnavailableError(f"Document AI OCR is unavailable: {exc}") from exc

        documentai = _get_documentai_module()
        client = _get_document_ai_client()
        request = documentai.ProcessRequest(
            name=_get_processor_name(client),
            raw_document=documentai.RawDocument(content=image_bytes, mime_type=_guess_image_mime(image_bytes)),
        )
        try:
            result = client.process_document(request=request)
        except Exception as exc:
            raise CaptchaSolveError(f"Document AI process_document failed: {exc}") from exc

        text = _clean_captcha_text(getattr(result.document, "text", "") or "")
        if not text:
            raise CaptchaSolveError("Document AI returned no readable captcha text")
        return CaptchaSolution(text=text, provider=self.provider, cost_units=self.cost_units)


def get_captcha_solver() -> CaptchaSolver:
    """Resolve the configured solver, honoring the default-off feature flag."""

    if not config.ECOURTS_COMMERCIAL_CAPTCHA_SOLVER_ENABLED:
        return DisabledSolver()
    provider = config.CAPTCHA_SOLVER_PROVIDER
    if provider in {"twocaptcha", "2captcha", "anticaptcha", "anti-captcha"}:
        # 2Captcha and Anti-Captcha both expose the in.php/res.php contract.
        return TwoCaptchaSolver()
    if provider in {"documentai", "document_ai", "docai", "google_documentai"}:
        return DocumentAiSolver()
    logger.warning("Unknown CAPTCHA_SOLVER_PROVIDER=%s; falling back to disabled solver", provider)
    return DisabledSolver()
