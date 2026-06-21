-- Legal doctrine wiki
-- Reviewed synthesis layer for judgment workspaces. Wiki articles are derived
-- artifacts and must cite raw judgment chunks for material claims.

ALTER TABLE review_queue
  DROP CONSTRAINT IF EXISTS review_queue_entity_type_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'review_queue_entity_type_check'
      AND conrelid = 'review_queue'::regclass
  ) THEN
    ALTER TABLE review_queue
      ADD CONSTRAINT review_queue_entity_type_check
      CHECK (entity_type IN (
        'DOCUMENT','GRAPH_NODE','GRAPH_EDGE','CHUNK','METADATA',
        'KG_ASSERTION','KG_QUALITY_REPORT','LEGAL_WIKI_ARTICLE'
      ));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS legal_wiki_article (
  article_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id            UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  slug                    TEXT NOT NULL,
  title                   TEXT NOT NULL,
  summary                 TEXT,
  body                    TEXT NOT NULL,
  frontmatter             JSONB NOT NULL DEFAULT '{}'::jsonb,
  court_scope             TEXT[] NOT NULL DEFAULT '{}',
  statutes                TEXT[] NOT NULL DEFAULT '{}',
  sections                TEXT[] NOT NULL DEFAULT '{}',
  issue_tags              TEXT[] NOT NULL DEFAULT '{}',
  outcome_focus           TEXT[] NOT NULL DEFAULT '{}',
  policing_stage          TEXT,
  source_judgments        TEXT[] NOT NULL DEFAULT '{}',
  source_chunk_ids        UUID[] NOT NULL DEFAULT '{}',
  corpus_scope            JSONB NOT NULL DEFAULT '{}'::jsonb,
  legal_validity_window   JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence              NUMERIC(5,4) NOT NULL DEFAULT 0,
  review_status           TEXT NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft','pending_legal_review','approved','rejected','deprecated')),
  supersedes_article_id   UUID REFERENCES legal_wiki_article(article_id) ON DELETE SET NULL,
  superseded_by_article_id UUID REFERENCES legal_wiki_article(article_id) ON DELETE SET NULL,
  embedding               vector(1536),
  fts_vector              tsvector,
  created_by              UUID REFERENCES user_account(user_id) ON DELETE SET NULL,
  reviewed_by             UUID REFERENCES user_account(user_id) ON DELETE SET NULL,
  reviewed_at             TIMESTAMPTZ,
  review_note             TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_workspace_status
  ON legal_wiki_article (workspace_id, review_status);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_court_scope
  ON legal_wiki_article USING gin (court_scope);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_statutes
  ON legal_wiki_article USING gin (statutes);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_sections
  ON legal_wiki_article USING gin (sections);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_issue_tags
  ON legal_wiki_article USING gin (issue_tags);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_outcome_focus
  ON legal_wiki_article USING gin (outcome_focus);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_fts
  ON legal_wiki_article USING gin (fts_vector);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_embedding
  ON legal_wiki_article
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

CREATE OR REPLACE FUNCTION legal_wiki_fts_trigger() RETURNS trigger AS $$
BEGIN
  NEW.fts_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.body, '')), 'C');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_legal_wiki_fts ON legal_wiki_article;
CREATE TRIGGER trg_legal_wiki_fts
  BEFORE INSERT OR UPDATE OF title, summary, body
  ON legal_wiki_article
  FOR EACH ROW EXECUTE FUNCTION legal_wiki_fts_trigger();

CREATE TABLE IF NOT EXISTS legal_wiki_article_source (
  article_source_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id        UUID NOT NULL REFERENCES legal_wiki_article(article_id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  document_id       UUID REFERENCES document(document_id) ON DELETE SET NULL,
  chunk_id          UUID REFERENCES chunk(chunk_id) ON DELETE SET NULL,
  judgment_id       TEXT,
  citation_text     TEXT,
  source_span       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_source_article
  ON legal_wiki_article_source (article_id);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_source_chunk
  ON legal_wiki_article_source (chunk_id);

CREATE TABLE IF NOT EXISTS legal_wiki_claim (
  claim_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id        UUID NOT NULL REFERENCES legal_wiki_article(article_id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  claim_text        TEXT NOT NULL,
  claim_type        TEXT,
  material          BOOLEAN NOT NULL DEFAULT true,
  source_chunk_id   UUID REFERENCES chunk(chunk_id) ON DELETE SET NULL,
  paragraph_number  TEXT,
  source_span       JSONB NOT NULL DEFAULT '{}'::jsonb,
  citation_status   TEXT NOT NULL DEFAULT 'missing'
    CHECK (citation_status IN ('missing','cited','verified','invalid')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_claim_article
  ON legal_wiki_claim (article_id, material, citation_status);

CREATE TABLE IF NOT EXISTS legal_wiki_coverage_gap (
  gap_id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id           UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  query_text             TEXT NOT NULL,
  query_profile          TEXT,
  filters                JSONB NOT NULL DEFAULT '{}'::jsonb,
  court_code             TEXT,
  statute                TEXT,
  section                TEXT,
  issue_tags             TEXT[] NOT NULL DEFAULT '{}',
  outcome_focus          TEXT[] NOT NULL DEFAULT '{}',
  raw_evidence_count     INTEGER NOT NULL DEFAULT 0,
  approved_article_count INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','queued','resolved','dismissed')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_gap_workspace
  ON legal_wiki_coverage_gap (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_legal_wiki_gap_statute
  ON legal_wiki_coverage_gap (workspace_id, statute, section);

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (27, '027_legal_wiki')
ON CONFLICT DO NOTHING;
