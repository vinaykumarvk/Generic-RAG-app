-- Migration 017: FTS indexes on document metadata + tsvector on graph_node
-- Covers FR-007/AC-04 (document metadata FTS) and FR-011/AC-03 (graph_node tsvector)

-- ============================================================================
-- 1. GIN index on document.extracted_metadata using jsonb_path_ops (FR-007/AC-04)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_document_extracted_metadata
  ON document USING gin (extracted_metadata jsonb_path_ops);

-- ============================================================================
-- 2. FTS index on document.custom_tags (FR-007/AC-04)
--
-- custom_tags is TEXT[] (added in 014_brd_gaps). Create a generated tsvector
-- column from the array and index it for full-text search.
-- ============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS custom_tags_tsv tsvector;

CREATE INDEX IF NOT EXISTS idx_document_custom_tags_tsv
  ON document USING gin (custom_tags_tsv);

-- Trigger to auto-populate custom_tags_tsv from the custom_tags array
CREATE OR REPLACE FUNCTION document_custom_tags_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.custom_tags_tsv := to_tsvector('simple', array_to_string(COALESCE(NEW.custom_tags, '{}'), ' '));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_custom_tags_tsv ON document;
CREATE TRIGGER trg_document_custom_tags_tsv
  BEFORE INSERT OR UPDATE OF custom_tags ON document
  FOR EACH ROW EXECUTE FUNCTION document_custom_tags_tsv_trigger();

-- Backfill existing rows
UPDATE document
SET custom_tags_tsv = to_tsvector('simple', array_to_string(COALESCE(custom_tags, '{}'), ' '))
WHERE custom_tags_tsv IS NULL;

-- ============================================================================
-- 3. tsvector column on graph_node for entity name FTS (FR-011/AC-03)
--
-- Replaces/supplements the trigram index with a dedicated tsvector column
-- on the entity name for more efficient full-text search.
-- ============================================================================

ALTER TABLE graph_node ADD COLUMN IF NOT EXISTS entity_name_tsv tsvector;

CREATE INDEX IF NOT EXISTS idx_graph_node_entity_name_tsv
  ON graph_node USING gin (entity_name_tsv);

-- Trigger to auto-populate entity_name_tsv from name column
CREATE OR REPLACE FUNCTION graph_node_entity_name_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.entity_name_tsv := to_tsvector('english', COALESCE(NEW.name, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_graph_node_entity_name_tsv ON graph_node;
CREATE TRIGGER trg_graph_node_entity_name_tsv
  BEFORE INSERT OR UPDATE OF name ON graph_node
  FOR EACH ROW EXECUTE FUNCTION graph_node_entity_name_tsv_trigger();

-- Backfill existing rows
UPDATE graph_node
SET entity_name_tsv = to_tsvector('english', COALESCE(name, ''))
WHERE entity_name_tsv IS NULL;

-- ============================================================================
-- Track migration
-- ============================================================================

INSERT INTO schema_migration (version, name) VALUES (17, '017_fts_graph_indexes')
ON CONFLICT DO NOTHING;
