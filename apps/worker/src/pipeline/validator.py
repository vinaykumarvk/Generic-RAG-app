"""Validates uploaded documents — MIME type, file size, checksum."""

import hashlib
import os
import logging
from ..config import config
from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)


def validate_document(document_id: str, workspace_id: str):
    """Validate a document's file exists, MIME type is allowed, and checksum matches."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT file_path, mime_type, file_size_bytes, sha256 FROM document WHERE document_id = %s",
                (document_id,)
            )
            doc = cur.fetchone()
            if not doc:
                raise ValueError(f"Document {document_id} not found")

            file_path = doc["file_path"]
            mime_type = doc["mime_type"]
            expected_sha256 = doc["sha256"]

            # Check file exists
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"File not found: {file_path}")

            # Check file size
            file_size = os.path.getsize(file_path)
            if file_size > config.MAX_FILE_BYTES:
                raise ValueError(f"File too large: {file_size} bytes (max {config.MAX_FILE_BYTES})")

            # Check MIME type
            if mime_type not in config.ALLOWED_MIME_TYPES:
                raise ValueError(f"Unsupported MIME type: {mime_type}")

            # Verify checksum
            sha256 = hashlib.sha256()
            with open(file_path, "rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    sha256.update(chunk)
            actual_sha256 = sha256.hexdigest()

            if actual_sha256 != expected_sha256:
                raise ValueError(f"Checksum mismatch: expected {expected_sha256}, got {actual_sha256}")

            logger.info(f"Document {document_id} validated: {mime_type}, {file_size} bytes")
