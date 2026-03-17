/**
 * Vector search — pgvector cosine similarity on chunk embeddings.
 */

import type { QueryFn, LlmProvider } from "@puda/api-core";

export interface VectorSearchResult {
  chunk_id: string;
  document_id: string;
  content: string;
  similarity: number;
  chunk_type: string;
  page_start: number | null;
  heading_path: string | null;
  document_title: string;
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
  filters?: { documentIds?: string[]; categories?: string[] },
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

  const result = await deps.queryFn(
    `SELECT c.chunk_id, c.document_id, c.content, c.chunk_type, c.page_start, c.heading_path,
            d.title as document_title,
            1 - (c.embedding <=> $1::vector) as similarity
     FROM chunk c
     JOIN document d ON d.document_id = c.document_id
     WHERE c.workspace_id = $2
       AND c.embedding IS NOT NULL
       AND d.status IN ('SEARCHABLE', 'ACTIVE')
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
