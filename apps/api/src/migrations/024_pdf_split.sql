-- Migration 024: Auto-split large PDFs during ingestion
-- Adds parent/child document relationship and SPLITTING/SPLIT_COMPLETE statuses

-- 1. Parent-child relationship columns
ALTER TABLE document ADD COLUMN IF NOT EXISTS parent_document_id UUID REFERENCES document(document_id) ON DELETE CASCADE;
ALTER TABLE document ADD COLUMN IF NOT EXISTS part_number INTEGER;
ALTER TABLE document ADD COLUMN IF NOT EXISTS total_parts INTEGER;

CREATE INDEX IF NOT EXISTS idx_document_parent_id ON document(parent_document_id) WHERE parent_document_id IS NOT NULL;

-- 2. Add SPLITTING and SPLIT_COMPLETE to document status constraint
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

-- 3. Add SPLIT to ingestion job step constraint
ALTER TABLE ingestion_job DROP CONSTRAINT IF EXISTS ingestion_job_step_check;

ALTER TABLE ingestion_job ADD CONSTRAINT ingestion_job_step_check
  CHECK (step IN ('VALIDATE','SPLIT','NORMALIZE','CONVERT','METADATA_EXTRACT','CHUNK','EMBED','KG_EXTRACT'));
