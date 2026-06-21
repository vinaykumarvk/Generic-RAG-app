-- District court metadata foundation
-- Stores metadata-only district court cases separately from text-bearing
-- documents. Document rows are created later only for eligible text artifacts.

-- ============================================================================
-- District case metadata
-- ============================================================================

CREATE TABLE IF NOT EXISTS district_case (
  district_case_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id          UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  cnr                   TEXT,
  source_case_id        TEXT NOT NULL,
  source_name           TEXT NOT NULL,
  metadata_source       TEXT NOT NULL,
  dataset_version       TEXT NOT NULL DEFAULT 'unknown',
  state_code            INTEGER,
  state_name            TEXT,
  district_code         INTEGER,
  district_name         TEXT,
  court_no              INTEGER,
  court_code            TEXT,
  court_name            TEXT,
  court_level           TEXT,
  case_type             TEXT,
  filing_date           DATE,
  registration_date     DATE,
  decision_date         DATE,
  disposition           TEXT,
  purpose_name          TEXT,
  judge_position        TEXT,
  bailable              BOOLEAN,
  under_trial           BOOLEAN,
  acts_cited            TEXT[] NOT NULL DEFAULT '{}',
  sections_cited        TEXT[] NOT NULL DEFAULT '{}',
  offence_categories    TEXT[] NOT NULL DEFAULT '{}',
  is_criminal_target    BOOLEAN NOT NULL DEFAULT false,
  source_confidence     NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  commercial_safe       BOOLEAN NOT NULL DEFAULT true,
  license_classification TEXT NOT NULL DEFAULT 'commercial_safe'
    CHECK (license_classification IN ('commercial_safe','internal_only','non_commercial','blocked','pending_review')),
  sensitive_data_flags  TEXT[] NOT NULL DEFAULT '{}',
  source_payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  text_status           TEXT NOT NULL DEFAULT 'metadata_only'
    CHECK (text_status IN (
      'metadata_only',
      'targeted',
      'ik_pending',
      'ik_hit',
      'ik_miss',
      'ecourts_pending',
      'ecourts_hit',
      'ocr_pending',
      'text_ready',
      'dead',
      'blocked'
    )),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_name, dataset_version, source_case_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_district_case_cnr_unique
  ON district_case (workspace_id, cnr)
  WHERE cnr IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_district_case_workspace_status
  ON district_case (workspace_id, text_status, is_criminal_target);

CREATE INDEX IF NOT EXISTS idx_district_case_state_date
  ON district_case (workspace_id, state_code, district_code, decision_date);

CREATE INDEX IF NOT EXISTS idx_district_case_court
  ON district_case (workspace_id, court_level, court_code);

CREATE INDEX IF NOT EXISTS idx_district_case_acts
  ON district_case USING gin (acts_cited);

CREATE INDEX IF NOT EXISTS idx_district_case_sections
  ON district_case USING gin (sections_cited);

CREATE INDEX IF NOT EXISTS idx_district_case_offences
  ON district_case USING gin (offence_categories);

-- ============================================================================
-- Case lifecycle events
-- ============================================================================

CREATE TABLE IF NOT EXISTS district_case_event (
  district_case_event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id           UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  district_case_id       UUID NOT NULL REFERENCES district_case(district_case_id) ON DELETE CASCADE,
  event_type             TEXT NOT NULL
    CHECK (event_type IN (
      'filing',
      'registration',
      'hearing',
      'order',
      'bail_order',
      'charge_framing',
      'judgment',
      'disposal',
      'transfer',
      'appeal_link',
      'status_refresh'
    )),
  event_date             DATE,
  event_label            TEXT,
  source_name            TEXT NOT NULL,
  source_confidence      NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_district_case_event_case
  ON district_case_event (district_case_id, event_date);

CREATE INDEX IF NOT EXISTS idx_district_case_event_workspace
  ON district_case_event (workspace_id, event_type, event_date);

-- ============================================================================
-- Source provenance
-- ============================================================================

CREATE TABLE IF NOT EXISTS district_case_source (
  district_case_source_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id            UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  district_case_id        UUID NOT NULL REFERENCES district_case(district_case_id) ON DELETE CASCADE,
  source_name             TEXT NOT NULL,
  source_url              TEXT,
  source_case_id          TEXT NOT NULL,
  license                 TEXT,
  license_classification  TEXT NOT NULL
    CHECK (license_classification IN ('commercial_safe','internal_only','non_commercial','blocked','pending_review')),
  dataset_version         TEXT NOT NULL DEFAULT 'unknown',
  retrieved_at            TIMESTAMPTZ,
  checksum_sha256         TEXT,
  raw_storage_uri         TEXT,
  commercial_safe         BOOLEAN NOT NULL DEFAULT true,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_name, dataset_version, source_case_id)
);

CREATE INDEX IF NOT EXISTS idx_district_case_source_case
  ON district_case_source (district_case_id);

CREATE INDEX IF NOT EXISTS idx_district_case_source_lookup
  ON district_case_source (workspace_id, source_name, license_classification);

-- ============================================================================
-- Target CNR queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS district_target_cnr (
  target_cnr_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id        UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  district_case_id    UUID NOT NULL REFERENCES district_case(district_case_id) ON DELETE CASCADE,
  cnr                 TEXT,
  target_reason       TEXT NOT NULL,
  priority            INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'targeted'
    CHECK (status IN ('targeted','queued','processing','completed','failed','blocked','dead')),
  last_attempt_at     TIMESTAMPTZ,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, district_case_id)
);

