"""Normalizes documents to text — PDF, DOCX, XLSX, plain text, with OCR fallback."""

import logging
import os
from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)


def normalize_document(document_id: str, workspace_id: str):
    """Extract text from document based on MIME type."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT file_path, mime_type, file_name FROM document WHERE document_id = %s",
                (document_id,)
            )
            doc = cur.fetchone()
            if not doc:
                raise ValueError(f"Document {document_id} not found")

    file_path = doc["file_path"]
    mime_type = doc["mime_type"]

    if mime_type == "application/pdf":
        text, page_count = _extract_pdf(file_path)
    elif mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        text, page_count = _extract_docx(file_path)
    elif mime_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        text, page_count = _extract_xlsx(file_path)
    elif mime_type in ("text/plain", "text/markdown", "text/csv"):
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
        page_count = 1
    else:
        raise ValueError(f"Unsupported MIME type for normalization: {mime_type}")

    if not text or len(text.strip()) < 10:
        # Try OCR fallback for PDFs
        if mime_type == "application/pdf":
            logger.info(f"PDF text extraction yielded minimal content, trying OCR for {document_id}")
            text, page_count = _ocr_pdf(file_path)
        if not text or len(text.strip()) < 10:
            raise ValueError("Document normalization produced no usable text")

    # Store extraction results
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                INSERT INTO extraction_result (document_id, extraction_type, content, metadata)
                VALUES (%s, 'TEXT', %s, %s)
            """, (document_id, text, f'{{"page_count": {page_count}}}'))

            cur.execute("""
                UPDATE document SET page_count = %s, updated_at = now() WHERE document_id = %s
            """, (page_count, document_id))

    logger.info(f"Document {document_id} normalized: {len(text)} chars, {page_count} pages")


def _extract_pdf(file_path: str) -> tuple:
    import pdfplumber
    texts = []
    with pdfplumber.open(file_path) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            text = page.extract_text() or ""
            tables = page.extract_tables()
            if tables:
                for table in tables:
                    rows = []
                    for row in table:
                        cells = [str(cell) if cell else "" for cell in row]
                        rows.append(" | ".join(cells))
                    text += "\n\n" + "\n".join(rows)
            texts.append(text)
    return "\n\n".join(texts), page_count


def _extract_docx(file_path: str) -> tuple:
    from docx import Document as DocxDocument
    doc = DocxDocument(file_path)
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    # Also extract tables
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            paragraphs.append(" | ".join(cells))
    return "\n\n".join(paragraphs), 1


def _extract_xlsx(file_path: str) -> tuple:
    from openpyxl import load_workbook
    wb = load_workbook(file_path, read_only=True, data_only=True)
    texts = []
    for sheet in wb.worksheets:
        rows = []
        for row in sheet.iter_rows(values_only=True):
            cells = [str(cell) if cell is not None else "" for cell in row]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            texts.append(f"Sheet: {sheet.title}\n" + "\n".join(rows))
    wb.close()
    return "\n\n".join(texts), len(wb.worksheets)


def _ocr_pdf(file_path: str) -> tuple:
    """OCR fallback using pytesseract on PDF pages."""
    try:
        import subprocess
        import pytesseract
        from PIL import Image
        import tempfile

        # Convert PDF pages to images using pdftoppm
        with tempfile.TemporaryDirectory() as tmpdir:
            subprocess.run(
                ["pdftoppm", "-png", "-r", "300", file_path, os.path.join(tmpdir, "page")],
                check=True, capture_output=True, timeout=120
            )
            images = sorted([f for f in os.listdir(tmpdir) if f.endswith(".png")])
            texts = []
            for img_file in images:
                img = Image.open(os.path.join(tmpdir, img_file))
                text = pytesseract.image_to_string(img)
                texts.append(text)
                img.close()
            return "\n\n".join(texts), len(images)
    except Exception as e:
        logger.warning(f"OCR fallback failed: {e}")
        return "", 0
