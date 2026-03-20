-- Migration 016: Versioning, Feedback & Audit Enrichment
-- Supports FR-008, FR-019, FR-020, FR-006, FR-007, FR-009

-- ============================================================================
-- 1. Document Version enrichment (FR-008)
-- ============================================================================

ALTER TABLE document_version ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT false;

-- Only one current version per document
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_version_current
  ON document_version (document_id) WHERE is_current = true;

-- Citation version tracking
ALTER TABLE citation ADD COLUMN IF NOT EXISTS version_id UUID REFERENCES document_version(version_id) ON DELETE SET NULL;

-- ============================================================================
-- 2. Feedback enrichment (FR-019)
-- ============================================================================

-- Add 3-level feedback
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS feedback_level TEXT
  CHECK (feedback_level IN ('HELPFUL','PARTIALLY_HELPFUL','NOT_HELPFUL'));

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS issue_tags TEXT[] DEFAULT '{}';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES user_account(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_level
  ON feedback (workspace_id, feedback_level) WHERE feedback_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_unresolved
  ON feedback (workspace_id) WHERE resolved_at IS NULL AND feedback_type = 'THUMBS_DOWN';

-- ============================================================================
-- 3. Audit Event enrichment (FR-020)
-- ============================================================================

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS event_subtype TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_log_subtype
  ON audit_log (event_subtype) WHERE event_subtype IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_user_action
  ON audit_log (user_id, action, created_at);

-- ============================================================================
-- 4. Notification Event enrichment (FR-021)
-- ============================================================================

ALTER TABLE notification_event ADD COLUMN IF NOT EXISTS failed_state TEXT;
ALTER TABLE notification_event ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

-- ============================================================================
-- 5. Chunk enrichment (FR-009, FR-010)
-- ============================================================================

ALTER TABLE chunk ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE chunk ADD COLUMN IF NOT EXISTS ocr_confidence NUMERIC(5,4);

CREATE INDEX IF NOT EXISTS idx_chunk_content_hash
  ON chunk (document_id, content_hash) WHERE content_hash IS NOT NULL;

-- ============================================================================
-- 6. Document enrichment (FR-006, FR-007)
-- ============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS review_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE document ADD COLUMN IF NOT EXISTS metadata_confidence NUMERIC(5,4);

-- Add REPROCESSING and METADATA_EXTRACT statuses
ALTER TABLE document DROP CONSTRAINT IF EXISTS document_status_check;
ALTER TABLE document ADD CONSTRAINT document_status_check
  CHECK (status IN ('UPLOADED','VALIDATING','NORMALIZING','CONVERTING','CHUNKING','EMBEDDING',
                     'SEARCHABLE','KG_EXTRACTING','ACTIVE','FAILED','DELETED','REPROCESSING'));

-- Add METADATA_EXTRACT step to ingestion job
ALTER TABLE ingestion_job DROP CONSTRAINT IF EXISTS ingestion_job_step_check;
ALTER TABLE ingestion_job ADD CONSTRAINT ingestion_job_step_check
  CHECK (step IN ('VALIDATE','NORMALIZE','CONVERT','METADATA_EXTRACT','CHUNK','EMBED','KG_EXTRACT'));

-- ============================================================================
-- 7. Retrieval Run enrichment (FR-014)
-- ============================================================================

ALTER TABLE retrieval_run ADD COLUMN IF NOT EXISTS expanded_intent TEXT;
ALTER TABLE retrieval_run ADD COLUMN IF NOT EXISTS step_back_question TEXT;
ALTER TABLE retrieval_run ADD COLUMN IF NOT EXISTS retrieval_mode TEXT DEFAULT 'hybrid'
  CHECK (retrieval_mode IN ('hybrid','vector_only','metadata_only','graph_only'));
ALTER TABLE retrieval_run ADD COLUMN IF NOT EXISTS inferred_filters JSONB DEFAULT '{}';

-- ============================================================================
-- 8. Answer Cache enrichment (FR-017)
-- ============================================================================

ALTER TABLE answer_cache ADD COLUMN IF NOT EXISTS access_signature TEXT;
ALTER TABLE answer_cache ADD COLUMN IF NOT EXISTS active_filters JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_answer_cache_access
  ON answer_cache (workspace_id, preset, access_signature) WHERE access_signature IS NOT NULL;

-- ============================================================================
-- 9. Audit event append-only rule (FR-020)
-- ============================================================================

DO $$ BEGIN
  CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 10. Retention rules table (FR-NFR)
-- ============================================================================

CREATE TABLE IF NOT EXISTS retention_rule (
  rule_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('answer_cache','audit_log','notification_event','feedback','retrieval_run')),
  retention_days INTEGER NOT NULL DEFAULT 365,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track migration
INSERT INTO schema_migration (version, name) VALUES (16, '016_versioning_feedback')
ON CONFLICT DO NOTHING;
