-- Migration 015: Access Control, Org Units & Enrichment
-- Supports FR-001 through FR-003, FR-011, FR-013, FR-017, FR-021

-- ============================================================================
-- 1. Sensitivity Level on Document (FR-002)
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE sensitivity_level_enum AS ENUM ('PUBLIC','INTERNAL','RESTRICTED','SEALED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE document ADD COLUMN IF NOT EXISTS sensitivity_level TEXT NOT NULL DEFAULT 'INTERNAL'
  CHECK (sensitivity_level IN ('PUBLIC','INTERNAL','RESTRICTED','SEALED'));

ALTER TABLE document ADD COLUMN IF NOT EXISTS case_reference TEXT;
ALTER TABLE document ADD COLUMN IF NOT EXISTS fir_number TEXT;
ALTER TABLE document ADD COLUMN IF NOT EXISTS station_code TEXT;

CREATE INDEX IF NOT EXISTS idx_document_sensitivity
  ON document (workspace_id, sensitivity_level);

CREATE INDEX IF NOT EXISTS idx_document_case_ref
  ON document (workspace_id, case_reference) WHERE case_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_station
  ON document (workspace_id, station_code) WHERE station_code IS NOT NULL;

-- ============================================================================
-- 2. Org Unit hierarchy (FR-003)
-- ============================================================================

CREATE TABLE IF NOT EXISTS org_unit (
  org_unit_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  parent_id     UUID REFERENCES org_unit(org_unit_id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_org_unit_workspace
  ON org_unit (workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_org_unit_parent
  ON org_unit (parent_id) WHERE parent_id IS NOT NULL;

-- Link documents to org units
ALTER TABLE document ADD COLUMN IF NOT EXISTS org_unit_id UUID REFERENCES org_unit(org_unit_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_org_unit
  ON document (workspace_id, org_unit_id) WHERE org_unit_id IS NOT NULL;

-- ============================================================================
-- 3. Access Grant (FR-002)
-- ============================================================================

CREATE TABLE IF NOT EXISTS access_grant (
  grant_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
  document_id       UUID REFERENCES document(document_id) ON DELETE CASCADE,
  sensitivity_level TEXT CHECK (sensitivity_level IN ('PUBLIC','INTERNAL','RESTRICTED','SEALED')),
  granted_by        UUID NOT NULL REFERENCES user_account(user_id),
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_grant_user
  ON access_grant (user_id);

CREATE INDEX IF NOT EXISTS idx_access_grant_document
  ON access_grant (document_id) WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_access_grant_expiry
  ON access_grant (expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================================
-- 4. Conversation enrichment (FR-013, FR-017)
-- ============================================================================

ALTER TABLE conversation ADD COLUMN IF NOT EXISTS pinned_filters JSONB DEFAULT '{}';
ALTER TABLE conversation ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_conversation_archived
  ON conversation (workspace_id, user_id, is_archived);

-- ============================================================================
-- 5. Review Queue (FR-011, FR-012)
-- ============================================================================

CREATE TABLE IF NOT EXISTS review_queue (
  review_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('DOCUMENT','GRAPH_NODE','GRAPH_EDGE','CHUNK','METADATA')),
  entity_id     UUID NOT NULL,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ASSIGNED','RESOLVED','DISMISSED')),
  assigned_to   UUID REFERENCES user_account(user_id) ON DELETE SET NULL,
  resolved_by   UUID REFERENCES user_account(user_id) ON DELETE SET NULL,
  resolution    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_review_queue_workspace
  ON review_queue (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_review_queue_entity
  ON review_queue (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_review_queue_assigned
  ON review_queue (assigned_to) WHERE assigned_to IS NOT NULL;

-- ============================================================================
-- 6. Node Merge History (FR-012)
-- ============================================================================

CREATE TABLE IF NOT EXISTS node_merge_history (
  merge_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  source_node_id  UUID NOT NULL,
  target_node_id  UUID NOT NULL REFERENCES graph_node(node_id) ON DELETE CASCADE,
  merged_by       UUID REFERENCES user_account(user_id),
  merged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  merge_reason    TEXT
);

CREATE INDEX IF NOT EXISTS idx_node_merge_target
  ON node_merge_history (target_node_id);

-- ============================================================================
-- 7. Notification Preferences (FR-021)
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_preference (
  preference_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','email','webhook')),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_type, channel)
);

-- ============================================================================
-- 8. Graph Node FTS (FR-011)
-- ============================================================================

ALTER TABLE graph_node ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE INDEX IF NOT EXISTS idx_graph_node_search_tsv
  ON graph_node USING gin (search_tsv);

-- Auto-update search_tsv on name/description changes
CREATE OR REPLACE FUNCTION graph_node_search_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', coalesce(NEW.name, '') || ' ' || coalesce(NEW.description, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_graph_node_search_tsv ON graph_node;
CREATE TRIGGER trg_graph_node_search_tsv
  BEFORE INSERT OR UPDATE OF name, description ON graph_node
  FOR EACH ROW EXECUTE FUNCTION graph_node_search_tsv_trigger();

-- Backfill existing nodes
UPDATE graph_node SET search_tsv = to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
WHERE search_tsv IS NULL;

-- ============================================================================
-- 9. User org unit association
-- ============================================================================

ALTER TABLE user_account ADD COLUMN IF NOT EXISTS org_unit_id UUID REFERENCES org_unit(org_unit_id) ON DELETE SET NULL;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS sensitivity_clearance TEXT NOT NULL DEFAULT 'INTERNAL'
  CHECK (sensitivity_clearance IN ('PUBLIC','INTERNAL','RESTRICTED','SEALED'));

-- Track migration
INSERT INTO schema_migration (version, name) VALUES (15, '015_access_control_org')
ON CONFLICT DO NOTHING;
