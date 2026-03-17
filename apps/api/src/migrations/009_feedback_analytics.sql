-- IntelliRAG Feedback & Analytics

-- ============================================================================
-- Feedback
-- ============================================================================

CREATE TABLE feedback (
  feedback_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id      UUID NOT NULL REFERENCES message(message_id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversation(conversation_id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES user_account(user_id),
  feedback_type   TEXT NOT NULL CHECK (feedback_type IN ('THUMBS_UP', 'THUMBS_DOWN', 'CORRECTION', 'FLAG')),
  rating          INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment         TEXT,
  correction      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_workspace ON feedback (workspace_id, created_at DESC);
CREATE INDEX idx_feedback_message ON feedback (message_id);

-- ============================================================================
-- Notification Event (for admin alerts)
-- ============================================================================

CREATE TABLE notification_event (
  event_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspace(workspace_id),
  event_type   TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'ERROR')),
  title        TEXT NOT NULL,
  description  TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_unread ON notification_event (workspace_id, created_at DESC) WHERE read_at IS NULL;

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (9, '009_feedback_analytics')
ON CONFLICT DO NOTHING;
