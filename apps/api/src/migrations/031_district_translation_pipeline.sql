-- District court translation pipeline stage and bilingual citation metadata

-- 1. Add TRANSLATE as a first-class ingestion step between REDACT and CHUNK.
ALTER TABLE ingestion_job DROP CONSTRAINT IF EXISTS ingestion_job_step_check;

ALTER TABLE ingestion_job ADD CONSTRAINT ingestion_job_step_check
  CHECK (step IN (
    'VALIDATE',
    'SPLIT',
    'NORMALIZE',
    'CONVERT',
    'METADATA_EXTRACT',
    'REDACT',
    'TRANSLATE',
    'CHUNK',
    'EMBED',
    'KG_EXTRACT'
  ));

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
      'TRANSLATING',
      'TRANSLATED',
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

-- 2. Store translated text as a derived extraction artifact.
ALTER TABLE extraction_result DROP CONSTRAINT IF EXISTS extraction_result_extraction_type_check;

ALTER TABLE extraction_result ADD CONSTRAINT extraction_result_extraction_type_check
  CHECK (extraction_type IN ('TEXT','REDACTED_TEXT','TRANSLATED_TEXT','OCR','TABLE','METADATA'));

CREATE INDEX IF NOT EXISTS idx_extraction_translated_document
  ON extraction_result (document_id, created_at DESC)
  WHERE extraction_type = 'TRANSLATED_TEXT';

-- 3. Link translation audit rows back to source and translated artifacts.
ALTER TABLE district_translation
  ADD COLUMN IF NOT EXISTS source_extraction_id UUID REFERENCES extraction_result(extraction_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS translated_extraction_id UUID REFERENCES extraction_result(extraction_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_hash TEXT,
  ADD COLUMN IF NOT EXISTS translated_hash TEXT,
  ADD COLUMN IF NOT EXISTS character_count INTEGER,
  ADD COLUMN IF NOT EXISTS review_sample_required BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_district_translation_source_extraction
  ON district_translation (source_extraction_id)
  WHERE source_extraction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_district_translation_translated_extraction
  ON district_translation (translated_extraction_id)
  WHERE translated_extraction_id IS NOT NULL;

-- 4. Allow translation-specific review queue entities for QA sampling.
ALTER TABLE review_queue DROP CONSTRAINT IF EXISTS review_queue_entity_type_check;

ALTER TABLE review_queue ADD CONSTRAINT review_queue_entity_type_check
  CHECK (entity_type IN (
    'DOCUMENT',
    'GRAPH_NODE',
    'GRAPH_EDGE',
    'CHUNK',
    'METADATA',
    'KG_ASSERTION',
    'KG_QUALITY_REPORT',
    'LEGAL_WIKI_ARTICLE',
    'DISTRICT_TRANSLATION'
  ));

-- 5. Persist bilingual citation details for conversation replay and trace views.
ALTER TABLE citation
  ADD COLUMN IF NOT EXISTS source_language TEXT,
  ADD COLUMN IF NOT EXISTS target_language TEXT,
  ADD COLUMN IF NOT EXISTS translation_status TEXT,
  ADD COLUMN IF NOT EXISTS translated_excerpt TEXT,
  ADD COLUMN IF NOT EXISTS original_excerpt TEXT,
  ADD COLUMN IF NOT EXISTS translation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_citation_translation_status
  ON citation (translation_status)
  WHERE translation_status IS NOT NULL;

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (31, '031_district_translation_pipeline')
ON CONFLICT DO NOTHING;
