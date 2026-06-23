"""Defensive parsers for eCourts District Court Services HTML.

The eCourts portal schema is unstable, so these helpers are deliberately
tolerant: they harvest hidden tokens, locate the orders/judgement table by
heading text, and extract per-order PDF references whether the link is a plain
anchor or buried in an ``onclick`` handler. Selectors may need tuning against
the live portal during the pilot; keep the heuristics here, not in the client.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_DATE_RE = re.compile(r"(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})")
_PDF_HINT_RE = re.compile(r"(view[_]?order|display_pdf|order_?pdf|viewpdf|\.pdf)", re.IGNORECASE)
_JUDGEMENT_RE = re.compile(r"(judg|final order|disposed|disposal)", re.IGNORECASE)
_INVALID_CAPTCHA_RE = re.compile(r"invalid\s*captcha|enter\s*(the\s*)?captcha", re.IGNORECASE)
_NOT_FOUND_RE = re.compile(
    r"record not found|no record found|invalid cnr|cnr number does not exist|this record does not exist",
    re.IGNORECASE,
)
_ISO_DATE_RE = re.compile(r"(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})")
_TEXT_DATE_RE = re.compile(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})")
_MONTHS = {
    m: i + 1
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    )
}

# Case-history label -> district_case-compatible field name.
_LABEL_FIELD = {
    "case type": "case_type",
    "filing date": "filing_date",
    "date of filing": "filing_date",
    "registration date": "registration_date",
    "date of registration": "registration_date",
    "decision date": "decision_date",
    "date of decision": "decision_date",
    "nature of disposal": "disposition",
    "disposal nature": "disposition",
    "court number and judge": "court_name",
    "court no. and judge": "court_name",
}


@dataclass(frozen=True)
class OrderLink:
    """One order/judgement row discovered on the case-history page."""

    pdf_ref: str
    order_date: str | None
    label: str
    is_judgement: bool


def _soup(html: str):
    """Lazily import BeautifulSoup so the worker loads without it when disabled."""

    try:
        from bs4 import BeautifulSoup  # type: ignore
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise RuntimeError(
            "beautifulsoup4 is required for eCourts portal parsing; add it to requirements"
        ) from exc
    return BeautifulSoup(html, "html.parser")


def is_invalid_captcha(html_or_text: str) -> bool:
    """Return whether the portal rejected the supplied CAPTCHA."""

    return bool(_INVALID_CAPTCHA_RE.search(html_or_text or ""))


def extract_hidden_inputs(html: str) -> dict[str, str]:
    """Harvest hidden form inputs (CSRF/app tokens) to replay on POSTs."""

    tokens: dict[str, str] = {}
    for tag in _soup(html).find_all("input", attrs={"type": "hidden"}):
        name = tag.get("name") or tag.get("id")
        if name:
            tokens[str(name)] = str(tag.get("value") or "")
    return tokens


def _pdf_ref_from_tag(tag: Any) -> str | None:
    """Extract a PDF reference from an anchor href or an onclick handler."""

    href = str(tag.get("href") or "")
    if _PDF_HINT_RE.search(href) and href not in {"#", "javascript:void(0)"}:
        return href
    onclick = str(tag.get("onclick") or "")
    if _PDF_HINT_RE.search(onclick):
        quoted = re.findall(r"""['"]([^'"]+)['"]""", onclick)
        for value in quoted:
            if _PDF_HINT_RE.search(value) or "=" in value:
                return value
    return None


def parse_order_links(html: str) -> list[OrderLink]:
    """Extract every order/judgement PDF reference from a case-history page."""

    links: list[OrderLink] = []
    seen: set[str] = set()
    for tag in _soup(html).find_all("a"):
        pdf_ref = _pdf_ref_from_tag(tag)
        if not pdf_ref or pdf_ref in seen:
            continue
        seen.add(pdf_ref)
        context = " ".join(filter(None, [tag.get_text(" ", strip=True), _row_text(tag)]))
        date_match = _DATE_RE.search(context)
        links.append(
            OrderLink(
                pdf_ref=pdf_ref,
                order_date=date_match.group(1) if date_match else None,
                label=tag.get_text(" ", strip=True) or "order",
                is_judgement=bool(_JUDGEMENT_RE.search(context)),
            )
        )
    return links


def _row_text(tag: Any) -> str:
    """Text of the enclosing table row, used for date/label context."""

    row = tag.find_parent("tr")
    return row.get_text(" ", strip=True) if row else ""


def _date_sort_key(value: str | None) -> tuple[int, int, int]:
    if not value:
        return (0, 0, 0)
    parts = re.split(r"[-/]", value)
    if len(parts) != 3:
        return (0, 0, 0)
    day, month, year = (int(p) for p in parts)
    if year < 100:
        year += 2000
    return (year, month, day)


def select_judgement(orders: list[OrderLink]) -> OrderLink | None:
    """Pick the detailed judgement: prefer judgement-labeled, else latest dated."""

    if not orders:
        return None
    judgements = [o for o in orders if o.is_judgement]
    pool = judgements or orders
    return max(pool, key=lambda o: _date_sort_key(o.order_date))


def is_case_not_found(html_or_text: str) -> bool:
    """Return whether the portal reported the CNR does not resolve to a case."""

    return bool(_NOT_FOUND_RE.search(html_or_text or ""))


def to_iso_date(value: str | None) -> str | None:
    """Normalize ``dd-mm-yyyy`` or ``12th March 2020`` to ISO ``yyyy-mm-dd``."""

    if not value:
        return None
    numeric = _ISO_DATE_RE.search(value)
    if numeric:
        day, month, year = (int(part) for part in numeric.groups())
        year += 2000 if year < 100 else 0
        return f"{year:04d}-{month:02d}-{day:02d}"
    textual = _TEXT_DATE_RE.search(value)
    if textual:
        day, month_name, year = textual.groups()
        month = _MONTHS.get(month_name[:3].lower())
        if month:
            return f"{int(year):04d}-{month:02d}-{int(day):02d}"
    return None


def parse_case_metadata(html: str) -> dict[str, Any]:
    """Extract district_case-compatible metadata from a case-history page."""

    soup = _soup(html)
    fields: dict[str, Any] = {}
    for row in soup.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
        for i in range(0, len(cells) - 1, 2):
            label = cells[i].rstrip(":").strip().lower()
            value = cells[i + 1].strip()
            field = _LABEL_FIELD.get(label)
            if field and value and field not in fields:
                fields[field] = value
    for date_field in ("filing_date", "registration_date", "decision_date"):
        if date_field in fields:
            fields[date_field] = to_iso_date(fields[date_field])
    acts, sections = _parse_acts_sections(soup)
    if acts:
        fields["acts"] = acts
    if sections:
        fields["sections"] = sections
    return fields


def _parse_acts_sections(soup: Any) -> tuple[list[str], list[str]]:
    """Pull act/section columns from the case-history acts table."""

    acts: list[str] = []
    sections: list[str] = []
    for table in soup.find_all("table"):
        header = table.get_text(" ", strip=True).lower()
        if "under act" in header or ("act" in header and "section" in header):
            for row in table.find_all("tr"):
                cells = [c.get_text(" ", strip=True) for c in row.find_all("td")]
                if len(cells) >= 2 and cells[0].lower() not in {"act", "under act(s)", "under act"}:
                    if cells[0]:
                        acts.append(cells[0])
                    if cells[1]:
                        sections.append(cells[1])
    return acts, sections
