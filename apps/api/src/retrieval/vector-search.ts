/**
 * Vector search — pgvector cosine similarity on chunk embeddings.
 */

import type { QueryFn, LlmProvider } from "@puda/api-core";
import {
  appendJudgmentFilters,
  JUDGMENT_JOIN,
  JUDGMENT_SELECT_FIELDS,
  type JudgmentSearchFilters,
} from "./judgment-filters";

export interface VectorSearchResult {
  chunk_id: string;
  document_id: string;
  content: string;
  similarity: number;
  chunk_type: string;
  page_start: number | null;
  heading_path: string | null;
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

export interface VectorSearchDeps {
  queryFn: QueryFn;
  llmProvider: LlmProvider;
}

export async function vectorSearch(
  deps: VectorSearchDeps,
  workspaceId: string,
  query: string,
  maxResults: number,
  filters?: JudgmentSearchFilters,
): Promise<{ results: VectorSearchResult[]; latencyMs: number }> {
  const start = Date.now();

  // Get query embedding
  const embeddingResult = await deps.llmProvider.llmEmbed({ input: query });
  if (!embeddingResult || embeddingResult.embeddings.length === 0) {
    return { results: [], latencyMs: Date.now() - start };
  }

  const queryEmbedding = embeddingResult.embeddings[0];
  const vecStr = "[" + queryEmbedding.join(",") + "]";

  let filterClause = "";
  const params: unknown[] = [vecStr, workspaceId, maxResults];

  if (filters?.documentIds?.length) {
    params.push(filters.documentIds);
    filterClause += ` AND c.document_id = ANY($${params.length})`;
  }

  if (filters?.categories?.length) {
    params.push(filters.categories);
    filterClause += ` AND d.category = ANY($${params.length})`;
  }

  filterClause += appendJudgmentFilters(filters, params);

  const result = await deps.queryFn(
    `SELECT c.chunk_id, c.document_id, c.content, c.chunk_type, c.page_start, c.heading_path,
            c.metadata as chunk_metadata,
            d.title as document_title,
            d.case_reference,
            d.fir_number,
            d.station_code,
            ${JUDGMENT_SELECT_FIELDS},
            1 - (c.embedding <=> $1::vector) as similarity
     FROM chunk c
     JOIN document d ON d.document_id = c.document_id
     ${JUDGMENT_JOIN}
     WHERE c.workspace_id = $2
       AND c.embedding IS NOT NULL
       AND d.status IN ('SEARCHABLE', 'KG_EXTRACTING', 'ACTIVE')
       ${filterClause}
     ORDER BY c.embedding <=> $1::vector
     LIMIT $3`,
    params
  );

  return {
    results: result.rows as VectorSearchResult[],
    latencyMs: Date.now() - start,
  };
}
