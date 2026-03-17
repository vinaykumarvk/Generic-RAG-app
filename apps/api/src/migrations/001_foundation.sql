-- IntelliRAG Foundation Migration
-- Extensions, core tables, seed data

-- ============================================================================
-- Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- Schema version tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migration (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Workspaces
-- ============================================================================

CREATE TABLE workspace (
  workspace_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED', 'SUSPENDED')),
  settings      JSONB NOT NULL DEFAULT '{}',
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workspace_slug ON workspace (slug);

-- ============================================================================
-- Users
-- ============================================================================

CREATE TABLE user_account (
  user_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  user_type     TEXT NOT NULL DEFAULT 'MEMBER' CHECK (user_type IN ('ADMIN', 'MEMBER', 'VIEWER', 'API_KEY')),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'LOCKED')),
  password_hash TEXT,
  avatar_url    TEXT,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_email ON user_account (email);

-- ============================================================================
-- Roles
-- ============================================================================

CREATE TABLE role (
  role_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_role (
  user_id UUID NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES role(role_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- ============================================================================
-- Workspace membership
-- ============================================================================

CREATE TABLE workspace_member (
  workspace_id UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'VIEWER' CHECK (role IN ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- ============================================================================
-- LLM Provider Configuration
-- ============================================================================

CREATE TABLE llm_provider_config (
  config_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider      TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  api_base_url  TEXT NOT NULL,
  api_key_enc   TEXT,
  model_id      TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  max_tokens    INTEGER NOT NULL DEFAULT 2048,
  temperature   NUMERIC(3,2) NOT NULL DEFAULT 0.3,
  timeout_ms    INTEGER NOT NULL DEFAULT 30000,
  max_retries   INTEGER NOT NULL DEFAULT 2,
  config_jsonb  JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- LLM System Prompts
-- ============================================================================

CREATE TABLE llm_system_prompt (
  prompt_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  use_case    TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_system_prompt_use_case ON llm_system_prompt (use_case, is_active);

-- ============================================================================
-- Model Prediction Log
-- ============================================================================

CREATE TABLE model_prediction_log (
  log_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider        TEXT,
  model_name      TEXT,
  prompt_tokens   INTEGER,
  output_tokens   INTEGER,
  use_case        TEXT,
  entity_type     TEXT,
  entity_id       TEXT,
  prediction      JSONB,
  latency_ms      INTEGER,
  fallback_used   BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prediction_log_created ON model_prediction_log (created_at);

-- ============================================================================
-- Audit Log
-- ============================================================================

CREATE TABLE audit_log (
  audit_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES user_account(user_id),
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT,
  workspace_id  UUID REFERENCES workspace(workspace_id),
  details       JSONB DEFAULT '{}',
  ip_address    TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_user ON audit_log (user_id, created_at);
CREATE INDEX idx_audit_log_workspace ON audit_log (workspace_id, created_at);

-- ============================================================================
-- Feature Flags
-- ============================================================================

CREATE TABLE feature_flag (
  flag_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Seed Data
-- ============================================================================

-- Default roles
INSERT INTO role (name, description, permissions) VALUES
  ('admin', 'Full system access', '["*"]'),
  ('editor', 'Can manage documents and query', '["workspace:read", "document:write", "query:write"]'),
  ('viewer', 'Read-only access', '["workspace:read", "document:read", "query:read"]')
ON CONFLICT (name) DO NOTHING;

-- Default Ollama provider (local)
INSERT INTO llm_provider_config (provider, display_name, api_base_url, model_id, is_default, config_jsonb) VALUES
  ('ollama', 'Ollama (Local)', 'http://ollama:11434', 'qwen3:35b', true,
   '{"embedding_model": "nomic-embed-text", "embedding_dimensions": 768}')
ON CONFLICT DO NOTHING;

-- Default system prompts for RAG use cases
INSERT INTO llm_system_prompt (use_case, prompt_text) VALUES
  ('QUERY_EXPANSION', 'You are a query expansion assistant. Given a user question, generate 2-3 alternative phrasings that capture the same intent but use different terminology. Return a JSON array of strings.'),
  ('ENTITY_DETECTION', 'You are an entity detection assistant. Given a user question, extract key entities (people, organizations, concepts, dates, locations). Return a JSON object with an "entities" array, each with "name" and "type" fields.'),
  ('ANSWER_GENERATION', 'You are a knowledgeable assistant that answers questions using provided context. Always cite your sources using [1], [2], etc. notation matching the provided chunk indices. If the context does not contain enough information, say so clearly. Do not make up information.'),
  ('KG_EXTRACTION', 'You are a knowledge graph extraction assistant. Given a text chunk, extract entities and relationships. Return JSON with "nodes" (array of {name, type, description}) and "edges" (array of {source, target, type, description}).'),
  ('DOCUMENT_CLASSIFY', 'You are a document classification assistant. Given a document excerpt, classify it into the most appropriate category from the provided taxonomy. Return JSON with "category", "subcategory" (optional), and "confidence" fields.')
ON CONFLICT DO NOTHING;

-- Default feature flags
INSERT INTO feature_flag (name, enabled, description) VALUES
  ('kg_extraction', true, 'Enable knowledge graph extraction after document embedding'),
  ('semantic_cache', true, 'Enable semantic similarity caching for RAG queries'),
  ('streaming_answers', true, 'Enable SSE streaming for RAG answers'),
  ('ocr_fallback', true, 'Enable OCR fallback for scanned documents')
ON CONFLICT (name) DO NOTHING;

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (1, '001_foundation')
ON CONFLICT DO NOTHING;
