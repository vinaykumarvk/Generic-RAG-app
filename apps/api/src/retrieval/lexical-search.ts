/**
 * Lexical search — PostgreSQL full-text search with ts_rank.
 */

import type { QueryFn } from "@puda/api-core";
import {
  appendJudgmentFilters,
  JUDGMENT_JOIN,
  JUDGMENT_SELECT_FIELDS,
  type JudgmentSearchFilters,
} from "./judgment-filters";

export interface LexicalSearchResult {
  chunk_id: string;
  document_id: string;
  content: string;
  rank: number;
  chunk_type: string;
  page_start: number | null;
  document_title: string;
  case_reference?: string | null;
  fir_number?: string | null;
  station_code?: string | null;
  judgment_id?: string | null;
  court_code?: string | null;
  court_name?: string | null;
  decision_date?: string | null;
  judgment_year?: number | null;
  neutral_citation?: string | null;
  reporter_citations?: string[] | null;
  cnr?: string | null;
  case_number?: string | null;
  appeal_posture?: string | null;
  applicable_legal_regime?: string | null;
  source_uri?: string | null;
  source_path?: string | null;
  source_bucket?: string | null;
  judgment_ocr_confidence?: number | null;
  paragraph_anchor_confidence?: number | null;
  judgment_metadata_confidence?: number | null;
  sensitive_data_flags?: string[] | null;
  redaction_status?: string | null;
  district_state_code?: string | null;
  district_state_name?: string | null;
  district_code?: string | null;
  district_name?: string | null;
  district_source_name?: string | null;
  district_commercial_safe?: string | null;
  district_license_classification?: string | null;
  paragraph_number?: string | null;
  section_label?: string | null;
  anchor_confidence?: number | null;
  chunk_metadata?: Record<string, unknown> | null;
  chunk_legal_metadata?: Record<string, unknown> | null;
}

export async function lexicalSearch(
  queryFn: QueryFn,
  workspaceId: string,
  query: string,
  maxResults: number,
  filters?: JudgmentSearchFilters,
): Promise<{ results: LexicalSearchResult[]; latencyMs: number }> {
  const start = Date.now();

  const tsQuery = query
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => w.replace(/[^\w]/g, ""))
    .filter(Boolean)
    .join(" | ");

  if (!tsQuery) {
    return { results: [], latencyMs: Date.now() - start };
  }

  let filterClause = "";
  const params: unknown[] = [tsQuery, workspaceId, maxResults];

  if (filters?.documentIds?.length) {
    params.push(filters.documentIds);
    filterClause += ` AND c.document_id = ANY($${params.length})`;
  }

  if (filters?.categories?.length) {
    params.push(filters.categories);
    filterClause += ` AND d.category = ANY($${params.length})`;
  }

  filterClause += appendJudgmentFilters(filters, params);

  const result = await queryFn(
    `SELECT c.chunk_id, c.document_id, c.content, c.chunk_type, c.page_start,
            c.metadata as chunk_metadata,
            d.title as document_title,
            d.case_reference,
            d.fir_number,
            d.station_code,
            ${JUDGMENT_SELECT_FIELDS},
            ts_rank(c.fts_vector, to_tsquery('english', $1)) as rank
     FROM chunk c
     JOIN document d ON d.document_id = c.document_id
     ${JUDGMENT_JOIN}
     WHERE c.workspace_id = $2
       AND c.fts_vector @@ to_tsquery('english', $1)
       AND d.status IN ('SEARCHABLE', 'KG_EXTRACTING', 'ACTIVE')
       ${filterClause}
     ORDER BY rank DESC
     LIMIT $3`,
    params
  );

  return {
    results: result.rows as LexicalSearchResult[],
    latencyMs: Date.now() - start,
  };
}
