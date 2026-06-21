"""LLM-based metadata extraction from document text (FR-007).

Extracts structured metadata: doc_type, case_reference, FIR number,
station, dates, legal sections, confidence scoring.
Stores to document.extracted_metadata and flags low-confidence for review.
"""

import json
import logging
import time
import httpx
from ..config import config
from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """Analyze the following document text and extract structured metadata.
Return a JSON object with these fields (use null if not found):

{
  "doc_type": "string — type of document (e.g. FIR, chargesheet, court_order, report, circular, memo, letter, affidavit, witness_statement, forensic_report, other)",
  "case_reference": "string — case number or reference (e.g. 'Case No. 123/2024')",
  "fir_number": "string — FIR number if applicable",
  "station_code": "string — police station code or name",
  "dates": ["list of significant dates mentioned (ISO format YYYY-MM-DD where possible)"],
  "legal_sections": ["list of legal sections cited (e.g. 'IPC 302', 'CrPC 161')"],
  "parties": ["list of key parties/persons mentioned"],
  "jurisdiction": "string — jurisdiction or court name",
  "judgment": {
    "canonical_judgment_id": "string — stable source judgment id if available",
    "court_code": "string — normalized court code, e.g. SCI, DELHC, PUNJABHARYANAHC",
    "court_name": "string — full court name",
    "court_level": "string — supreme_court, high_court, trial_court, tribunal, unknown",
    "bench_strength": "string — single_judge, division_bench, full_bench, constitution_bench, unknown",
    "appeal_posture": "string — appeal, revision, slp, writ, bail, trial, unknown",
    "decision_date": "YYYY-MM-DD or null",
    "incident_date": "YYYY-MM-DD or null",
    "offence_date": "YYYY-MM-DD or null",
    "fir_date": "YYYY-MM-DD or null",
    "search_date": "YYYY-MM-DD or null",
    "seizure_date": "YYYY-MM-DD or null",
    "applicable_legal_regime": "ipc_crpc_evidence_act, bns_bnss_bsa, transition_period, special_statute, state_amendment, or unknown",
    "neutral_citation": "string or null",
    "reporter_citations": ["list"],
    "cnr": "string or null",
    "case_number": "string or null",
    "disposal_nature": "string or null",
    "author_judge": "string or null",
    "judges": ["list"],
    "statutes": ["list, e.g. NDPS, IPC, CrPC"],
    "sections": ["list, e.g. 50, 42, 52A"],
    "offence_categories": ["list"],
    "outcomes": ["list of normalized final outcomes"],
    "source_bucket": "string or null",
    "source_license": "string or null",
    "ocr_confidence": 0.0,
    "paragraph_anchor_confidence": 0.0,
    "sensitive_data_flags": ["victim_identity, minor_identity, sexual_offence_detail, sealed_record, etc."],
    "redaction_status": "not_required, pending, redacted, or restricted",
    "correction_status": "uncorrected, corrected, or verified",
    "parties": [{"label": "string", "role": "string", "sensitive": false}],
    "statute_sections": [{"statute": "string", "section": "string", "section_type": "string", "issue_tags": ["list"]}],
    "outcome_details": [{
      "accused_label": "string or null",
      "charge_label": "string or null",
      "statute": "string or null",
      "section": "string or null",
      "trial_outcome": "string or null",
      "appeal_outcome": "string or null",
      "final_outcome": "string or null",
      "state_or_police_result": "favourable, adverse, mixed, neutral, or unknown",
      "reason_category": "procedure, evidence, credibility, statutory_interpretation, precedent, sentencing, jurisdiction, delay, or unknown",
      "outcome_reason": "short reason stated by the court",
      "source_span": {"paragraph_number": "string or null", "page_start": null, "quote": "short quote or null"}
    }]
  },
  "sensitivity": "string — suggested sensitivity: PUBLIC, INTERNAL, RESTRICTED, or SEALED",
  "language": "string — primary language of the document (ISO 639-1 code)",
  "summary": "string — one-sentence summary of the document",
  "confidence": 0.0
}

The confidence field should be 0.0-1.0 indicating how confident you are in the overall extraction.
Only extract what is clearly present in the text. Do not guess or fabricate.

Document text (first 3000 chars):
"""


