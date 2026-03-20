"""Converter step — transforms tables to JSON and nested lists to hierarchy.

Runs between NORMALIZE and CHUNK. Processes extraction_result content
to produce structured representations of tables and lists.
"""

import json
import re
import logging
from typing import List
from ..db import get_connection, get_cursor
from ..storage import storage_client
from .table_semantics import build_semantic_table_record

logger = logging.getLogger(__name__)

PAGE_STABLE_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/bmp",
    "image/gif",
    "image/webp",
}


def _store_artifact_uris(document_id: str, artifact_uris: List[str]):
    """Append artifact URIs to document.extracted_metadata.artifact_uris[] (FR-005/AC-02).

    Uses jsonb_set with concatenation to append without overwriting existing entries.
    """
    if not artifact_uris:
        return

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            # Ensure extracted_metadata has artifact_uris array, then append new URIs
            cur.execute("""
                UPDATE document
                SET extracted_metadata = jsonb_set(
                    COALESCE(extracted_metadata, '{}'::jsonb),
                    '{artifact_uris}',
                    COALESCE(
                        extracted_metadata->'artifact_uris', '[]'::jsonb
                    ) || %s::jsonb,
                    true
                )
                WHERE document_id = %s
            """, (json.dumps(artifact_uris), document_id))

    logger.info(
        f"Stored {len(artifact_uris)} artifact URI(s) for document {document_id}"
    )


