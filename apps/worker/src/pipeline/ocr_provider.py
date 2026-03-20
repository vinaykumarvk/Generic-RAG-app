"""Document AI OCR abstraction — PDF and image OCR via Google Document AI."""

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from ..config import config
from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)
MIN_OCR_TEXT_CHARS = 10


def _document_ai_enabled() -> bool:
    return bool(config.DOCUMENT_AI_PROJECT_ID and config.DOCUMENT_AI_PROCESSOR_ID)


def _has_usable_text(text: str) -> bool:
    return bool(text and len(text.strip()) >= MIN_OCR_TEXT_CHARS)


@lru_cache(maxsize=1)
def _get_documentai_module():
    try:
        from google.cloud import documentai_v1 as documentai
    except ImportError as exc:
        raise RuntimeError("google-cloud-documentai is not installed") from exc
    return documentai


@lru_cache(maxsize=1)
def _get_document_ai_client():
    documentai = _get_documentai_module()
    try:
        from google.api_core.client_options import ClientOptions
    except ImportError as exc:
        raise RuntimeError("google-api-core is not installed") from exc

    credentials_path = config.DOCUMENT_AI_CREDENTIALS_PATH.strip()
    client_options = ClientOptions(
        api_endpoint=f"{config.DOCUMENT_AI_LOCATION}-documentai.googleapis.com"
    )

    if credentials_path:
        if not os.path.exists(credentials_path):
            raise RuntimeError(
                f"Document AI credentials file not found: {credentials_path}"
            )

        try:
            from google.oauth2 import service_account
        except ImportError as exc:
            raise RuntimeError("google-auth is not installed") from exc

        credentials = service_account.Credentials.from_service_account_file(credentials_path)
        logger.info(
            "Initializing Document AI client with explicit credentials file",
            extra={"credentials_path": credentials_path, "location": config.DOCUMENT_AI_LOCATION},
        )
        return documentai.DocumentProcessorServiceClient(
            credentials=credentials,
            client_options=client_options,
        )

    logger.info(
        "Initializing Document AI client with application default credentials",
        extra={"location": config.DOCUMENT_AI_LOCATION},
    )
    return documentai.DocumentProcessorServiceClient(client_options=client_options)


def reset_document_ai_client():
    """Clear the cached Document AI client so the next OCR call recreates it."""
    _get_document_ai_client.cache_clear()


def _get_processor_name(client) -> str:
    return client.processor_path(
        config.DOCUMENT_AI_PROJECT_ID,
        config.DOCUMENT_AI_LOCATION,
        config.DOCUMENT_AI_PROCESSOR_ID,
    )


def ocr_pdf(file_path: str, document_id: str) -> tuple:
    """OCR a PDF using Document AI. Returns (text, page_count)."""
    if _document_ai_enabled():
        try:
            text, page_count = _ocr_document_ai(file_path, document_id, "application/pdf")
            if _has_usable_text(text):
                return text, page_count

            logger.warning(
                "Document AI OCR returned minimal content, falling back to pytesseract",
                extra={"document_id": document_id, "file_path": file_path},
            )
        except Exception as exc:
            logger.warning(
                "Document AI OCR failed, falling back to pytesseract",
                extra={"document_id": document_id, "file_path": file_path, "error": str(exc)},
            )

    text, page_count = _ocr_pytesseract_pdf(file_path)
    if _has_usable_text(text):
        _update_ocr_metadata(document_id, None)
    return text, page_count


def ocr_pdf_pages(file_path: str, document_id: str, page_indices: list) -> dict:
    """OCR specific pages of a PDF (FR-003/AC-02). Returns {page_index: text}."""
    if not page_indices:
        return {}

    if _document_ai_enabled():
        try:
            page_results, avg_confidence = _ocr_document_ai_pages(file_path, document_id, page_indices)
            missing_pages = [
                page_idx for page_idx in page_indices if not _has_usable_text(page_results.get(page_idx, ""))
            ]
            if not missing_pages:
                _update_ocr_metadata(document_id, avg_confidence)
                return page_results

            logger.warning(
                "Document AI per-page OCR returned minimal content, filling gaps with pytesseract",
                extra={"document_id": document_id, "missing_pages": [page + 1 for page in missing_pages]},
            )

            fallback_results = _ocr_pytesseract_pdf_pages(file_path, missing_pages)
            for page_idx, text in fallback_results.items():
                if _has_usable_text(text):
                    page_results[page_idx] = text

            if any(_has_usable_text(page_results.get(page_idx, "")) for page_idx in page_indices):
                _update_ocr_metadata(document_id, avg_confidence)

            return page_results
        except Exception as exc:
            logger.warning(
                "Document AI per-page OCR failed, falling back to pytesseract",
                extra={"document_id": document_id, "file_path": file_path, "error": str(exc)},
            )

    page_results = _ocr_pytesseract_pdf_pages(file_path, page_indices)
    if any(_has_usable_text(page_results.get(page_idx, "")) for page_idx in page_indices):
        _update_ocr_metadata(document_id, None)
    return page_results