CREATE INDEX IF NOT EXISTS idx_district_target_status
  ON district_target_cnr (workspace_id, status, priority DESC, created_at);

CREATE INDEX IF NOT EXISTS idx_district_target_cnr
  ON district_target_cnr (workspace_id, cnr)
  WHERE cnr IS NOT NULL;

-- ============================================================================
-- Fetch attempt audit
-- ============================================================================

CREATE TABLE IF NOT EXISTS district_fetch_attempt (
  district_fetch_attempt_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id              UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  district_case_id          UUID REFERENCES district_case(district_case_id) ON DELETE SET NULL,
  source_name               TEXT NOT NULL,
  attempted_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome                   TEXT NOT NULL
    CHECK (outcome IN (
      'hit',
      'miss',
      'captcha_required',
      'captcha_failed',
      'rate_limited',
      'http_error',
      'ocr_failed',
      'blocked_by_policy',
      'duplicate'
    )),
  http_status               INTEGER,
  bytes                     BIGINT,
  rate_limit_delay_ms       INTEGER,
  captcha_outcome           TEXT,
  cost_units                NUMERIC(12,4),
  notes                     TEXT,
  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_district_fetch_case
  ON district_fetch_attempt (district_case_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_district_fetch_source
  ON district_fetch_attempt (workspace_id, source_name, outcome, attempted_at DESC);

-- ============================================================================
-- Daily dashboard facts
-- ============================================================================

CREATE TABLE IF NOT EXISTS district_case_fact_daily (
  district_case_fact_daily_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fact_date                         DATE NOT NULL,
  workspace_id                      UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  state_code                        INTEGER,
  district_code                     INTEGER,
  court_level                       TEXT,
  case_type                         TEXT,
  statute                           TEXT,
  section                           TEXT,
  offence_category                  TEXT,
  disposition                       TEXT,
  language                          TEXT,
  source_name                       TEXT,
  license_classification            TEXT,
  commercial_safe                   BOOLEAN NOT NULL DEFAULT true,
  metadata_case_count               INTEGER NOT NULL DEFAULT 0,
  criminal_target_count             INTEGER NOT NULL DEFAULT 0,
  text_available_count              INTEGER NOT NULL DEFAULT 0,
  ocr_required_count                INTEGER NOT NULL DEFAULT 0,
  translated_count                  INTEGER NOT NULL DEFAULT 0,
  redacted_count                    INTEGER NOT NULL DEFAULT 0,
  rag_active_count                  INTEGER NOT NULL DEFAULT 0,
  fetch_failed_count                INTEGER NOT NULL DEFAULT 0,
  avg_days_registration_to_decision NUMERIC(12,2),
  p95_days_registration_to_decision NUMERIC(12,2),
  refreshed_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_district_fact_workspace_date
  ON district_case_fact_daily (workspace_id, fact_date DESC);

CREATE INDEX IF NOT EXISTS idx_district_fact_filters
  ON district_case_fact_daily (workspace_id, state_code, district_code, offence_category, disposition);

CREATE UNIQUE INDEX IF NOT EXISTS idx_district_fact_unique_bucket
  ON district_case_fact_daily (
    fact_date,
    workspace_id,
    COALESCE(state_code, -1),
    COALESCE(district_code, -1),
    COALESCE(court_level, ''),
    COALESCE(case_type, ''),
    COALESCE(statute, ''),
    COALESCE(section, ''),
    COALESCE(offence_category, ''),
    COALESCE(disposition, ''),
    COALESCE(language, ''),
    COALESCE(source_name, ''),
    COALESCE(license_classification, ''),
    commercial_safe
  );

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (28, '028_district_court_foundation')
ON CONFLICT DO NOTHING;
