/**
 * Core RAG retrieval pipeline — 11-step orchestrator.
 *
 * 1. Check semantic cache (with access signature)
 * 2. Query expansion via LLM
 * 3. Entity detection via LLM
 * 4. Vector search (pgvector)
 * 5. Lexical search (PostgreSQL FTS)
 * 6. Graph context lookup
 * 7. Metadata filtering (applied in search queries)
 * 8. Rerank (weighted merge)
 * 8b. Chunk access filtering (sensitivity guard — FR-002)
 * 9. Answer generation via LLM
 * 10. Cache result
 */

import type { QueryFn, LlmProvider } from "@puda/api-core";
import { logInfo, logWarn } from "@puda/api-core";
import { RETRIEVAL_PRESETS } from "@puda/shared";
import { checkCache, writeCache } from "./cache";
import { expandQueryWithIntent } from "./query-expander";
import { detectEntities } from "./entity-detector";
import { vectorSearch } from "./vector-search";
import type { VectorSearchResult } from "./vector-search";
import { lexicalSearch } from "./lexical-search";
import type { LexicalSearchResult } from "./lexical-search";
import { graphContextLookup } from "./graph-context";
import { rerank } from "./reranker";
import { generateAnswer } from "./answer-generator";
import { persistRetrievalTrace, type RetrievalTraceStepInput } from "./trace-recorder";
import { filterChunksByAccess, buildAccessSignature } from "../middleware/sensitivity-guard";
import type { RankedChunk } from "./reranker";

/** Per-preset model overrides for answer generation (env-configured) */
const PRESET_MODEL_ENV_KEYS: Record<string, string> = {
  concise:  "PRESET_MODEL_CONCISE",
  balanced: "PRESET_MODEL_BALANCED",
  detailed: "PRESET_MODEL_DETAILED",
};

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
  mode?: "hybrid" | "vector_only" | "metadata_only" | "graph_only";
  skipCache?: boolean;
  skipUserMessage?: boolean;
  userClearance?: string;
  userType?: string;
  filters?: {
    categories?: string[];
    documentIds?: string[];
    date_from?: string;
    date_to?: string;
    org_unit_id?: string;
    case_reference?: string;
    fir_number?: string;
    station_code?: string;
    language?: string;
    sensitivity_levels?: string[];
  };
}

export interface PipelineResult {
  answer: string;
  conversationId: string;
  messageId: string;
  retrieval_run_id?: string;
  model_provider?: string;
  model_id?: string;
  prompt_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  title?: string;
  follow_up_questions?: string[];
  citations: Array<{
    citation_index: number;
    document_title: string;
    page_number: number | null;
    excerpt: string;
    relevance_score: number;
  }>;
  retrieval: {
    preset: string;
    mode: string;
    total_latency_ms: number;
    cache_hit: boolean;
    chunks_retrieved: number;
    expanded_queries: string[];
    detected_entities: Array<{ name: string; type: string }>;
    inferred_filters?: Record<string, unknown>;
  };
}

type ScopeMode = "single" | "multi" | "global";
type ScopeSource = "explicit_single" | "explicit_multi" | "follow_up_single" | "follow_up_multi" | "global";

interface ScopeResolution {
  activeCaseScopes: string[];
  scopeMode: ScopeMode;
  scopeSource: ScopeSource;
  clarificationMessage?: string;
}

