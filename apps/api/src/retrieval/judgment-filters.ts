export interface JudgmentSearchFilters {
  documentIds?: string[];
  categories?: string[];
  case_reference?: string;
  judgmentId?: string;
  judgmentIds?: string[];
  canonical_judgment_id?: string;
  court_code?: string;
  court_codes?: string[];
  court?: string;
  decision_date_from?: string;
  decision_date_to?: string;
  date_from?: string;
  date_to?: string;
  year?: number | string;
  years?: Array<number | string>;
  statute?: string;
  statutes?: string[];
  section?: string;
  sections?: string[];
  offence_category?: string;
  offence_categories?: string[];
  disposition?: string;
  dispositions?: string[];
  outcome?: string;
  outcomes?: string[];
  state_or_police_result?: string;
  judge?: string;
  judges?: string[];
  citation?: string;
  cnr?: string;
  legal_regime?: string;
  source_path?: string;
  state?: string;
  states?: string[];
  state_name?: string;
  state_names?: string[];
  state_code?: string | number;
  state_codes?: Array<string | number>;
  district?: string;
  districts?: string[];
  district_name?: string;
  district_names?: string[];
  district_code?: string | number;
  district_codes?: Array<string | number>;
  court_level?: string;
  court_levels?: string[];
  source_name?: string;
  source_names?: string[];
  license_classification?: string;
  license_classifications?: string[];
  commercial_safe?: boolean | string;
  redaction_status?: string;
  redaction_statuses?: string[];
  language?: string;
  languages?: string[];
  source_language?: string;
  target_language?: string;
  translation_status?: string;
  translation_statuses?: string[];
}

export const JUDGMENT_SELECT_FIELDS = `
            jm.canonical_judgment_id as judgment_id,
            jm.court_code,
            jm.court_name,
            jm.decision_date,
            jm.judgment_year,
            jm.neutral_citation,
            jm.reporter_citations,
            jm.cnr,
            jm.case_number,
            jm.appeal_posture,
            jm.applicable_legal_regime,
            jm.source_uri,
            jm.source_path,
            jm.source_bucket,
            jm.ocr_confidence as judgment_ocr_confidence,
            jm.paragraph_anchor_confidence,
            jm.metadata_confidence as judgment_metadata_confidence,
            jm.sensitive_data_flags,
            jm.redaction_status,
            COALESCE(c.legal_metadata->>'state_code', d.metadata->'district'->>'state_code', d.metadata->>'state_code') as district_state_code,
            COALESCE(c.legal_metadata->>'state', d.metadata->'district'->>'state_name', d.metadata->'district'->>'state', d.metadata->>'state') as district_state_name,
            COALESCE(c.legal_metadata->>'district_code', d.metadata->'district'->>'district_code', d.metadata->>'district_code') as district_code,
            COALESCE(c.legal_metadata->>'district', d.metadata->'district'->>'district_name', d.metadata->'district'->>'district', d.metadata->>'district_name') as district_name,
            COALESCE(c.legal_metadata->>'source_name', d.metadata->'district'->>'source_name', d.metadata->>'source_name') as district_source_name,
            COALESCE(c.legal_metadata->>'commercial_safe', d.metadata->'district'->>'commercial_safe', d.metadata->>'commercial_safe') as district_commercial_safe,
            COALESCE(c.legal_metadata->>'license_classification', d.metadata->'district'->>'license_classification', d.metadata->>'license_classification') as district_license_classification,
            c.paragraph_number,
            c.section_label,
            c.anchor_confidence,
            c.legal_metadata as chunk_legal_metadata`;

export const JUDGMENT_JOIN = `
     LEFT JOIN judgment_metadata jm ON jm.document_id = d.document_id`;

type TextLike = string | number | boolean;

function textArray(...values: Array<TextLike | TextLike[] | undefined>): string[] {
  return values.flatMap((value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }).map((value) => String(value).trim()).filter(Boolean);
}

function lowerArray(...values: Array<TextLike | TextLike[] | undefined>): string[] {
  return textArray(...values).map((value) => value.toLowerCase());
}

function parseOptionalBoolean(value: boolean | string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "t", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "f", "0", "no", "n"].includes(normalized)) return false;
  return undefined;
}

function yearArray(filter?: JudgmentSearchFilters): number[] {
  const values = [filter?.year, ...(filter?.years || [])]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
  return Array.from(new Set(values));
}

