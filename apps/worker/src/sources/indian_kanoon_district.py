"""Indian Kanoon district-court lookup helpers."""

from __future__ import annotations

from dataclasses import dataclass
import html
import re
from typing import Any

import httpx

from ..config import config


@dataclass(frozen=True)
class IndianKanoonCandidate:
    provider_document_id: str
    title: str
    url: str
    match_confidence: float
    matched_on: str


@dataclass(frozen=True)
class IndianKanoonFetchResult:
    outcome: str
    content: bytes | None = None
    file_name: str | None = None
    mime_type: str = "text/plain"
    source_url: str | None = None
    provider_document_id: str | None = None
    match_confidence: float = 0.0
    metadata: dict[str, Any] | None = None
    error_message: str | None = None
    http_status: int | None = None
    cost_units: float | None = None


def build_cnr_search_query(cnr: str) -> str:
    """Build the preferred exact CNR lookup query."""

    return f'"{cnr.strip()}"'


def build_fallback_search_query(case: dict[str, Any]) -> str:
    """Build a conservative fallback query from metadata."""

    parts = [
        case.get("cnr"),
        case.get("case_type"),
        case.get("court_name"),
        case.get("district_name"),
        case.get("state_name"),
        case.get("decision_date"),
    ]
    return " ".join(str(part).strip() for part in parts if part)


def classify_candidate(cnr: str | None, candidate: dict[str, Any]) -> IndianKanoonCandidate:
    """Classify an API candidate without trusting it blindly."""

    title = str(candidate.get("title") or "")
    url = str(candidate.get("url") or "")
    provider_document_id = str(candidate.get("docid") or candidate.get("id") or url)
    body = " ".join(str(candidate.get(key) or "") for key in ("title", "headline", "doc", "url"))

    if cnr and cnr.lower() in body.lower():
        confidence = 0.98
        matched_on = "cnr"
    else:
        confidence = 0.50
        matched_on = "metadata_heuristic"

    return IndianKanoonCandidate(
        provider_document_id=provider_document_id,
        title=title,
        url=url,
        match_confidence=confidence,
        matched_on=matched_on,
    )


class IndianKanoonClient:
    """Small Indian Kanoon API client for CNR-first district lookup."""

    def __init__(self, api_token: str | None = None, base_url: str | None = None, timeout_s: int | None = None):
        self.api_token = (api_token if api_token is not None else config.INDIAN_KANOON_API_TOKEN).strip()
        self.base_url = (base_url or config.INDIAN_KANOON_BASE_URL).rstrip("/")
        self.timeout_s = timeout_s or config.INDIAN_KANOON_TIMEOUT_S

    def fetch_case(self, case: dict[str, Any]) -> IndianKanoonFetchResult:
        if not self.api_token:
            return IndianKanoonFetchResult(
                outcome="blocked_by_policy",
                error_message="INDIAN_KANOON_API_TOKEN is not configured",
            )

        cnr = _text_or_none(case.get("cnr"))
        queries = []
        if cnr:
            queries.append(build_cnr_search_query(cnr))
        fallback = build_fallback_search_query(case)
        if fallback and fallback not in queries:
            queries.append(fallback)

        seen_doc_ids: set[str] = set()
        best_candidate: IndianKanoonCandidate | None = None
        search_metadata: list[dict[str, Any]] = []
        for query in queries:
            response = self._get("/search/", params={"formInput": query, "pagenum": 0})
            if response.status_code == 429:
                return IndianKanoonFetchResult(outcome="rate_limited", http_status=429, metadata={"query": query})
            if response.status_code >= 500:
                return IndianKanoonFetchResult(outcome="http_error", http_status=response.status_code, metadata={"query": query})
            if response.status_code >= 400:
                continue

            payload = response.json()
            candidates = _extract_candidates(payload)
            search_metadata.append({"query": query, "candidate_count": len(candidates)})
            for raw_candidate in candidates:
                candidate = classify_candidate(cnr, raw_candidate)
                if candidate.provider_document_id in seen_doc_ids:
                    continue
                seen_doc_ids.add(candidate.provider_document_id)
                if not best_candidate or candidate.match_confidence > best_candidate.match_confidence:
                    best_candidate = candidate

            if best_candidate and best_candidate.match_confidence >= 0.90:
                break

        if not best_candidate or best_candidate.match_confidence < 0.90:
            return IndianKanoonFetchResult(outcome="miss", metadata={"searches": search_metadata})

        document_response = self._get(f"/doc/{best_candidate.provider_document_id}/")
        if document_response.status_code == 429:
            return IndianKanoonFetchResult(outcome="rate_limited", http_status=429, provider_document_id=best_candidate.provider_document_id)
        if document_response.status_code >= 400:
            return IndianKanoonFetchResult(
                outcome="http_error",
                http_status=document_response.status_code,
                provider_document_id=best_candidate.provider_document_id,
            )

        document_payload = document_response.json()
        text = _extract_document_text(document_payload)
        if not text.strip():
            return IndianKanoonFetchResult(
                outcome="miss",
                provider_document_id=best_candidate.provider_document_id,
                metadata={"reason": "empty_document_body", "candidate": best_candidate.__dict__},
            )

        source_url = best_candidate.url or f"https://indiankanoon.org/doc/{best_candidate.provider_document_id}/"
        return IndianKanoonFetchResult(
            outcome="hit",
            content=text.encode("utf-8"),
            file_name=f"indian-kanoon-{best_candidate.provider_document_id}.txt",
            mime_type="text/plain",
            source_url=source_url,
            provider_document_id=best_candidate.provider_document_id,
            match_confidence=best_candidate.match_confidence,
            cost_units=1.0,
            metadata={
                "candidate": best_candidate.__dict__,
                "searches": search_metadata,
                "title": best_candidate.title,
                "api_payload_keys": sorted(document_payload.keys()),
            },
        )

    def _get(self, path: str, params: dict[str, Any] | None = None) -> httpx.Response:
        headers = {"Authorization": f"Token {self.api_token}"}
        with httpx.Client(base_url=self.base_url, headers=headers, timeout=self.timeout_s) as client:
            return client.get(path, params=params)


def _extract_candidates(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("docs", "results", "documents"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _extract_document_text(payload: dict[str, Any]) -> str:
    for key in ("doc", "text", "body", "judgment", "content"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return _html_to_text(value)
    return ""


def _html_to_text(value: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
