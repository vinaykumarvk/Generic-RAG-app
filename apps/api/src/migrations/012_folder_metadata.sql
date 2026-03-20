-- 012_folder_metadata.sql
-- Add source_path column to document table and GIN indexes for metadata filtering

ALTER TABLE document ADD COLUMN IF NOT EXISTS source_path TEXT;

CREATE INDEX IF NOT EXISTS idx_document_source_path
  ON document (workspace_id, source_path) WHERE source_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_metadata
  ON document USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_chunk_metadata
  ON chunk USING gin (metadata);
