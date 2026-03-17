"""Adaptive chunker — heading-aware splitting, table detection, narrative chunking."""

import re
import logging
from ..config import config
from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)

# Approximate tokens per character ratio (conservative)
CHARS_PER_TOKEN = 4


def chunk_document(document_id: str, workspace_id: str):
    """Split document text into chunks with metadata."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT content FROM extraction_result
                WHERE document_id = %s AND extraction_type = 'TEXT'
                ORDER BY created_at DESC LIMIT 1
            """, (document_id,))
            row = cur.fetchone()
            if not row:
                raise ValueError(f"No extraction result for document {document_id}")

    text = row["content"]
    target_tokens = config.CHUNK_SIZE_TOKENS
    overlap_ratio = config.CHUNK_OVERLAP

    # Split into chunks
    chunks = _adaptive_split(text, target_tokens, overlap_ratio)

    # Store chunks
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            # Remove existing chunks for this document
            cur.execute("DELETE FROM chunk WHERE document_id = %s", (document_id,))

            for i, chunk in enumerate(chunks):
                token_count = len(chunk["content"]) // CHARS_PER_TOKEN
                cur.execute("""
                    INSERT INTO chunk (document_id, workspace_id, chunk_index, content, chunk_type,
                                       token_count, page_start, page_end, heading_path, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    document_id, workspace_id, i, chunk["content"], chunk["type"],
                    token_count, chunk.get("page_start"), chunk.get("page_end"),
                    chunk.get("heading_path"), "{}"
                ))

            # Update document chunk count
            cur.execute("""
                UPDATE document SET chunk_count = %s, updated_at = now() WHERE document_id = %s
            """, (len(chunks), document_id))

    logger.info(f"Document {document_id} chunked: {len(chunks)} chunks")


def _adaptive_split(text: str, target_tokens: int, overlap_ratio: float) -> list:
    """Split text adaptively: detect headings, tables, and narrative blocks."""
    target_chars = target_tokens * CHARS_PER_TOKEN
    overlap_chars = int(target_chars * overlap_ratio)

    # Split into sections by headings
    sections = _split_by_headings(text)
    chunks = []

    for section in sections:
        heading = section.get("heading", "")
        content = section["content"]

        if not content.strip():
            continue

        # Detect if this section is a table
        if _is_table(content):
            chunks.append({
                "content": f"{heading}\n{content}" if heading else content,
                "type": "TABLE",
                "heading_path": heading,
            })
            continue

        # Split narrative text
        if len(content) <= target_chars:
            chunks.append({
                "content": f"{heading}\n{content}" if heading else content,
                "type": "NARRATIVE",
                "heading_path": heading,
            })
        else:
            # Split into overlapping chunks at sentence boundaries
            sub_chunks = _split_narrative(content, target_chars, overlap_chars)
            for j, sub in enumerate(sub_chunks):
                prefix = f"{heading}\n" if heading and j == 0 else ""
                chunks.append({
                    "content": f"{prefix}{sub}",
                    "type": "NARRATIVE",
                    "heading_path": heading,
                })

    return chunks


def _split_by_headings(text: str) -> list:
    """Split text into sections by markdown-style headings."""
    heading_pattern = re.compile(r'^(#{1,4})\s+(.+)$', re.MULTILINE)
    sections = []
    last_end = 0
    current_heading = ""

    for match in heading_pattern.finditer(text):
        # Add content before this heading
        content = text[last_end:match.start()].strip()
        if content:
            sections.append({"heading": current_heading, "content": content})
        current_heading = match.group(2).strip()
        last_end = match.end()

    # Add remaining content
    remaining = text[last_end:].strip()
    if remaining:
        sections.append({"heading": current_heading, "content": remaining})

    if not sections:
        sections.append({"heading": "", "content": text})

    return sections


def _is_table(text: str) -> bool:
    """Detect if text block is primarily tabular data."""
    lines = text.strip().split("\n")
    if len(lines) < 2:
        return False
    pipe_lines = sum(1 for line in lines if line.count("|") >= 2)
    return pipe_lines / len(lines) > 0.5


def _split_narrative(text: str, target_chars: int, overlap_chars: int) -> list:
    """Split narrative text at sentence boundaries with overlap."""
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks = []
    current = ""

    for sentence in sentences:
        if len(current) + len(sentence) > target_chars and current:
            chunks.append(current.strip())
            # Keep overlap from the end of current chunk
            if overlap_chars > 0 and len(current) > overlap_chars:
                current = current[-overlap_chars:] + " " + sentence
            else:
                current = sentence
        else:
            current = current + " " + sentence if current else sentence

    if current.strip():
        chunks.append(current.strip())

    return chunks
