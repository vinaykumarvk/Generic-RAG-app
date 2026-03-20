-- IntelliRAG Answer Journey Tracing
-- Ordered step artifacts for drilldown + message -> retrieval_run linkage

-- ============================================================================
-- Retrieval Step
-- ============================================================================

CREATE TABLE retrieval_step (
  retrieval_step_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  retrieval_run_id  UUID NOT NULL REFERENCES retrieval_run(retrieval_run_id) ON DELETE CASCADE,
  step_key          TEXT NOT NULL,
  step_index        INTEGER NOT NULL,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'skipped', 'cache_hit', 'cache_miss', 'fallback', 'failed')),
  latency_ms        INTEGER,
  item_count        INTEGER,
  summary           JSONB NOT NULL DEFAULT '{}',
  payload           JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (retrieval_run_id, step_index),
  UNIQUE (retrieval_run_id, step_key)
);

CREATE INDEX idx_retrieval_step_run ON retrieval_step (retrieval_run_id, step_index);

-- ============================================================================
-- Message linkage
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_message_retrieval_run ON message (retrieval_run_id);

DO $$ BEGIN
  ALTER TABLE message
    ADD CONSTRAINT fk_message_retrieval_run
    FOREIGN KEY (retrieval_run_id)
    REFERENCES retrieval_run(retrieval_run_id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (20, '020_answer_journeys')
ON CONFLICT DO NOTHING;
