"""KG extraction — LLM-based entity and relationship extraction from document chunks."""

import json
import logging
import os
import httpx
from ..config import config
from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)

CHUNK_BATCH_SIZE = 5

# Default ontology used when workspace has no KG ontology configured
DEFAULT_ONTOLOGY = {
    "nodeTypes": [
        {"type": "person", "label": "Person"},
        {"type": "organization", "label": "Organization"},
        {"type": "concept", "label": "Concept"},
        {"type": "location", "label": "Location"},
        {"type": "date", "label": "Date"},
        {"type": "event", "label": "Event"},
        {"type": "technology", "label": "Technology"},
        {"type": "document", "label": "Document"},
    ],
    "edgeTypes": [
        {"type": "related_to", "label": "Related To", "directed": True},
        {"type": "part_of", "label": "Part Of", "directed": True},
        {"type": "created_by", "label": "Created By", "directed": True},
        {"type": "located_in", "label": "Located In", "directed": True},
        {"type": "occurred_at", "label": "Occurred At", "directed": True},
        {"type": "uses", "label": "Uses", "directed": True},
        {"type": "references", "label": "References", "directed": True},
    ],
}


def _get_workspace_ontology(workspace_id: str) -> dict:
    """Fetch KG ontology from workspace settings, falling back to default."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT settings FROM workspace WHERE workspace_id = %s",
                (workspace_id,),
            )
            row = cur.fetchone()

    if not row or not row.get("settings"):
        return DEFAULT_ONTOLOGY

    settings = row["settings"]
    if isinstance(settings, str):
        try:
            settings = json.loads(settings)
        except json.JSONDecodeError:
            return DEFAULT_ONTOLOGY

    ontology = settings.get("kgOntology")
    if not ontology or not ontology.get("nodeTypes"):
        return DEFAULT_ONTOLOGY

    return ontology


def _build_extraction_prompt(ontology: dict) -> str:
    """Build an LLM extraction prompt from workspace ontology."""
    node_types = ontology.get("nodeTypes", [])
    edge_types = ontology.get("edgeTypes", [])

    type_list = "|".join(nt["type"] for nt in node_types)
    type_descriptions = "\n".join(
        f"  - {nt['type']}: {nt.get('label', nt['type'])}" for nt in node_types
    )

    edge_list = ", ".join(et["type"] for et in edge_types)
    edge_descriptions = "\n".join(
        f"  - {et['type']}: {et.get('label', et['type'])}" for et in edge_types
    )

    return f"""Extract entities and relationships from this text using the ontology below.

Entity types:
{type_descriptions}

Relationship types:
{edge_descriptions}

Rules:
- Only use the entity types listed above
- Prefer the relationship types listed above, but you may introduce new ones if needed
- Normalize entity names (capitalize properly, remove redundancy)
- Each entity must have a brief description

Return JSON:
{{
  "nodes": [
    {{"name": "Entity Name", "type": "{type_list}", "description": "Brief description"}}
  ],
  "edges": [
    {{"source": "Entity A", "target": "Entity B", "type": "{edge_list}", "description": "Brief description"}}
  ]
}}

Text:
"""


def extract_kg(document_id: str, workspace_id: str):
    """Extract knowledge graph entities and relationships from document chunks."""
    ontology = _get_workspace_ontology(workspace_id)
    prompt = _build_extraction_prompt(ontology)

    logger.info(
        f"Using ontology with {len(ontology.get('nodeTypes', []))} node types, "
        f"{len(ontology.get('edgeTypes', []))} edge types for workspace {workspace_id}"
    )

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT chunk_id, content, chunk_index FROM chunk
                WHERE document_id = %s
                ORDER BY chunk_index
            """, (document_id,))
            chunks = cur.fetchall()

    if not chunks:
        logger.info(f"No chunks to extract KG from for document {document_id}")
        _update_document_status(document_id, "ACTIVE")
        return

    total = len(chunks)
    logger.info(f"Extracting KG from {total} chunks for document {document_id}")

    # Collect valid node types for validation
    valid_node_types = {nt["type"] for nt in ontology.get("nodeTypes", [])}

    all_nodes = []
    all_edges = []

    for i in range(0, total, CHUNK_BATCH_SIZE):
        batch = chunks[i:i + CHUNK_BATCH_SIZE]
        for chunk in batch:
            try:
                result = _extract_from_chunk(chunk["content"], prompt)
                if result:
                    for node in result.get("nodes", []):
                        # Validate node type against ontology; default to first type
                        if node.get("type") not in valid_node_types:
                            node["type"] = ontology["nodeTypes"][0]["type"]
                        node["chunk_id"] = chunk["chunk_id"]
                        all_nodes.append(node)
                    for edge in result.get("edges", []):
                        edge["chunk_id"] = chunk["chunk_id"]
                        all_edges.append(edge)
            except Exception as e:
                logger.warning(f"KG extraction failed for chunk {chunk['chunk_id']}: {e}")
                continue

        logger.info(f"Extracted batch {i // CHUNK_BATCH_SIZE + 1}/{(total + CHUNK_BATCH_SIZE - 1) // CHUNK_BATCH_SIZE}")

    # Deduplicate and store nodes
    _store_nodes(workspace_id, document_id, all_nodes)

    # Store edges
    _store_edges(workspace_id, document_id, all_edges)

    # Update document status to ACTIVE
    _update_document_status(document_id, "ACTIVE")

    logger.info(f"Document {document_id} KG extraction complete: {len(all_nodes)} nodes, {len(all_edges)} edges")


