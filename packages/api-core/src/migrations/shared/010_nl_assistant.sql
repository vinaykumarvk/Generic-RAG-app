-- NL Assistant Module: query log, page agent audit, LLM config, system prompts, feature flags

-- ── NL Query Log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nl_query_log (
  query_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,
  question       TEXT NOT NULL,
  generated_sql  TEXT,
  summary        TEXT,
  citations      JSONB DEFAULT '[]',
  source         VARCHAR(20) NOT NULL DEFAULT 'LLM', -- LLM | REGEX | NONE
  execution_time_ms INTEGER,
  app_id         VARCHAR(50),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nl_query_log_user_id ON nl_query_log (user_id);
CREATE INDEX IF NOT EXISTS idx_nl_query_log_created_at ON nl_query_log (created_at);

-- ── Page Agent Audit Log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS page_agent_audit_log (
  audit_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL,
  action_type      VARCHAR(100) NOT NULL,
  instruction      TEXT NOT NULL,
  target_selector  VARCHAR(500),
  was_blocked      BOOLEAN NOT NULL DEFAULT FALSE,
  user_confirmed   BOOLEAN NOT NULL DEFAULT FALSE,
  page_url         VARCHAR(2000),
  metadata_jsonb   JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_agent_audit_user_id ON page_agent_audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_page_agent_audit_created_at ON page_agent_audit_log (created_at);

-- ── LLM Provider Config ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_provider_config (
  config_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       VARCHAR(50) NOT NULL,
  display_name   VARCHAR(100) NOT NULL,
  api_base_url   VARCHAR(500) NOT NULL,
  api_key_enc    VARCHAR(500),
  model_id       VARCHAR(100) NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  max_tokens     INTEGER NOT NULL DEFAULT 2048,
  temperature    NUMERIC(3,2) NOT NULL DEFAULT 0.30,
  timeout_ms     INTEGER NOT NULL DEFAULT 30000,
  max_retries    INTEGER NOT NULL DEFAULT 2,
  config_jsonb   JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── LLM System Prompts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_system_prompt (
  prompt_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  use_case     VARCHAR(50) NOT NULL,
  prompt_text  TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_system_prompt_use_case ON llm_system_prompt (use_case);

-- ── Model Prediction Log (if not exists from social-media-api) ───────────────
CREATE TABLE IF NOT EXISTS model_prediction_log (
  prediction_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       VARCHAR(50),
  model_name     VARCHAR(100),
  prompt_tokens  INTEGER,
  output_tokens  INTEGER,
  use_case       VARCHAR(50),
  entity_type    VARCHAR(100),
  entity_id      VARCHAR(255),
  prediction     JSONB,
  latency_ms     INTEGER,
  fallback_used  BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Feature Flags (if not exists) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flag (
  flag_key             TEXT PRIMARY KEY,
  enabled              BOOLEAN NOT NULL DEFAULT FALSE,
  description          TEXT,
  rollout_percentage   INTEGER NOT NULL DEFAULT 100,
  rules_jsonb          JSONB NOT NULL DEFAULT '{}',
  updated_by_user_id   TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_archived          BOOLEAN NOT NULL DEFAULT FALSE
);

-- Seed feature flags for NL assistant
INSERT INTO feature_flag (flag_key, enabled, description)
VALUES
  ('nl_query', TRUE, 'Enable natural language data query assistant'),
  ('page_agent', FALSE, 'Enable page agent for DOM-based UI control')
ON CONFLICT (flag_key) DO NOTHING;

-- Seed default system prompts
INSERT INTO llm_system_prompt (use_case, prompt_text, version, is_active)
VALUES
  ('NL_QUERY', 'You are a helpful database query assistant. Generate only SELECT queries. Always include LIMIT. Never modify data.', 1, TRUE),
  ('PAGE_AGENT', 'You are a UI automation assistant. Help users navigate and interact with the application. Never perform destructive actions without explicit user confirmation.', 1, TRUE)
ON CONFLICT DO NOTHING;
