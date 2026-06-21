-- Judgment metadata and KG contracts
-- Adds judgment-specific metadata, outcome modeling, source quality, sensitive
-- data flags, and provenance fields needed by the judgment workspace.

-- ============================================================================
-- Legal KG assertion/provenance compatibility
-- ============================================================================

ALTER TABLE kg_assertion
  DROP CONSTRAINT IF EXISTS kg_assertion_assertion_type_check;

ALTER TABLE kg_assertion
  ADD COLUMN IF NOT EXISTS ontology_version TEXT,
  ADD COLUMN IF NOT EXISTS claim_type TEXT,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS source_span JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE kg_provenance
  ADD COLUMN IF NOT EXISTS ontology_version TEXT,
  ADD COLUMN IF NOT EXISTS claim_type TEXT,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS source_span JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kg_assertion_assertion_type_check'
      AND conrelid = 'kg_assertion'::regclass
  ) THEN
    ALTER TABLE kg_assertion
      ADD CONSTRAINT kg_assertion_assertion_type_check
      CHECK (assertion_type IN (
        'CLAIM',
        'CONTRADICTION',
        'FINDING',
        'OPINION',
        'FACT',
        'ALLEGATION',
        'RULING',
        'allegation',
        'admitted_fact',
        'disputed_fact',
        'finding_of_fact',
        'finding_of_law',
        'holding',
        'ratio',
        'obiter',
        'procedural_defect',
        'investigation_lapse',
        'evidence_gap',
        'credibility_assessment',
        'outcome_reason',
        'authority_treatment',
        'temporal_validity',
        'source_quality_note',
        'redaction_requirement',
        'corpus_validity_note',
        'officer_lesson'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kg_assertion_review_status_check'
      AND conrelid = 'kg_assertion'::regclass
  ) THEN
    ALTER TABLE kg_assertion
      ADD CONSTRAINT kg_assertion_review_status_check
      CHECK (review_status IN ('unreviewed', 'needs_review', 'approved', 'rejected', 'deprecated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kg_provenance_review_status_check'
      AND conrelid = 'kg_provenance'::regclass
  ) THEN
    ALTER TABLE kg_provenance
      ADD CONSTRAINT kg_provenance_review_status_check
      CHECK (review_status IN ('unreviewed', 'needs_review', 'approved', 'rejected', 'deprecated'));
  END IF;
END $$;

-- ============================================================================
-- Judgment metadata
-- ============================================================================

CREATE TABLE IF NOT EXISTS judgment_metadata (
  judgment_metadata_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id               UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  document_id                UUID NOT NULL REFERENCES document(document_id) ON DELETE CASCADE UNIQUE,
  canonical_judgment_id      TEXT,
  court_code                 TEXT,
  court_name                 TEXT,
  court_level                TEXT,
  bench_strength             TEXT,
  appeal_posture             TEXT,
  decision_date              DATE,
  judgment_year              INTEGER,
  incident_date              DATE,
  offence_date               DATE,
  fir_date                   DATE,
  search_date                DATE,
  seizure_date               DATE,
  applicable_legal_regime    TEXT,
  statute_versions           JSONB NOT NULL DEFAULT '{}'::jsonb,
  neutral_citation           TEXT,
  reporter_citations         TEXT[] NOT NULL DEFAULT '{}',
  cnr                        TEXT,
  case_number                TEXT,
  disposal_nature            TEXT,
  author_judge               TEXT,
  judges                     TEXT[] NOT NULL DEFAULT '{}',
  parties                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  statutes                   TEXT[] NOT NULL DEFAULT '{}',
  sections                   TEXT[] NOT NULL DEFAULT '{}',
  offence_categories         TEXT[] NOT NULL DEFAULT '{}',
  outcomes                   TEXT[] NOT NULL DEFAULT '{}',
  source_uri                 TEXT,
  source_path                TEXT,
  source_bucket              TEXT,
  source_license             TEXT,
  ocr_confidence             NUMERIC(5,4),
  paragraph_anchor_confidence NUMERIC(5,4),
  metadata_confidence        NUMERIC(5,4),
  source_quality             JSONB NOT NULL DEFAULT '{}'::jsonb,
  sensitive_data_flags       TEXT[] NOT NULL DEFAULT '{}',
  redaction_status           TEXT NOT NULL DEFAULT 'not_required'
    CHECK (redaction_status IN ('not_required','pending','redacted','restricted')),
  correction_status          TEXT NOT NULL DEFAULT 'uncorrected'
    CHECK (correction_status IN ('uncorrected','corrected','verified')),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_judgment_metadata_canonical
  ON judgment_metadata (workspace_id, canonical_judgment_id)
  WHERE canonical_judgment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_judgment_metadata_court_date
  ON judgment_metadata (workspace_id, court_code, decision_date);

CREATE INDEX IF NOT EXISTS idx_judgment_metadata_year
  ON judgment_metadata (workspace_id, judgment_year);

CREATE INDEX IF NOT EXISTS idx_judgment_metadata_citation
  ON judgment_metadata (workspace_id, neutral_citation)
  WHERE neutral_citation IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_judgment_metadata_cnr
  ON judgment_metadata (workspace_id, cnr)
  WHERE cnr IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_judgment_metadata_judges
  ON judgment_metadata USING gin (judges);

CREATE INDEX IF NOT EXISTS idx_judgment_metadata_statutes
  ON judgment_metadata USING gin (statutes);

CREATE INDEX IF NOT EXISTS idx_judgment_metadata_sections
  ON judgment_metadata USING gin (sections);

CREATE INDEX IF NOT EXISTS idx_judgment_metadata_offences
  ON judgment_metadata USING gin (offence_categories);

CREATE INDEX IF NOT EXISTS idx_judgment_metadata_outcomes
  ON judgment_metadata USING gin (outcomes);

-- ============================================================================
-- Judgment parties, statutory sections, and outcomes
-- ============================================================================

CREATE TABLE IF NOT EXISTS judgment_party (
  judgment_party_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id       UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  document_id        UUID NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
  party_label        TEXT NOT NULL,
  party_role         TEXT,
  normalized_name    TEXT,
  sensitive_flag     BOOLEAN NOT NULL DEFAULT false,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_judgment_party_document
  ON judgment_party (workspace_id, document_id, party_role);

CREATE TABLE IF NOT EXISTS judgment_statute_section (
  judgment_statute_section_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id                UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  document_id                 UUID NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
  statute                     TEXT NOT NULL,
  section                     TEXT,
  section_type                TEXT,
  legal_regime                TEXT,
  issue_tags                  TEXT[] NOT NULL DEFAULT '{}',
  source_chunk_id             UUID REFERENCES chunk(chunk_id) ON DELETE SET NULL,
  source_span                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_judgment_statute_filter
  ON judgment_statute_section (workspace_id, statute, section);

CREATE INDEX IF NOT EXISTS idx_judgment_statute_issues
  ON judgment_statute_section USING gin (issue_tags);

CREATE TABLE IF NOT EXISTS judgment_outcome (
  judgment_outcome_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id         UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  document_id          UUID NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
  accused_label        TEXT,
  charge_label         TEXT,
  statute              TEXT,
  section              TEXT,
  trial_outcome        TEXT,
  appeal_outcome       TEXT,
  final_outcome        TEXT,
  state_or_police_result TEXT,
  reason_category      TEXT,
  outcome_reason       TEXT,
  source_chunk_id      UUID REFERENCES chunk(chunk_id) ON DELETE SET NULL,
  source_span          JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status        TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed', 'needs_review', 'approved', 'rejected', 'deprecated')),
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_judgment_outcome_filter
  ON judgment_outcome (workspace_id, final_outcome, statute, section);

CREATE INDEX IF NOT EXISTS idx_judgment_outcome_result
  ON judgment_outcome (workspace_id, state_or_police_result);

CREATE INDEX IF NOT EXISTS idx_judgment_outcome_document
  ON judgment_outcome (document_id);

-- ============================================================================
-- Chunk-level legal anchors
-- ============================================================================

ALTER TABLE chunk
  ADD COLUMN IF NOT EXISTS paragraph_number TEXT,
  ADD COLUMN IF NOT EXISTS section_label TEXT,
  ADD COLUMN IF NOT EXISTS anchor_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS legal_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_chunk_paragraph_anchor
  ON chunk (document_id, paragraph_number)
  WHERE paragraph_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chunk_legal_metadata
  ON chunk USING gin (legal_metadata);

-- ============================================================================
-- Provenance indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_kg_assertion_ontology_version
  ON kg_assertion (workspace_id, ontology_version);

CREATE INDEX IF NOT EXISTS idx_kg_assertion_review_status
  ON kg_assertion (workspace_id, review_status);

CREATE INDEX IF NOT EXISTS idx_kg_provenance_ontology_version
  ON kg_provenance (workspace_id, ontology_version);

CREATE INDEX IF NOT EXISTS idx_kg_provenance_review_status
  ON kg_provenance (workspace_id, review_status);

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (25, '025_judgment_metadata')
ON CONFLICT DO NOTHING;
