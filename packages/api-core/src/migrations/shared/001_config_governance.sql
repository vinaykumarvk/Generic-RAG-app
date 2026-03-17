-- Config Governance table — versioned config lifecycle
-- DRAFT → PENDING_REVIEW → APPROVED → PUBLISHED → ROLLED_BACK / SUPERSEDED
CREATE TABLE IF NOT EXISTS config_governance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_type     VARCHAR(100) NOT NULL,
  version_number  INTEGER NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK')),
  content_jsonb   JSONB NOT NULL,
  description     VARCHAR(500),
  created_by      UUID REFERENCES user_account(user_id),
  approved_by     UUID REFERENCES user_account(user_id),
  published_at    TIMESTAMPTZ,
  rollback_reason VARCHAR(500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (config_type, version_number)
);

CREATE INDEX IF NOT EXISTS idx_config_governance_type_status
  ON config_governance (config_type, status);

CREATE INDEX IF NOT EXISTS idx_config_governance_published
  ON config_governance (config_type) WHERE status = 'PUBLISHED';
