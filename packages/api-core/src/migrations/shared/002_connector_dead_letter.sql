-- Dead letter queue for failed connector items
CREATE TABLE IF NOT EXISTS connector_dead_letter (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     VARCHAR(500) NOT NULL,
  source          VARCHAR(100) NOT NULL,
  connector_name  VARCHAR(100) NOT NULL,
  raw_data        JSONB NOT NULL,
  error_message   TEXT NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (external_id, source)
);

CREATE INDEX IF NOT EXISTS idx_connector_dead_letter_failed_at
  ON connector_dead_letter (failed_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_dead_letter_connector
  ON connector_dead_letter (connector_name);
