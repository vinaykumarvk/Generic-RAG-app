"""Structured table semantics for retrieval and KG extraction.

Converts extracted table JSON into:
- deterministic row-level semantic text for chunking/search
- structured row objects for downstream inspection and future enrichment
"""

from __future__ import annotations

import re
from typing import Any

TABLE_JSON_BLOCK_RE = re.compile(r"\[TABLE_JSON\]\s*.*?\s*\[/TABLE_JSON\]", re.DOTALL)
WHITESPACE_RE = re.compile(r"\s+")
HEADER_KEY_RE = re.compile(r"[^a-z0-9]+")
SEMANTIC_VERSION = 1


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return WHITESPACE_RE.sub(" ", str(value)).strip()


def _build_headers(raw_headers: list[str], column_count: int) -> tuple[list[str], list[str]]:
    labels: list[str] = []
    keys: list[str] = []
    seen: dict[str, int] = {}

    for index in range(column_count):
        label = _clean_text(raw_headers[index]) if index < len(raw_headers) else ""
        label = label or f"Column {index + 1}"

        base_key = HEADER_KEY_RE.sub("_", label.lower()).strip("_") or f"column_{index + 1}"
        seen[base_key] = seen.get(base_key, 0) + 1
        key = base_key if seen[base_key] == 1 else f"{base_key}_{seen[base_key]}"

        labels.append(label)
        keys.append(key)

    return labels, keys


def _build_row_objects(headers: list[str], keys: list[str], rows: list[list[Any]]) -> list[dict[str, Any]]:
    row_objects: list[dict[str, Any]] = []

    for row_index, raw_row in enumerate(rows, start=1):
        cells = []
        for column_index, header in enumerate(headers):
            value = _clean_text(raw_row[column_index]) if column_index < len(raw_row) else ""
            if not value:
                continue
            cells.append({
                "header": header,
                "key": keys[column_index],
                "value": value,
            })

        if cells:
            row_objects.append({
                "row_index": row_index,
                "cells": cells,
            })

    return row_objects


def _table_header_blocks(metadata: dict[str, Any]) -> list[str]:
    table_index = metadata.get("table_index") or 1
    caption = _clean_text(metadata.get("caption"))
    headers = [_clean_text(header) for header in metadata.get("headers", []) if _clean_text(header)]

    title = f"Table {table_index}"
    if caption:
        title = f"{title}: {caption}"

    blocks = [title]
    if headers:
        blocks.append("Columns: " + "; ".join(headers) + ".")
    else:
        blocks.append("Columns were not detected.")
    return blocks


def _render_row_sentence(row: dict[str, Any]) -> str:
    row_index = row.get("row_index") or "?"
    facts = [
        f"{cell['header']} is {cell['value']}"
        for cell in row.get("cells", [])
        if _clean_text(cell.get("value"))
    ]
    if not facts:
        return f"Row {row_index} has no populated values."
    return f"Row {row_index}. " + ". ".join(facts) + "."


def render_semantic_table_text(
    metadata: dict[str, Any],
    row_objects: list[dict[str, Any]] | None = None,
) -> str:
    blocks = _table_header_blocks(metadata)
    rows = row_objects if row_objects is not None else metadata.get("row_objects", [])
    if rows:
        blocks.extend(_render_row_sentence(row) for row in rows)
    else:
        blocks.append("No populated rows were extracted from this table.")
    return "\n\n".join(blocks).strip()


def build_semantic_table_record(table_obj: dict[str, Any], table_index: int) -> dict[str, Any]:
    raw_headers = [_clean_text(header) for header in table_obj.get("headers", [])]
    rows = table_obj.get("rows", [])
    if not isinstance(rows, list):
        rows = []

    column_count = max(
        len(raw_headers),
        max((len(row) for row in rows if isinstance(row, list)), default=0),
    )
    headers, keys = _build_headers(raw_headers, column_count)
    row_objects = _build_row_objects(headers, keys, [row for row in rows if isinstance(row, list)])

    metadata: dict[str, Any] = {
        "table_index": table_index,
        "caption": _clean_text(table_obj.get("caption")),
        "headers": headers,
        "header_keys": keys,
        "row_count": len(row_objects),
        "row_objects": row_objects,
        "semantic_version": SEMANTIC_VERSION,
    }

    return {
        "content": render_semantic_table_text(metadata),
        "metadata": metadata,
    }


def build_semantic_table_chunks(
    metadata: dict[str, Any],
    max_chars: int,
    max_rows: int,
) -> list[str]:
    rows = metadata.get("row_objects", []) or []
    if not rows:
        return [render_semantic_table_text(metadata)]

    chunks: list[str] = []
    current_rows: list[dict[str, Any]] = []

    for row in rows:
        candidate_rows = current_rows + [row]
        candidate_text = render_semantic_table_text(metadata, candidate_rows)

        if current_rows and (len(candidate_rows) > max_rows or len(candidate_text) > max_chars):
            chunks.append(render_semantic_table_text(metadata, current_rows))
            current_rows = [row]
        else:
            current_rows = candidate_rows

    if current_rows:
        chunks.append(render_semantic_table_text(metadata, current_rows))

    return chunks


def strip_table_json_blocks(text: str) -> str:
    stripped = TABLE_JSON_BLOCK_RE.sub("\n\n", text)
    stripped = re.sub(r"\n{3,}", "\n\n", stripped)
    return stripped.strip()
