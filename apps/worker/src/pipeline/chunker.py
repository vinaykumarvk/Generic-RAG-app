"""Adaptive chunker — heading-aware splitting, table detection, narrative chunking, semantic chunking."""

import bisect
import json
import math
import re
import logging
from ..config import config
from ..db import get_connection, get_cursor
from .embedder import _get_embeddings
from .table_semantics import build_semantic_table_chunks, strip_table_json_blocks

logger = logging.getLogger(__name__)

# Approximate tokens per character ratio (conservative)
CHARS_PER_TOKEN = 4
MAX_CHUNK_CHARS = 10000  # Hard limit on chunk size (FR-006/BR-01)
MIN_CHUNK_CHARS = 50     # Merge chunks smaller than this (FR-006/BR-02)
TABLE_SPLIT_ROWS = 50    # Split tables larger than this (FR-006/BR-03)


def chunk_document(document_id: str, workspace_id: str):
    """Split document text into chunks with metadata.

    Reads chunking_strategy from:
    1. Ingestion job metadata (per-document override via ?strategy= param)
    2. CHUNKING_STRATEGY env var / config (global default: 'fixed')
    """
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

            cur.execute("""
                SELECT content, metadata
                FROM extraction_result
                WHERE document_id = %s AND extraction_type = 'TABLE'
                ORDER BY created_at, extraction_id
            """, (document_id,))
            table_rows = cur.fetchall()

            # Fetch document-level metadata for propagation to chunks
            cur.execute("""
                SELECT category, subcategory, source_path, metadata
                FROM document WHERE document_id = %s
            """, (document_id,))
            doc_row = cur.fetchone()

            # Check ingestion job metadata for per-document chunking strategy override (FR-006/AC-05)
            cur.execute("""
                SELECT metadata FROM ingestion_job
                WHERE document_id = %s AND step = 'CHUNK'
                ORDER BY created_at DESC LIMIT 1
            """, (document_id,))
            job_row = cur.fetchone()

    text = row["content"]
    table_extractions = table_rows or []

    # Determine chunking strategy: job metadata overrides global config
    strategy = config.CHUNKING_STRATEGY
    if job_row and job_row.get("metadata"):
        job_meta = job_row["metadata"]
        if isinstance(job_meta, str):
            try:
                job_meta = json.loads(job_meta)
            except (json.JSONDecodeError, TypeError):
                job_meta = {}
        if isinstance(job_meta, dict) and job_meta.get("chunking_strategy"):
            strategy = str(job_meta["chunking_strategy"])

    logger.info("Chunking document %s with strategy=%s", document_id, strategy)

    # Build chunk metadata from document-level folder metadata
    doc_metadata = {}
    if doc_row:
        raw_meta = doc_row.get("metadata")
        if isinstance(raw_meta, str):
            try:
                doc_metadata = json.loads(raw_meta)
            except (json.JSONDecodeError, TypeError):
                doc_metadata = {}
        elif isinstance(raw_meta, dict):
            doc_metadata = raw_meta
        if doc_row.get("category"):
            doc_metadata["category"] = doc_row["category"]
        if doc_row.get("subcategory"):
            doc_metadata["subcategory"] = doc_row["subcategory"]
        if doc_row.get("source_path"):
            doc_metadata["source_path"] = doc_row["source_path"]
    target_tokens = config.CHUNK_SIZE_TOKENS
    overlap_ratio = config.CHUNK_OVERLAP

    # Build page boundary map from form feeds (\f) or page markers (FR-006/AC-06)
    # Returns boundaries mapped to the clean text coordinate space
    narrative_text = strip_table_json_blocks(text)
    clean_text, page_boundaries = _build_page_boundaries(narrative_text)

    # Split into chunks based on strategy (FR-006/AC-02)
    if strategy == "semantic":
        narrative_chunks = _semantic_split(clean_text, target_tokens)
    else:
        narrative_chunks = _adaptive_split(clean_text, target_tokens, overlap_ratio)

    # Post-processing: enforce MAX_CHUNK_CHARS hard limit
    narrative_chunks = _enforce_max_chunk_chars(narrative_chunks, MAX_CHUNK_CHARS)

    # Post-processing: merge tiny chunks
    narrative_chunks = _merge_tiny_chunks(narrative_chunks, MIN_CHUNK_CHARS)

    # Assign page_start and page_end to each chunk (FR-006/AC-06)
    _assign_page_numbers(narrative_chunks, clean_text, page_boundaries)

    table_chunks = _build_table_chunks(table_extractions, target_tokens * CHARS_PER_TOKEN)
    chunks = narrative_chunks + table_chunks

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
                    chunk.get("heading_path"), json.dumps(doc_metadata)
                ))

            # Update document chunk count
            cur.execute("""
                UPDATE document SET chunk_count = %s, updated_at = now() WHERE document_id = %s
            """, (len(chunks), document_id))

    logger.info(f"Document {document_id} chunked: {len(chunks)} chunks")


