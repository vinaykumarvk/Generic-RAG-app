-- Migration 014: BRD gap remediation — schema changes
-- Consolidated idempotent migration covering FR-001 through FR-025

-- =====================================================================
-- 1. Document table — GCS, OCR, metadata fields (FR-003, FR-005, FR-007)
-- =====================================================================
ALTER TABLE document ADD COLUMN IF NOT EXISTS gcs_uri TEXT;
ALTER TABLE document ADD COLUMN IF NOT EXISTS storage_class TEXT DEFAULT 'STANDARD';
ALTER TABLE document ADD COLUMN IF NOT EXISTS ocr_applied BOOLEAN DEFAULT false;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ocr_confidence NUMERIC(5,4);
ALTER TABLE document ADD COLUMN IF NOT EXISTS extracted_metadata JSONB DEFAULT '{}';
ALTER TABLE document ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE document ADD COLUMN IF NOT EXISTS custom_tags TEXT[] DEFAULT '{}';

-- =====================================================================
-- 2. Ingestion job step — add CONVERT (FR-002)
-- =====================================================================
-- Drop old CHECK and recreate with CONVERT included
ALTER TABLE ingestion_job DROP CONSTRAINT IF EXISTS ingestion_job_step_check;
ALTER TABLE ingestion_job ADD CONSTRAINT ingestion_job_step_check
  CHECK (step IN ('VALIDATE','NORMALIZE','CONVERT','CHUNK','EMBED','KG_EXTRACT'));

-- =====================================================================
-- 3. Document status — add CONVERTING (FR-004)
-- =====================================================================
ALTER TABLE document DROP CONSTRAINT IF EXISTS document_status_check;
ALTER TABLE document ADD CONSTRAINT document_status_check
  CHECK (status IN ('UPLOADED','VALIDATING','NORMALIZING','CONVERTING','CHUNKING','EMBEDDING','SEARCHABLE','KG_EXTRACTING','ACTIVE','FAILED','DELETED'));

-- =====================================================================
-- 4. User account — ARCHIVED status + soft-delete fields (FR-022)
-- =====================================================================
ALTER TABLE user_account DROP CONSTRAINT IF EXISTS user_account_status_check;
ALTER TABLE user_account ADD CONSTRAINT user_account_status_check
  CHECK (status IN ('ACTIVE', 'DISABLED', 'LOCKED', 'ARCHIVED'));

ALTER TABLE user_account ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS archived_by UUID;

-- =====================================================================
-- 5. System settings table (FR-023)
-- =====================================================================
CREATE TABLE IF NOT EXISTS system_setting (
  key TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT system_setting_value_type_check CHECK (value_type IN ('string', 'number', 'boolean', 'json'))
);

CREATE INDEX IF NOT EXISTS idx_system_setting_category ON system_setting(category);

-- Seed default settings
INSERT INTO system_setting (key, category, value, value_type, description) VALUES
  ('max_file_size_bytes', 'storage', '104857600', 'number', 'Maximum file upload size in bytes (100MB)'),
  ('storage_provider', 'storage', 'local', 'string', 'Storage provider: local or gcs'),
  ('gcs_bucket', 'storage', '', 'string', 'GCS bucket name'),
  ('chunk_size_tokens', 'chunking', '512', 'number', 'Target chunk size in tokens'),
  ('chunk_overlap_tokens', 'chunking', '50', 'number', 'Chunk overlap in tokens'),
  ('max_chunk_chars', 'chunking', '10000', 'number', 'Hard limit on chunk character count'),
  ('kg_confidence_threshold', 'knowledge_graph', '0.75', 'number', 'Minimum entity confidence for KG inclusion'),
  ('kg_dedup_threshold', 'knowledge_graph', '0.90', 'number', 'Similarity threshold for KG entity deduplication'),
  ('ocr_parallel_pages', 'ocr', '10', 'number', 'Number of pages to OCR in parallel'),
  ('ocr_confidence_threshold', 'ocr', '0.7', 'number', 'Minimum OCR confidence before warning'),
  ('ocr_page_timeout_s', 'ocr', '120', 'number', 'Per-page OCR timeout in seconds'),
  ('cache_ttl_hours', 'retrieval', '24', 'number', 'Answer cache TTL in hours'),
  ('query_expansion_timeout_ms', 'retrieval', '500', 'number', 'Query expansion timeout in milliseconds'),
  ('graph_context_timeout_ms', 'retrieval', '300', 'number', 'Graph context lookup timeout in milliseconds'),
  ('max_references', 'retrieval', '10', 'number', 'Maximum references appended to answers'),
  ('default_preset', 'retrieval', 'balanced', 'string', 'Default retrieval preset')
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- 6. Graph edge — unique constraint + weight check (FR-010)
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edge_dedup
  ON graph_edge(workspace_id, source_node_id, target_node_id, edge_type);

ALTER TABLE graph_edge DROP CONSTRAINT IF EXISTS graph_edge_weight_check;
ALTER TABLE graph_edge ADD CONSTRAINT graph_edge_weight_check
  CHECK (weight >= 0 AND weight <= 1);

-- =====================================================================
-- 7. Graph node/edge indexes for query performance (FR-011)
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_graph_edge_source_type ON graph_edge(source_node_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_graph_edge_target_type ON graph_edge(target_node_id, edge_type);

-- Graph node aliases with GIN index
ALTER TABLE graph_node ADD COLUMN IF NOT EXISTS aliases TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_graph_node_aliases ON graph_node USING GIN(aliases);

-- =====================================================================
-- 8. Conversation — pinned flag (FR-017)
-- =====================================================================
ALTER TABLE conversation ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;

-- =====================================================================
-- 9. Retrieval run — graph node tracking (FR-013)
-- =====================================================================
ALTER TABLE retrieval_run ADD COLUMN IF NOT EXISTS graph_node_ids TEXT[] DEFAULT '{}';

-- =====================================================================
-- 10. Ingestion volume materialized view (FR-024)
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'v_ingestion_volume') THEN
    EXECUTE '
      CREATE MATERIALIZED VIEW v_ingestion_volume AS
      SELECT
        date_trunc(''day'', d.created_at) AS day,
        d.workspace_id,
        count(*) AS doc_count,
        sum(d.file_size_bytes) AS total_bytes,
        count(*) FILTER (WHERE d.status = ''ACTIVE'') AS active_count,
        count(*) FILTER (WHERE d.status = ''FAILED'') AS failed_count,
        count(*) FILTER (WHERE d.status = ''SEARCHABLE'') AS searchable_count
      FROM document d
      WHERE d.status != ''DELETED''
      GROUP BY date_trunc(''day'', d.created_at), d.workspace_id
    ';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_v_ingestion_volume_day_ws
  ON v_ingestion_volume(day, workspace_id);

-- Record migration
INSERT INTO schema_migration (version, name)
VALUES (14, '014_brd_gaps')
ON CONFLICT (version) DO NOTHING;
