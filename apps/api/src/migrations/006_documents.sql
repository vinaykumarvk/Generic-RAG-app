-- IntelliRAG Documents & Ingestion Pipeline
-- Documents, chunks with pgvector embeddings, ingestion job queue

-- ============================================================================
-- Document
-- ============================================================================

CREATE TABLE document (
  document_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  file_path       TEXT NOT NULL,
  sha256          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'UPLOADED'
    CHECK (status IN ('UPLOADED','VALIDATING','NORMALIZING','CHUNKING','EMBEDDING','SEARCHABLE','KG_EXTRACTING','ACTIVE','FAILED','DELETED')),
  category        TEXT,
  subcategory     TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  page_count      INTEGER,
  chunk_count     INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  uploaded_by     UUID REFERENCES user_account(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_document_workspace ON document (workspace_id, status);
CREATE INDEX idx_document_sha256 ON document (workspace_id, sha256);
CREATE INDEX idx_document_status ON document (status) WHERE status != 'DELETED';

-- ============================================================================
-- Document Version
-- ============================================================================

CREATE TABLE document_version (
  version_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id     UUID NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  file_path       TEXT NOT NULL,
  sha256          TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  created_by      UUID REFERENCES user_account(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);

-- ============================================================================
-- Ingestion Job (PostgreSQL-backed queue)
-- ============================================================================

CREATE TABLE ingestion_job (
  job_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id   UUID NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  step          TEXT NOT NULL CHECK (step IN ('VALIDATE','NORMALIZE','CHUNK','EMBED','KG_EXTRACT')),
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','RETRYING')),
  priority      INTEGER NOT NULL DEFAULT 0,
  attempt       INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  progress      NUMERIC(5,2) NOT NULL DEFAULT 0,
  metadata      JSONB NOT NULL DEFAULT '{}',
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  locked_until  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_job_poll ON ingestion_job (status, priority DESC, created_at)
  WHERE status IN ('PENDING', 'RETRYING');
CREATE INDEX idx_ingestion_job_document ON ingestion_job (document_id);

-- ============================================================================
-- Chunk (with pgvector embedding + FTS)
-- ============================================================================

CREATE TABLE chunk (
  chunk_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id   UUID NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  chunk_type    TEXT NOT NULL DEFAULT 'NARRATIVE'
    CHECK (chunk_type IN ('NARRATIVE','TABLE','HEADING','LIST','CODE','IMAGE_OCR')),
  token_count   INTEGER NOT NULL,
  page_start    INTEGER,
  page_end      INTEGER,
  heading_path  TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  embedding     vector(768),
  fts_vector    tsvector,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for fast vector similarity search
CREATE INDEX idx_chunk_embedding ON chunk
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- Full-text search index
CREATE INDEX idx_chunk_fts ON chunk USING gin (fts_vector);

-- Composite index for workspace-scoped queries
CREATE INDEX idx_chunk_workspace ON chunk (workspace_id, document_id);

-- Auto-update FTS vector on insert/update
CREATE OR REPLACE FUNCTION chunk_fts_trigger() RETURNS trigger AS $$
BEGIN
  NEW.fts_vector := to_tsvector('english', NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chunk_fts
  BEFORE INSERT OR UPDATE OF content ON chunk
  FOR EACH ROW EXECUTE FUNCTION chunk_fts_trigger();

-- ============================================================================
-- Extraction Result
-- ============================================================================

CREATE TABLE extraction_result (
  extraction_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id     UUID NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
  extraction_type TEXT NOT NULL CHECK (extraction_type IN ('TEXT','OCR','TABLE','METADATA')),
  content         TEXT NOT NULL,
  page_number     INTEGER,
  confidence      NUMERIC(5,4),
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_extraction_document ON extraction_result (document_id);

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (6, '006_documents')
ON CONFLICT DO NOTHING;
