-- District batch-job control table
-- Lets the API request bulk seeding and enumeration discovery, which the Python
-- worker executes (discovery must run worker-side: it hits the eCourts portal +
-- CAPTCHA solver). The API only enqueues; the worker is the single executor, so
-- planner/portal logic is not duplicated across languages.

CREATE TABLE IF NOT EXISTS district_batch_job (
  district_batch_job_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id          UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  job_type              TEXT NOT NULL CHECK (job_type IN ('seed','discover','process')),
  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','succeeded','failed')),
  params                JSONB NOT NULL DEFAULT '{}'::jsonb,
  result                JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  max_attempts          INTEGER NOT NULL DEFAULT 1,
  locked_until          TIMESTAMPTZ,
  error_message         TEXT,
  requested_by          UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_district_batch_job_poll
  ON district_batch_job (status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_district_batch_job_workspace
  ON district_batch_job (workspace_id, created_at DESC);

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (34, '034_district_batch_jobs')
ON CONFLICT DO NOTHING;