def _extract_from_chunk(content: str, prompt: str) -> dict | None:
    """Call LLM to extract entities and relationships from a chunk."""
    ollama_url = config.OLLAMA_BASE_URL
    chat_model = os.getenv("OLLAMA_CHAT_MODEL", "qwen3:35b")

    try:
        response = httpx.post(
            f"{ollama_url}/api/chat",
            json={
                "model": chat_model,
                "messages": [
                    {"role": "user", "content": prompt + content[:3000]}
                ],
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.1, "num_predict": 1024},
            },
            timeout=120.0,
        )
        response.raise_for_status()
        data = response.json()
        content_text = data.get("message", {}).get("content", "")

        # Parse JSON from response
        result = json.loads(content_text)
        return result
    except (json.JSONDecodeError, httpx.HTTPError) as e:
        logger.warning(f"KG extraction LLM call failed: {e}")
        return None


def _store_nodes(workspace_id: str, document_id: str, nodes: list):
    """Store nodes with deduplication by normalized name + type."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            for node in nodes:
                name = node.get("name", "").strip()
                if not name:
                    continue
                normalized = name.lower().strip()
                node_type = node.get("type", "concept")
                description = node.get("description", "")

                # Upsert: if exists, increment source_count
                cur.execute("""
                    INSERT INTO graph_node (workspace_id, name, normalized_name, node_type, description)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (workspace_id, normalized_name, node_type)
                    DO UPDATE SET source_count = graph_node.source_count + 1,
                                  description = CASE
                                    WHEN length(EXCLUDED.description) > length(COALESCE(graph_node.description, ''))
                                    THEN EXCLUDED.description
                                    ELSE graph_node.description
                                  END,
                                  updated_at = now()
                """, (workspace_id, name, normalized, node_type, description))

    # Embed node descriptions
    _embed_node_descriptions(workspace_id)


def _embed_node_descriptions(workspace_id: str):
    """Embed descriptions for nodes that don't have embeddings yet."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT node_id, name, description FROM graph_node
                WHERE workspace_id = %s AND description_embedding IS NULL AND description IS NOT NULL AND description != ''
                LIMIT 50
            """, (workspace_id,))
            nodes = cur.fetchall()

    if not nodes:
        return

    texts = [f"{n['name']}: {n['description']}" for n in nodes]
    node_ids = [n["node_id"] for n in nodes]

    try:
        response = httpx.post(
            f"{config.OLLAMA_BASE_URL}/api/embed",
            json={"model": config.OLLAMA_EMBEDDING_MODEL, "input": texts},
            timeout=60.0,
        )
        response.raise_for_status()
        embeddings = response.json().get("embeddings", [])

        with get_connection() as conn:
            with get_cursor(conn) as cur:
                for node_id, embedding in zip(node_ids, embeddings):
                    vec_str = "[" + ",".join(str(v) for v in embedding) + "]"
                    cur.execute("UPDATE graph_node SET description_embedding = %s::vector WHERE node_id = %s",
                               (vec_str, node_id))
    except Exception as e:
        logger.warning(f"Failed to embed node descriptions: {e}")


def _store_edges(workspace_id: str, document_id: str, edges: list):
    """Store edges between existing nodes."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            for edge in edges:
                source_name = edge.get("source", "").strip().lower()
                target_name = edge.get("target", "").strip().lower()
                edge_type = edge.get("type", "related_to")

                if not source_name or not target_name:
                    continue

                # Look up source and target nodes
                cur.execute("""
                    SELECT node_id FROM graph_node
                    WHERE workspace_id = %s AND normalized_name = %s
                    LIMIT 1
                """, (workspace_id, source_name))
                source = cur.fetchone()

                cur.execute("""
                    SELECT node_id FROM graph_node
                    WHERE workspace_id = %s AND normalized_name = %s
                    LIMIT 1
                """, (workspace_id, target_name))
                target = cur.fetchone()

                if source and target:
                    cur.execute("""
                        INSERT INTO graph_edge (workspace_id, source_node_id, target_node_id, edge_type,
                                               evidence_chunk_id, document_id)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (workspace_id, source["node_id"], target["node_id"], edge_type,
                          edge.get("chunk_id"), document_id))


def _update_document_status(document_id: str, status: str):
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("UPDATE document SET status = %s, updated_at = now() WHERE document_id = %s",
                       (status, document_id))
