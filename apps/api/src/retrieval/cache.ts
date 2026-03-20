/**
 * Semantic answer cache — checks for cached answers by query embedding similarity.
 * FR-017: Access signature in cache key, per-document invalidation, configurable TTL.
 */

import type { QueryFn, LlmProvider } from "@puda/api-core";
import { logInfo, logWarn } from "@puda/api-core";

export interface CachedAnswer {
  answer_text: string;
  citations: Array<{ chunk_id: string; document_title: string; excerpt: string }>;
  cache_id: string;
}

const CACHE_SIMILARITY_THRESHOLD = 0.80;
const DEFAULT_TTL_DAYS = 7;

export async function checkCache(
  deps: { queryFn: QueryFn; llmProvider: LlmProvider },
  workspaceId: string,
  query: string,
  preset: string,
  accessSignature?: string,
  activeFilters: Record<string, unknown> = {},
): Promise<CachedAnswer | null> {
  const cacheStart = Date.now();
  const embeddingResult = await deps.llmProvider.llmEmbed({ input: query });
  if (!embeddingResult?.embeddings.length) return null;

  const vecStr = "[" + embeddingResult.embeddings[0].join(",") + "]";
  const normalizedFilters = normalizeActiveFilters(activeFilters);

  try {
    // FR-017: Include access_signature in cache lookup
    const signatureClause = accessSignature
      ? "AND (access_signature = $6 OR access_signature IS NULL)"
      : "";
    const params: unknown[] = [vecStr, workspaceId, preset, CACHE_SIMILARITY_THRESHOLD, JSON.stringify(normalizedFilters)];
    if (accessSignature) params.push(accessSignature);

    const result = await deps.queryFn(
      `SELECT cache_id, answer_text, citations, access_signature,
              1 - (query_embedding <=> $1::vector) as similarity
       FROM answer_cache
       WHERE workspace_id = $2
         AND preset = $3
         AND expires_at > now()
         AND 1 - (query_embedding <=> $1::vector) >= $4
         AND COALESCE(active_filters, '{}'::jsonb) = $5::jsonb
         ${signatureClause}
       ORDER BY similarity DESC
       LIMIT 1`,
      params
    );

    if (result.rows.length === 0) {
      const lookupMs = Date.now() - cacheStart;
      if (lookupMs > 200) {
        logInfo("Cache lookup slow", { workspaceId, lookupMs, threshold: 200 });
      }
      return null;
    }

    const row = result.rows[0];

    // FR-017: If cache entry exists but access signature changed, force clean retrieval
    if (accessSignature && row.access_signature && row.access_signature !== accessSignature) {
      return null;
    }

    // Increment hit count
    await deps.queryFn(
      "UPDATE answer_cache SET hit_count = hit_count + 1 WHERE cache_id = $1",
      [row.cache_id]
    );

    const lookupMs = Date.now() - cacheStart;
    if (lookupMs > 200) {
      logInfo("Cache lookup slow", { workspaceId, lookupMs, threshold: 200 });
    }

    return {
      answer_text: row.answer_text,
      citations: typeof row.citations === "string" ? JSON.parse(row.citations) : row.citations,
      cache_id: row.cache_id,
    };
  } catch (err) {
    logWarn("Cache lookup failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Invalidate cache for entire workspace.
 */
export async function invalidateCache(
  deps: { queryFn: QueryFn },
  workspaceId: string,
): Promise<void> {
  try {
    await deps.queryFn(
      "DELETE FROM answer_cache WHERE workspace_id = $1",
      [workspaceId]
    );
  } catch (err) {
    logWarn("Cache invalidation failed", { workspaceId, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * FR-017: Per-document targeted cache invalidation.
 * Removes cache entries whose citations reference the given document.
 */
export async function invalidateCacheForDocument(
  deps: { queryFn: QueryFn },
  workspaceId: string,
  documentId: string,
): Promise<void> {
  try {
    await deps.queryFn(
      `DELETE FROM answer_cache
       WHERE workspace_id = $1
         AND citations::text LIKE '%' || $2 || '%'`,
      [workspaceId, documentId]
    );
  } catch (err) {
    logWarn("Document cache invalidation failed", { workspaceId, documentId, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function writeCache(
  deps: { queryFn: QueryFn; llmProvider: LlmProvider },
  workspaceId: string,
  query: string,
  answer: string,
  citations: Array<{ chunk_id: string; document_title: string; excerpt: string }>,
  preset: string,
  accessSignature?: string,
  activeFilters: Record<string, unknown> = {},
): Promise<void> {
  const embeddingResult = await deps.llmProvider.llmEmbed({ input: query });
  if (!embeddingResult?.embeddings.length) return;

  const vecStr = "[" + embeddingResult.embeddings[0].join(",") + "]";
  const normalizedFilters = normalizeActiveFilters(activeFilters);

  // FR-017: Read configurable TTL from system_settings
  let ttlDays = DEFAULT_TTL_DAYS;
  try {
    const ttlResult = await deps.queryFn(
      "SELECT value FROM system_setting WHERE key = 'cache_ttl_hours'",
      []
    );
    if (ttlResult.rows.length > 0) {
      const ttlHours = parseInt(ttlResult.rows[0].value, 10);
      if (ttlHours > 0) {
        ttlDays = ttlHours / 24;
      }
    }
  } catch (err) {
    logWarn("Cache TTL lookup failed, using default", { error: err instanceof Error ? err.message : String(err) });
  }

  try {
    await deps.queryFn(
      `INSERT INTO answer_cache (workspace_id, query_text, query_embedding, answer_text, citations, preset,
       access_signature, active_filters, expires_at)
       VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8::jsonb, now() + $9::int * interval '1 day')`,
      [workspaceId, query, vecStr, answer, JSON.stringify(citations), preset,
       accessSignature || null, JSON.stringify(normalizedFilters), Math.ceil(ttlDays)]
    );
  } catch (err) {
    logWarn("Cache write failed", { workspaceId, error: err instanceof Error ? err.message : String(err) });
  }
}

function normalizeActiveFilters(activeFilters: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(activeFilters)
    .map(([key, value]) => [key, normalizeFilterValue(value)] as const)
    .filter(([, value]) => {
      if (value === undefined || value === null || value === "") return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    })
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(entries);
}

function normalizeFilterValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value]
      .map((item) => typeof item === "string" ? item.trim() : item)
      .filter((item) => item !== undefined && item !== null && item !== "")
      .sort((left, right) => String(left).localeCompare(String(right)));
  }

  return typeof value === "string" ? value.trim() : value;
}
