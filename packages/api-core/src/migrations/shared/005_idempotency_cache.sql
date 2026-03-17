CREATE TABLE IF NOT EXISTS idempotency_cache (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  response_status INTEGER NOT NULL,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX idx_idempotency_cache_expires ON idempotency_cache (expires_at);