def convert_document(document_id: str, workspace_id: str):
    """Convert tables to JSON and detect list hierarchies in extracted text."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT er.extraction_id, er.content, d.mime_type, COALESCE(d.page_count, 1) AS page_count
                FROM extraction_result er
                JOIN document d ON d.document_id = er.document_id
                WHERE er.document_id = %s AND er.extraction_type = 'TEXT'
                ORDER BY er.created_at DESC LIMIT 1
            """, (document_id,))
            row = cur.fetchone()
            if not row:
                logger.info(f"No extraction result for document {document_id}, skipping convert")
                return

    text = row["content"]
    extraction_id = row["extraction_id"]
    mime_type = row["mime_type"]
    page_count = int(row.get("page_count") or 1)
    page_stable = mime_type in PAGE_STABLE_MIME_TYPES

    # Convert marked tables to JSON
    converted_text, table_artifacts = _convert_tables_to_json(text)
    table_page_spans = _extract_table_page_spans(text, page_stable=page_stable, page_count=page_count)
    semantic_tables = [
        build_semantic_table_record(table_obj, table_index=index + 1)
        for index, table_obj in enumerate(table_artifacts)
    ]
    for index, table in enumerate(semantic_tables):
        if index < len(table_page_spans):
            table["metadata"].update(table_page_spans[index])

    # Convert nested lists to hierarchy
    converted_text = _convert_lists_to_hierarchy(converted_text)

    # Upload any generated artifacts to storage and track their URIs (FR-005/AC-02)
    artifact_uris: List[str] = []
    for idx, artifact_data in enumerate(table_artifacts):
        artifact_name = f"table_{idx}.json"
        content_bytes = json.dumps(artifact_data, ensure_ascii=False, indent=2).encode("utf-8")
        try:
            uri = storage_client.upload_artifact(
                doc_id=document_id,
                artifact_name=artifact_name,
                content=content_bytes,
                content_type="application/json",
            )
            artifact_uris.append(uri)
            semantic_tables[idx]["metadata"]["artifact_uri"] = uri
        except Exception:
            logger.warning(
                f"Failed to upload artifact {artifact_name} for document {document_id}",
                exc_info=True,
            )

    if artifact_uris:
        _store_artifact_uris(document_id, artifact_uris)

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                DELETE FROM extraction_result
                WHERE document_id = %s AND extraction_type = 'TABLE'
            """, (document_id,))

            if converted_text != text:
                cur.execute("""
                    UPDATE extraction_result SET content = %s WHERE extraction_id = %s
                """, (converted_text, extraction_id))

            for table in semantic_tables:
                cur.execute("""
                    INSERT INTO extraction_result (document_id, extraction_type, content, confidence, metadata)
                    VALUES (%s, 'TABLE', %s, %s, %s)
                """, (
                    document_id,
                    table["content"],
                    1.0,
                    json.dumps(table["metadata"], ensure_ascii=False),
                ))

    if converted_text != text or semantic_tables:
        logger.info(
            "Document %s converted: %d semantic table(s), list/table transforms applied",
            document_id,
            len(semantic_tables),
        )
    else:
        logger.info(f"Document {document_id}: no conversions needed")


def _convert_tables_to_json(text: str) -> tuple:
    """Convert <!-- TABLE_START/END --> marked tables to JSON.

    Returns a tuple of (converted_text, table_artifacts) where table_artifacts
    is a list of parsed table data dicts suitable for artifact upload (FR-005/AC-02).
    """
    table_pattern = re.compile(
        r'<!-- TABLE_START -->\n(.*?)\n<!-- TABLE_END -->',
        re.DOTALL
    )

    table_artifacts: list = []

    def table_to_json(match: re.Match) -> str:
        table_text = match.group(1).strip()
        lines = [line.strip() for line in table_text.split("\n") if line.strip()]
        if not lines:
            return match.group(0)

        # Parse pipe-delimited rows
        parsed_rows: list = []
        for line in lines:
            cells = [cell.strip() for cell in line.split("|")]
            cells = [c for c in cells if c]  # Remove empty edge cells
            parsed_rows.append(cells)

        if len(parsed_rows) < 2:
            return match.group(0)

        # First row is header, rest are data rows (FR-004/AC-01)
        headers = parsed_rows[0]
        data_rows = [row for row in parsed_rows[1:]]

        table_obj: dict = {
            "headers": headers,
            "rows": data_rows,
            "caption": "",
        }

        try:
            json_str = json.dumps(table_obj, ensure_ascii=False, indent=2)
            # Collect artifact for GCS upload (FR-005/AC-02)
            table_artifacts.append(table_obj)
            return f"[TABLE_JSON]\n{json_str}\n[/TABLE_JSON]"
        except Exception:
            return match.group(0)

    converted = table_pattern.sub(table_to_json, text)
    return converted, table_artifacts


def _extract_table_page_spans(text: str, page_stable: bool, page_count: int) -> list[dict]:
    """Derive page provenance for tables from annotated TEXT extraction."""
    if not page_stable:
        return []

    token_pattern = re.compile(
        r'<!-- PAGE (\d+) -->|<!-- TABLE_START -->\n(.*?)\n<!-- TABLE_END -->',
        re.DOTALL
    )
    current_page = 1 if page_count == 1 else None
    spans: list[dict] = []

    for match in token_pattern.finditer(text):
        page_marker = match.group(1)
        if page_marker is not None:
            current_page = int(page_marker)
            continue

        if current_page is None:
            spans.append({})
        else:
            spans.append({
                "page_number": current_page,
                "page_start": current_page,
                "page_end": current_page,
            })

    return spans


def _convert_lists_to_hierarchy(text: str) -> str:
    """Detect and convert nested lists to hierarchical structure (FR-004/AC-02).

    Handles markdown-style and numbered lists with indentation.
    """
    lines = text.split("\n")
    result = []
    list_buffer = []
    in_list = False

    for line in lines:
        is_list_item = bool(re.match(r'^(\s*)([-*+]|\d+[.)]) ', line))

        if is_list_item:
            list_buffer.append(line)
            in_list = True
        else:
            if in_list and list_buffer:
                hierarchy = _parse_list_hierarchy(list_buffer)
                if hierarchy:
                    result.append(json.dumps(hierarchy, ensure_ascii=False, indent=2))
                else:
                    result.extend(list_buffer)
                list_buffer = []
                in_list = False
            result.append(line)

    # Flush remaining
    if list_buffer:
        hierarchy = _parse_list_hierarchy(list_buffer)
        if hierarchy:
            result.append(json.dumps(hierarchy, ensure_ascii=False, indent=2))
        else:
            result.extend(list_buffer)

    return "\n".join(result)


MAX_NESTING = 5  # Cap nesting depth to prevent unbounded recursion (FR-004/AC-02)


def _parse_list_hierarchy(lines: list) -> list:
    """Parse indented list lines into a nested structure."""
    if len(lines) < 2:
        return []

    root = []
    stack = [(root, -1)]

    for line in lines:
        match = re.match(r'^(\s*)([-*+]|\d+[.)]) (.+)$', line)
        if not match:
            continue

        indent = len(match.group(1))
        text = match.group(3).strip()

        item = {"text": text, "children": []}

        # Find parent level
        while len(stack) > 1 and stack[-1][1] >= indent:
            stack.pop()

        # Cap nesting depth (FR-004/AC-02)
        if len(stack) > MAX_NESTING:
            stack[MAX_NESTING - 1][0].append(item)
        else:
            stack[-1][0].append(item)
            stack.append((item["children"], indent))

    # Clean up empty children
    def clean(items: list) -> list:
        for item in items:
            if not item["children"]:
                del item["children"]
            else:
                clean(item["children"])
        return items

    return clean(root) if len(root) >= 2 else []