def extract_metadata(document_id: str, workspace_id: str):
    """Extract structured metadata from document text using LLM."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT er.content,
                       d.title,
                       d.file_name,
                       d.file_path,
                       d.source_path,
                       d.gcs_uri,
                       d.metadata,
                       d.ocr_confidence
                FROM extraction_result er
                JOIN document d ON d.document_id = er.document_id
                WHERE er.document_id = %s AND er.extraction_type = 'TEXT'
                ORDER BY er.created_at DESC LIMIT 1
            """, (document_id,))
            row = cur.fetchone()
            if not row:
                logger.warning(f"No extraction result for document {document_id}, skipping metadata extraction")
                return

    text = row["content"]
    document_context = dict(row)
    document_context.pop("content", None)
    # Use first 3000 chars for metadata extraction
    sample = text[:3000]

    provider, model_name = _current_model_details()
    started_at = time.perf_counter()

    try:
        metadata = _extract_with_llm(sample)
    except Exception as e:
        logger.warning(f"LLM metadata extraction failed for {document_id}: {e}")
        metadata = {"confidence": 0.0, "error": str(e)}
    latency_ms = int((time.perf_counter() - started_at) * 1000)

    confidence = metadata.get("confidence", 0.0)
    if isinstance(confidence, str):
        try:
            confidence = float(confidence)
        except ValueError:
            confidence = 0.0

    # Store extracted metadata
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                UPDATE document
                SET extracted_metadata = %s,
                    metadata_confidence = %s,
                    updated_at = now()
                WHERE document_id = %s
            """, (json.dumps(metadata, default=str), confidence, document_id))

            # Auto-populate scoping fields if not already set and confidence is high
            if confidence >= 0.7:
                updates = []
                params = []
                if metadata.get("case_reference"):
                    updates.append("case_reference = COALESCE(case_reference, %s)")
                    params.append(metadata["case_reference"])
                if metadata.get("fir_number"):
                    updates.append("fir_number = COALESCE(fir_number, %s)")
                    params.append(metadata["fir_number"])
                if metadata.get("station_code"):
                    updates.append("station_code = COALESCE(station_code, %s)")
                    params.append(metadata["station_code"])
                if metadata.get("language"):
                    updates.append("language = COALESCE(language, %s)")
                    params.append(metadata["language"])

                if updates:
                    params.append(document_id)
                    cur.execute(
                        f"UPDATE document SET {', '.join(updates)}, updated_at = now() WHERE document_id = %s",
                        params
                    )

            # FR-007: Flag for review if confidence is low or mandatory fields missing
            mandatory = config.METADATA_MANDATORY_FIELDS
            missing_mandatory = [f for f in mandatory if not metadata.get(f)]

            if confidence < config.OCR_REVIEW_THRESHOLD or missing_mandatory:
                review_reason = []
                if confidence < config.OCR_REVIEW_THRESHOLD:
                    review_reason.append(f"Low metadata confidence: {confidence:.2f}")
                if missing_mandatory:
                    review_reason.append(f"Missing mandatory fields: {', '.join(missing_mandatory)}")

                cur.execute("""
                    INSERT INTO review_queue (workspace_id, entity_type, entity_id, reason, details)
                    VALUES (%s, 'DOCUMENT', %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (
                    workspace_id, document_id,
                    "; ".join(review_reason),
                    json.dumps({"confidence": confidence, "missing_fields": missing_mandatory})
                ))

                cur.execute("""
                    UPDATE document SET review_required = true WHERE document_id = %s
                """, (document_id,))

                logger.info("Document flagged for metadata review",
                            extra={"document_id": document_id, "confidence": confidence,
                                   "missing": missing_mandatory})

            cur.execute("""
                INSERT INTO model_prediction_log
                  (provider, model_name, use_case, entity_type, entity_id, prediction, latency_ms, fallback_used)
                VALUES (%s, %s, 'metadata_extract', 'DOCUMENT', %s, %s::jsonb, %s, %s)
            """, (
                provider,
                model_name,
                document_id,
                json.dumps(metadata, default=str),
                latency_ms,
                "error" in metadata,
            ))

    try:
        _upsert_judgment_metadata(workspace_id, document_id, metadata, document_context, confidence)
    except Exception as e:
        logger.warning(f"Failed to upsert judgment metadata for {document_id}: {e}")

    logger.info(f"Metadata extracted for {document_id}: confidence={confidence:.2f}")


