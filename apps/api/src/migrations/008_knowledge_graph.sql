-- IntelliRAG Knowledge Graph
-- Graph nodes with description embeddings, edges with evidence links

-- ============================================================================
-- Graph Node
-- ============================================================================

CREATE TABLE graph_node (
  node_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id          UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  normalized_name       TEXT NOT NULL,
  node_type             TEXT NOT NULL,
  description           TEXT,
  properties            JSONB NOT NULL DEFAULT '{}',
  source_count          INTEGER NOT NULL DEFAULT 1,
  description_embedding vector(768),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for semantic node discovery
CREATE INDEX idx_graph_node_desc_embedding ON graph_node
  USING hnsw (description_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

-- Trigram index for fuzzy name matching
CREATE INDEX idx_graph_node_name_trgm ON graph_node
  USING gin (normalized_name gin_trgm_ops);

-- Composite for workspace lookups
CREATE INDEX idx_graph_node_workspace ON graph_node (workspace_id, node_type);

-- Unique constraint for deduplication
CREATE UNIQUE INDEX idx_graph_node_dedup ON graph_node (workspace_id, normalized_name, node_type);

-- ============================================================================
-- Graph Edge
-- ============================================================================

CREATE TABLE graph_edge (
  edge_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id      UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  source_node_id    UUID NOT NULL REFERENCES graph_node(node_id) ON DELETE CASCADE,
  target_node_id    UUID NOT NULL REFERENCES graph_node(node_id) ON DELETE CASCADE,
  edge_type         TEXT NOT NULL,
  label             TEXT,
  weight            NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  properties        JSONB NOT NULL DEFAULT '{}',
  evidence_chunk_id UUID REFERENCES chunk(chunk_id) ON DELETE SET NULL,
  document_id       UUID REFERENCES document(document_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_graph_edge_source ON graph_edge (source_node_id);
CREATE INDEX idx_graph_edge_target ON graph_edge (target_node_id);
CREATE INDEX idx_graph_edge_workspace ON graph_edge (workspace_id, edge_type);

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (8, '008_knowledge_graph')
ON CONFLICT DO NOTHING;
