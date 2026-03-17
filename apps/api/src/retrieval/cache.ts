/**
 * Semantic answer cache — checks for cached answers by query embedding similarity.
 */

import type { QueryFn, LlmProvider } from "@puda/api-core";

export interface CachedAnswer {
  answer_text: string;
  citations: Array<{ chunk_id: string; document_title: string; excerpt: string }>;
  cache_id: string;
}

const CACHE_SIMILARITY_THRESHOLD = 0.80;

export async function checkCache(
  deps: { queryFn: QueryFn; llmProvider: LlmProvider },
  workspaceId: string,
  query: string,
  preset: string,
): Promise<CachedAnswer | null> {
  const embeddingResult = await deps.llmProvider.llmEmbed({ input: query });
  if (!embeddingResult?.embeddings.length) return null;

  const vecStr = "[" + embeddingResult.embeddings[0].join(",") + "]";

  try {
    const result = await deps.queryFn(
      `SELECT cache_id, answer_text, citations,
              1 - (query_embedding <=> $1::vector) as similarity
       FROM answer_cache
       WHERE workspace_id = $2
         AND preset = $3
         AND expires_at > now()
         AND 1 - (query_embedding <=> $1::vector) >= $4
       ORDER BY similarity DESC
       LIMIT 1`,
      [vecStr, workspaceId, preset, CACHE_SIMILARITY_THRESHOLD]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];

    // Increment hit count
    await deps.queryFn(
      "UPDATE answer_cache SET hit_count = hit_count + 1 WHERE cache_id = $1",
      [row.cache_id]
    );

    return {
      answer_text: row.answer_text,
      citations: typeof row.citations === "string" ? JSON.parse(row.citations) : row.citations,
      cache_id: row.cache_id,
    };
  } catch {
    // Cache table may not exist yet
    return null;
  }
}

export async function writeCache(
  deps: { queryFn: QueryFn; llmProvider: LlmProvider },
  workspaceId: string,
  query: string,
  answer: string,
  citations: Array<{ chunk_id: string; document_title: string; excerpt: string }>,
  preset: string,
): Promise<void> {
  const embeddingResult = await deps.llmProvider.llmEmbed({ input: query });
  if (!embeddingResult?.embeddings.length) return;

  const vecStr = "[" + embeddingResult.embeddings[0].join(",") + "]";

  try {
    await deps.queryFn(
      `INSERT INTO answer_cache (workspace_id, query_text, query_embedding, answer_text, citations, preset)
       VALUES ($1, $2, $3::vector, $4, $5, $6)`,
      [workspaceId, query, vecStr, answer, JSON.stringify(citations), preset]
    );
  } catch {
    // Non-critical, ignore cache write failures
  }
}
