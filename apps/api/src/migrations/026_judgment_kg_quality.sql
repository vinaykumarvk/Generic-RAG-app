-- Judgment KG quality controls
-- Adds reviewability fields to graph edges, legal KG review categories, and
-- quality reports for judgment graph extraction.

ALTER TABLE graph_edge
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS source_span JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS high_impact BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'graph_edge_review_status_check'
      AND conrelid = 'graph_edge'::regclass
  ) THEN
    ALTER TABLE graph_edge
      ADD CONSTRAINT graph_edge_review_status_check
      CHECK (review_status IN ('unreviewed', 'needs_review', 'approved', 'rejected', 'deprecated'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_graph_edge_review_status
  ON graph_edge (workspace_id, review_status);

CREATE INDEX IF NOT EXISTS idx_graph_edge_high_impact
  ON graph_edge (workspace_id, high_impact)
  WHERE high_impact = true;

ALTER TABLE review_queue
  DROP CONSTRAINT IF EXISTS review_queue_entity_type_check;

ALTER TABLE review_queue
  ADD COLUMN IF NOT EXISTS review_category TEXT,
  ADD COLUMN IF NOT EXISTS priority_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ontology_version TEXT;

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
      CHECK (entity_type IN ('DOCUMENT','GRAPH_NODE','GRAPH_EDGE','CHUNK','METADATA','KG_ASSERTION','KG_QUALITY_REPORT'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_review_queue_category
  ON review_queue (workspace_id, review_category, status);

CREATE INDEX IF NOT EXISTS idx_review_queue_priority
  ON review_queue (workspace_id, status, priority_score DESC);

CREATE TABLE IF NOT EXISTS judgment_kg_quality_report (
  report_id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id                    UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  document_id                     UUID REFERENCES document(document_id) ON DELETE CASCADE,
  ontology_version                TEXT,
  total_edges                     INTEGER NOT NULL DEFAULT 0,
  related_to_edges                INTEGER NOT NULL DEFAULT 0,
  related_to_ratio                NUMERIC(6,4) NOT NULL DEFAULT 0,
  high_impact_unreviewed_edges    INTEGER NOT NULL DEFAULT 0,
  low_confidence_edges            INTEGER NOT NULL DEFAULT 0,
  ungrounded_high_impact_edges    INTEGER NOT NULL DEFAULT 0,
  dangling_nodes                  INTEGER NOT NULL DEFAULT 0,
  details                         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_judgment_kg_quality_workspace
  ON judgment_kg_quality_report (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_judgment_kg_quality_document
  ON judgment_kg_quality_report (document_id);

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (26, '026_judgment_kg_quality')
ON CONFLICT DO NOTHING;
