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
                SELECT content FROM extraction_result
                WHERE document_id = %s AND extraction_type = 'TEXT'
                ORDER BY created_at DESC LIMIT 1
            """, (document_id,))
            row = cur.fetchone()
            if not row:
                logger.warning(f"No extraction result for document {document_id}, skipping metadata extraction")
                return

    text = row["content"]
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

    logger.info(f"Metadata extracted for {document_id}: confidence={confidence:.2f}")


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
