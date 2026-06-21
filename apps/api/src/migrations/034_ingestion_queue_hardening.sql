-- Harden ingestion queue recovery and terminal failure visibility.

ALTER TABLE ingestion_job DROP CONSTRAINT IF EXISTS ingestion_job_status_check;

ALTER TABLE ingestion_job ADD CONSTRAINT ingestion_job_status_check
  CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','RETRYING','DEAD_LETTER'));

ALTER TABLE ingestion_job
  ADD COLUMN IF NOT EXISTS failure_category TEXT,
  ADD COLUMN IF NOT EXISTS reclaimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;

ALTER TABLE ingestion_job DROP CONSTRAINT IF EXISTS ingestion_job_failure_category_check;

ALTER TABLE ingestion_job ADD CONSTRAINT ingestion_job_failure_category_check
  CHECK (
    failure_category IS NULL OR failure_category IN (
      'worker_exception',
      'max_attempts_exceeded',
      'stale_processing_lock',
      'unknown_step',
      'manual_reprocess',
      'superseded'
    )
  );

CREATE INDEX IF NOT EXISTS idx_ingestion_job_poll_ready
  ON ingestion_job (status, locked_until, priority DESC, created_at)
  WHERE status IN ('PENDING','RETRYING');

CREATE INDEX IF NOT EXISTS idx_ingestion_job_stale_processing
  ON ingestion_job (locked_until, created_at)
  WHERE status = 'PROCESSING';

CREATE INDEX IF NOT EXISTS idx_ingestion_job_dead_letter
  ON ingestion_job (workspace_id, dead_lettered_at DESC)
  WHERE status = 'DEAD_LETTER';
