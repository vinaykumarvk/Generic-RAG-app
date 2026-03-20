-- Migration 023: add CHUNKED to document.status for queued post-chunk work

ALTER TABLE document DROP CONSTRAINT IF EXISTS document_status_check;

ALTER TABLE document ADD CONSTRAINT document_status_check
  CHECK (
    status IN (
      'UPLOADED',
      'VALIDATING',
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