export function appendJudgmentFilters(
  filters: JudgmentSearchFilters | undefined,
  params: unknown[],
): string {
  if (!filters) return "";

  let filterClause = "";
  const judgmentIds = textArray(filters.judgmentId, filters.judgmentIds, filters.canonical_judgment_id);
  if (judgmentIds.length) {
    params.push(judgmentIds);
    filterClause += ` AND jm.canonical_judgment_id = ANY($${params.length})`;
  }

  const courtCodes = lowerArray(filters.court_code, filters.court_codes, filters.court);
  if (courtCodes.length) {
    params.push(courtCodes);
    filterClause += ` AND LOWER(COALESCE(jm.court_code, jm.court_name, '')) = ANY($${params.length})`;
  }

  const fromDate = filters.decision_date_from || filters.date_from;
  if (fromDate) {
    params.push(fromDate);
    filterClause += ` AND jm.decision_date >= $${params.length}::date`;
  }

  const toDate = filters.decision_date_to || filters.date_to;
  if (toDate) {
    params.push(toDate);
    filterClause += ` AND jm.decision_date <= $${params.length}::date`;
  }

  const years = yearArray(filters);
  if (years.length) {
    params.push(years);
    filterClause += ` AND jm.judgment_year = ANY($${params.length})`;
  }

  const statutes = lowerArray(filters.statute, filters.statutes);
  if (statutes.length) {
    params.push(statutes);
    filterClause += ` AND EXISTS (
       SELECT 1 FROM judgment_statute_section jss
       WHERE jss.document_id = d.document_id
         AND LOWER(jss.statute) = ANY($${params.length})
     )`;
  }

  const sections = lowerArray(filters.section, filters.sections);
  if (sections.length) {
    params.push(sections);
    filterClause += ` AND EXISTS (
       SELECT 1 FROM judgment_statute_section jss
       WHERE jss.document_id = d.document_id
         AND LOWER(COALESCE(jss.section, '')) = ANY($${params.length})
     )`;
  }

  const offenceCategories = lowerArray(filters.offence_category, filters.offence_categories);
  if (offenceCategories.length) {
    params.push(offenceCategories);
    filterClause += ` AND EXISTS (
       SELECT 1 FROM unnest(jm.offence_categories) offence_category
       WHERE LOWER(offence_category) = ANY($${params.length})
     )`;
  }

  const outcomes = lowerArray(filters.outcome, filters.outcomes);
  if (outcomes.length) {
    params.push(outcomes);
    filterClause += ` AND EXISTS (
       SELECT 1 FROM judgment_outcome jo
       WHERE jo.document_id = d.document_id
         AND LOWER(COALESCE(jo.final_outcome, '')) = ANY($${params.length})
     )`;
  }

  if (filters.state_or_police_result) {
    params.push(filters.state_or_police_result.toLowerCase());
    filterClause += ` AND EXISTS (
       SELECT 1 FROM judgment_outcome jo
       WHERE jo.document_id = d.document_id
         AND LOWER(COALESCE(jo.state_or_police_result, '')) = $${params.length}
     )`;
  }

  const judges = lowerArray(filters.judge, filters.judges);
  if (judges.length) {
    params.push(judges);
    filterClause += ` AND EXISTS (
       SELECT 1 FROM unnest(jm.judges) judge_name
       WHERE LOWER(judge_name) = ANY($${params.length})
     )`;
  }

  if (filters.citation) {
    params.push(`%${filters.citation}%`);
    filterClause += ` AND (
       jm.neutral_citation ILIKE $${params.length}
       OR EXISTS (
         SELECT 1 FROM unnest(jm.reporter_citations) citation
         WHERE citation ILIKE $${params.length}
       )
     )`;
  }

  if (filters.cnr) {
    params.push(filters.cnr);
    filterClause += ` AND jm.cnr = $${params.length}`;
  }

  if (filters.legal_regime) {
    params.push(filters.legal_regime.toLowerCase());
    filterClause += ` AND LOWER(COALESCE(jm.applicable_legal_regime, '')) = $${params.length}`;
  }

  if (filters.source_path) {
    params.push(`${filters.source_path}%`);
    filterClause += ` AND COALESCE(jm.source_path, d.source_path, d.file_path) LIKE $${params.length}`;
  }

  const courtLevels = lowerArray(filters.court_level, filters.court_levels);
  if (courtLevels.length) {
    params.push(courtLevels);
    filterClause += ` AND LOWER(COALESCE(jm.court_level, c.legal_metadata->>'court_level', d.metadata->'district'->>'court_level', d.metadata->>'court_level', '')) = ANY($${params.length})`;
  }

  const stateCodes = textArray(filters.state_code, filters.state_codes);
  if (stateCodes.length) {
    params.push(stateCodes);
    filterClause += ` AND COALESCE(c.legal_metadata->>'state_code', d.metadata->'district'->>'state_code', d.metadata->>'state_code', '') = ANY($${params.length})`;
  }

  const states = lowerArray(filters.state, filters.states, filters.state_name, filters.state_names);
  if (states.length) {
    params.push(states);
    filterClause += ` AND LOWER(COALESCE(c.legal_metadata->>'state', d.metadata->'district'->>'state_name', d.metadata->'district'->>'state', d.metadata->>'state', '')) = ANY($${params.length})`;
  }

  const districtCodes = textArray(filters.district_code, filters.district_codes);
  if (districtCodes.length) {
    params.push(districtCodes);
    filterClause += ` AND COALESCE(c.legal_metadata->>'district_code', d.metadata->'district'->>'district_code', d.metadata->>'district_code', '') = ANY($${params.length})`;
  }

  const districts = lowerArray(filters.district, filters.districts, filters.district_name, filters.district_names);
  if (districts.length) {
    params.push(districts);
    filterClause += ` AND LOWER(COALESCE(c.legal_metadata->>'district', d.metadata->'district'->>'district_name', d.metadata->'district'->>'district', d.metadata->>'district_name', '')) = ANY($${params.length})`;
  }

  const dispositions = lowerArray(filters.disposition, filters.dispositions);
  if (dispositions.length) {
    params.push(dispositions);
    filterClause += ` AND LOWER(COALESCE(c.legal_metadata->>'disposition', d.metadata->'district'->>'disposition', d.metadata->>'disposition', '')) = ANY($${params.length})`;
  }

  const sourceNames = lowerArray(filters.source_name, filters.source_names);
  if (sourceNames.length) {
    params.push(sourceNames);
    filterClause += ` AND LOWER(COALESCE(c.legal_metadata->>'source_name', d.metadata->'district'->>'source_name', d.metadata->>'source_name', '')) = ANY($${params.length})`;
  }

  const licenseClassifications = lowerArray(filters.license_classification, filters.license_classifications);
  if (licenseClassifications.length) {
    params.push(licenseClassifications);
    filterClause += ` AND LOWER(COALESCE(c.legal_metadata->>'license_classification', d.metadata->'district'->>'license_classification', d.metadata->>'license_classification', '')) = ANY($${params.length})`;
  }

  const redactionStatuses = lowerArray(filters.redaction_status, filters.redaction_statuses);
  if (redactionStatuses.length) {
    params.push(redactionStatuses);
    filterClause += ` AND LOWER(COALESCE(jm.redaction_status, c.legal_metadata->>'redaction_status', d.metadata->'redaction'->>'redaction_status', d.metadata->>'redaction_status', 'not_required')) = ANY($${params.length})`;
  }

  const requestedCommercialSafe = parseOptionalBoolean(filters.commercial_safe);
  const enforceCommercialSafe = requestedCommercialSafe !== undefined || process.env.COMMERCIAL_MODE === "true";
  if (enforceCommercialSafe) {
    const booleanValues = (requestedCommercialSafe ?? true)
      ? ["true", "t", "1", "yes", "y"]
      : ["false", "f", "0", "no", "n"];
    params.push(booleanValues);
    filterClause += ` AND LOWER(COALESCE(c.legal_metadata->>'commercial_safe', d.metadata->'district'->>'commercial_safe', d.metadata->>'commercial_safe', 'true')) = ANY($${params.length})`;
  }

  const languages = lowerArray(filters.language, filters.languages, filters.source_language);
  if (languages.length) {
    params.push(languages);
    filterClause += ` AND LOWER(COALESCE(c.legal_metadata->>'source_language', d.language, '')) = ANY($${params.length})`;
  }

  if (filters.target_language) {
    params.push(filters.target_language.toLowerCase());
    filterClause += ` AND LOWER(COALESCE(c.legal_metadata->>'target_language', '')) = $${params.length}`;
  }

  const translationStatuses = lowerArray(filters.translation_status, filters.translation_statuses);
  if (translationStatuses.length) {
    params.push(translationStatuses);
    filterClause += ` AND LOWER(COALESCE(c.legal_metadata->>'translation_status', '')) = ANY($${params.length})`;
  }

  return filterClause;
}
