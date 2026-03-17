/**
 * Core RAG retrieval pipeline — 10-step orchestrator.
 *
 * 1. Check semantic cache
 * 2. Query expansion via LLM
 * 3. Entity detection via LLM
 * 4. Vector search (pgvector)
 * 5. Lexical search (PostgreSQL FTS)
 * 6. Graph context lookup
 * 7. Metadata filtering (applied in search queries)
 * 8. Rerank (weighted merge)
 * 9. Answer generation via LLM
 * 10. Cache result
 */

import type { QueryFn, LlmProvider } from "@puda/api-core";
import { logInfo } from "@puda/api-core";
import { RETRIEVAL_PRESETS } from "@puda/shared";
import { checkCache, writeCache } from "./cache";
import { expandQuery } from "./query-expander";
import { detectEntities } from "./entity-detector";
import { vectorSearch } from "./vector-search";
import { lexicalSearch } from "./lexical-search";
import { graphContextLookup } from "./graph-context";
import { rerank } from "./reranker";
import { generateAnswer } from "./answer-generator";
import type { RankedChunk } from "./reranker";

export interface PipelineDeps {
  queryFn: QueryFn;
  llmProvider: LlmProvider;
}

export interface PipelineRequest {
  question: string;
  workspaceId: string;
  conversationId?: string;
  userId: string;
  preset: "concise" | "balanced" | "detailed";
  filters?: {
    categories?: string[];
    documentIds?: string[];
  };
}

export interface PipelineResult {
  answer: string;
  conversationId: string;
  messageId: string;
  citations: Array<{
    citation_index: number;
    document_title: string;
    page_number: number | null;
    excerpt: string;
    relevance_score: number;
  }>;
  retrieval: {
    preset: string;
    total_latency_ms: number;
    cache_hit: boolean;
    chunks_retrieved: number;
    expanded_queries: string[];
    detected_entities: Array<{ name: string; type: string }>;
  };
}

