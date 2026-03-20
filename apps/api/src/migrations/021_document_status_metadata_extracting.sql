-- Migration 021: allow metadata extraction lifecycle states on document.status

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
      'EMBEDDING',
      'SEARCHABLE',
      'KG_EXTRACTING',
      'ACTIVE',
      'FAILED',
      'DELETED',
      'REPROCESSING'
    )
  );