def _as_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        if not value.strip():
            return []
        return [part.strip() for part in value.split(",") if part.strip()]
    return [str(value).strip()]


def _as_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return 0.0
    if parsed > 1:
        return 1.0
    return parsed


def _as_dict(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _iso_date_or_none(value) -> str | None:
    text = _as_text(value)
    if not text:
        return None
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    return None


def _year_from_date(value) -> int | None:
    date = _iso_date_or_none(value)
    if not date:
        return None
    try:
        return int(date[:4])
    except ValueError:
        return None


def _safe_status(value: str | None, allowed: set[str], default: str) -> str:
    if not value:
        return default
    normalized = value.strip().lower()
    return normalized if normalized in allowed else default


def _build_canonical_judgment_id(judgment: dict, metadata: dict, document_context: dict) -> str | None:
    explicit = _as_text(judgment.get("canonical_judgment_id"))
    if explicit:
        return explicit
    for key in ("neutral_citation", "cnr", "case_number"):
        value = _as_text(judgment.get(key))
        if value:
            return value
    district_metadata = _as_dict(_as_dict(document_context.get("metadata")).get("district"))
    for key in ("cnr", "case_number"):
        value = _as_text(district_metadata.get(key))
        if value:
            return value
    case_reference = _as_text(metadata.get("case_reference"))
    court_code = _as_text(judgment.get("court_code") or judgment.get("court_name") or metadata.get("jurisdiction"))
    decision_date = _iso_date_or_none(judgment.get("decision_date"))
    if court_code and decision_date and case_reference:
        normalized_case = "".join(ch.lower() if ch.isalnum() else "-" for ch in case_reference).strip("-")
        return f"{court_code.lower()}:{decision_date}:{normalized_case}"
    return _as_text(document_context.get("file_name"))


def _judgment_payload(metadata: dict, document_context: dict, confidence: float) -> dict:
    judgment = metadata.get("judgment") or metadata.get("judgment_metadata") or {}
    if not isinstance(judgment, dict):
        judgment = {}

    document_metadata = _as_dict(document_context.get("metadata"))
    district_metadata = _as_dict(document_metadata.get("district"))
    source_metadata = _as_dict(document_metadata.get("source"))

    legal_sections = _as_list(metadata.get("legal_sections"))
    statutes = _as_list(judgment.get("statutes"))
    sections = _as_list(judgment.get("sections"))
    statutes.extend(_as_list(district_metadata.get("acts_cited") or district_metadata.get("statutes")))
    sections.extend(_as_list(district_metadata.get("sections_cited") or district_metadata.get("sections")))
    for legal_section in legal_sections:
        parts = legal_section.split()
        if len(parts) >= 2:
            statutes.append(parts[0])
            sections.append(" ".join(parts[1:]))

    source_quality = {
        "source_file_name": document_context.get("file_name"),
        "source_file_path": document_context.get("file_path"),
        "document_metadata": document_metadata,
    }
    sensitive_flags = _as_list(judgment.get("sensitive_data_flags"))
    sensitive_flags.extend(_as_list(district_metadata.get("sensitive_data_flags")))
    offence_categories = _as_list(judgment.get("offence_categories"))
    offence_categories.extend(_as_list(district_metadata.get("offence_categories")))

    return {
        "canonical_judgment_id": _build_canonical_judgment_id(judgment, metadata, document_context),
        "court_code": _as_text(judgment.get("court_code") or district_metadata.get("court_code")),
        "court_name": _as_text(judgment.get("court_name") or metadata.get("jurisdiction") or district_metadata.get("court_name")),
        "court_level": _as_text(judgment.get("court_level") or district_metadata.get("court_level")),
        "bench_strength": _as_text(judgment.get("bench_strength")),
        "appeal_posture": _as_text(judgment.get("appeal_posture")),
        "decision_date": _iso_date_or_none(judgment.get("decision_date") or district_metadata.get("decision_date")),
        "judgment_year": _year_from_date(judgment.get("decision_date") or district_metadata.get("decision_date")),
        "incident_date": _iso_date_or_none(judgment.get("incident_date")),
        "offence_date": _iso_date_or_none(judgment.get("offence_date")),
        "fir_date": _iso_date_or_none(judgment.get("fir_date")),
        "search_date": _iso_date_or_none(judgment.get("search_date")),
        "seizure_date": _iso_date_or_none(judgment.get("seizure_date")),
        "applicable_legal_regime": _as_text(judgment.get("applicable_legal_regime")),
        "statute_versions": judgment.get("statute_versions") if isinstance(judgment.get("statute_versions"), dict) else {},
        "neutral_citation": _as_text(judgment.get("neutral_citation")),
        "reporter_citations": _as_list(judgment.get("reporter_citations")),
        "cnr": _as_text(judgment.get("cnr") or district_metadata.get("cnr")),
        "case_number": _as_text(judgment.get("case_number") or metadata.get("case_reference") or district_metadata.get("case_number")),
        "disposal_nature": _as_text(judgment.get("disposal_nature") or district_metadata.get("disposition")),
        "author_judge": _as_text(judgment.get("author_judge")),
        "judges": _as_list(judgment.get("judges")),
        "parties": judgment.get("parties") if isinstance(judgment.get("parties"), list) else _as_list(metadata.get("parties")),
        "statutes": sorted(set(statutes)),
        "sections": sorted(set(sections)),
        "offence_categories": sorted(set(offence_categories)),
        "outcomes": _as_list(judgment.get("outcomes")),
        "source_uri": _as_text(judgment.get("source_uri") or document_context.get("gcs_uri")),
        "source_path": _as_text(judgment.get("source_path") or document_context.get("source_path") or document_context.get("file_path")),
        "source_bucket": _as_text(judgment.get("source_bucket")),
        "source_license": _as_text(judgment.get("source_license") or source_metadata.get("license") or district_metadata.get("source_license")),
        "ocr_confidence": _as_float(judgment.get("ocr_confidence")) or _as_float(document_context.get("ocr_confidence")),
        "paragraph_anchor_confidence": _as_float(judgment.get("paragraph_anchor_confidence")),
        "metadata_confidence": confidence,
        "source_quality": source_quality,
        "sensitive_data_flags": sorted(set(sensitive_flags)),
        "redaction_status": _safe_status(
            _as_text(judgment.get("redaction_status")),
            {"not_required", "pending", "redacted", "restricted"},
            "not_required",
        ),
        "correction_status": _safe_status(
            _as_text(judgment.get("correction_status")),
            {"uncorrected", "corrected", "verified"},
            "uncorrected",
        ),
        "statute_sections": judgment.get("statute_sections") if isinstance(judgment.get("statute_sections"), list) else [],
        "outcome_details": judgment.get("outcome_details") if isinstance(judgment.get("outcome_details"), list) else [],
    }


def _has_judgment_signal(payload: dict) -> bool:
    return bool(
        payload.get("court_name")
        or payload.get("court_code")
        or payload.get("neutral_citation")
        or payload.get("cnr")
        or payload.get("statutes")
        or payload.get("outcome_details")
    )


def _upsert_judgment_metadata(
    workspace_id: str,
    document_id: str,
    metadata: dict,
    document_context: dict,
    confidence: float,
):
    payload = _judgment_payload(metadata, document_context, confidence)
    if not _has_judgment_signal(payload):
        return

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                INSERT INTO judgment_metadata (
                  workspace_id, document_id, canonical_judgment_id, court_code, court_name,
                  court_level, bench_strength, appeal_posture, decision_date, judgment_year,
                  incident_date, offence_date, fir_date, search_date, seizure_date,
                  applicable_legal_regime, statute_versions, neutral_citation, reporter_citations,
                  cnr, case_number, disposal_nature, author_judge, judges, parties, statutes,
                  sections, offence_categories, outcomes, source_uri, source_path, source_bucket,
                  source_license, ocr_confidence, paragraph_anchor_confidence, metadata_confidence,
                  source_quality, sensitive_data_flags, redaction_status, correction_status,
                  updated_at
                )
                VALUES (
                  %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s,
                  %s, %s::jsonb, %s, %s,
                  %s, %s, %s, %s, %s, %s::jsonb, %s,
                  %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s,
                  %s::jsonb, %s, %s, %s,
                  now()
                )
                ON CONFLICT (document_id) DO UPDATE SET
                  canonical_judgment_id = EXCLUDED.canonical_judgment_id,
                  court_code = EXCLUDED.court_code,
                  court_name = EXCLUDED.court_name,
                  court_level = EXCLUDED.court_level,
                  bench_strength = EXCLUDED.bench_strength,
                  appeal_posture = EXCLUDED.appeal_posture,
                  decision_date = EXCLUDED.decision_date,
                  judgment_year = EXCLUDED.judgment_year,
                  incident_date = EXCLUDED.incident_date,
                  offence_date = EXCLUDED.offence_date,
                  fir_date = EXCLUDED.fir_date,
                  search_date = EXCLUDED.search_date,
                  seizure_date = EXCLUDED.seizure_date,
                  applicable_legal_regime = EXCLUDED.applicable_legal_regime,
                  statute_versions = EXCLUDED.statute_versions,
                  neutral_citation = EXCLUDED.neutral_citation,
                  reporter_citations = EXCLUDED.reporter_citations,
                  cnr = EXCLUDED.cnr,
                  case_number = EXCLUDED.case_number,
                  disposal_nature = EXCLUDED.disposal_nature,
                  author_judge = EXCLUDED.author_judge,
                  judges = EXCLUDED.judges,
                  parties = EXCLUDED.parties,
                  statutes = EXCLUDED.statutes,
                  sections = EXCLUDED.sections,
                  offence_categories = EXCLUDED.offence_categories,
                  outcomes = EXCLUDED.outcomes,
                  source_uri = EXCLUDED.source_uri,
                  source_path = EXCLUDED.source_path,
                  source_bucket = EXCLUDED.source_bucket,
                  source_license = EXCLUDED.source_license,
                  ocr_confidence = EXCLUDED.ocr_confidence,
                  paragraph_anchor_confidence = EXCLUDED.paragraph_anchor_confidence,
                  metadata_confidence = EXCLUDED.metadata_confidence,
                  source_quality = EXCLUDED.source_quality,
                  sensitive_data_flags = EXCLUDED.sensitive_data_flags,
                  redaction_status = EXCLUDED.redaction_status,
                  correction_status = EXCLUDED.correction_status,
                  updated_at = now()
            """, (
                workspace_id, document_id, payload["canonical_judgment_id"], payload["court_code"], payload["court_name"],
                payload["court_level"], payload["bench_strength"], payload["appeal_posture"], payload["decision_date"], payload["judgment_year"],
                payload["incident_date"], payload["offence_date"], payload["fir_date"], payload["search_date"], payload["seizure_date"],
                payload["applicable_legal_regime"], json.dumps(payload["statute_versions"]), payload["neutral_citation"], payload["reporter_citations"],
                payload["cnr"], payload["case_number"], payload["disposal_nature"], payload["author_judge"], payload["judges"], json.dumps(payload["parties"]),
                payload["statutes"], payload["sections"], payload["offence_categories"], payload["outcomes"], payload["source_uri"], payload["source_path"], payload["source_bucket"],
                payload["source_license"], payload["ocr_confidence"], payload["paragraph_anchor_confidence"], payload["metadata_confidence"],
                json.dumps(payload["source_quality"], default=str), payload["sensitive_data_flags"], payload["redaction_status"], payload["correction_status"],
            ))

            cur.execute("DELETE FROM judgment_statute_section WHERE document_id = %s", (document_id,))
            statute_rows = []
            for item in payload["statute_sections"]:
                if not isinstance(item, dict) or not _as_text(item.get("statute")):
                    continue
                statute_rows.append((
                    workspace_id,
                    document_id,
                    _as_text(item.get("statute")),
                    _as_text(item.get("section")),
                    _as_text(item.get("section_type")),
                    payload["applicable_legal_regime"],
                    _as_list(item.get("issue_tags")),
                    json.dumps(item.get("source_span") if isinstance(item.get("source_span"), dict) else {}),
                ))
            if not statute_rows:
                for statute in payload["statutes"]:
                    statute_rows.append((workspace_id, document_id, statute, None, None, payload["applicable_legal_regime"], [], "{}"))
                for section in payload["sections"]:
                    statute_rows.append((workspace_id, document_id, payload["statutes"][0] if payload["statutes"] else "unknown", section, None, payload["applicable_legal_regime"], [], "{}"))
            for row in statute_rows:
                cur.execute("""
                    INSERT INTO judgment_statute_section (
                      workspace_id, document_id, statute, section, section_type,
                      legal_regime, issue_tags, source_span
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """, row)

            cur.execute("DELETE FROM judgment_outcome WHERE document_id = %s", (document_id,))
            for item in payload["outcome_details"]:
                if not isinstance(item, dict):
                    continue
                cur.execute("""
                    INSERT INTO judgment_outcome (
                      workspace_id, document_id, accused_label, charge_label, statute, section,
                      trial_outcome, appeal_outcome, final_outcome, state_or_police_result,
                      reason_category, outcome_reason, source_span, metadata
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
                """, (
                    workspace_id,
                    document_id,
                    _as_text(item.get("accused_label")),
                    _as_text(item.get("charge_label")),
                    _as_text(item.get("statute")),
                    _as_text(item.get("section")),
                    _as_text(item.get("trial_outcome")),
                    _as_text(item.get("appeal_outcome")),
                    _as_text(item.get("final_outcome")),
                    _as_text(item.get("state_or_police_result")),
                    _as_text(item.get("reason_category")),
                    _as_text(item.get("outcome_reason")),
                    json.dumps(item.get("source_span") if isinstance(item.get("source_span"), dict) else {}),
                    json.dumps(item, default=str),
                ))

            cur.execute("DELETE FROM judgment_party WHERE document_id = %s", (document_id,))
            parties = payload["parties"]
            if all(isinstance(party, str) for party in parties):
                parties = [{"label": party, "role": None, "sensitive": False} for party in parties]
            for party in parties:
                if not isinstance(party, dict) or not _as_text(party.get("label")):
                    continue
                cur.execute("""
                    INSERT INTO judgment_party (
                      workspace_id, document_id, party_label, party_role,
                      normalized_name, sensitive_flag, metadata
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                """, (
                    workspace_id,
                    document_id,
                    _as_text(party.get("label")),
                    _as_text(party.get("role")),
                    (_as_text(party.get("label")) or "").lower(),
                    bool(party.get("sensitive")),
                    json.dumps(party, default=str),
                ))


def _current_model_details() -> tuple[str, str]:
    if config.LLM_PROVIDER == "openai":
        return "openai", config.OPENAI_CHAT_MODEL
    return config.LLM_PROVIDER, config.OLLAMA_CHAT_MODEL


def _extract_with_llm(text: str) -> dict:
    """Call LLM to extract structured metadata."""
    prompt = EXTRACTION_PROMPT + text

    if config.LLM_PROVIDER == "openai":
        return _call_openai(prompt)
    return _call_ollama(prompt)


def _call_openai(prompt: str) -> dict:
    """Extract metadata via OpenAI."""
    response = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {config.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": config.OPENAI_CHAT_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        },
        timeout=30.0,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return json.loads(content)


def _call_ollama(prompt: str) -> dict:
    """Extract metadata via Ollama."""
    response = httpx.post(
        f"{config.OLLAMA_BASE_URL}/api/chat",
        json={
            "model": config.OLLAMA_CHAT_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "format": "json",
            "stream": False,
            "options": {"temperature": 0.1},
        },
        timeout=60.0,
    )
    response.raise_for_status()
    content = response.json().get("message", {}).get("content", "{}")
    return json.loads(content)
