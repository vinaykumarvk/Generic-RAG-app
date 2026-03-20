/**
 * Lexical search — PostgreSQL full-text search with ts_rank.
 */

import type { QueryFn } from "@puda/api-core";

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
}

export async function lexicalSearch(
  queryFn: QueryFn,
  workspaceId: string,
  query: string,
  maxResults: number,
  filters?: { documentIds?: string[]; categories?: string[]; case_reference?: string },
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

  const result = await queryFn(
    `SELECT c.chunk_id, c.document_id, c.content, c.chunk_type, c.page_start,
            d.title as document_title,
            d.case_reference,
            d.fir_number,
            d.station_code,
            ts_rank(c.fts_vector, to_tsquery('english', $1)) as rank
     FROM chunk c
     JOIN document d ON d.document_id = c.document_id
     WHERE c.workspace_id = $2
       AND c.fts_vector @@ to_tsquery('english', $1)
       AND d.status IN ('SEARCHABLE', 'ACTIVE')
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
