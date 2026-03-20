-- Migration 018: Configurable retention rules + cleanup trigger
-- FR-020: Data retention, audit integrity

-- Retention rules table (may already exist from an earlier migration with entity_type)
CREATE TABLE IF NOT EXISTS retention_rule (
  rule_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  resource_type    TEXT NOT NULL CHECK (resource_type IN ('audit_event', 'notification_event', 'answer_cache', 'retrieval_run', 'feedback')),
  retention_days   INT NOT NULL DEFAULT 365,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, resource_type)
);

-- If the table was created with entity_type instead of resource_type, rename the column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'retention_rule' AND column_name = 'entity_type'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'retention_rule' AND column_name = 'resource_type'
  ) THEN
    ALTER TABLE retention_rule RENAME COLUMN entity_type TO resource_type;
  END IF;
END $$;

-- Add updated_at if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'retention_rule' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE retention_rule ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- Add unique constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'retention_rule'::regclass AND contype = 'u'
  ) THEN
    ALTER TABLE retention_rule ADD CONSTRAINT retention_rule_workspace_resource_unique UNIQUE (workspace_id, resource_type);
  END IF;
END $$;

-- Update check constraint to include audit_event if needed
DO $$
BEGIN
  -- Drop old check constraint on entity_type if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'retention_rule'::regclass AND conname = 'retention_rule_entity_type_check'
  ) THEN
    ALTER TABLE retention_rule DROP CONSTRAINT retention_rule_entity_type_check;
    ALTER TABLE retention_rule ADD CONSTRAINT retention_rule_resource_type_check
      CHECK (resource_type IN ('audit_event', 'notification_event', 'answer_cache', 'retrieval_run', 'feedback'));
  END IF;
END $$;

-- System-wide defaults (workspace_id = NULL means global default)
INSERT INTO retention_rule (workspace_id, resource_type, retention_days)
VALUES
  (NULL, 'audit_event', 730),        -- 2 years
  (NULL, 'notification_event', 90),  -- 3 months
  (NULL, 'answer_cache', 30),        -- 1 month
  (NULL, 'retrieval_run', 180),      -- 6 months
  (NULL, 'feedback', 365)            -- 1 year
ON CONFLICT (workspace_id, resource_type) DO NOTHING;

-- Append-only protection for audit_event: prevent UPDATE and DELETE
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_rules WHERE rulename = 'audit_event_no_update'
  ) THEN
    EXECUTE 'CREATE RULE audit_event_no_update AS ON UPDATE TO audit_event DO INSTEAD NOTHING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_rules WHERE rulename = 'audit_event_no_delete'
  ) THEN
    EXECUTE 'CREATE RULE audit_event_no_delete AS ON DELETE TO audit_event DO INSTEAD NOTHING';
  END IF;
END
$$;

-- Cleanup function (called by external cron or pg_cron)
CREATE OR REPLACE FUNCTION apply_retention_rules()
RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT resource_type, retention_days
    FROM retention_rule
    WHERE is_active = true AND workspace_id IS NULL
  LOOP
    CASE r.resource_type
      WHEN 'notification_event' THEN
        DELETE FROM notification_event
        WHERE created_at < now() - (r.retention_days || ' days')::INTERVAL
          AND dismissed_at IS NOT NULL;
      WHEN 'answer_cache' THEN
        DELETE FROM answer_cache
        WHERE created_at < now() - (r.retention_days || ' days')::INTERVAL;
      WHEN 'retrieval_run' THEN
        DELETE FROM retrieval_run
        WHERE started_at < now() - (r.retention_days || ' days')::INTERVAL;
      WHEN 'feedback' THEN
        DELETE FROM feedback
        WHERE created_at < now() - (r.retention_days || ' days')::INTERVAL
          AND resolved_at IS NOT NULL;
      ELSE
        NULL; -- audit_event is protected by rules, skip
    END CASE;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
