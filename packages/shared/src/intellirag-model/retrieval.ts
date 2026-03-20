import { z } from "zod";

// ---------------------------------------------------------------------------
// Retrieval Run
// ---------------------------------------------------------------------------

export const RetrievalPresetSchema = z.enum(["concise", "balanced", "detailed"]);
export type RetrievalPreset = z.infer<typeof RetrievalPresetSchema>;

export const RetrievalPresetConfigSchema = z.object({
  maxChunks: z.number().int(),
  graphHops: z.number().int(),
  vectorWeight: z.number(),
  lexicalWeight: z.number(),
  graphWeight: z.number(),
  metadataWeight: z.number(),
});
export type RetrievalPresetConfig = z.infer<typeof RetrievalPresetConfigSchema>;

export const RETRIEVAL_PRESETS: Record<string, RetrievalPresetConfig> = {
  concise:  { maxChunks: 10, graphHops: 1, vectorWeight: 0.4, lexicalWeight: 0.2, graphWeight: 0.2, metadataWeight: 0.2 },
  balanced: { maxChunks: 20, graphHops: 1, vectorWeight: 0.4, lexicalWeight: 0.2, graphWeight: 0.2, metadataWeight: 0.2 },
  detailed: { maxChunks: 40, graphHops: 2, vectorWeight: 0.4, lexicalWeight: 0.2, graphWeight: 0.2, metadataWeight: 0.2 },
};

export const RetrievalRunSchema = z.object({
  retrieval_run_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  original_query: z.string(),
  expanded_queries: z.array(z.string()).default([]),
  detected_entities: z.array(z.object({
    name: z.string(),
    type: z.string(),
  })).default([]),
  preset: RetrievalPresetSchema.default("balanced"),
  vector_results_count: z.number().int().default(0),
  lexical_results_count: z.number().int().default(0),
  graph_results_count: z.number().int().default(0),
  final_chunks_count: z.number().int().default(0),
  cache_hit: z.boolean().default(false),
  graph_node_ids: z.array(z.string()).default([]),
  total_latency_ms: z.number().int(),
  vector_latency_ms: z.number().int().optional(),
  lexical_latency_ms: z.number().int().optional(),
  graph_latency_ms: z.number().int().optional(),
  rerank_latency_ms: z.number().int().optional(),
  generation_latency_ms: z.number().int().optional(),
  created_at: z.string().datetime(),
});
export type RetrievalRun = z.infer<typeof RetrievalRunSchema>;

export const AnswerCacheSchema = z.object({
  cache_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  query_text: z.string(),
  // query_embedding stored as vector(768) in PostgreSQL
  answer_text: z.string(),
  citations: z.array(z.object({
    chunk_id: z.string(),
    document_title: z.string(),
    excerpt: z.string(),
  })),
  preset: RetrievalPresetSchema,
  hit_count: z.number().int().default(0),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
});
export type AnswerCache = z.infer<typeof AnswerCacheSchema>;

// ---------------------------------------------------------------------------
// Query Request / Response
// ---------------------------------------------------------------------------

export const RetrievalModeSchema = z.enum(["hybrid", "vector_only", "metadata_only", "graph_only"]);
export type RetrievalMode = z.infer<typeof RetrievalModeSchema>;

export const QueryRequestSchema = z.object({
  question: z.string().min(1).max(4000),
  conversation_id: z.string().uuid().optional(),
  preset: RetrievalPresetSchema.default("balanced"),
  mode: RetrievalModeSchema.default("hybrid"),
  filters: z.object({
    categories: z.array(z.string()).optional(),
    document_ids: z.array(z.string().uuid()).optional(),
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    org_unit_id: z.string().uuid().optional(),
    case_reference: z.string().optional(),
    fir_number: z.string().optional(),
    station_code: z.string().optional(),
    language: z.string().optional(),
    sensitivity_levels: z.array(z.string()).optional(),
  }).optional(),
  stream: z.boolean().default(false),
});
export type QueryRequest = z.infer<typeof QueryRequestSchema>;

export const QueryResponseSchema = z.object({
  answer: z.string(),
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  citations: z.array(CitationResponseSchema()),
  retrieval: z.object({
    preset: RetrievalPresetSchema,
    total_latency_ms: z.number().int(),
    cache_hit: z.boolean(),
    chunks_retrieved: z.number().int(),
  }),
});

function CitationResponseSchema() {
  return z.object({
    citation_index: z.number().int(),
    document_title: z.string(),
    page_number: z.number().int().optional(),
    excerpt: z.string(),
    relevance_score: z.number(),
  });
}

export type QueryResponse = z.infer<typeof QueryResponseSchema>;
