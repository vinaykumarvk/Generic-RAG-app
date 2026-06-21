-- District court text acquisition queue and artifact provenance

-- ============================================================================
-- Text artifacts
-- ============================================================================

CREATE TABLE IF NOT EXISTS district_text_artifact (
  district_text_artifact_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id              UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  district_case_id          UUID NOT NULL REFERENCES district_case(district_case_id) ON DELETE CASCADE,
  document_id               UUID REFERENCES document(document_id) ON DELETE SET NULL,
  artifact_type             TEXT NOT NULL
    CHECK (artifact_type IN (
      'source_pdf',
      'source_html',
      'source_text',
      'ocr_text',
      'redacted_text',
      'translated_text',
      'metadata_only'
    )),
  source_name               TEXT NOT NULL,
  source_url                TEXT,
  storage_uri               TEXT,
  mime_type                 TEXT,
  language                  TEXT,
  script                    TEXT,
  text_quality_score        NUMERIC(5,4),
  ocr_required              BOOLEAN NOT NULL DEFAULT false,
  ocr_provider              TEXT,
  ocr_confidence            NUMERIC(5,4),
  redaction_status          TEXT NOT NULL DEFAULT 'not_required'
    CHECK (redaction_status IN ('not_required','pending','redacted','restricted','failed')),
  translation_status        TEXT NOT NULL DEFAULT 'not_required'
    CHECK (translation_status IN ('not_required','pending','translated','failed','needs_review')),
  license_classification    TEXT NOT NULL
    CHECK (license_classification IN ('commercial_safe','internal_only','non_commercial','blocked','pending_review')),
  commercial_safe           BOOLEAN NOT NULL DEFAULT true,
  checksum_sha256           TEXT,
  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_district_text_artifact_case
  ON district_text_artifact (district_case_id, artifact_type);

CREATE INDEX IF NOT EXISTS idx_district_text_artifact_document
  ON district_text_artifact (document_id)
  WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_district_text_artifact_policy
  ON district_text_artifact (workspace_id, commercial_safe, redaction_status, translation_status);

-- ============================================================================
-- Acquisition work queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS district_acquisition_queue (
  district_acquisition_queue_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id                  UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  district_case_id              UUID NOT NULL REFERENCES district_case(district_case_id) ON DELETE CASCADE,
  target_cnr_id                 UUID REFERENCES district_target_cnr(target_cnr_id) ON DELETE SET NULL,
  source_name                   TEXT NOT NULL CHECK (source_name IN ('indian_kanoon','ecourts','hldc')),
  status                        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','succeeded','miss','failed','blocked','rate_limited')),
  priority                      INTEGER NOT NULL DEFAULT 0,
  attempt_count                 INTEGER NOT NULL DEFAULT 0,
  max_attempts                  INTEGER NOT NULL DEFAULT 3,
  locked_until                  TIMESTAMPTZ,
  last_attempt_at               TIMESTAMPTZ,
  next_attempt_at               TIMESTAMPTZ,
  error_message                 TEXT,
  requested_metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, district_case_id, source_name)
);

CREATE INDEX IF NOT EXISTS idx_district_acquisition_poll
  ON district_acquisition_queue (status, priority DESC, created_at)
  WHERE status IN ('pending','rate_limited');

CREATE INDEX IF NOT EXISTS idx_district_acquisition_case
  ON district_acquisition_queue (district_case_id);

-- ============================================================================
-- Source quota and cost tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS district_source_quota (
  district_source_quota_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id             UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  source_name              TEXT NOT NULL,
  period_start             DATE NOT NULL,
  period_end               DATE NOT NULL,
  quota_units              NUMERIC(14,4),
  used_units               NUMERIC(14,4) NOT NULL DEFAULT 0,
  cost_currency            TEXT,
  estimated_cost           NUMERIC(14,4),
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_name, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_district_source_quota_source
  ON district_source_quota (workspace_id, source_name, period_start DESC);

-- ============================================================================
-- Helpful text-status synchronization trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION district_text_artifact_status_trigger() RETURNS trigger AS $$
BEGIN
  IF NEW.artifact_type IN ('source_pdf','source_html','source_text','ocr_text','redacted_text','translated_text') THEN
    UPDATE district_case
    SET text_status = 'text_ready',
        updated_at = now()
    WHERE district_case_id = NEW.district_case_id
      AND text_status NOT IN ('blocked','dead');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_district_text_artifact_status ON district_text_artifact;
CREATE TRIGGER trg_district_text_artifact_status
  AFTER INSERT ON district_text_artifact
  FOR EACH ROW EXECUTE FUNCTION district_text_artifact_status_trigger();

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (29, '029_district_text_acquisition')
ON CONFLICT DO NOTHING;

