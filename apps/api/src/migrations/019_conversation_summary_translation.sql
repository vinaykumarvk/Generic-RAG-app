-- 019: Conversation summary + translation cache
-- Idempotent: uses IF NOT EXISTS throughout.

-- ──────────────────────────────────────────────────────────────────────
-- conversation_summary — one LLM-generated summary per conversation
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_summary (
  summary_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL UNIQUE REFERENCES conversation(conversation_id) ON DELETE CASCADE,
  content          TEXT NOT NULL,
  model_provider   TEXT,
  model_id         TEXT,
  latency_ms       INT,
  token_count      INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_summary_conv ON conversation_summary(conversation_id);

-- ──────────────────────────────────────────────────────────────────────
-- translation — cached translations for messages and summaries
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS translation (
  translation_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type        TEXT NOT NULL CHECK (source_type IN ('message', 'summary')),
  source_id          UUID NOT NULL,
  target_language    TEXT NOT NULL,
  translated_content TEXT NOT NULL,
  model_provider     TEXT,
  model_id           TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, target_language)
);

CREATE INDEX IF NOT EXISTS idx_translation_source ON translation(source_type, source_id);
