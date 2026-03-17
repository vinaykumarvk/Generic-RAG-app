-- IntelliRAG Conversations & Retrieval
-- Conversations, messages, retrieval runs, citations, answer cache

-- ============================================================================
-- Conversation
-- ============================================================================

CREATE TABLE conversation (
  conversation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES user_account(user_id),
  title           TEXT,
  preset          TEXT NOT NULL DEFAULT 'balanced' CHECK (preset IN ('concise', 'balanced', 'detailed')),
  message_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversation_workspace ON conversation (workspace_id, user_id, updated_at DESC);

-- ============================================================================
-- Message
-- ============================================================================

CREATE TABLE message (
  message_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id   UUID NOT NULL REFERENCES conversation(conversation_id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content           TEXT NOT NULL,
  token_count       INTEGER,
  retrieval_run_id  UUID,
  model_provider    TEXT,
  model_id          TEXT,
  latency_ms        INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_conversation ON message (conversation_id, created_at);

-- ============================================================================
-- Retrieval Run
-- ============================================================================

CREATE TABLE retrieval_run (
  retrieval_run_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id       UUID NOT NULL REFERENCES conversation(conversation_id) ON DELETE CASCADE,
  workspace_id          UUID NOT NULL REFERENCES workspace(workspace_id),
  original_query        TEXT NOT NULL,
  expanded_queries      JSONB NOT NULL DEFAULT '[]',
  detected_entities     JSONB NOT NULL DEFAULT '[]',
  preset                TEXT NOT NULL DEFAULT 'balanced',
  vector_results_count  INTEGER NOT NULL DEFAULT 0,
  lexical_results_count INTEGER NOT NULL DEFAULT 0,
  graph_results_count   INTEGER NOT NULL DEFAULT 0,
  final_chunks_count    INTEGER NOT NULL DEFAULT 0,
  cache_hit             BOOLEAN NOT NULL DEFAULT false,
  total_latency_ms      INTEGER NOT NULL,
  vector_latency_ms     INTEGER,
  lexical_latency_ms    INTEGER,
  graph_latency_ms      INTEGER,
  rerank_latency_ms     INTEGER,
  generation_latency_ms INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Citation
-- ============================================================================

CREATE TABLE citation (
  citation_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id      UUID NOT NULL REFERENCES message(message_id) ON DELETE CASCADE,
  chunk_id        UUID NOT NULL REFERENCES chunk(chunk_id),
  document_id     UUID NOT NULL REFERENCES document(document_id),
  document_title  TEXT NOT NULL,
  page_number     INTEGER,
  excerpt         TEXT NOT NULL,
  relevance_score NUMERIC(5,4) NOT NULL,
  citation_index  INTEGER NOT NULL
);

CREATE INDEX idx_citation_message ON citation (message_id);

-- ============================================================================
-- Answer Cache (semantic similarity)
-- ============================================================================

CREATE TABLE answer_cache (
  cache_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  query_text      TEXT NOT NULL,
  query_embedding vector(768),
  answer_text     TEXT NOT NULL,
  citations       JSONB NOT NULL DEFAULT '[]',
  preset          TEXT NOT NULL DEFAULT 'balanced',
  hit_count       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX idx_answer_cache_embedding ON answer_cache
  USING hnsw (query_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_answer_cache_workspace ON answer_cache (workspace_id, expires_at);

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (7, '007_conversations')
ON CONFLICT DO NOTHING;