def ocr_image(file_path: str, document_id: str, mime_type: str) -> tuple:
    """OCR an image file using Document AI. Returns (text, page_count=1)."""
    if _document_ai_enabled():
        try:
            text, page_count = _ocr_document_ai(file_path, document_id, mime_type)
            if _has_usable_text(text):
                return text, page_count

            logger.warning(
                "Document AI image OCR returned minimal content, falling back to pytesseract",
                extra={"document_id": document_id, "file_path": file_path},
            )
        except Exception as exc:
            logger.warning(
                "Document AI image OCR failed, falling back to pytesseract",
                extra={"document_id": document_id, "file_path": file_path, "error": str(exc)},
            )

    text, page_count = _ocr_pytesseract_image(file_path)
    if _has_usable_text(text):
        _update_ocr_metadata(document_id, None)
    return text, page_count


def _ocr_document_ai(file_path: str, document_id: str, mime_type: str) -> tuple:
    """OCR using Google Document AI with structure preservation (FR-003/AC-04)."""
    documentai = _get_documentai_module()
    client = _get_document_ai_client()
    name = _get_processor_name(client)

    with open(file_path, "rb") as f:
        content = f.read()

    request = documentai.ProcessRequest(
        name=name,
        raw_document=documentai.RawDocument(content=content, mime_type=mime_type),
    )

    result = client.process_document(request=request, timeout=config.OCR_PAGE_TIMEOUT_S)
    document = result.document

    page_texts = []
    total_confidence = 0.0

    for i, page in enumerate(document.pages):
        page_text = _extract_structured_page(document, page)

        page_conf = 0.0
        block_count = 0
        for block in page.blocks:
            page_conf += block.layout.confidence
            block_count += 1

        avg_conf = page_conf / block_count if block_count > 0 else 0.0
        page_texts.append(page_text)
        total_confidence += avg_conf

        if avg_conf < config.OCR_CONFIDENCE_THRESHOLD:
            logger.warning(
                "OCR page confidence below threshold",
                extra={
                    "document_id": document_id,
                    "page": i + 1,
                    "confidence": round(avg_conf, 3),
                    "threshold": config.OCR_CONFIDENCE_THRESHOLD,
                }
            )

    page_count = len(document.pages) or 1
    avg_confidence = total_confidence / page_count if page_count > 0 else 0.0
    full_text = "\f".join(page_texts)

    # Update document with OCR metadata
    _update_ocr_metadata(document_id, avg_confidence)

    # Log OCR accuracy (FR-003/AC-03)
    logger.info("OCR complete", extra={
        "document_id": document_id,
        "accuracy": f"{avg_confidence:.2%}",
        "page_count": page_count,
    })

    return full_text, page_count


def _extract_structured_page(document, page) -> str:
    """Extract structured text from a Document AI page, preserving tables/headers/lists (FR-003/AC-04).

    Uses layout blocks to detect tables, paragraphs, and blocks. Outputs
    <!-- TABLE_START/END --> markers for tables so downstream pipeline can process them.
    """
    parts = []

    # Extract tables with structure markers (FR-003/AC-04)
    if hasattr(page, "tables") and page.tables:
        for table in page.tables:
            table_text = _extract_table_structure(document, table)
            if table_text:
                parts.append(f"<!-- TABLE_START -->\n{table_text}\n<!-- TABLE_END -->")

    # Extract paragraphs (includes headings and body text)
    if hasattr(page, "paragraphs") and page.paragraphs:
        for paragraph in page.paragraphs:
            para_text = _get_layout_text(document, paragraph.layout)
            if para_text.strip():
                parts.append(para_text)
    elif hasattr(page, "blocks") and page.blocks:
        # Fallback: extract from blocks if no paragraph-level data
        for block in page.blocks:
            block_text = _get_layout_text(document, block.layout)
            if block_text.strip():
                parts.append(block_text)

    return "\n\n".join(parts) if parts else ""


def _extract_table_structure(document, table) -> str:
    """Extract table rows/columns from Document AI table object as pipe-delimited text."""
    rows = []
    if not hasattr(table, "header_rows"):
        return ""

    for header_row in (table.header_rows or []):
        cells = []
        for cell in (header_row.cells or []):
            cell_text = _get_layout_text(document, cell.layout).strip().replace("\n", " ")
            cells.append(cell_text)
        if cells:
            rows.append(" | ".join(cells))

    for body_row in (table.body_rows or []):
        cells = []
        for cell in (body_row.cells or []):
            cell_text = _get_layout_text(document, cell.layout).strip().replace("\n", " ")
            cells.append(cell_text)
        if cells:
            rows.append(" | ".join(cells))

    return "\n".join(rows)


def _get_layout_text(document, layout) -> str:
    """Extract text from a Document AI layout element using text anchors."""
    if not layout or not layout.text_anchor or not layout.text_anchor.text_segments:
        return ""
    text = ""
    for segment in layout.text_anchor.text_segments:
        start = int(segment.start_index) if segment.start_index else 0
        end = int(segment.end_index)
        text += document.text[start:end]
    return text


