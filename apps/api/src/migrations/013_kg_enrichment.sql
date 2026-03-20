-- IntelliRAG KG Enrichment
-- Adds subtype/confidence/sensitivity to graph_node, assertion and provenance tables

-- ============================================================================
-- graph_node additions
-- ============================================================================

ALTER TABLE graph_node ADD COLUMN IF NOT EXISTS subtype TEXT;

ALTER TABLE graph_node ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,4) NOT NULL DEFAULT 1.0;

ALTER TABLE graph_node ADD COLUMN IF NOT EXISTS sensitivity_level TEXT NOT NULL DEFAULT 'NONE'
  CHECK (sensitivity_level IN ('NONE','LOW','MEDIUM','HIGH','RESTRICTED'));

CREATE INDEX IF NOT EXISTS idx_graph_node_subtype
  ON graph_node (workspace_id, node_type, subtype);

CREATE INDEX IF NOT EXISTS idx_graph_node_sensitivity
  ON graph_node (workspace_id, sensitivity_level);

-- ============================================================================
-- KG Assertion
-- ============================================================================

CREATE TABLE IF NOT EXISTS kg_assertion (
  assertion_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id      UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  assertion_type    TEXT NOT NULL
    CHECK (assertion_type IN ('CLAIM','CONTRADICTION','FINDING','OPINION','FACT','ALLEGATION','RULING')),
  subject_node_id   UUID REFERENCES graph_node(node_id) ON DELETE SET NULL,
  predicate         TEXT NOT NULL,
  object_node_id    UUID REFERENCES graph_node(node_id) ON DELETE SET NULL,
  object_value      TEXT,
  confidence        NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','RETRACTED','SUPERSEDED')),
  evidence_edge_id  UUID REFERENCES graph_edge(edge_id) ON DELETE SET NULL,
  source_chunk_id   UUID REFERENCES chunk(chunk_id) ON DELETE SET NULL,
  document_id       UUID REFERENCES document(document_id) ON DELETE SET NULL,
  properties        JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kg_assertion_workspace
  ON kg_assertion (workspace_id, assertion_type);

CREATE INDEX IF NOT EXISTS idx_kg_assertion_subject
  ON kg_assertion (subject_node_id);

CREATE INDEX IF NOT EXISTS idx_kg_assertion_object
  ON kg_assertion (object_node_id);

CREATE INDEX IF NOT EXISTS idx_kg_assertion_document
  ON kg_assertion (document_id);

-- ============================================================================
-- KG Provenance
-- ============================================================================

CREATE TABLE IF NOT EXISTS kg_provenance (
  provenance_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id          UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  entity_type           TEXT NOT NULL
    CHECK (entity_type IN ('NODE','EDGE','ASSERTION')),
  entity_id             UUID NOT NULL,
  source_chunk_id       UUID REFERENCES chunk(chunk_id) ON DELETE SET NULL,
  document_id           UUID REFERENCES document(document_id) ON DELETE SET NULL,
  extraction_model      TEXT,
  extraction_prompt_hash TEXT,
  raw_extraction        JSONB,
  confidence            NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  extracted_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kg_provenance_workspace
  ON kg_provenance (workspace_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_kg_provenance_entity
  ON kg_provenance (entity_id);

CREATE INDEX IF NOT EXISTS idx_kg_provenance_document
  ON kg_provenance (document_id);

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (13, '013_kg_enrichment')
ON CONFLICT DO NOTHING;