export async function executeRetrievalPipeline(
  deps: PipelineDeps,
  request: PipelineRequest,
): Promise<PipelineResult> {
  const pipelineStart = Date.now();
  const presetConfig = RETRIEVAL_PRESETS[request.preset] || RETRIEVAL_PRESETS.balanced;
  const { queryFn, llmProvider } = deps;

  // Ensure conversation exists
  let conversationId: string = request.conversationId || "";
  if (!conversationId) {
    const convResult = await queryFn(
      `INSERT INTO conversation (workspace_id, user_id, title, preset)
       VALUES ($1, $2, $3, $4) RETURNING conversation_id`,
      [request.workspaceId, request.userId, request.question.slice(0, 100), request.preset]
    );
    conversationId = convResult.rows[0].conversation_id;
  }

  // Save user message
  const userMsgResult = await queryFn(
    `INSERT INTO message (conversation_id, role, content) VALUES ($1, 'user', $2) RETURNING message_id`,
    [conversationId, request.question]
  );

  // Update conversation
  await queryFn(
    `UPDATE conversation SET message_count = message_count + 1, updated_at = now() WHERE conversation_id = $1`,
    [conversationId]
  );

  // Step 1: Check semantic cache
  const cached = await checkCache({ queryFn, llmProvider }, request.workspaceId, request.question, request.preset);
  if (cached) {
    const msgResult = await queryFn(
      `INSERT INTO message (conversation_id, role, content) VALUES ($1, 'assistant', $2) RETURNING message_id`,
      [conversationId, cached.answer_text]
    );
    await queryFn(
      `UPDATE conversation SET message_count = message_count + 1, updated_at = now() WHERE conversation_id = $1`,
      [conversationId]
    );

    logInfo("RAG pipeline: cache hit", { workspaceId: request.workspaceId });
    return {
      answer: cached.answer_text,
      conversationId,
      messageId: msgResult.rows[0].message_id,
      citations: cached.citations.map((c, i) => ({
        citation_index: i + 1,
        document_title: c.document_title,
        page_number: null,
        excerpt: c.excerpt,
        relevance_score: 1,
      })),
      retrieval: {
        preset: request.preset,
        total_latency_ms: Date.now() - pipelineStart,
        cache_hit: true,
        chunks_retrieved: 0,
        expanded_queries: [],
        detected_entities: [],
      },
    };
  }

  // Step 2: Query expansion
  const expandedQueries = await expandQuery(llmProvider, request.question);

  // Step 3: Entity detection
  const entities = await detectEntities(llmProvider, request.question);

  // Step 4: Vector search (run for each expanded query, merge)
  const vectorPromises = expandedQueries.map((q) =>
    vectorSearch({ queryFn, llmProvider }, request.workspaceId, q, presetConfig.maxChunks, request.filters)
  );
  const vectorResultSets = await Promise.all(vectorPromises);
  const allVectorResults = vectorResultSets.flatMap((r) => r.results);
  const vectorLatency = Math.max(...vectorResultSets.map((r) => r.latencyMs));

  // Deduplicate vector results
  const seenChunkIds = new Set<string>();
  const uniqueVectorResults = allVectorResults.filter((r) => {
    if (seenChunkIds.has(r.chunk_id)) return false;
    seenChunkIds.add(r.chunk_id);
    return true;
  });

  // Step 5: Lexical search
  const { results: lexicalResults, latencyMs: lexicalLatency } = await lexicalSearch(
    queryFn, request.workspaceId, request.question, presetConfig.maxChunks, request.filters
  );

  // Step 6: Graph context lookup
  const { result: graphResult, latencyMs: graphLatency } = await graphContextLookup(
    { queryFn, llmProvider }, request.workspaceId, request.question, entities, presetConfig.graphHops
  );

  // Step 7: Metadata filtering (already applied in search queries via filters param)

  // Step 8: Rerank
  const graphChunkIds = new Set<string>(); // Will be populated in Phase 3
  const rerankStart = Date.now();
  const rankedChunks: RankedChunk[] = rerank(
    uniqueVectorResults,
    lexicalResults,
    graphChunkIds,
    presetConfig,
    presetConfig.maxChunks,
  );
  const rerankLatency = Date.now() - rerankStart;

  // Step 9: Answer generation
  const history = await getConversationHistory(queryFn, conversationId);
  const genResult = await generateAnswer(
    llmProvider, request.question, rankedChunks, graphResult.contextText, history
  );

  if (!genResult) {
    const fallbackMsg = "I was unable to generate an answer. Please try rephrasing your question.";
    const msgResult = await queryFn(
      `INSERT INTO message (conversation_id, role, content) VALUES ($1, 'assistant', $2) RETURNING message_id`,
      [conversationId, fallbackMsg]
    );
    return {
      answer: fallbackMsg,
      conversationId,
      messageId: msgResult.rows[0].message_id,
      citations: [],
      retrieval: {
        preset: request.preset,
        total_latency_ms: Date.now() - pipelineStart,
        cache_hit: false,
        chunks_retrieved: rankedChunks.length,
        expanded_queries: expandedQueries,
        detected_entities: entities,
      },
    };
  }

  // Save assistant message
  const assistantMsgResult = await queryFn(
    `INSERT INTO message (conversation_id, role, content, model_provider, model_id, latency_ms)
     VALUES ($1, 'assistant', $2, $3, $4, $5) RETURNING message_id`,
    [conversationId, genResult.answer, genResult.provider, genResult.model, genResult.latencyMs]
  );
  const messageId = assistantMsgResult.rows[0].message_id;

  await queryFn(
    `UPDATE conversation SET message_count = message_count + 1, updated_at = now() WHERE conversation_id = $1`,
    [conversationId]
  );

  // Save citations
  for (const citation of genResult.citations) {
    await queryFn(
      `INSERT INTO citation (message_id, chunk_id, document_id, document_title, page_number, excerpt, relevance_score, citation_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [messageId, citation.chunk_id, citation.document_id, citation.document_title,
       citation.page_number, citation.excerpt, citation.relevance_score, citation.citation_index]
    );
  }

  // Save retrieval run
  const totalLatency = Date.now() - pipelineStart;
  await queryFn(
    `INSERT INTO retrieval_run (conversation_id, workspace_id, original_query, expanded_queries, detected_entities,
     preset, vector_results_count, lexical_results_count, graph_results_count, final_chunks_count,
     cache_hit, total_latency_ms, vector_latency_ms, lexical_latency_ms, graph_latency_ms,
     rerank_latency_ms, generation_latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [conversationId, request.workspaceId, request.question,
     JSON.stringify(expandedQueries), JSON.stringify(entities),
     request.preset, uniqueVectorResults.length, lexicalResults.length, graphResult.nodes.length,
     rankedChunks.length, false, totalLatency, vectorLatency, lexicalLatency, graphLatency,
     rerankLatency, genResult.latencyMs]
  );

  // Step 10: Cache result
  await writeCache(
    { queryFn, llmProvider },
    request.workspaceId,
    request.question,
    genResult.answer,
    genResult.citations.map((c) => ({
      chunk_id: c.chunk_id,
      document_title: c.document_title,
      excerpt: c.excerpt,
    })),
    request.preset,
  );

  logInfo("RAG pipeline complete", {
    workspaceId: request.workspaceId,
    preset: request.preset,
    vectorResults: uniqueVectorResults.length,
    lexicalResults: lexicalResults.length,
    graphNodes: graphResult.nodes.length,
    finalChunks: rankedChunks.length,
    totalLatencyMs: totalLatency,
  });

  return {
    answer: genResult.answer,
    conversationId,
    messageId,
    citations: genResult.citations.map((c) => ({
      citation_index: c.citation_index,
      document_title: c.document_title,
      page_number: c.page_number,
      excerpt: c.excerpt,
      relevance_score: c.relevance_score,
    })),
    retrieval: {
      preset: request.preset,
      total_latency_ms: totalLatency,
      cache_hit: false,
      chunks_retrieved: rankedChunks.length,
      expanded_queries: expandedQueries,
      detected_entities: entities,
    },
  };
}

async function getConversationHistory(
  queryFn: QueryFn,
  conversationId: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const result = await queryFn(
    `SELECT role, content FROM message
     WHERE conversation_id = $1 AND role IN ('user', 'assistant')
     ORDER BY created_at DESC LIMIT 8`,
    [conversationId]
  );
  return result.rows.reverse() as Array<{ role: "user" | "assistant"; content: string }>;
}
