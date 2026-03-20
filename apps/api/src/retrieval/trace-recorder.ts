import type { QueryFn } from "@puda/api-core";

export type RetrievalStepStatus =
  | "completed"
  | "skipped"
  | "cache_hit"
  | "cache_miss"
  | "fallback"
  | "failed";

export interface RetrievalTraceStepInput {
  stepKey: string;
  title: string;
  status: RetrievalStepStatus;
  latencyMs?: number;
  itemCount?: number;
  summary?: unknown;
  payload?: unknown;
}

export interface PersistRetrievalTraceInput {
  conversationId: string;
  workspaceId: string;
  assistantMessageId?: string;
  originalQuery: string;
  expandedQueries: string[];
  detectedEntities: Array<{ name: string; type: string }>;
  preset: string;
  expandedIntent?: string | null;
  stepBackQuestion?: string | null;
  retrievalMode: string;
  inferredFilters?: Record<string, unknown>;
  vectorResultsCount: number;
  lexicalResultsCount: number;
  graphResultsCount: number;
  finalChunksCount: number;
  cacheHit: boolean;
  graphNodeIds?: string[];
  totalLatencyMs: number;
  vectorLatencyMs?: number;
  lexicalLatencyMs?: number;
  graphLatencyMs?: number;
  rerankLatencyMs?: number;
  generationLatencyMs?: number;
  steps: RetrievalTraceStepInput[];
}

export async function persistRetrievalTrace(
  queryFn: QueryFn,
  input: PersistRetrievalTraceInput,
): Promise<string> {
  const retrievalRunResult = await queryFn(
    `INSERT INTO retrieval_run (
       conversation_id,
       workspace_id,
       original_query,
       expanded_queries,
       detected_entities,
       preset,
       expanded_intent,
       step_back_question,
       retrieval_mode,
       inferred_filters,
       vector_results_count,
       lexical_results_count,
       graph_results_count,
       final_chunks_count,
       cache_hit,
       graph_node_ids,
       total_latency_ms,
       vector_latency_ms,
       lexical_latency_ms,
       graph_latency_ms,
       rerank_latency_ms,
       generation_latency_ms
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
     )
     RETURNING retrieval_run_id`,
    [
      input.conversationId,
      input.workspaceId,
      input.originalQuery,
      JSON.stringify(normalizeJson(input.expandedQueries)),
      JSON.stringify(normalizeJson(input.detectedEntities)),
      input.preset,
      input.expandedIntent || null,
      input.stepBackQuestion || null,
      input.retrievalMode,
      JSON.stringify(normalizeJson(input.inferredFilters || {})),
      input.vectorResultsCount,
      input.lexicalResultsCount,
      input.graphResultsCount,
      input.finalChunksCount,
      input.cacheHit,
      input.graphNodeIds || [],
      input.totalLatencyMs,
      input.vectorLatencyMs ?? null,
      input.lexicalLatencyMs ?? null,
      input.graphLatencyMs ?? null,
      input.rerankLatencyMs ?? null,
      input.generationLatencyMs ?? null,
    ],
  );

  const retrievalRunId =
    typeof retrievalRunResult.rows[0]?.retrieval_run_id === "string"
      ? retrievalRunResult.rows[0].retrieval_run_id as string
      : "retrieval-run-fallback";

  if (input.steps.length > 0) {
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    input.steps.forEach((step, index) => {
      placeholders.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`,
      );
      values.push(
        retrievalRunId,
        step.stepKey,
        index + 1,
        step.title,
        step.status,
        step.latencyMs ?? null,
        step.itemCount ?? null,
        JSON.stringify(normalizeJson(step.summary || {})),
        JSON.stringify(normalizeJson(step.payload || {})),
      );
    });

    await queryFn(
      `INSERT INTO retrieval_step (
         retrieval_run_id,
         step_key,
         step_index,
         title,
         status,
         latency_ms,
         item_count,
         summary,
         payload
       )
       VALUES ${placeholders.join(", ")}`,
      values,
    );
  }

  if (input.assistantMessageId) {
    await queryFn(
      `UPDATE message SET retrieval_run_id = $1 WHERE message_id = $2`,
      [retrievalRunId, input.assistantMessageId],
    );
  }

  return retrievalRunId;
}

function normalizeJson(value: unknown): unknown {
  if (value === undefined) return null;

  return JSON.parse(JSON.stringify(value, (_key, currentValue) => {
    if (currentValue instanceof Set) {
      return Array.from(currentValue);
    }
    if (currentValue instanceof Map) {
      return Object.fromEntries(currentValue);
    }
    return currentValue;
  }));
}
