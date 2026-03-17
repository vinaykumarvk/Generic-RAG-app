"""Embeds chunks using Ollama or OpenAI embeddings API, stores in pgvector."""

import logging
import httpx
from ..config import config
from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)

BATCH_SIZE = 10  # Embed this many chunks at once


def embed_chunks(document_id: str, workspace_id: str):
    """Generate embeddings for all chunks of a document and store in pgvector."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT chunk_id, content FROM chunk
                WHERE document_id = %s AND embedding IS NULL
                ORDER BY chunk_index
            """, (document_id,))
            chunks = cur.fetchall()

    if not chunks:
        logger.info(f"No chunks to embed for document {document_id}")
        return

    total = len(chunks)
    logger.info(f"Embedding {total} chunks for document {document_id}")

    for i in range(0, total, BATCH_SIZE):
        batch = chunks[i:i + BATCH_SIZE]
        texts = [c["content"] for c in batch]
        chunk_ids = [c["chunk_id"] for c in batch]

        embeddings = _get_embeddings(texts)
        if len(embeddings) != len(texts):
            raise ValueError(f"Embedding count mismatch: got {len(embeddings)}, expected {len(texts)}")

        with get_connection() as conn:
            with get_cursor(conn) as cur:
                for chunk_id, embedding in zip(chunk_ids, embeddings):
                    # Store as pgvector format: '[0.1, 0.2, ...]'
                    vec_str = "[" + ",".join(str(v) for v in embedding) + "]"
                    cur.execute("""
                        UPDATE chunk SET embedding = %s::vector WHERE chunk_id = %s
                    """, (vec_str, chunk_id))

        logger.info(f"Embedded batch {i // BATCH_SIZE + 1}/{(total + BATCH_SIZE - 1) // BATCH_SIZE}")

    logger.info(f"Document {document_id}: {total} chunks embedded")


def _get_embeddings(texts: list) -> list:
    """Get embeddings from Ollama or OpenAI."""
    ollama_url = config.OLLAMA_BASE_URL
    model = config.OLLAMA_EMBEDDING_MODEL

    try:
        response = httpx.post(
            f"{ollama_url}/api/embed",
            json={"model": model, "input": texts},
            timeout=60.0,
        )
        response.raise_for_status()
        data = response.json()
        return data.get("embeddings", [])
    except Exception as e:
        logger.error(f"Embedding API call failed: {e}")
        raise
