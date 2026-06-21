-- District RAG/wiki integration
-- Adds court-level coverage-gap dimensions so district court wiki gaps can be
-- reviewed by trial court/sessions/magistrate scope as well as statute/section.

ALTER TABLE legal_wiki_coverage_gap
  ADD COLUMN IF NOT EXISTS court_level TEXT;

CREATE INDEX IF NOT EXISTS idx_legal_wiki_gap_court_level
  ON legal_wiki_coverage_gap (workspace_id, court_level, status);

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (33, '033_district_rag_wiki_integration')
ON CONFLICT DO NOTHING;