def _build_table_chunks(table_extractions: list, target_chars: int) -> list:
    """Build TABLE chunks from semantic table extraction results."""
    chunks = []

    for index, table_row in enumerate(table_extractions, start=1):
        metadata = table_row.get("metadata") or {}
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except (json.JSONDecodeError, TypeError):
                metadata = {}

        chunk_texts = build_semantic_table_chunks(
            metadata,
            max_chars=target_chars,
            max_rows=TABLE_SPLIT_ROWS,
        ) if metadata else []

        if not chunk_texts:
            content = (table_row.get("content") or "").strip()
            if content:
                chunk_texts = [content]

        heading_path = metadata.get("caption") or f"Table {metadata.get('table_index') or index}"

        for chunk_text in chunk_texts:
            chunks.append({
                "content": chunk_text,
                "type": "TABLE",
                "heading_path": heading_path,
                "page_start": metadata.get("page_start", metadata.get("page_number")),
                "page_end": metadata.get("page_end", metadata.get("page_number")),
            })

    return chunks


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
            table_chunks = _split_table(content, heading)
            chunks.extend(table_chunks)
            continue

        # Split narrative text — try paragraph boundaries first
        if len(content) <= target_chars:
            chunks.append({
                "content": f"{heading}\n{content}" if heading else content,
                "type": "NARRATIVE",
                "heading_path": heading,
            })
        else:
            # Try paragraph-based splitting first (FR-006/AC-03)
            sub_chunks = _split_by_paragraphs(content, target_chars, overlap_chars)
            if not sub_chunks:
                sub_chunks = _split_narrative(content, target_chars, overlap_chars)
            for j, sub in enumerate(sub_chunks):
                prefix = f"{heading}\n" if heading and j == 0 else ""
                chunks.append({
                    "content": f"{prefix}{sub}",
                    "type": "NARRATIVE",
                    "heading_path": heading,
                })

    return chunks


def _semantic_split(text: str, target_tokens: int) -> list:
    """Split text into chunks using embedding-based semantic similarity (FR-006/AC-02).

    Steps:
    1. Split text into sentences
    2. Get embeddings for each sentence via the configured embedder
    3. Compute cosine similarity between consecutive sentence embeddings
    4. Split where similarity drops below threshold
    5. Group sentences into chunks, respecting target token size
    """
    threshold = config.SEMANTIC_SIMILARITY_THRESHOLD
    target_chars = target_tokens * CHARS_PER_TOKEN

    # Step 1: Split into sentences
    sentences = re.split(r'(?<=[.!?])\s+', text)
    sentences = [s.strip() for s in sentences if s.strip()]

    if len(sentences) <= 1:
        return [{
            "content": text.strip(),
            "type": "SEMANTIC",
            "heading_path": "",
        }] if text.strip() else []

    # Step 2: Get embeddings for all sentences
    try:
        embeddings = _get_embeddings(sentences)
    except Exception as e:
        logger.warning(
            "Semantic chunking failed to get embeddings, falling back to adaptive: %s", str(e)
        )
        return _adaptive_split(text, target_tokens, config.CHUNK_OVERLAP)

    if len(embeddings) != len(sentences):
        logger.warning(
            "Embedding count mismatch (%d vs %d sentences), falling back to adaptive",
            len(embeddings), len(sentences)
        )
        return _adaptive_split(text, target_tokens, config.CHUNK_OVERLAP)

    # Step 3: Compute cosine similarity between consecutive sentence embeddings
    similarities = []
    for i in range(len(embeddings) - 1):
        sim = _cosine_similarity(embeddings[i], embeddings[i + 1])
        similarities.append(sim)

    # Step 4: Find split points where similarity drops below threshold
    split_indices = set()
    for i, sim in enumerate(similarities):
        if sim < threshold:
            split_indices.add(i + 1)  # Split after sentence i (before sentence i+1)

    # Step 5: Group sentences into chunks, also splitting when target_chars is exceeded
    chunks = []
    current_sentences = []
    current_len = 0

    for i, sentence in enumerate(sentences):
        should_split = (
            i in split_indices and current_sentences
        ) or (
            current_len + len(sentence) > target_chars and current_sentences
        )

        if should_split:
            chunk_text = " ".join(current_sentences)
            chunks.append({
                "content": chunk_text,
                "type": "SEMANTIC",
                "heading_path": "",
            })
            current_sentences = []
            current_len = 0

        current_sentences.append(sentence)
        current_len += len(sentence) + 1  # +1 for space

    # Flush remaining sentences
    if current_sentences:
        chunk_text = " ".join(current_sentences)
        chunks.append({
            "content": chunk_text,
            "type": "SEMANTIC",
            "heading_path": "",
        })

    logger.info(
        "Semantic chunking: %d sentences -> %d chunks (threshold=%.2f)",
        len(sentences), len(chunks), threshold
    )
    return chunks


