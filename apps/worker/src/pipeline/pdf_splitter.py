"""PDF splitter — splits large PDFs into page-based parts for parallel ingestion."""

import hashlib
import io
import logging
import math
import os
import uuid

from pypdf import PdfReader, PdfWriter

from ..config import config
from ..db import get_connection, get_cursor
from ..storage import storage_client

logger = logging.getLogger(__name__)


def split_document(document_id: str, workspace_id: str):
    """Split a large PDF into smaller parts. No-op for non-PDFs or small files."""
    threshold = config.PDF_SPLIT_THRESHOLD_BYTES
    if threshold <= 0:
        logger.info("PDF splitting disabled (threshold=0), skipping %s", document_id)
        return

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """SELECT file_path, file_name, mime_type, file_size_bytes, title,
                          category, subcategory, case_reference, sensitivity_level,
                          fir_number, station_code, org_unit_id, custom_tags,
                          source_path, uploaded_by, language
                   FROM document WHERE document_id = %s""",
                (document_id,),
            )
            doc = cur.fetchone()

    if not doc:
        raise ValueError(f"Document {document_id} not found")

    # Only split PDFs
    if doc["mime_type"] != "application/pdf":
        logger.info("Not a PDF (%s), skipping split for %s", doc["mime_type"], document_id)
        return

    # Only split files above threshold
    file_size = doc["file_size_bytes"] or 0
    if file_size <= threshold:
        logger.info("PDF %s (%d bytes) below threshold (%d), skipping split", document_id, file_size, threshold)
        return

    # Download file
    temp_path = storage_client.download_to_temp(doc["file_path"])
    try:
        _do_split(document_id, workspace_id, doc, temp_path, file_size, threshold)
    finally:
        storage_client.cleanup_temp(temp_path, doc["file_path"])


def _do_split(document_id: str, workspace_id: str, doc: dict, temp_path: str, file_size: int, threshold: int):
    """Perform the actual PDF split and persist results."""
    reader = PdfReader(temp_path)
    total_pages = len(reader.pages)

    if total_pages <= 1:
        logger.info("PDF %s has only %d page(s), skipping split", document_id, total_pages)
        return

    num_parts = min(math.ceil(file_size / threshold), total_pages)
    if num_parts <= 1:
        return

    pages_per_part = math.ceil(total_pages / num_parts)
    logger.info(
        "Splitting PDF %s: %d pages into %d parts (~%d pages each)",
        document_id, total_pages, num_parts, pages_per_part,
    )

    base_name = os.path.splitext(doc["file_name"])[0]
    parts: list[dict] = []

    for i in range(num_parts):
        start_page = i * pages_per_part
        end_page = min((i + 1) * pages_per_part, total_pages)
        if start_page >= total_pages:
            break

        part_num = i + 1
        writer = PdfWriter()
        for page_idx in range(start_page, end_page):
            writer.add_page(reader.pages[page_idx])

        buf = io.BytesIO()
        writer.write(buf)
        part_bytes = buf.getvalue()

        sha256 = hashlib.sha256(part_bytes).hexdigest()
        child_id = str(uuid.uuid4())
        part_filename = f"{base_name}_part{part_num}of{num_parts}.pdf"

        # Upload part to storage
        storage_path = storage_client.upload_document(workspace_id, child_id, part_filename, part_bytes)

        parts.append({
            "child_id": child_id,
            "part_num": part_num,
            "filename": part_filename,
            "file_path": storage_path,
            "file_size": len(part_bytes),
            "sha256": sha256,
            "page_start": start_page + 1,
            "page_end": end_page,
        })

    _persist_split_results(document_id, workspace_id, doc, parts, num_parts)


def _persist_split_results(document_id: str, workspace_id: str, doc: dict, parts: list[dict], total_parts: int):
    """Atomically create all child document records and jobs in a single transaction."""
    parent_title = doc["title"] or doc["file_name"]

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            for part in parts:
                child_title = f"{parent_title} (Part {part['part_num']} of {total_parts})"

                cur.execute(
                    """INSERT INTO document (
                        document_id, workspace_id, title, file_name, mime_type,
                        file_size_bytes, file_path, sha256, status,
                        category, subcategory, case_reference, sensitivity_level,
                        fir_number, station_code, org_unit_id, custom_tags,
                        source_path, uploaded_by, language,
                        parent_document_id, part_number, total_parts
                    ) VALUES (
                        %s, %s, %s, %s, 'application/pdf',
                        %s, %s, %s, 'UPLOADED',
                        %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s
                    )""",
                    (
                        part["child_id"], workspace_id, child_title, part["filename"],
                        part["file_size"], part["file_path"], part["sha256"],
                        doc["category"], doc["subcategory"], doc["case_reference"],
                        doc["sensitivity_level"],
                        doc["fir_number"], doc["station_code"], doc["org_unit_id"],
                        doc["custom_tags"],
                        doc["source_path"], doc["uploaded_by"], doc["language"],
                        document_id, part["part_num"], total_parts,
                    ),
                )

                # Create NORMALIZE job for child (skip re-validation — we just wrote it)
                cur.execute(
                    """INSERT INTO ingestion_job (document_id, workspace_id, step, status)
                       VALUES (%s, %s, 'NORMALIZE', 'PENDING')""",
                    (part["child_id"], workspace_id),
                )

            # Update parent status
            cur.execute(
                """UPDATE document
                   SET status = 'SPLIT_COMPLETE', total_parts = %s, updated_at = now()
                   WHERE document_id = %s""",
                (total_parts, document_id),
            )

            conn.commit()

    logger.info(
        "Split PDF %s into %d parts, parent marked SPLIT_COMPLETE",
        document_id, total_parts,
    )
