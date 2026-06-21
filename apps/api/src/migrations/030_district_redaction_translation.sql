-- District court redaction and translation foundation

-- 1. Add REDACT worker step and redaction document statuses.
ALTER TABLE ingestion_job DROP CONSTRAINT IF EXISTS ingestion_job_step_check;

ALTER TABLE ingestion_job ADD CONSTRAINT ingestion_job_step_check
  CHECK (step IN ('VALIDATE','SPLIT','NORMALIZE','CONVERT','METADATA_EXTRACT','REDACT','CHUNK','EMBED','KG_EXTRACT'));

ALTER TABLE document DROP CONSTRAINT IF EXISTS document_status_check;

ALTER TABLE document ADD CONSTRAINT document_status_check
  CHECK (
    status IN (
      'UPLOADED',
      'VALIDATING',
      'VALIDATED',
      'SPLITTING',
      'SPLIT_COMPLETE',
      'NORMALIZING',
      'CONVERTING',
      'METADATA_EXTRACTING',
      'REDACTING',
      'REDACTED',
      'CHUNKING',
      'CHUNKED',
      'EMBEDDING',
      'SEARCHABLE',
      'KG_EXTRACTING',
      'ACTIVE',
      'FAILED',
      'DELETED',
      'REPROCESSING'
    )
  );

-- 2. Allow redacted text as a first-class extraction artifact.
ALTER TABLE extraction_result DROP CONSTRAINT IF EXISTS extraction_result_extraction_type_check;

ALTER TABLE extraction_result ADD CONSTRAINT extraction_result_extraction_type_check
  CHECK (extraction_type IN ('TEXT','REDACTED_TEXT','OCR','TABLE','METADATA'));

-- 3. Redaction audit log. Stores rule IDs and hashes, not raw PII values.
CREATE TABLE IF NOT EXISTS chunk_redaction_log (
  chunk_redaction_log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id           UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  document_id            UUID NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
  chunk_id               UUID REFERENCES chunk(chunk_id) ON DELETE SET NULL,
  rule_id                TEXT NOT NULL,
  replacement_count      INTEGER NOT NULL DEFAULT 0,
  original_hash          TEXT NOT NULL,
  redacted_hash          TEXT NOT NULL,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunk_redaction_document
  ON chunk_redaction_log (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chunk_redaction_workspace
  ON chunk_redaction_log (workspace_id, rule_id, created_at DESC);

-- 4. Translation metadata shell used by Phase 5.
CREATE TABLE IF NOT EXISTS district_translation (
  district_translation_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id              UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  district_text_artifact_id UUID REFERENCES district_text_artifact(district_text_artifact_id) ON DELETE CASCADE,
  document_id               UUID REFERENCES document(document_id) ON DELETE CASCADE,
  chunk_id                  UUID REFERENCES chunk(chunk_id) ON DELETE CASCADE,
  source_language           TEXT NOT NULL,
  target_language           TEXT NOT NULL DEFAULT 'en',
  provider                  TEXT NOT NULL,
  model_name                TEXT,
  provider_version          TEXT,
  glossary_version          TEXT,
  translation_confidence    NUMERIC(5,4),
  qa_status                 TEXT NOT NULL DEFAULT 'pending'
    CHECK (qa_status IN ('pending','sampled','approved','rejected','needs_review')),
  cost_units                NUMERIC(14,4),
  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_district_translation_document
  ON district_translation (document_id, target_language, qa_status);

CREATE INDEX IF NOT EXISTS idx_district_translation_chunk
  ON district_translation (chunk_id)
  WHERE chunk_id IS NOT NULL;

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (30, '030_district_redaction_translation')
ON CONFLICT DO NOTHING;