def _cosine_similarity(vec_a: list, vec_b: list) -> float:
    """Compute cosine similarity between two embedding vectors."""
    dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot_product / (norm_a * norm_b)


def _split_by_headings(text: str) -> list:
    """Split text into sections by markdown-style headings and domain-specific labels."""
    # FR-009: Domain-specific section labels (Facts, Evidence, Findings, Order, etc.)
    heading_pattern = re.compile(
        r'^(#{1,4})\s+(.+)$|^((?:Facts|Evidence|Findings|Order|Judgment|Submission|'
        r'Statement|Investigation|Analysis|Conclusion|Recommendation|Background|'
        r'Observations|Discussion|Prayer|Annexure|Appendix|Schedule)\b.*)$',
        re.MULTILINE | re.IGNORECASE
    )
    sections = []
    last_end = 0
    current_heading = ""

    for match in heading_pattern.finditer(text):
        # Add content before this heading
        content = text[last_end:match.start()].strip()
        if content:
            sections.append({"heading": current_heading, "content": content})
        # FR-009: Handle both markdown headings and domain-specific labels
        current_heading = (match.group(2) or match.group(3) or "").strip()
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


def _split_by_paragraphs(text: str, target_chars: int, overlap_chars: int) -> list:
    """Split text at paragraph boundaries (FR-006/AC-03)."""
    paragraphs = re.split(r'\n\s*\n', text)
    if len(paragraphs) < 2:
        return []

    chunks = []
    current = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(current) + len(para) + 2 > target_chars and current:
            chunks.append(current.strip())
            # Add overlap
            if overlap_chars > 0 and len(current) > overlap_chars:
                current = current[-overlap_chars:] + "\n\n" + para
            else:
                current = para
        else:
            current = current + "\n\n" + para if current else para

    if current.strip():
        chunks.append(current.strip())

    return chunks


def _split_table(content: str, heading: str) -> list:
    """Split tables >TABLE_SPLIT_ROWS into sub-tables preserving header (FR-006/BR-03)."""
    lines = content.strip().split("\n")
    if len(lines) <= TABLE_SPLIT_ROWS:
        return [{
            "content": f"{heading}\n{content}" if heading else content,
            "type": "TABLE",
            "heading_path": heading,
        }]

    # First row is header
    header = lines[0]
    data_rows = lines[1:]
    chunks = []

    for i in range(0, len(data_rows), TABLE_SPLIT_ROWS):
        batch = data_rows[i:i + TABLE_SPLIT_ROWS]
        table_content = header + "\n" + "\n".join(batch)
        prefix = f"{heading}\n" if heading else ""
        chunks.append({
            "content": f"{prefix}{table_content}",
            "type": "TABLE",
            "heading_path": heading,
        })

    return chunks


