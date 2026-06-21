-- District court analytics refresh function and operational refresh log

CREATE TABLE IF NOT EXISTS district_analytics_refresh_log (
  district_analytics_refresh_log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id                      UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  inserted_fact_rows                INTEGER NOT NULL DEFAULT 0,
  started_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at                      TIMESTAMPTZ,
  status                            TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed','failed')),
  error_message                     TEXT
);

CREATE INDEX IF NOT EXISTS idx_district_analytics_refresh_workspace
  ON district_analytics_refresh_log (workspace_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_district_fact_volume
  ON district_case_fact_daily (workspace_id, fact_date, state_code, district_code, court_level);

CREATE INDEX IF NOT EXISTS idx_district_fact_quality
  ON district_case_fact_daily (workspace_id, language, source_name, commercial_safe);

CREATE OR REPLACE FUNCTION refresh_district_case_fact_daily(p_workspace_id UUID DEFAULT NULL)
RETURNS TABLE(refreshed_workspace_id UUID, inserted_rows INTEGER, refreshed_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
  target_workspace UUID;
  inserted_count INTEGER;
  refresh_time TIMESTAMPTZ := now();
  saw_workspace BOOLEAN := false;
BEGIN
  FOR target_workspace IN
    SELECT DISTINCT dc.workspace_id
    FROM district_case dc
    WHERE p_workspace_id IS NULL OR dc.workspace_id = p_workspace_id
  LOOP
    saw_workspace := true;

    DELETE FROM district_case_fact_daily
    WHERE workspace_id = target_workspace;

    WITH artifact_rollup AS (
      SELECT
        dta.district_case_id,
        bool_or(dta.artifact_type IN ('source_pdf','source_html','source_text','ocr_text','redacted_text','translated_text')) AS has_text,
        bool_or(dta.ocr_required OR dta.artifact_type = 'ocr_text') AS ocr_required,
        bool_or(dta.redaction_status = 'redacted' OR dta.artifact_type = 'redacted_text') AS redacted,
        bool_or(dta.translation_status = 'translated' OR dta.artifact_type = 'translated_text') AS translated,
        max(NULLIF(dta.language, '')) AS artifact_language
      FROM district_text_artifact dta
      WHERE dta.workspace_id = target_workspace
      GROUP BY dta.district_case_id
    ),
    document_rollup AS (
      SELECT
        dta.district_case_id,
        bool_or(d.status IN ('SEARCHABLE','KG_EXTRACTING','ACTIVE')) AS rag_active,
        bool_or(dt.qa_status IN ('pending','sampled','approved','needs_review')) AS translated
      FROM district_text_artifact dta
      LEFT JOIN document d ON d.document_id = dta.document_id
      LEFT JOIN district_translation dt ON dt.document_id = d.document_id
      WHERE dta.workspace_id = target_workspace
      GROUP BY dta.district_case_id
    ),
    failure_rollup AS (
      SELECT
        dfa.district_case_id,
        count(*)::int AS failed_attempts
      FROM district_fetch_attempt dfa
      WHERE dfa.workspace_id = target_workspace
        AND dfa.outcome IN ('captcha_failed','rate_limited','http_error','ocr_failed','blocked_by_policy')
        AND dfa.district_case_id IS NOT NULL
      GROUP BY dfa.district_case_id
    ),
    case_rollup AS (
      SELECT
        dc.workspace_id,
        COALESCE(dc.decision_date, dc.registration_date, dc.filing_date, dc.created_at::date) AS fact_date,
        dc.state_code,
        dc.district_code,
        dc.court_level,
        dc.case_type,
        NULLIF(dc.acts_cited[1], '') AS statute,
        NULLIF(dc.sections_cited[1], '') AS section,
        NULLIF(dc.offence_categories[1], '') AS offence_category,
        dc.disposition,
        COALESCE(NULLIF(dc.source_payload->>'language', ''), ar.artifact_language, 'unknown') AS language,
        dc.source_name,
        dc.license_classification,
        dc.commercial_safe,
        dc.is_criminal_target,
        dc.text_status,
        dc.registration_date,
        dc.decision_date,
        COALESCE(ar.has_text, false) AS has_text,
        COALESCE(ar.ocr_required, false) AS ocr_required,
        COALESCE(ar.redacted, false) AS redacted,
        COALESCE(ar.translated, false) OR COALESCE(dr.translated, false) AS translated,
        COALESCE(dr.rag_active, false) AS rag_active,
        COALESCE(fr.failed_attempts, 0) AS failed_attempts
      FROM district_case dc
      LEFT JOIN artifact_rollup ar ON ar.district_case_id = dc.district_case_id
      LEFT JOIN document_rollup dr ON dr.district_case_id = dc.district_case_id
      LEFT JOIN failure_rollup fr ON fr.district_case_id = dc.district_case_id
      WHERE dc.workspace_id = target_workspace
    )
    INSERT INTO district_case_fact_daily (
      fact_date,
      workspace_id,
      state_code,
      district_code,
      court_level,
      case_type,
      statute,
      section,
      offence_category,
      disposition,
      language,
      source_name,
      license_classification,
      commercial_safe,
      metadata_case_count,
      criminal_target_count,
      text_available_count,
      ocr_required_count,
      translated_count,
      redacted_count,
      rag_active_count,
      fetch_failed_count,
      avg_days_registration_to_decision,
      p95_days_registration_to_decision,
      refreshed_at
    )
    SELECT
      fact_date,
      workspace_id,
      state_code,
      district_code,
      court_level,
      case_type,
      statute,
      section,
      offence_category,
      disposition,
      language,
      source_name,
      license_classification,
      commercial_safe,
      count(*)::int AS metadata_case_count,
      count(*) FILTER (WHERE is_criminal_target)::int AS criminal_target_count,
      count(*) FILTER (WHERE has_text OR text_status = 'text_ready')::int AS text_available_count,
      count(*) FILTER (WHERE ocr_required)::int AS ocr_required_count,
      count(*) FILTER (WHERE translated)::int AS translated_count,
      count(*) FILTER (WHERE redacted)::int AS redacted_count,
      count(*) FILTER (WHERE rag_active)::int AS rag_active_count,
      COALESCE(sum(failed_attempts), 0)::int AS fetch_failed_count,
      avg((decision_date - registration_date)::numeric)
        FILTER (WHERE decision_date IS NOT NULL AND registration_date IS NOT NULL) AS avg_days_registration_to_decision,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY (decision_date - registration_date))
        FILTER (WHERE decision_date IS NOT NULL AND registration_date IS NOT NULL) AS p95_days_registration_to_decision,
      refresh_time
    FROM case_rollup
    GROUP BY
      fact_date,
      workspace_id,
      state_code,
      district_code,
      court_level,
      case_type,
      statute,
      section,
      offence_category,
      disposition,
      language,
      source_name,
      license_classification,
      commercial_safe;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    INSERT INTO district_analytics_refresh_log (
      workspace_id,
      inserted_fact_rows,
      completed_at,
      status
    ) VALUES (
      target_workspace,
      inserted_count,
      refresh_time,
      'completed'
    );

    refreshed_workspace_id := target_workspace;
    inserted_rows := inserted_count;
    refreshed_at := refresh_time;
    RETURN NEXT;
  END LOOP;

  IF p_workspace_id IS NOT NULL AND NOT saw_workspace THEN
    DELETE FROM district_case_fact_daily
    WHERE workspace_id = p_workspace_id;

    INSERT INTO district_analytics_refresh_log (
      workspace_id,
      inserted_fact_rows,
      completed_at,
      status
    ) VALUES (
      p_workspace_id,
      0,
      refresh_time,
      'completed'
    );

    refreshed_workspace_id := p_workspace_id;
    inserted_rows := 0;
    refreshed_at := refresh_time;
    RETURN NEXT;
  END IF;
END;
$$;

-- Track this migration
INSERT INTO schema_migration (version, name) VALUES (32, '032_district_analytics')
ON CONFLICT DO NOTHING;
