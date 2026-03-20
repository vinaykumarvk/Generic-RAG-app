"""Embeds chunks using Ollama or OpenAI embeddings API, stores in pgvector."""

import logging
import httpx
from ..config import config
from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)

BATCH_SIZE = 1000  # Embed this many chunks at once (FR-008/AC-02)


E2E_TIMEOUT_S = 60  # End-to-end timeout for all embedding (FR-008/AC-01)


def embed_chunks(document_id: str, workspace_id: str):
    """Generate embeddings for all chunks of a document and store in pgvector."""
    import asyncio

    async def _embed_all():
        import hashlib

        with get_connection() as conn:
            with get_cursor(conn) as cur:
                cur.execute("""
                    SELECT chunk_id, content, content_hash FROM chunk
                    WHERE document_id = %s AND embedding IS NULL
                    ORDER BY chunk_index
                """, (document_id,))
                chunks = cur.fetchall()

        if not chunks:
            logger.info(f"No chunks to embed for document {document_id}")
            return

        # FR-010: Compute content_hash and skip unchanged chunks on reprocess
        to_embed = []
        skipped = 0
        for c in chunks:
            content_hash = hashlib.sha256(c["content"].encode("utf-8")).hexdigest()[:16]
            if c.get("content_hash") == content_hash:
                skipped += 1
                continue
            to_embed.append({**c, "_new_hash": content_hash})

        if skipped > 0:
            logger.info(f"Skipped {skipped} unchanged chunks (content_hash match)")

        if not to_embed:
            logger.info(f"All chunks already embedded for document {document_id}")
            return

        total = len(to_embed)
        logger.info(f"Embedding {total} chunks for document {document_id} via {config.LLM_PROVIDER}")

        for i in range(0, total, BATCH_SIZE):
            batch = to_embed[i:i + BATCH_SIZE]
            texts = [c["content"] for c in batch]
            chunk_ids = [c["chunk_id"] for c in batch]
            hashes = [c["_new_hash"] for c in batch]

            embeddings = _get_embeddings(texts)
            if len(embeddings) != len(texts):
                raise ValueError(
                    f"Embedding dimension mismatch: got {len(embeddings)} embeddings for {len(texts)} chunks. "
                    f"Check that your embedding model ({config.LLM_PROVIDER}) is configured correctly "
                    f"and supports batch input."
                )

            # FR-010: Validate embedding dimensions match DB schema
            if embeddings and len(embeddings[0]) != config.EMBEDDING_DIMENSIONS:
                raise ValueError(
                    f"Embedding dimension mismatch: model returned {len(embeddings[0])}d vectors "
                    f"but DB expects {config.EMBEDDING_DIMENSIONS}d. Update OLLAMA_EMBEDDING_DIMENSIONS "
                    f"or change the embedding model."
                )

            with get_connection() as conn:
                with get_cursor(conn) as cur:
                    for chunk_id, embedding, content_hash in zip(chunk_ids, embeddings, hashes):
                        vec_str = "[" + ",".join(str(v) for v in embedding) + "]"
                        cur.execute("""
                            UPDATE chunk SET embedding = %s::vector, content_hash = %s WHERE chunk_id = %s
                        """, (vec_str, content_hash, chunk_id))

            logger.info(f"Embedded batch {i // BATCH_SIZE + 1}/{(total + BATCH_SIZE - 1) // BATCH_SIZE}")

        logger.info(f"Document {document_id}: {total} chunks embedded")

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Already in async context — run directly with timeout
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, asyncio.wait_for(_embed_all(), timeout=E2E_TIMEOUT_S))
                future.result(timeout=E2E_TIMEOUT_S + 5)
        else:
            asyncio.run(asyncio.wait_for(_embed_all(), timeout=E2E_TIMEOUT_S))
    except asyncio.TimeoutError:
        raise TimeoutError(f"Embedding timed out after {E2E_TIMEOUT_S}s for document {document_id}")
    except RuntimeError:
        # No event loop — run directly
        asyncio.run(asyncio.wait_for(_embed_all(), timeout=E2E_TIMEOUT_S))


def _get_embeddings(texts: list) -> list:
    """Get embeddings from configured provider."""
    if config.LLM_PROVIDER == "openai":
        return _get_openai_embeddings(texts)
    return _get_ollama_embeddings(texts)


def _get_ollama_embeddings(texts: list) -> list:
    """Get embeddings from Ollama."""
    try:
        response = httpx.post(
            f"{config.OLLAMA_BASE_URL}/api/embed",
            json={"model": config.OLLAMA_EMBEDDING_MODEL, "input": texts},
            timeout=60.0,
        )
        response.raise_for_status()
        return response.json().get("embeddings", [])
    except Exception as e:
        logger.error(f"Ollama embedding API call failed: {e}")
        raise


def _get_openai_embeddings(texts: list) -> list:
    """Get embeddings from OpenAI, requesting dimensions to match DB schema."""
    try:
        response = httpx.post(
            "https://api.openai.com/v1/embeddings",
            headers={
                "Authorization": f"Bearer {config.OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": config.OPENAI_EMBEDDING_MODEL,
                "input": texts,
                "dimensions": config.EMBEDDING_DIMENSIONS,
            },
            timeout=60.0,
        )
        response.raise_for_status()
        data = response.json().get("data", [])
        return [item["embedding"] for item in data]
    except Exception as e:
        logger.error(f"OpenAI embedding API call failed: {e}")
        raise