def _enforce_max_chunk_chars(chunks: list, max_chars: int) -> list:
    """Hard-split any chunks exceeding MAX_CHUNK_CHARS (FR-006/BR-01)."""
    result = []
    for chunk in chunks:
        content = chunk["content"]
        if len(content) <= max_chars:
            result.append(chunk)
        else:
            # Force split at sentence boundaries within max_chars
            parts = _split_narrative(content, max_chars, 0)
            for part in parts:
                result.append({
                    "content": part,
                    "type": chunk["type"],
                    "heading_path": chunk.get("heading_path"),
                })
    return result


def _merge_tiny_chunks(chunks: list, min_chars: int) -> list:
    """Merge chunks smaller than min_chars with their neighbor (FR-006/BR-02)."""
    if not chunks:
        return chunks

    result = []
    for chunk in chunks:
        if result and len(chunk["content"]) < min_chars and chunk["type"] == result[-1]["type"]:
            result[-1]["content"] += "\n" + chunk["content"]
        else:
            result.append(chunk)

    return result


def _build_page_boundaries(text: str) -> tuple:
    """Build page boundaries and produce clean text with form feeds replaced (FR-006/AC-06).

    Detects page boundaries from form feed characters (\\f) or <!-- PAGE n --> markers.
    Returns (clean_text, boundaries) where boundaries is a sorted list of
    (char_offset_in_clean_text, page_number) tuples. Page 1 always starts at offset 0.
    """
    replacement = "\n\n"
    boundaries = [(0, 1)]

    # Check for form feed characters (primary page marker from PDF extraction)
    if "\f" in text:
        page_num = 1
        # Build clean text by replacing \f with \n\n, tracking new offsets
        clean_parts = []
        offset_in_clean = 0
        segments = text.split("\f")
        for idx, segment in enumerate(segments):
            if idx > 0:
                page_num += 1
                # Add the replacement text between pages
                clean_parts.append(replacement)
                offset_in_clean += len(replacement)
                # The new page starts here (at the beginning of this segment)
                boundaries.append((offset_in_clean, page_num))
            clean_parts.append(segment)
            offset_in_clean += len(segment)

        clean_text = "".join(clean_parts)
        return clean_text, boundaries

    # Fallback: look for explicit page markers <!-- PAGE n -->
    page_marker_pattern = re.compile(r'<!-- PAGE (\d+) -->')
    for match in page_marker_pattern.finditer(text):
        pn = int(match.group(1))
        boundaries.append((match.start(), pn))

    if len(boundaries) > 1:
        boundaries.sort(key=lambda x: x[0])

    return text, boundaries


def _assign_page_numbers(chunks: list, clean_text: str, page_boundaries: list):
    """Assign page_start and page_end to each chunk based on page boundaries (FR-006/AC-06).

    Searches for each chunk's content position in the full text and determines
    which page(s) it spans using the page boundary map.
    """
    if len(page_boundaries) <= 1:
        # Single page or no page markers — all chunks are page 1
        for chunk in chunks:
            chunk["page_start"] = 1
            chunk["page_end"] = 1
        return

    # Build a mapping: for any character offset, which page is it on?
    # page_boundaries is sorted list of (offset, page_number)
    boundary_offsets = [b[0] for b in page_boundaries]
    boundary_pages = [b[1] for b in page_boundaries]

    def _get_page_at_offset(offset: int) -> int:
        """Return the page number for a given character offset."""
        idx = bisect.bisect_right(boundary_offsets, offset) - 1
        if idx < 0:
            return 1
        return boundary_pages[idx]

    search_start = 0
    for chunk in chunks:
        content = chunk["content"]
        # Find chunk position in the full text
        pos = clean_text.find(content, search_start)
        if pos == -1:
            # Fallback: try from beginning (overlap chunks may go backwards)
            pos = clean_text.find(content)
        if pos == -1:
            # Could not locate chunk; try partial match with first 100 chars
            partial = content[:100]
            pos = clean_text.find(partial, search_start)
            if pos == -1:
                pos = clean_text.find(partial)

        if pos >= 0:
            chunk_start = pos
            chunk_end = pos + len(content)
            chunk["page_start"] = _get_page_at_offset(chunk_start)
            chunk["page_end"] = _get_page_at_offset(chunk_end - 1)
            # Advance search start for next chunk (but not past current end due to overlap)
            search_start = pos + 1
        else:
            # Cannot determine page; default to None
            chunk["page_start"] = None
            chunk["page_end"] = None
            logger.warning("Could not determine page numbers for chunk",
                           extra={"chunk_preview": content[:80]})