def _ocr_document_ai_pages(file_path: str, document_id: str, page_indices: list) -> tuple[dict, float | None]:
    """OCR specific pages via Document AI (FR-003/AC-02).

    Returns ({page_index: text}, average_confidence_for_selected_pages).
    """
    documentai = _get_documentai_module()
    client = _get_document_ai_client()
    name = _get_processor_name(client)

    with open(file_path, "rb") as f:
        content = f.read()

    request = documentai.ProcessRequest(
        name=name,
        raw_document=documentai.RawDocument(content=content, mime_type="application/pdf"),
    )

    result = client.process_document(request=request, timeout=config.OCR_PAGE_TIMEOUT_S)
    document = result.document

    page_results = {}
    page_confidences = []
    for page_idx in page_indices:
        if page_idx < len(document.pages):
            page = document.pages[page_idx]
            page_text = _extract_structured_page(document, page)
            page_results[page_idx] = page_text
            page_conf = 0.0
            block_count = 0
            for block in page.blocks:
                page_conf += block.layout.confidence
                block_count += 1
            if block_count > 0:
                page_confidences.append(page_conf / block_count)

    avg_confidence = (
        sum(page_confidences) / len(page_confidences)
        if page_confidences else None
    )
    logger.info("Per-page Document AI OCR complete",
                extra={"document_id": document_id, "pages_ocrd": len(page_results)})

    return page_results, avg_confidence


def _update_ocr_metadata(document_id: str, confidence: float | None):
    """Set ocr_applied and ocr_confidence on the document."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                UPDATE document
                SET ocr_applied = true,
                    ocr_confidence = COALESCE(%s, ocr_confidence),
                    updated_at = now()
                WHERE document_id = %s
            """, (round(confidence, 4) if confidence is not None else None, document_id))


def _ocr_pytesseract_pdf(file_path: str) -> tuple:
    """Fallback OCR using pytesseract on PDF pages."""
    try:
        import subprocess
        import pytesseract
        from PIL import Image
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            subprocess.run(
                ["pdftoppm", "-png", "-r", "300", file_path, os.path.join(tmpdir, "page")],
                check=True, capture_output=True,
                timeout=config.OCR_PAGE_TIMEOUT_S * 10,
            )
            images = sorted([f for f in os.listdir(tmpdir) if f.endswith(".png")])

            texts = []
            with ThreadPoolExecutor(max_workers=config.OCR_PARALLEL_PAGES) as executor:
                futures = {}
                for img_file in images:
                    img_path = os.path.join(tmpdir, img_file)
                    future = executor.submit(_ocr_single_page, img_path)
                    futures[future] = img_file

                for future in as_completed(futures):
                    try:
                        text = future.result(timeout=config.OCR_PAGE_TIMEOUT_S)
                        texts.append((futures[future], text))
                    except Exception as e:
                        logger.warning(f"OCR failed for page {futures[future]}: {e}")
                        texts.append((futures[future], ""))

            # Sort by filename to maintain page order
            texts.sort(key=lambda x: x[0])
            return "\f".join(t[1] for t in texts), len(images)
    except Exception as e:
        logger.warning(f"Pytesseract OCR fallback failed: {e}")
        return "", 0


def _ocr_pytesseract_image(file_path: str) -> tuple:
    """OCR a single image file using pytesseract."""
    try:
        import pytesseract
        from PIL import Image

        img = Image.open(file_path)
        text = pytesseract.image_to_string(img)
        img.close()
        return text, 1
    except Exception as e:
        logger.warning(f"Pytesseract image OCR failed: {e}")
        return "", 0


def _ocr_pytesseract_pdf_pages(file_path: str, page_indices: list) -> dict:
    """OCR specific PDF pages using pytesseract (FR-003/AC-02). Returns {page_index: text}."""
    try:
        import subprocess
        import tempfile

        results = {}
        with tempfile.TemporaryDirectory() as tmpdir:
            subprocess.run(
                ["pdftoppm", "-png", "-r", "300", file_path, os.path.join(tmpdir, "page")],
                check=True, capture_output=True,
                timeout=config.OCR_PAGE_TIMEOUT_S * 10,
            )
            images = sorted([f for f in os.listdir(tmpdir) if f.endswith(".png")])

            for page_idx in page_indices:
                if page_idx < len(images):
                    img_path = os.path.join(tmpdir, images[page_idx])
                    try:
                        text = _ocr_single_page(img_path)
                        results[page_idx] = text
                    except Exception as e:
                        logger.warning("Pytesseract per-page OCR failed",
                                       extra={"page": page_idx + 1, "error": str(e)})
                        results[page_idx] = ""

        return results
    except Exception as e:
        logger.warning("Pytesseract per-page OCR fallback failed", extra={"error": str(e)})
        return {}


def _ocr_single_page(image_path: str) -> str:
    """OCR a single page image."""
    import pytesseract
    from PIL import Image

    img = Image.open(image_path)
    text = pytesseract.image_to_string(img)
    img.close()
    return text