export async function executeRetrievalPipeline(
  deps: PipelineDeps,
  request: PipelineRequest,
): Promise<PipelineResult> {
  const pipelineStart = Date.now();
  const presetConfig = RETRIEVAL_PRESETS[request.preset] || RETRIEVAL_PRESETS.balanced;
  const { queryFn, llmProvider } = deps;
  const mode = request.mode || "hybrid";
  const userClearance = request.userClearance || "INTERNAL";
  const userType = request.userType || "MEMBER";
  const accessSignature = buildAccessSignature(userClearance, userType);
  const traceSteps: RetrievalTraceStepInput[] = [];
  const addTraceStep = (step: RetrievalTraceStepInput) => {
    traceSteps.push(step);
  };
  let expandedQueriesWithCaseScope: string[] = [];
  let expandedIntent: string | null = null;
  let stepBackQuestion: string | null = null;
  let entities: Array<{ name: string; type: string }> = [];
  let inferredFilters: Record<string, unknown> = {};
  let uniqueVectorResults: VectorSearchResult[] = [];
  let lexicalResults: LexicalSearchResult[] = [];
  let graphResult = {
    nodes: [] as Array<{ node_id: string; name: string; node_type: string; subtype?: string; description: string }>,
    edges: [] as Array<{ source: string; target: string; edge_type: string; source_name: string; target_name: string }>,
    contextText: "",
    chunkIds: new Set<string>(),
    nodeIds: [] as string[],
  };
  let vectorLatency = 0;
  let lexicalLatency = 0;
  let graphLatency = 0;
  let rerankLatency: number | undefined;
  let generationLatency: number | undefined;
  let rankedChunks: RankedChunk[] = [];
  let traceCacheHit = false;

  // Check if conversation is archived (FR-013)
  if (request.conversationId) {
    const archiveCheck = await queryFn(
      "SELECT is_archived FROM conversation WHERE conversation_id = $1",
      [request.conversationId]
    );
    if (archiveCheck.rows.length > 0 && archiveCheck.rows[0].is_archived) {
      return {
        answer: "This conversation is archived and read-only. Please start a new conversation.",
        conversationId: request.conversationId,
        messageId: "",
        citations: [],
        retrieval: { preset: request.preset, mode, total_latency_ms: 0, cache_hit: false, chunks_retrieved: 0, expanded_queries: [], detected_entities: [] },
      };
    }
  }

  // Merge pinned filters from conversation (FR-003)
  let effectiveFilters = { ...request.filters };
  let pinnedConversationFilters: Record<string, unknown> | undefined;
  if (request.conversationId) {
    try {
      const convFilters = await queryFn(
        "SELECT pinned_filters FROM conversation WHERE conversation_id = $1",
        [request.conversationId]
      );
      if (convFilters.rows.length > 0 && convFilters.rows[0].pinned_filters) {
        const pinned = convFilters.rows[0].pinned_filters as Record<string, unknown>;
        pinnedConversationFilters = pinned;
        // Merge pinned filters into effective filters, but exclude case_reference
        // because document.case_reference is not populated — it would zero-out results.
        // Case scoping is handled via query expansion + answer generator scope instructions.
        const {
          case_reference: _excluded,
          case_references: _excludedMany,
          last_multi_case_references: _excludedMulti,
          last_scope_mode: _excludedScopeMode,
          last_scope_source: _excludedScopeSource,
          ...mergeablePinned
        } = pinned;
        effectiveFilters = { ...mergeablePinned, ...effectiveFilters };
      }
    } catch { /* ignore */ }
  }

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

  // Save user message (skip when regenerating to avoid duplicates)
  if (!request.skipUserMessage) {
    await queryFn(
      `INSERT INTO message (conversation_id, role, content) VALUES ($1, 'user', $2) RETURNING message_id`,
      [conversationId, request.question]
    );

    await queryFn(
      `UPDATE conversation SET message_count = message_count + 1, updated_at = now() WHERE conversation_id = $1`,
      [conversationId]
    );
  }

  async function persistTraceForMessage(
    assistantMessageId?: string,
    totalLatencyMs: number = Date.now() - pipelineStart,
  ): Promise<string> {
    return persistRetrievalTrace(queryFn, {
      conversationId,
      workspaceId: request.workspaceId,
      assistantMessageId,
      originalQuery: request.question,
      expandedQueries: expandedQueriesWithCaseScope,
      detectedEntities: entities,
      preset: request.preset,
      expandedIntent,
      stepBackQuestion,
      retrievalMode: mode,
      inferredFilters,
      vectorResultsCount: uniqueVectorResults.length,
      lexicalResultsCount: lexicalResults.length,
      graphResultsCount: graphResult.nodes.length,
      finalChunksCount: rankedChunks.length,
      cacheHit: traceCacheHit,
      graphNodeIds: graphResult.nodeIds || [],
      totalLatencyMs,
      vectorLatencyMs: vectorLatency || undefined,
      lexicalLatencyMs: lexicalLatency || undefined,
      graphLatencyMs: graphLatency || undefined,
      rerankLatencyMs: rerankLatency,
      generationLatencyMs: generationLatency,
      steps: traceSteps,
    });
  }

  // Fetch conversation history early — needed for query expansion coreference resolution
  const history = conversationId
    ? await getConversationHistory(queryFn, conversationId)
    : [];

  const explicitCaseReference = readCaseReference(request.filters?.case_reference);
  const explicitCaseScopes = collectCaseScopes(
    explicitCaseReference ? [explicitCaseReference] : [],
    extractCaseScopes(request.question),
  );
  const pinnedCaseReference = getPinnedCaseReference(pinnedConversationFilters);
  const pinnedMultiCaseScopes = getPinnedMultiCaseReferences(pinnedConversationFilters);
  const pinnedLastScopeMode = getPinnedLastScopeMode(pinnedConversationFilters);
	  let scopeResolution = resolveScopeResolution(
    request.question,
    explicitCaseScopes,
    pinnedCaseReference,
    pinnedMultiCaseScopes,
    pinnedLastScopeMode,
  );
  if (scopeResolution.clarificationMessage) {
    addTraceStep({
      stepKey: "conversation_context",
      title: "Conversation context",
      status: "completed",
      itemCount: history.length,
      summary: {
        history_count: history.length,
        scope_mode: scopeResolution.scopeMode,
        scope_source: scopeResolution.scopeSource,
      },
      payload: {
        conversation_id: conversationId,
        request_filters: request.filters || {},
        effective_filters: effectiveFilters,
        pinned_filters: pinnedConversationFilters || {},
        scope_resolution: scopeResolution,
      },
    });
  }
  if (scopeResolution.clarificationMessage) {
    const msgResult = await queryFn(
      `INSERT INTO message (conversation_id, role, content) VALUES ($1, 'assistant', $2) RETURNING message_id`,
      [conversationId, scopeResolution.clarificationMessage]
    );
    await queryFn(
      `UPDATE conversation SET message_count = message_count + 1, updated_at = now() WHERE conversation_id = $1`,
      [conversationId]
    );
    addTraceStep({
      stepKey: "clarification",
      title: "Clarification required",
      status: "completed",
      summary: {
        clarification_required: true,
        scope_mode: scopeResolution.scopeMode,
      },
      payload: {
        clarification_message: scopeResolution.clarificationMessage,
        scope_resolution: scopeResolution,
      },
    });
    addTraceStep({
      stepKey: "final_response",
      title: "Final response",
      status: "completed",
      summary: {
        source: "clarification",
        answer_length: scopeResolution.clarificationMessage.length,
      },
      payload: {
        answer: scopeResolution.clarificationMessage,
        message_id: msgResult.rows[0].message_id,
      },
    });
    const retrievalRunId = await persistTraceForMessage(
      msgResult.rows[0].message_id,
      Date.now() - pipelineStart,
    );
    return {
      answer: scopeResolution.clarificationMessage,
      conversationId,
      messageId: msgResult.rows[0].message_id,
      retrieval_run_id: retrievalRunId,
      citations: [],
      retrieval: {
        preset: request.preset,
        mode,
        total_latency_ms: Date.now() - pipelineStart,
        cache_hit: false,
        chunks_retrieved: 0,
        expanded_queries: [],
        detected_entities: [],
      },
    };
  }
  const initialPinnedFilters = buildNextPinnedFilters(pinnedConversationFilters, scopeResolution);
  if (initialPinnedFilters) {
    await queryFn(
      `UPDATE conversation SET pinned_filters = $1, updated_at = now() WHERE conversation_id = $2`,
      [JSON.stringify(initialPinnedFilters), conversationId]
    );
    pinnedConversationFilters = initialPinnedFilters;
  }
  let cacheActiveFilters = buildCacheActiveFilters(
    mode,
    effectiveFilters,
    scopeResolution.activeCaseScopes,
  );

  addTraceStep({
    stepKey: "conversation_context",
    title: "Conversation context",
    status: "completed",
    itemCount: history.length,
    summary: {
      history_count: history.length,
      scope_mode: scopeResolution.scopeMode,
      scope_source: scopeResolution.scopeSource,
      active_case_scopes: scopeResolution.activeCaseScopes,
    },
    payload: {
      conversation_id: conversationId,
      request_filters: request.filters || {},
      effective_filters: effectiveFilters,
      pinned_filters: pinnedConversationFilters || {},
      scope_resolution: scopeResolution,
      cache_active_filters: cacheActiveFilters,
      user_access: {
        clearance: userClearance,
        user_type: userType,
      },
    },
  });

  // Step 1: Check semantic cache (with access signature — FR-017)
  const cacheLookupStart = Date.now();
  const cached = request.skipCache
    ? null
    : await checkCache(
      { queryFn, llmProvider },
      request.workspaceId,
      request.question,
      request.preset,
      accessSignature,
      cacheActiveFilters,
    );
  const cacheLookupLatency = Date.now() - cacheLookupStart;
  if (cached) {
    traceCacheHit = true;
    const msgResult = await queryFn(
      `INSERT INTO message (conversation_id, role, content) VALUES ($1, 'assistant', $2) RETURNING message_id`,
      [conversationId, cached.answer_text]
    );
    await queryFn(
      `UPDATE conversation SET message_count = message_count + 1, updated_at = now() WHERE conversation_id = $1`,
      [conversationId]
    );

    addTraceStep({
      stepKey: "cache_lookup",
      title: "Cache lookup",
      status: "cache_hit",
      latencyMs: cacheLookupLatency,
      itemCount: cached.citations.length,
      summary: {
        cache_hit: true,
        citations: cached.citations.length,
      },
      payload: {
        access_signature: accessSignature,
        active_filters: cacheActiveFilters,
        cached_answer_preview: trimTraceText(cached.answer_text, 500),
        citations: cached.citations,
      },
    });

    addTraceStep({
      stepKey: "final_response",
      title: "Final response",
      status: "completed",
      itemCount: cached.citations.length,
      summary: {
        source: "cache",
        answer_length: cached.answer_text.length,
      },
      payload: {
        answer: cached.answer_text,
        message_id: msgResult.rows[0].message_id,
        citations: cached.citations.map((c, i) => ({
          citation_index: i + 1,
          document_title: c.document_title,
          excerpt: c.excerpt,
          chunk_id: c.chunk_id,
        })),
      },
    });

    const retrievalRunId = await persistTraceForMessage(
      msgResult.rows[0].message_id,
      Date.now() - pipelineStart,
    );

    logInfo("RAG pipeline: cache hit", { workspaceId: request.workspaceId });
    return {
      answer: cached.answer_text,
      conversationId,
      messageId: msgResult.rows[0].message_id,
      retrieval_run_id: retrievalRunId,
      citations: cached.citations.map((c, i) => ({
        citation_index: i + 1,
        document_title: c.document_title,
        page_number: null,
        excerpt: c.excerpt,
        relevance_score: 1,
      })),
      retrieval: {
        preset: request.preset,
        mode,
        total_latency_ms: Date.now() - pipelineStart,
        cache_hit: true,
        chunks_retrieved: 0,
        expanded_queries: [],
        detected_entities: [],
      },
    };
  }

  addTraceStep({
    stepKey: "cache_lookup",
    title: "Cache lookup",
    status: request.skipCache ? "skipped" : "cache_miss",
    latencyMs: cacheLookupLatency,
    summary: {
      cache_hit: false,
      cache_skipped: !!request.skipCache,
    },
    payload: {
      access_signature: accessSignature,
      active_filters: cacheActiveFilters,
      reason: request.skipCache ? "skip_cache_requested" : "no_cache_match",
    },
  });

  // Step 2: Query expansion (FR-012/AC-01: persist expanded_intent, pass history for coreference)
  const expansionStart = Date.now();
  const expansionResult = await expandQueryWithIntent(llmProvider, request.question, history);
  const expansionLatency = Date.now() - expansionStart;
  const { queries: expandedQueries } = expansionResult;
  expandedIntent = expansionResult.expandedIntent;
  stepBackQuestion = expansionResult.stepBackQuestion || null;

  addTraceStep({
    stepKey: "query_expansion",
    title: "Intent expansion",
    status: "completed",
    latencyMs: expansionLatency,
    itemCount: expandedQueries.length,
    summary: {
      query_count: expandedQueries.length,
      expanded_intent: expandedIntent,
      step_back_question: stepBackQuestion,
    },
    payload: {
      original_query: request.question,
      expanded_intent: expandedIntent,
      step_back_question: stepBackQuestion,
      expanded_queries: expandedQueries,
      history_user_messages: history.filter((msg) => msg.role === "user").slice(-3),
    },
  });

  // Step 3: Entity detection
  const entityDetectionStart = Date.now();
  entities = await detectEntities(llmProvider, request.question);
  const entityDetectionLatency = Date.now() - entityDetectionStart;

  addTraceStep({
    stepKey: "entity_detection",
    title: "Entity detection",
    status: "completed",
    latencyMs: entityDetectionLatency,
    itemCount: entities.length,
    summary: {
      entity_count: entities.length,
      entity_types: Array.from(new Set(entities.map((entity) => entity.type))),
    },
    payload: {
      entities,
    },
  });

  // FR-014: Infer filters from entities and auto-apply to search
  const detectedCaseScopes = collectCaseScopes(
    entities
      .filter((entity) => entity.type.toUpperCase() === "CASE_REF")
      .map((entity) => entity.name)
  );
  for (const entity of entities) {
    const entityType = entity.type.toUpperCase();
    if (entityType === "CASE_REF" && detectedCaseScopes.length === 1) {
      inferredFilters.case_reference = entity.name;
    }
    if (entityType === "STATION" && !effectiveFilters.station_code) {
      inferredFilters.station_code = entity.name;
    }
    if (entityType === "LANGUAGE" && !effectiveFilters.language) {
      inferredFilters.language = entity.name;
    }
  }

  // Case scope is tracked for cache keys, pinned conversation context, chunk
  // filtering, and answer-generation instructions. It is intentionally not
  // applied as a hard SQL filter because metadata coverage is not reliable yet.
  if (detectedCaseScopes.length > 1) {
    inferredFilters.case_references = detectedCaseScopes;
  }

  if (scopeResolution.activeCaseScopes.length === 0 && !looksLikeGlobalQuery(request.question) && detectedCaseScopes.length > 0) {
    scopeResolution = resolveScopeResolution(
      request.question,
      detectedCaseScopes,
      pinnedCaseReference,
      pinnedMultiCaseScopes,
      pinnedLastScopeMode,
    );
  }

  expandedQueriesWithCaseScope = appendCaseScopeQueries(
    request.question,
    expandedQueries,
    scopeResolution.activeCaseScopes,
  );
  const expandedCaseScopes = collectCaseScopes(...expandedQueriesWithCaseScope.map((query) => extractCaseScopes(query)));

  if (scopeResolution.activeCaseScopes.length === 0 && !looksLikeGlobalQuery(request.question) && expandedCaseScopes.length > 0) {
    scopeResolution = resolveScopeResolution(
      request.question,
      expandedCaseScopes,
      pinnedCaseReference,
      pinnedMultiCaseScopes,
      pinnedLastScopeMode,
    );
    expandedQueriesWithCaseScope = appendCaseScopeQueries(
      request.question,
      expandedQueries,
      scopeResolution.activeCaseScopes,
    );
  } else if (scopeResolution.activeCaseScopes.length > 0) {
    scopeResolution = {
      ...scopeResolution,
      activeCaseScopes: collectCaseScopes(scopeResolution.activeCaseScopes, detectedCaseScopes, expandedCaseScopes),
    };
  }

  const resolvedPinnedFilters = buildNextPinnedFilters(pinnedConversationFilters, scopeResolution);
  if (resolvedPinnedFilters && JSON.stringify(resolvedPinnedFilters) !== JSON.stringify(pinnedConversationFilters || {})) {
    await queryFn(
      `UPDATE conversation SET pinned_filters = $1, updated_at = now() WHERE conversation_id = $2`,
      [JSON.stringify(resolvedPinnedFilters), conversationId]
    );
    pinnedConversationFilters = resolvedPinnedFilters;
  }
  cacheActiveFilters = buildCacheActiveFilters(mode, effectiveFilters, scopeResolution.activeCaseScopes);

  addTraceStep({
    stepKey: "filter_inference",
    title: "Filter inference",
    status: "completed",
    itemCount: Object.keys(inferredFilters).length,
    summary: {
      inferred_filter_count: Object.keys(inferredFilters).length,
      active_case_scopes: scopeResolution.activeCaseScopes,
      scope_mode: scopeResolution.scopeMode,
    },
    payload: {
      inferred_filters: inferredFilters,
      detected_case_scopes: detectedCaseScopes,
      expanded_case_scopes: expandedCaseScopes,
      final_scope_resolution: scopeResolution,
      resolved_pinned_filters: pinnedConversationFilters || {},
      cache_active_filters: cacheActiveFilters,
    },
  });

  // Steps 4-6 based on retrieval mode (FR-015)
  if (mode === "hybrid" || mode === "vector_only") {
    const vectorPromises = expandedQueriesWithCaseScope.map((q) =>
      vectorSearch({ queryFn, llmProvider }, request.workspaceId, q, presetConfig.maxChunks, effectiveFilters)
    );
    const vectorResultSets = await Promise.all(vectorPromises);
    const allVectorResults = vectorResultSets.flatMap((r) => r.results);
    vectorLatency = Math.max(...vectorResultSets.map((r) => r.latencyMs));
    logInfo("Vector search completed", { totalResults: allVectorResults.length, queries: expandedQueriesWithCaseScope.length });

    const seenChunkIds = new Set<string>();
    uniqueVectorResults = allVectorResults.filter((r) => {
      if (seenChunkIds.has(r.chunk_id)) return false;
      seenChunkIds.add(r.chunk_id);
      return true;
    });

    addTraceStep({
      stepKey: "vector_search",
      title: "Vector search",
      status: "completed",
      latencyMs: vectorLatency,
      itemCount: uniqueVectorResults.length,
      summary: {
        queries_executed: expandedQueriesWithCaseScope.length,
        raw_result_count: allVectorResults.length,
        deduped_result_count: uniqueVectorResults.length,
      },
      payload: {
        queries: expandedQueriesWithCaseScope.map((query, index) => ({
          query,
          latency_ms: vectorResultSets[index]?.latencyMs ?? null,
          results: (vectorResultSets[index]?.results || []).map((result) => toTraceVectorResult(result)),
        })),
        deduped_results: uniqueVectorResults.map((result) => toTraceVectorResult(result)),
      },
    });
  } else {
    addTraceStep({
      stepKey: "vector_search",
      title: "Vector search",
      status: "skipped",
      summary: {
        reason: `mode_${mode}`,
      },
      payload: {
        mode,
      },
    });
  }

  if (mode === "hybrid" || mode === "metadata_only") {
    const lexResult = await lexicalSearch(
      queryFn, request.workspaceId, request.question, presetConfig.maxChunks, effectiveFilters
    );
    lexicalResults = lexResult.results;
    lexicalLatency = lexResult.latencyMs;
    addTraceStep({
      stepKey: "lexical_search",
      title: "Lexical search",
      status: "completed",
      latencyMs: lexicalLatency,
      itemCount: lexicalResults.length,
      summary: {
        result_count: lexicalResults.length,
      },
      payload: {
        query: request.question,
        results: lexicalResults.map((result) => toTraceLexicalResult(result)),
      },
    });
  } else {
    addTraceStep({
      stepKey: "lexical_search",
      title: "Lexical search",
      status: "skipped",
      summary: {
        reason: `mode_${mode}`,
      },
      payload: {
        mode,
      },
    });
  }

  if (mode === "hybrid" || mode === "graph_only") {
    // Timeout must accommodate embedding call (~500ms) + DB queries (~200ms) + BFS (~200ms)
    const GRAPH_TIMEOUT_MS = 3000;
    const graphTimeout = new Promise<{ result: typeof graphResult; latencyMs: number }>((resolve) => {
      setTimeout(() => resolve({
        result: { nodes: [], edges: [], contextText: "", chunkIds: new Set<string>(), nodeIds: [] },
        latencyMs: GRAPH_TIMEOUT_MS,
      }), GRAPH_TIMEOUT_MS);
    });
    const graphLookup = await Promise.race([
      graphContextLookup({ queryFn, llmProvider }, request.workspaceId, request.question, entities, presetConfig.graphHops),
      graphTimeout,
    ]);
    graphResult = graphLookup.result;
    graphLatency = graphLookup.latencyMs;
    addTraceStep({
      stepKey: "graph_lookup",
      title: "Knowledge graph lookup",
      status: "completed",
      latencyMs: graphLatency,
      itemCount: graphResult.nodes.length,
      summary: {
        node_count: graphResult.nodes.length,
        edge_count: graphResult.edges.length,
        related_chunk_count: graphResult.chunkIds.size,
      },
      payload: {
        query: request.question,
        entities,
        nodes: graphResult.nodes.map((node) => ({
          node_id: node.node_id,
          name: node.name,
          node_type: node.node_type,
          subtype: node.subtype || null,
          description: node.description,
        })),
        edges: graphResult.edges,
        related_chunk_ids: Array.from(graphResult.chunkIds),
        context_text: graphResult.contextText,
      },
    });
  } else {
    addTraceStep({
      stepKey: "graph_lookup",
      title: "Knowledge graph lookup",
      status: "skipped",
      summary: {
        reason: `mode_${mode}`,
      },
      payload: {
        mode,
      },
    });
  }

  // Step 8: Rerank
  const rerankStart = Date.now();
  rankedChunks = rerank(
    uniqueVectorResults,
    lexicalResults,
    graphResult.chunkIds,
    presetConfig,
    presetConfig.maxChunks,
  );
  rerankLatency = Date.now() - rerankStart;

  addTraceStep({
    stepKey: "rerank",
    title: "Rerank candidates",
    status: "completed",
    latencyMs: rerankLatency,
    itemCount: rankedChunks.length,
    summary: {
      ranked_chunk_count: rankedChunks.length,
    },
    payload: {
      ranked_chunks: rankedChunks.map((chunk) => toTraceRankedChunk(chunk)),
    },
  });

  // Step 8b: Chunk access filtering (FR-002)
  const rankedBeforeAccessFilter = [...rankedChunks];
  if (rankedChunks.length > 0 && userType !== "ADMIN") {
    const allowedChunkIds = await filterChunksByAccess(
      queryFn,
      rankedChunks.map((c) => c.chunk_id),
      request.userId,
      userClearance,
      userType,
    );
    const allowedSet = new Set(allowedChunkIds);
    const beforeCount = rankedChunks.length;
    rankedChunks = rankedChunks.filter((c) => allowedSet.has(c.chunk_id));
    if (rankedChunks.length < beforeCount) {
      logInfo("Chunk access filtering applied", {
        before: beforeCount,
        after: rankedChunks.length,
        userId: request.userId,
      });
    }

    const removedChunks = rankedBeforeAccessFilter
      .filter((chunk) => !allowedSet.has(chunk.chunk_id))
      .map((chunk) => toTraceFilteredChunk(chunk, "access_denied", false));

    addTraceStep({
      stepKey: "access_filter",
      title: "Access filtering",
      status: "completed",
      itemCount: rankedChunks.length,
      summary: {
        before_count: beforeCount,
        after_count: rankedChunks.length,
        removed_count: removedChunks.length,
      },
      payload: {
        allowed_chunks: rankedChunks.map((chunk) => toTraceRankedChunk(chunk)),
        removed_chunks: removedChunks,
      },
    });
  } else {
    addTraceStep({
      stepKey: "access_filter",
      title: "Access filtering",
      status: "skipped",
      itemCount: rankedChunks.length,
      summary: {
        reason: rankedChunks.length === 0 ? "no_ranked_chunks" : "admin_bypass",
      },
      payload: {
        remaining_chunks: rankedChunks.map((chunk) => toTraceRankedChunk(chunk)),
      },
    });
  }

  const rankedBeforeScopeFilter = [...rankedChunks];
  let scopeRemovedChunks: RankedChunk[] = [];
  let scopeBalancedOutChunks: RankedChunk[] = [];
  if (scopeResolution.activeCaseScopes.length > 0) {
    const beforeCount = rankedChunks.length;
    rankedChunks = filterChunksByCaseScopes(rankedChunks, scopeResolution.activeCaseScopes);
    const remainingIds = new Set(rankedChunks.map((chunk) => chunk.chunk_id));
    scopeRemovedChunks = rankedBeforeScopeFilter.filter((chunk) => !remainingIds.has(chunk.chunk_id));
    if (rankedChunks.length < beforeCount) {
      logInfo("Case scope filtering applied", {
        before: beforeCount,
        after: rankedChunks.length,
        caseScopes: scopeResolution.activeCaseScopes,
      });
    }
  }

  if (scopeResolution.scopeMode === "multi" && scopeResolution.activeCaseScopes.length > 1) {
    const beforeBalance = [...rankedChunks];
    rankedChunks = balanceChunksAcrossCaseScopes(rankedChunks, scopeResolution.activeCaseScopes, presetConfig.maxChunks);
    const balancedIds = new Set(rankedChunks.map((chunk) => chunk.chunk_id));
    scopeBalancedOutChunks = beforeBalance.filter((chunk) => !balancedIds.has(chunk.chunk_id));
  }

  if (scopeResolution.activeCaseScopes.length > 0 || (scopeResolution.scopeMode === "multi" && rankedBeforeScopeFilter.length > 0)) {
    addTraceStep({
      stepKey: "scope_filter",
      title: "Scope filtering",
      status: "completed",
      itemCount: rankedChunks.length,
      summary: {
        active_case_scopes: scopeResolution.activeCaseScopes,
        removed_count: scopeRemovedChunks.length,
        balanced_out_count: scopeBalancedOutChunks.length,
        final_count: rankedChunks.length,
      },
      payload: {
        scope_resolution: scopeResolution,
        removed_chunks: scopeRemovedChunks.map((chunk) => toTraceFilteredChunk(chunk, "scope_mismatch")),
        balanced_out_chunks: scopeBalancedOutChunks.map((chunk) => toTraceFilteredChunk(chunk, "multi_case_balance")),
        final_chunks: rankedChunks.map((chunk) => toTraceRankedChunk(chunk)),
      },
    });
  } else {
    addTraceStep({
      stepKey: "scope_filter",
      title: "Scope filtering",
      status: "skipped",
      itemCount: rankedChunks.length,
      summary: {
        reason: "global_scope",
      },
      payload: {
        final_chunks: rankedChunks.map((chunk) => toTraceRankedChunk(chunk)),
      },
    });
  }

  // FR-015: Deterministic "insufficient evidence" when no high-confidence chunks
  if (rankedChunks.length === 0) {
    const insufficientMsg = "I could not find sufficient evidence in the available documents to answer your question. " +
      "Try narrowing your filters, using different search terms, or ensuring relevant documents have been uploaded.";
    const msgResult = await queryFn(
      `INSERT INTO message (conversation_id, role, content) VALUES ($1, 'assistant', $2) RETURNING message_id`,
      [conversationId, insufficientMsg]
    );
    await queryFn(
      `UPDATE conversation SET message_count = message_count + 1, updated_at = now() WHERE conversation_id = $1`,
      [conversationId]
    );
    addTraceStep({
      stepKey: "answer_generation",
      title: "Answer generation",
      status: "skipped",
      summary: {
        reason: "insufficient_evidence",
      },
      payload: {
        ranked_chunk_count: 0,
      },
    });
    addTraceStep({
      stepKey: "final_response",
      title: "Final response",
      status: "completed",
      summary: {
        source: "insufficient_evidence",
        answer_length: insufficientMsg.length,
      },
      payload: {
        answer: insufficientMsg,
        message_id: msgResult.rows[0].message_id,
        citations: [],
      },
    });
    const retrievalRunId = await persistTraceForMessage(
      msgResult.rows[0].message_id,
      Date.now() - pipelineStart,
    );
    return {
      answer: insufficientMsg,
      conversationId,
      messageId: msgResult.rows[0].message_id,
      retrieval_run_id: retrievalRunId,
      citations: [],
      retrieval: {
        preset: request.preset,
        mode,
        total_latency_ms: Date.now() - pipelineStart,
        cache_hit: false,
        chunks_retrieved: 0,
        expanded_queries: expandedQueriesWithCaseScope,
        detected_entities: entities,
        inferred_filters: Object.keys(inferredFilters).length > 0 ? inferredFilters : undefined,
      },
    };
  }

  // Step 9: Answer generation (reuse history fetched earlier)
  // FR-014/AC-05: Use centralized model routing (LlmProvider) with env-var fallback
  const routedModel = llmProvider.getModelForPreset("ANSWER_GENERATION", request.preset);
  const envKey = PRESET_MODEL_ENV_KEYS[request.preset];
  const answerModel = routedModel ?? (envKey ? process.env[envKey] : undefined);

  // Build scope entities: merge detected entities with case refs from expanded queries
  // and pinned conversation context. This ensures follow-up questions stay scoped
  // even when the current question doesn't mention a case number.
  const scopeEntities = [...entities];
  addScopeEntity(scopeEntities, explicitCaseReference);
  for (const scope of scopeResolution.activeCaseScopes) {
    addScopeEntity(scopeEntities, scope);
  }
  for (const q of expandedQueriesWithCaseScope) {
    for (const scope of extractCaseScopes(q)) {
      addScopeEntity(scopeEntities, scope);
    }
  }
  addScopeEntity(scopeEntities, getPinnedCaseReference(pinnedConversationFilters));
  const matchedCaseScopes = getMatchedCaseScopes(rankedChunks, scopeResolution.activeCaseScopes);

  const genResult = await generateAnswer(
    llmProvider,
    request.question,
    rankedChunks,
    graphResult.contextText,
    history,
    request.preset,
    answerModel,
    scopeEntities,
    {
      requestedCaseScopes: scopeResolution.activeCaseScopes,
      matchedCaseScopes,
      scopeMode: scopeResolution.scopeMode,
      scopeSource: scopeResolution.scopeSource,
    },
  );
  generationLatency = genResult?.latencyMs;

  if (!genResult) {
    const fallbackMsg = "I was unable to generate an answer. Please try rephrasing your question.";
    const msgResult = await queryFn(
      `INSERT INTO message (conversation_id, role, content) VALUES ($1, 'assistant', $2) RETURNING message_id`,
      [conversationId, fallbackMsg]
    );
    await queryFn(
      `UPDATE conversation SET message_count = message_count + 1, updated_at = now() WHERE conversation_id = $1`,
      [conversationId]
    );
    addTraceStep({
      stepKey: "answer_generation",
      title: "Answer generation",
      status: "fallback",
      summary: {
        reason: "llm_returned_null",
      },
      payload: {
        ranked_chunk_count: rankedChunks.length,
        input_chunks: rankedChunks.map((chunk) => toTraceRankedChunk(chunk)),
      },
    });
    addTraceStep({
      stepKey: "final_response",
      title: "Final response",
      status: "completed",
      summary: {
        source: "generation_fallback",
        answer_length: fallbackMsg.length,
      },
      payload: {
        answer: fallbackMsg,
        message_id: msgResult.rows[0].message_id,
        citations: [],
      },
    });
    const retrievalRunId = await persistTraceForMessage(
      msgResult.rows[0].message_id,
      Date.now() - pipelineStart,
    );
    return {
      answer: fallbackMsg,
      conversationId,
      messageId: msgResult.rows[0].message_id,
      retrieval_run_id: retrievalRunId,
      citations: [],
      retrieval: {
        preset: request.preset,
        mode,
        total_latency_ms: Date.now() - pipelineStart,
        cache_hit: false,
        chunks_retrieved: rankedChunks.length,
        expanded_queries: expandedQueriesWithCaseScope,
        detected_entities: entities,
      },
    };
  }

  addTraceStep({
    stepKey: "answer_generation",
    title: "Answer generation",
    status: "completed",
    latencyMs: genResult.latencyMs,
    itemCount: genResult.citations.length,
    summary: {
      provider: genResult.provider,
      model: genResult.model,
      citation_count: genResult.citations.length,
      follow_up_count: genResult.followUpQuestions.length,
    },
    payload: {
      provider: genResult.provider,
      model: genResult.model,
      answer: genResult.answer,
      citations: genResult.citations,
      follow_up_questions: genResult.followUpQuestions,
      input_chunks: rankedChunks.map((chunk) => toTraceRankedChunk(chunk)),
      graph_context: graphResult.contextText,
    },
  });

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

  // Save citations (batch insert)
  if (genResult.citations.length > 0) {
    const citationValues: unknown[] = [];
    const citationPlaceholders: string[] = [];
    let paramIdx = 1;
    for (const citation of genResult.citations) {
      citationPlaceholders.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
      );
      citationValues.push(
        messageId, citation.chunk_id, citation.document_id, citation.document_title,
        citation.page_number, citation.excerpt, citation.relevance_score, citation.citation_index
      );
    }
    await queryFn(
      `INSERT INTO citation (message_id, chunk_id, document_id, document_title, page_number, excerpt, relevance_score, citation_index)
       VALUES ${citationPlaceholders.join(", ")}`,
      citationValues
    );
  }
  const totalLatency = Date.now() - pipelineStart;

  // Step 10: Cache result (with access signature — FR-017)
  const cacheWriteStart = Date.now();
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
    accessSignature,
    cacheActiveFilters,
  );
  const cacheWriteLatency = Date.now() - cacheWriteStart;

  addTraceStep({
    stepKey: "cache_write",
    title: "Cache write",
    status: "completed",
    latencyMs: cacheWriteLatency,
    itemCount: genResult.citations.length,
    summary: {
      cached: true,
      citation_count: genResult.citations.length,
    },
    payload: {
      access_signature: accessSignature,
      active_filters: cacheActiveFilters,
      citations: genResult.citations.map((citation) => ({
        chunk_id: citation.chunk_id,
        document_title: citation.document_title,
        excerpt: citation.excerpt,
      })),
    },
  });

  addTraceStep({
    stepKey: "final_response",
    title: "Final response",
    status: "completed",
    itemCount: genResult.citations.length,
    summary: {
      source: "generated",
      answer_length: genResult.answer.length,
    },
    payload: {
      answer: genResult.answer,
      message_id: messageId,
      citations: genResult.citations,
      follow_up_questions: genResult.followUpQuestions,
    },
  });

  const retrievalRunId = await persistTraceForMessage(messageId, totalLatency);

  // FR-014/AC-07: Warn if pipeline exceeds P95 latency threshold
  if (totalLatency > 3000) {
    logWarn("RAG pipeline P95 exceeded", {
      workspaceId: request.workspaceId,
      preset: request.preset,
      totalLatencyMs: totalLatency,
      threshold: 3000,
    });
  }

  // Auto-title: generate a concise title for new conversations after first answer
  let generatedTitle: string | undefined;
  if (!request.conversationId) {
    try {
      const titleResult = await llmProvider.llmComplete({
        messages: [
          { role: "system", content: "Generate a concise 5-8 word title for this conversation. Return ONLY the title, nothing else." },
          { role: "user", content: `Question: ${request.question}\nAnswer: ${genResult.answer.slice(0, 300)}` },
        ],
        useCase: "GENERAL",
        maxTokens: 30,
        temperature: 0.3,
      });
      if (titleResult?.content) {
        generatedTitle = titleResult.content.replace(/^["']|["']$/g, "").trim().slice(0, 100);
        await queryFn(
          "UPDATE conversation SET title = $1 WHERE conversation_id = $2",
          [generatedTitle, conversationId]
        );
      }
    } catch {
      // Non-critical — keep truncated question as title
    }
  }

  logInfo("RAG pipeline complete", {
    workspaceId: request.workspaceId,
    preset: request.preset,
    mode,
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
    retrieval_run_id: retrievalRunId,
    model_provider: genResult.provider,
    model_id: genResult.model,
    prompt_tokens: genResult.promptTokens,
    output_tokens: genResult.outputTokens,
    cost_usd: genResult.costUsd,
    title: generatedTitle,
    follow_up_questions: genResult.followUpQuestions.length > 0 ? genResult.followUpQuestions : undefined,
    citations: genResult.citations.map((c) => ({
      citation_index: c.citation_index,
      document_title: c.document_title,
      page_number: c.page_number,
      excerpt: c.excerpt,
      relevance_score: c.relevance_score,
    })),
    retrieval: {
      preset: request.preset,
      mode,
      total_latency_ms: totalLatency,
      cache_hit: false,
      chunks_retrieved: rankedChunks.length,
      expanded_queries: expandedQueriesWithCaseScope,
      detected_entities: entities,
      inferred_filters: Object.keys(inferredFilters).length > 0 ? inferredFilters : undefined,
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

function buildCacheActiveFilters(
  mode: string,
  filters: PipelineRequest["filters"],
  caseScopes: string[] = [],
): Record<string, unknown> {
  const activeFilters: Record<string, unknown> = { mode };
  if (!filters) {
    setCaseScopeFilters(activeFilters, caseScopes);
    return activeFilters;
  }

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (
      key === "case_reference" ||
      key === "case_references" ||
      key === "last_multi_case_references" ||
      key === "last_scope_mode" ||
      key === "last_scope_source"
    ) continue;
    activeFilters[key] = value;
  }

  setCaseScopeFilters(activeFilters, caseScopes);

  return activeFilters;
}

function getPinnedCaseReference(pinnedFilters?: Record<string, unknown>): string | undefined {
  const value = pinnedFilters?.case_reference;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getPinnedMultiCaseReferences(pinnedFilters?: Record<string, unknown>): string[] {
  const value = pinnedFilters?.last_multi_case_references;
  return Array.isArray(value)
    ? collectCaseScopes(value.filter((item): item is string => typeof item === "string"))
    : [];
}

function getPinnedLastScopeMode(pinnedFilters?: Record<string, unknown>): ScopeMode | undefined {
  const value = pinnedFilters?.last_scope_mode;
  return value === "single" || value === "multi" || value === "global"
    ? value
    : undefined;
}

function readCaseReference(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function extractCaseScopes(text: string): string[] {
  const matches = new Map<string, string>();
  const patterns = [
    /(?:\bcase\b|\bcr(?:ime)?\b|\bcr\.\b|\bfir\b)\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z0-9]+(?:[/-][A-Z0-9]+)+|\d{1,8})/gi,
    /\b([A-Z0-9]+(?:\/[A-Z0-9]+)+)\b/gi,
    /\b(\d{3,8}\s*(?:\/|-|\bOF\b)\s*\d{2,4})\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1] || match[0];
      const normalized = normalizeCaseScope(raw);
      if (normalized) {
        matches.set(normalized, raw.trim());
      }
    }
  }

  const groupedCasePattern = /\bcases?\b([^?.!\n]{0,120})/gi;
  for (const match of text.matchAll(groupedCasePattern)) {
    const segment = match[1] || "";
    if (!/\b(and|vs\.?|versus|,|&)\b/i.test(segment)) continue;
    for (const caseMatch of segment.matchAll(/\b\d{1,8}(?:\s*(?:\/|-|\bOF\b)\s*\d{2,4})?\b/gi)) {
      const raw = caseMatch[0]?.trim();
      if (!raw) continue;
      const normalized = normalizeCaseScope(raw);
      if (normalized) {
        matches.set(normalized, raw);
      }
    }
  }

  return Array.from(matches.keys());
}

function normalizeCaseScope(value: string): string {
  const cleaned = value
    .toUpperCase()
    .replace(/\b(CASE|CRIME|CR|FIR|NO|NUMBER)\b/g, " ")
    .replace(/\bOF\b/g, "/")
    .replace(/-/g, "/")
    .replace(/[^A-Z0-9/]+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();

  const compoundMatch = cleaned.match(/[A-Z0-9]+(?:[/-][A-Z0-9]+)+/);
  if (compoundMatch) {
    return compoundMatch[0].replace(/-/g, "/");
  }

  return cleaned;
}

function filterChunksByCaseScopes(chunks: RankedChunk[], caseScopes: string[]): RankedChunk[] {
  const normalizedScopes = collectCaseScopes(caseScopes);
  const matched: RankedChunk[] = [];
  const unresolved: RankedChunk[] = [];
  const documentMatchedScopes = new Map<string, string[]>();

  for (const chunk of chunks) {
    const matchedCaseScopes = getChunkMatchedCaseScopes(chunk, normalizedScopes);
    if (matchedCaseScopes.length === 0) {
      if (collectChunkCaseSignals(chunk).length === 0) {
        unresolved.push(chunk);
      }
      continue;
    }
    const existingDocumentScopes = documentMatchedScopes.get(chunk.document_id) || [];
    documentMatchedScopes.set(
      chunk.document_id,
      collectCaseScopes(existingDocumentScopes, matchedCaseScopes),
    );
    matched.push({
      ...chunk,
      matched_case_scopes: matchedCaseScopes,
      scope_status: "MATCH" as const,
    });
  }

  const documentScopedUnresolved = unresolved
    .map((chunk) => {
      const matchedCaseScopes = collectCaseScopes(documentMatchedScopes.get(chunk.document_id) || []);
      if (matchedCaseScopes.length === 0) {
        return { ...chunk, scope_status: "UNKNOWN" as const };
      }
      return {
        ...chunk,
        matched_case_scopes: matchedCaseScopes,
        scope_status: "UNKNOWN" as const,
      };
    });

  if (normalizedScopes.length > 1) {
    return [...matched, ...documentScopedUnresolved.filter((chunk) => (chunk.matched_case_scopes || []).length > 0)];
  }

  if (matched.length > 0) {
    return [...matched, ...documentScopedUnresolved.filter((chunk) => (chunk.matched_case_scopes || []).length > 0)];
  }

  return documentScopedUnresolved;
}

function balanceChunksAcrossCaseScopes(
  chunks: RankedChunk[],
  caseScopes: string[],
  maxChunks: number,
): RankedChunk[] {
  const normalizedScopes = collectCaseScopes(caseScopes);
  if (normalizedScopes.length <= 1 || chunks.length <= 1) {
    return chunks.slice(0, maxChunks);
  }

  const buckets = new Map<string, RankedChunk[]>();
  const shared: RankedChunk[] = [];
  for (const scope of normalizedScopes) {
    buckets.set(scope, []);
  }

  for (const chunk of chunks) {
    const matchedScopes = chunk.matched_case_scopes && chunk.matched_case_scopes.length > 0
      ? collectCaseScopes(chunk.matched_case_scopes)
      : getChunkMatchedCaseScopes(chunk, normalizedScopes);
    if (matchedScopes.length === 1) {
      buckets.get(matchedScopes[0])?.push({ ...chunk, matched_case_scopes: matchedScopes });
      continue;
    }
    if (matchedScopes.length > 1) {
      shared.push({ ...chunk, matched_case_scopes: matchedScopes });
    }
  }

  const selected: RankedChunk[] = [];
  const selectedIds = new Set<string>();
  const perScopeQuota = Math.max(1, Math.floor(maxChunks / normalizedScopes.length));
  for (const scope of normalizedScopes) {
    for (const chunk of (buckets.get(scope) || []).slice(0, perScopeQuota)) {
      if (selectedIds.has(chunk.chunk_id)) continue;
      selected.push(chunk);
      selectedIds.add(chunk.chunk_id);
    }
  }

  const overflow = [
    ...shared,
    ...normalizedScopes.flatMap((scope) => (buckets.get(scope) || []).slice(perScopeQuota)),
  ].sort((a, b) => b.score - a.score);

  for (const chunk of overflow) {
    if (selected.length >= maxChunks) break;
    if (selectedIds.has(chunk.chunk_id)) continue;
    selected.push(chunk);
    selectedIds.add(chunk.chunk_id);
  }

  return selected;
}

function getMatchedCaseScopes(chunks: RankedChunk[], caseScopes: string[]): string[] {
  return collectCaseScopes(
    ...chunks.map((chunk) => chunk.matched_case_scopes && chunk.matched_case_scopes.length > 0
      ? chunk.matched_case_scopes
      : getChunkMatchedCaseScopes(chunk, caseScopes))
  );
}

function getChunkMatchedCaseScopes(chunk: RankedChunk, caseScopes: string[]): string[] {
  const normalizedScopes = collectCaseScopes(caseScopes);
  const signals = collectChunkCaseSignals(chunk);
  if (signals.length === 0) {
    return [];
  }
  return normalizedScopes.filter((scope) => signals.some((signal) => caseSignalMatchesScope(signal, scope)));
}

function collectChunkCaseSignals(chunk: RankedChunk): string[] {
  const signals = new Set<string>();
  for (const value of [chunk.case_reference, chunk.fir_number]) {
    if (typeof value === "string" && value.trim().length > 0) {
      signals.add(normalizeCaseScope(value));
    }
  }
  for (const extracted of extractCaseScopes(chunk.document_title)) {
    signals.add(extracted);
  }
  return Array.from(signals);
}

function addScopeEntity(
  entities: Array<{ name: string; type: string }>,
  caseScope?: string,
): void {
  if (!caseScope) return;
  const normalizedScope = normalizeCaseScope(caseScope);
  if (entities.some((entity) => entity.type.toUpperCase() === "CASE_REF" && normalizeCaseScope(entity.name) === normalizedScope)) {
    return;
  }
  entities.push({ name: caseScope, type: "case_ref" });
}

function appendCaseScopeQueries(
  originalQuery: string,
  expandedQueries: string[],
  caseScopes: string[],
): string[] {
  if (caseScopes.length <= 1) {
    return expandedQueries;
  }

  const queries = [...expandedQueries];
  for (const scope of caseScopes) {
    queries.push(`case ${scope}`);
    queries.push(`${originalQuery} case ${scope}`);
  }

  if (looksLikeComparisonQuery(originalQuery)) {
    queries.push(`compare case ${caseScopes.join(" and case ")}`);
  }

  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
}

function setCaseScopeFilters(activeFilters: Record<string, unknown>, caseScopes: string[]): void {
  const normalizedScopes = collectCaseScopes(caseScopes);
  if (normalizedScopes.length === 1) {
    activeFilters.case_reference = normalizedScopes[0];
  } else if (normalizedScopes.length > 1) {
    activeFilters.case_references = normalizedScopes;
  }
}

function collectCaseScopes(...groups: Array<Array<string | undefined> | string[]>): string[] {
  const scopes = new Map<string, string>();
  for (const group of groups) {
    for (const value of group) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      const normalized = normalizeCaseScope(value);
      if (!normalized) continue;
      const key = getCaseScopeKey(normalized);
      const existing = scopes.get(key);
      scopes.set(key, pickPreferredCaseScope(existing, normalized));
    }
  }
  return Array.from(scopes.values());
}

function pickPreferredCaseScope(existing: string | undefined, candidate: string): string {
  if (!existing) return candidate;
  const existingSpecificity = getCaseScopeSpecificity(existing);
  const candidateSpecificity = getCaseScopeSpecificity(candidate);
  return candidateSpecificity > existingSpecificity ? candidate : existing;
}

function getCaseScopeSpecificity(scope: string): number {
  return scope.includes("/") ? 100 + scope.length : scope.length;
}

function getCaseScopeKey(scope: string): string {
  return scope.split("/")[0] || scope;
}

function caseSignalMatchesScope(signal: string, scope: string): boolean {
  if (signal === scope) return true;
  const signalKey = getCaseScopeKey(signal);
  const scopeKey = getCaseScopeKey(scope);
  if (signalKey !== scopeKey) return false;
  return !signal.includes("/") || !scope.includes("/");
}

function resolveScopeResolution(
  question: string,
  explicitCaseScopes: string[],
  defaultCaseScope?: string,
  lastMultiCaseScopes: string[] = [],
  lastScopeMode?: ScopeMode,
): ScopeResolution {
  const normalizedExplicitScopes = collectCaseScopes(explicitCaseScopes);
  if (normalizedExplicitScopes.length > 1) {
    return {
      activeCaseScopes: normalizedExplicitScopes,
      scopeMode: "multi",
      scopeSource: "explicit_multi",
    };
  }
  if (normalizedExplicitScopes.length === 1) {
    return {
      activeCaseScopes: normalizedExplicitScopes,
      scopeMode: "single",
      scopeSource: "explicit_single",
    };
  }

  if (looksLikeComparativeFollowUpQuery(question) && lastScopeMode === "multi" && lastMultiCaseScopes.length > 1) {
    return {
      activeCaseScopes: collectCaseScopes(lastMultiCaseScopes),
      scopeMode: "multi",
      scopeSource: "follow_up_multi",
    };
  }

  if (shouldClarifyAmbiguousMultiCaseFollowUp(question, lastMultiCaseScopes, lastScopeMode)) {
    return {
      activeCaseScopes: [],
      scopeMode: "global",
      scopeSource: "global",
      clarificationMessage: buildAmbiguousMultiCaseClarification(lastMultiCaseScopes),
    };
  }

  if (!looksLikeGlobalQuery(question) && defaultCaseScope && looksLikeScopedFollowUpQuery(question)) {
    return {
      activeCaseScopes: collectCaseScopes([defaultCaseScope]),
      scopeMode: "single",
      scopeSource: "follow_up_single",
    };
  }

  return {
    activeCaseScopes: [],
    scopeMode: "global",
    scopeSource: "global",
  };
}

function buildNextPinnedFilters(
  currentPinnedFilters: Record<string, unknown> | undefined,
  scopeResolution: ScopeResolution,
): Record<string, unknown> | undefined {
  const nextPinnedFilters = { ...(currentPinnedFilters || {}) };
  let changed = false;

  if (scopeResolution.scopeSource === "explicit_single" && scopeResolution.activeCaseScopes.length === 1) {
    if (nextPinnedFilters.case_reference !== scopeResolution.activeCaseScopes[0]) {
      nextPinnedFilters.case_reference = scopeResolution.activeCaseScopes[0];
      changed = true;
    }
    if (Array.isArray(nextPinnedFilters.last_multi_case_references) && nextPinnedFilters.last_multi_case_references.length > 0) {
      delete nextPinnedFilters.last_multi_case_references;
      changed = true;
    }
  }

  if (scopeResolution.scopeSource === "explicit_multi" && scopeResolution.activeCaseScopes.length > 1) {
    const currentMulti = getPinnedMultiCaseReferences(currentPinnedFilters);
    if (!sameCaseScopes(currentMulti, scopeResolution.activeCaseScopes)) {
      nextPinnedFilters.last_multi_case_references = scopeResolution.activeCaseScopes;
      changed = true;
    }
  }

  if (currentPinnedFilters || scopeResolution.scopeMode !== "global") {
    if (nextPinnedFilters.last_scope_mode !== scopeResolution.scopeMode) {
      nextPinnedFilters.last_scope_mode = scopeResolution.scopeMode;
      changed = true;
    }
    if (nextPinnedFilters.last_scope_source !== scopeResolution.scopeSource) {
      nextPinnedFilters.last_scope_source = scopeResolution.scopeSource;
      changed = true;
    }
  }

  return changed ? nextPinnedFilters : undefined;
}

function sameCaseScopes(left: string[], right: string[]): boolean {
  const normalizedLeft = collectCaseScopes(left);
  const normalizedRight = collectCaseScopes(right);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((scope, index) => scope === normalizedRight[index]);
}

function looksLikeComparisonQuery(query: string): boolean {
  return /\b(compare|comparison|difference|differences|different|versus|vs\.?|contrast|similarit(?:y|ies))\b/i.test(query);
}

function looksLikeComparativeFollowUpQuery(query: string): boolean {
  return /\b(which one|which case|the other case|both cases|both of them|either case|either one|difference|differences|compare|comparison|versus|vs\.?|contrast|similarit(?:y|ies))\b/i.test(query);
}

function looksLikeGlobalQuery(query: string): boolean {
  return /\b(which (?:are )?(?:the )?cases?|what cases?|list (?:the )?cases?|show (?:me )?(?:the )?cases?|available cases?|cases? about which you have information|what information (?:is )?available|which information (?:is )?available|which documents?|what documents?|across (?:all |different )?cases?|across cases|all cases|overall|in general)\b/i.test(query);
}

function looksLikeScopedFollowUpQuery(query: string): boolean {
  if (looksLikeGlobalQuery(query) || looksLikeComparativeFollowUpQuery(query)) {
    return false;
  }
  if (/\b(this case|that case|the case|this matter|that matter|the matter|the accused|the victim|the complainant|the incident|the offence|the offense|the witness(?:es)?|the charge(?:s)?|the motive|the weapon|what happened|who|why|when|where|how)\b/i.test(query)) {
    return true;
  }
  return query.trim().split(/\s+/).length <= 12;
}

function shouldClarifyAmbiguousMultiCaseFollowUp(
  query: string,
  lastMultiCaseScopes: string[],
  lastScopeMode?: ScopeMode,
): boolean {
  return lastScopeMode === "multi"
    && lastMultiCaseScopes.length > 1
    && !looksLikeGlobalQuery(query)
    && !looksLikeComparativeFollowUpQuery(query)
    && looksLikeScopedFollowUpQuery(query);
}

function buildAmbiguousMultiCaseClarification(caseScopes: string[]): string {
  const normalizedScopes = collectCaseScopes(caseScopes);
  const scopeList = normalizedScopes.join(" and ");
  return `Your previous question compared ${scopeList}. This follow-up is ambiguous because it does not say which case you want. Tell me the case number to use, or ask the question as a comparison across those cases.`;
}

function toTraceVectorResult(result: VectorSearchResult): Record<string, unknown> {
  return {
    chunk_id: result.chunk_id,
    document_id: result.document_id,
    document_title: result.document_title,
    page_start: result.page_start,
    heading_path: result.heading_path || null,
    similarity: result.similarity,
    chunk_type: result.chunk_type,
    case_reference: result.case_reference ?? null,
    fir_number: result.fir_number ?? null,
    station_code: result.station_code ?? null,
    content_preview: trimTraceText(result.content),
  };
}

function toTraceLexicalResult(result: LexicalSearchResult): Record<string, unknown> {
  return {
    chunk_id: result.chunk_id,
    document_id: result.document_id,
    document_title: result.document_title,
    page_start: result.page_start,
    rank: result.rank,
    chunk_type: result.chunk_type,
    case_reference: result.case_reference ?? null,
    fir_number: result.fir_number ?? null,
    station_code: result.station_code ?? null,
    content_preview: trimTraceText(result.content),
  };
}

function toTraceRankedChunk(chunk: RankedChunk): Record<string, unknown> {
  return {
    chunk_id: chunk.chunk_id,
    document_id: chunk.document_id,
    document_title: chunk.document_title,
    page_start: chunk.page_start,
    heading_path: chunk.heading_path || null,
    score: chunk.score,
    sources: chunk.sources,
    score_breakdown: chunk.score_breakdown || {
      vector: 0,
      lexical: 0,
      graph: 0,
      metadata: 0,
    },
    case_reference: chunk.case_reference ?? null,
    fir_number: chunk.fir_number ?? null,
    station_code: chunk.station_code ?? null,
    matched_case_scopes: chunk.matched_case_scopes || [],
    scope_status: chunk.scope_status || null,
    content_preview: trimTraceText(chunk.content),
  };
}

function toTraceFilteredChunk(
  chunk: RankedChunk,
  reason: string,
  includePreview: boolean = true,
): Record<string, unknown> {
  return {
    chunk_id: chunk.chunk_id,
    document_id: chunk.document_id,
    document_title: chunk.document_title,
    page_start: chunk.page_start,
    score: chunk.score,
    sources: chunk.sources,
    reason,
    case_reference: chunk.case_reference ?? null,
    fir_number: chunk.fir_number ?? null,
    station_code: chunk.station_code ?? null,
    matched_case_scopes: chunk.matched_case_scopes || [],
    scope_status: chunk.scope_status || null,
    ...(includePreview ? { content_preview: trimTraceText(chunk.content) } : {}),
  };
}

function trimTraceText(text: string, maxLength: number = 280): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}
