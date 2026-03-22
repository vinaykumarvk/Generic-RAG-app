import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryFn } from "@puda/api-core";

// Mock all dependencies before importing the pipeline module
vi.mock("../../retrieval/cache", () => ({
  checkCache: vi.fn(),
  writeCache: vi.fn(),
}));

vi.mock("../../retrieval/query-expander", () => ({
  expandQuery: vi.fn(),
  expandQueryWithIntent: vi.fn(),
}));

vi.mock("../../retrieval/entity-detector", () => ({
  detectEntities: vi.fn(),
}));

vi.mock("../../retrieval/vector-search", () => ({
  vectorSearch: vi.fn(),
}));

vi.mock("../../retrieval/lexical-search", () => ({
  lexicalSearch: vi.fn(),
}));

vi.mock("../../retrieval/graph-context", () => ({
  graphContextLookup: vi.fn(),
}));

vi.mock("../../retrieval/reranker", () => ({
  rerank: vi.fn(),
}));

vi.mock("../../retrieval/answer-generator", () => ({
  generateAnswer: vi.fn(),
}));

vi.mock("@puda/api-core", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../../middleware/sensitivity-guard", () => ({
  filterChunksByAccess: vi.fn().mockImplementation((_qf: unknown, chunkIds: string[]) => Promise.resolve(chunkIds)),
  buildAccessSignature: vi.fn().mockReturnValue("INTERNAL:MEMBER"),
}));

vi.mock("@puda/shared", () => ({
  RETRIEVAL_PRESETS: {
    concise: { maxChunks: 10, graphHops: 1, vectorWeight: 0.4, lexicalWeight: 0.2, graphWeight: 0.2, metadataWeight: 0.2 },
    balanced: { maxChunks: 20, graphHops: 1, vectorWeight: 0.4, lexicalWeight: 0.2, graphWeight: 0.2, metadataWeight: 0.2 },
    detailed: { maxChunks: 40, graphHops: 2, vectorWeight: 0.4, lexicalWeight: 0.2, graphWeight: 0.2, metadataWeight: 0.2 },
  },
}));

import { executeRetrievalPipeline, type PipelineRequest } from "../../retrieval/pipeline";
import { checkCache, writeCache } from "../../retrieval/cache";
import { expandQuery, expandQueryWithIntent } from "../../retrieval/query-expander";
import { detectEntities } from "../../retrieval/entity-detector";
import { vectorSearch } from "../../retrieval/vector-search";
import { lexicalSearch } from "../../retrieval/lexical-search";
import { graphContextLookup } from "../../retrieval/graph-context";
import { rerank } from "../../retrieval/reranker";
import { generateAnswer } from "../../retrieval/answer-generator";

// ── Mock Helpers ──────────────────────────────────────────────────────────────

function createMockQueryFn() {
  return vi.fn(async (sql: string, _params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> => {
    if (typeof sql === "string" && sql.includes("INSERT INTO retrieval_run")) {
      return { rows: [{ retrieval_run_id: "retrieval-run-1" }], rowCount: 1 };
    }
    if (typeof sql === "string" && sql.includes("INSERT INTO conversation")) {
      return { rows: [{ conversation_id: "conv-default" }], rowCount: 1 };
    }
    if (typeof sql === "string" && sql.includes("INSERT INTO message")) {
      return { rows: [{ message_id: "msg-default" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }) as ReturnType<typeof vi.fn> & QueryFn;
}

function createMockLlmProvider() {
  return {
    llmComplete: vi.fn(),
    llmCompleteJson: vi.fn(),
    llmEmbed: vi.fn(),
    isLlmAvailable: vi.fn().mockResolvedValue(true),
    getActiveProvider: vi.fn(),
    testProvider: vi.fn(),
    getSystemPrompt: vi.fn(),
    invalidateProviderCache: vi.fn(),
    getModelForPreset: vi.fn().mockReturnValue(undefined),
  };
}

function makeRequest(overrides: Partial<PipelineRequest> = {}): PipelineRequest {
  return {
    question: "What are the data privacy regulations?",
    workspaceId: "ws-1",
    userId: "user-1",
    preset: "balanced",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("executeRetrievalPipeline", () => {
  let queryFn: ReturnType<typeof createMockQueryFn>;
  let llmProvider: ReturnType<typeof createMockLlmProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    queryFn = createMockQueryFn();
    llmProvider = createMockLlmProvider();

    // Default: create conversation
    queryFn.mockResolvedValueOnce({ rows: [{ conversation_id: "conv-1" }], rowCount: 1 });
    // Save user message
    queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
    // Update conversation message count
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // Early history fetch (getConversationHistory)
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  });

  function setupFullPipelineMocks() {
    // Step 1: Cache miss
    vi.mocked(checkCache).mockResolvedValueOnce(null);

    // Step 2: Query expansion (now uses expandQueryWithIntent)
    vi.mocked(expandQueryWithIntent).mockResolvedValueOnce({
      queries: [
        "What are the data privacy regulations?",
        "Data privacy rules and requirements",
      ],
      expandedIntent: "Understanding data privacy compliance requirements",
    });

    // Step 3: Entity detection
    vi.mocked(detectEntities).mockResolvedValueOnce([
      { name: "data privacy", type: "concept" },
    ]);

    // Step 4: Vector search (one per expanded query)
    vi.mocked(vectorSearch).mockResolvedValueOnce({
      results: [
        { chunk_id: "c1", document_id: "doc-1", content: "Privacy regulation text.", similarity: 0.92, chunk_type: "paragraph", page_start: 5, heading_path: "Section 1", document_title: "Privacy Guide" },
      ],
      latencyMs: 50,
    });
    vi.mocked(vectorSearch).mockResolvedValueOnce({
      results: [
        { chunk_id: "c2", document_id: "doc-2", content: "Data rules text.", similarity: 0.85, chunk_type: "paragraph", page_start: 10, heading_path: null, document_title: "Data Handbook" },
      ],
      latencyMs: 40,
    });

    // Step 5: Lexical search
    vi.mocked(lexicalSearch).mockResolvedValueOnce({
      results: [
        { chunk_id: "c3", document_id: "doc-1", content: "Lexical match for privacy.", rank: 0.7, chunk_type: "paragraph", page_start: 6, document_title: "Privacy Guide" },
      ],
      latencyMs: 30,
    });

    // Step 6: Graph context
    vi.mocked(graphContextLookup).mockResolvedValueOnce({
      result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
      latencyMs: 20,
    });

    // Step 8: Rerank
    vi.mocked(rerank).mockReturnValueOnce([
      { chunk_id: "c1", document_id: "doc-1", content: "Privacy regulation text.", document_title: "Privacy Guide", page_start: 5, heading_path: "Section 1", score: 0.56, sources: ["vector"] },
      { chunk_id: "c2", document_id: "doc-2", content: "Data rules text.", document_title: "Data Handbook", page_start: 10, heading_path: null, score: 0.34, sources: ["vector"] },
    ]);

    // Step 9: Answer generation
    vi.mocked(generateAnswer).mockResolvedValueOnce({
      answer: "According to the Privacy Guide [1], data privacy regulations require...",
      citations: [
        { citation_index: 1, chunk_id: "c1", document_id: "doc-1", document_title: "Privacy Guide", page_number: 5, excerpt: "Privacy regulation text.", relevance_score: 0.56 },
      ],
      followUpQuestions: ["What are the penalties for non-compliance?", "How does this apply to international data?"],
      provider: "openai",
      model: "gpt-4o",
      latencyMs: 500,
    });

    // Save assistant message
    queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-asst-1" }], rowCount: 1 });
    // Update conversation
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // Save citation
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // Save retrieval run
    queryFn.mockResolvedValueOnce({ rows: [{ retrieval_run_id: "retrieval-run-1" }], rowCount: 1 });
    // Save retrieval steps
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // Update assistant message with retrieval_run_id
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    // Step 10: writeCache (void)
    vi.mocked(writeCache).mockResolvedValueOnce(undefined);
  }

  describe("TC-INT-01: Full 10-step pipeline with mocked dependencies", () => {
    it("executes all pipeline steps and returns structured result", async () => {
      setupFullPipelineMocks();

      const result = await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest()
      );

      expect(result.answer).toContain("Privacy Guide [1]");
      expect(result.conversationId).toBe("conv-1");
      expect(result.messageId).toBe("msg-asst-1");
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].citation_index).toBe(1);
      expect(result.citations[0].document_title).toBe("Privacy Guide");
      expect(result.retrieval.preset).toBe("balanced");
      expect(result.retrieval.cache_hit).toBe(false);
      expect(result.retrieval.chunks_retrieved).toBe(2);
      expect(result.retrieval.expanded_queries).toHaveLength(2);
      expect(result.retrieval.detected_entities).toHaveLength(1);
      expect(result.retrieval.total_latency_ms).toBeGreaterThanOrEqual(0);

      // Verify all pipeline steps were called
      expect(checkCache).toHaveBeenCalledTimes(1);
      expect(expandQueryWithIntent).toHaveBeenCalledTimes(1);
      expect(detectEntities).toHaveBeenCalledTimes(1);
      expect(vectorSearch).toHaveBeenCalledTimes(2); // one per expanded query
      expect(lexicalSearch).toHaveBeenCalledTimes(1);
      expect(graphContextLookup).toHaveBeenCalledTimes(1);
      expect(rerank).toHaveBeenCalledTimes(1);
      expect(generateAnswer).toHaveBeenCalledTimes(1);
      expect(writeCache).toHaveBeenCalledTimes(1);
    });
  });

  describe("TC-INT-03: Cache hit short-circuits pipeline", () => {
    it("returns cached answer without running retrieval steps", async () => {
      vi.mocked(checkCache).mockResolvedValueOnce({
        answer_text: "Cached answer about privacy",
        citations: [{ chunk_id: "c1", document_title: "Privacy Guide", excerpt: "cached excerpt" }],
        cache_id: "cache-1",
      });

      // Save assistant message for cache hit
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-cache-1" }], rowCount: 1 });
      // Update conversation
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest()
      );

      expect(result.answer).toBe("Cached answer about privacy");
      expect(result.retrieval.cache_hit).toBe(true);
      expect(result.retrieval.chunks_retrieved).toBe(0);
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].document_title).toBe("Privacy Guide");

      // Pipeline steps after cache should NOT be called
      expect(expandQueryWithIntent).not.toHaveBeenCalled();
      expect(detectEntities).not.toHaveBeenCalled();
      expect(vectorSearch).not.toHaveBeenCalled();
      expect(lexicalSearch).not.toHaveBeenCalled();
      expect(graphContextLookup).not.toHaveBeenCalled();
      expect(rerank).not.toHaveBeenCalled();
      expect(generateAnswer).not.toHaveBeenCalled();
      expect(writeCache).not.toHaveBeenCalled();
    });
  });

  describe("Creates retrieval_run record", () => {
    it("persists retrieval run with metrics after pipeline completion", async () => {
      setupFullPipelineMocks();

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest()
      );

      // Find the retrieval_run INSERT call
      const retrievalRunCall = queryFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO retrieval_run")
      );

      expect(retrievalRunCall).toBeDefined();
      const params = retrievalRunCall![1];
      expect(params[0]).toBe("conv-1"); // conversation_id
      expect(params[1]).toBe("ws-1"); // workspace_id
      expect(params[2]).toBe("What are the data privacy regulations?"); // original_query
      expect(params[5]).toBe("balanced"); // preset
      expect(params[6]).toContain("Understanding"); // expanded_intent
      expect(params[14]).toBe(false); // cache_hit

      const retrievalStepCall = queryFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO retrieval_step")
      );
      expect(retrievalStepCall).toBeDefined();

      const linkMessageCall = queryFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("UPDATE message SET retrieval_run_id")
      );
      expect(linkMessageCall).toBeDefined();
    });
  });

  describe("Per-preset model override", () => {
    it("passes PRESET_MODEL env var to generateAnswer", async () => {
      process.env.PRESET_MODEL_BALANCED = "gpt-5-mini";
      setupFullPipelineMocks();

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ preset: "balanced" })
      );

      expect(generateAnswer).toHaveBeenCalledWith(
        llmProvider,
        "What are the data privacy regulations?",
        expect.any(Array),
        expect.any(String),
        expect.any(Array),
        "balanced",
        "gpt-5-mini",
        expect.arrayContaining([{ name: "data privacy", type: "concept" }]),
        expect.objectContaining({
          requestedCaseScopes: [],
          matchedCaseScopes: [],
          scopeMode: "global",
          scopeSource: "global",
        }),
        "ANSWER_GENERATION",
      );

      delete process.env.PRESET_MODEL_BALANCED;
    });

    it("passes undefined when no PRESET_MODEL env var is set", async () => {
      delete process.env.PRESET_MODEL_BALANCED;
      setupFullPipelineMocks();

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ preset: "balanced" })
      );

      expect(generateAnswer).toHaveBeenCalledWith(
        llmProvider,
        "What are the data privacy regulations?",
        expect.any(Array),
        expect.any(String),
        expect.any(Array),
        "balanced",
        undefined,
        expect.arrayContaining([{ name: "data privacy", type: "concept" }]),
        expect.objectContaining({
          requestedCaseScopes: [],
          matchedCaseScopes: [],
          scopeMode: "global",
          scopeSource: "global",
        }),
        "ANSWER_GENERATION",
      );
    });

    it("routes regenerate requests through the answer-regeneration use case", async () => {
      queryFn = createMockQueryFn();
      llmProvider = createMockLlmProvider();
      queryFn.mockResolvedValueOnce({ rows: [{ conversation_id: "conv-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      setupFullPipelineMocks();

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ preset: "balanced", regenerate: true, skipUserMessage: true })
      );

      expect(llmProvider.getModelForPreset).toHaveBeenCalledWith("ANSWER_REGENERATION", "balanced");
      expect(generateAnswer).toHaveBeenCalledWith(
        llmProvider,
        "What are the data privacy regulations?",
        expect.any(Array),
        expect.any(String),
        expect.any(Array),
        "balanced",
        undefined,
        expect.arrayContaining([{ name: "data privacy", type: "concept" }]),
        expect.objectContaining({
          requestedCaseScopes: [],
          matchedCaseScopes: [],
          scopeMode: "global",
          scopeSource: "global",
        }),
        "ANSWER_REGENERATION",
      );
    });
  });

  describe("Persists conversation and messages", () => {
    it("creates a new conversation when conversationId is not provided", async () => {
      setupFullPipelineMocks();

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest()
      );

      // First queryFn call creates conversation
      const createConvCall = queryFn.mock.calls[0];
      expect(createConvCall[0]).toContain("INSERT INTO conversation");
      expect(createConvCall[1][0]).toBe("ws-1"); // workspace_id
      expect(createConvCall[1][1]).toBe("user-1"); // user_id

      // Second call saves user message
      const userMsgCall = queryFn.mock.calls[1];
      expect(userMsgCall[0]).toContain("INSERT INTO message");
      expect(userMsgCall[1][1]).toBe("What are the data privacy regulations?");
    });

    it("uses existing conversationId when provided", async () => {
      // Reset the default mock setup for conversationId scenario
      queryFn.mockReset();
      queryFn.mockImplementation(async (sql: string, _params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> => {
        if (typeof sql === "string" && sql.includes("INSERT INTO retrieval_run")) {
          return { rows: [{ retrieval_run_id: "retrieval-run-1" }], rowCount: 1 };
        }
        if (typeof sql === "string" && sql.includes("INSERT INTO message")) {
          return { rows: [{ message_id: "msg-default" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      });

      // Archive check (FR-013)
      queryFn.mockResolvedValueOnce({ rows: [{ is_archived: false }], rowCount: 1 });
      // Pinned filters check (FR-003)
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // Save user message (no conversation creation)
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
      // Update conversation
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // Early history fetch (getConversationHistory)
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      setupFullPipelineMocks();

      const result = await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ conversationId: "existing-conv-id" })
      );

      expect(result.conversationId).toBe("existing-conv-id");

      // First call should be archive check, then pinned filters, then user message
      const userMsgCall = queryFn.mock.calls[2];
      expect(userMsgCall[0]).toContain("INSERT INTO message");
    });

    it("returns fallback message when no relevant chunks found", async () => {
      vi.mocked(checkCache).mockResolvedValueOnce(null);
      vi.mocked(expandQueryWithIntent).mockResolvedValueOnce({ queries: ["test query"], expandedIntent: null });
      vi.mocked(detectEntities).mockResolvedValueOnce([]);
      vi.mocked(vectorSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(lexicalSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(graphContextLookup).mockResolvedValueOnce({
        result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
        latencyMs: 5,
      });
      vi.mocked(rerank).mockReturnValueOnce([]);

      // Save "insufficient evidence" assistant message
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-fallback" }], rowCount: 1 });
      // Update conversation
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ question: "test query" })
      );

      expect(result.answer).toContain("could not find sufficient evidence");
      expect(result.citations).toEqual([]);
      expect(result.retrieval.cache_hit).toBe(false);
    });
  });

  describe("Conversation history passed to query expander", () => {
    it("passes early-fetched history to expandQueryWithIntent", async () => {
      // Fresh queryFn with custom history
      queryFn = createMockQueryFn();
      // Create conversation
      queryFn.mockResolvedValueOnce({ rows: [{ conversation_id: "conv-1" }], rowCount: 1 });
      // Save user message
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
      // Update conversation
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // Early history fetch with prior messages (DESC order, reversed by getConversationHistory)
      queryFn.mockResolvedValueOnce({
        rows: [
          { role: "assistant", content: "Case 424/2021 involves..." },
          { role: "user", content: "Tell me about case 424/2021" },
        ],
        rowCount: 2,
      });

      setupFullPipelineMocks();

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ question: "What is the status of the case?" })
      );

      expect(expandQueryWithIntent).toHaveBeenCalledWith(
        llmProvider,
        "What is the status of the case?",
        [
          { role: "user", content: "Tell me about case 424/2021" },
          { role: "assistant", content: "Case 424/2021 involves..." },
        ],
      );
    });
  });

  describe("CASE_REF entity auto-pin", () => {
    it("pins detected CASE_REF to the conversation", async () => {
      vi.mocked(checkCache).mockResolvedValueOnce(null);
      vi.mocked(expandQueryWithIntent).mockResolvedValueOnce({ queries: ["case 424/2021"], expandedIntent: null });
      vi.mocked(detectEntities).mockResolvedValueOnce([
        { name: "424/2021", type: "case_ref" },
      ]);
      vi.mocked(vectorSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(lexicalSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(graphContextLookup).mockResolvedValueOnce({
        result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
        latencyMs: 5,
      });
      vi.mocked(rerank).mockReturnValueOnce([]);

      // Pin UPDATE on conversation
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // Save "insufficient evidence" message
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-fallback" }], rowCount: 1 });
      // Update conversation count
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ question: "Tell me about case 424/2021" })
      );

      // Verify pinned_filters UPDATE was called
      const pinCall = queryFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("UPDATE conversation SET pinned_filters")
      );
      expect(pinCall).toBeDefined();
      expect(pinCall![1][0]).toContain("424/2021");

      // Verify CASE_REF is reported in inferred_filters
      expect(result.retrieval.inferred_filters).toEqual({ case_reference: "424/2021" });
    });

    it("updates pinned filter on scope-switch to different case", async () => {
      // Fresh queryFn for existing-conversation flow
      queryFn = createMockQueryFn();
      // Archive check
      queryFn.mockResolvedValueOnce({ rows: [{ is_archived: false }], rowCount: 1 });
      // Pinned filters with existing case_reference
      queryFn.mockResolvedValueOnce({
        rows: [{ pinned_filters: { case_reference: "424/2021", last_scope_mode: "single", last_scope_source: "follow_up_single" } }],
        rowCount: 1,
      });
      // Save user message
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
      // Update conversation
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // Early history fetch
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      vi.mocked(checkCache).mockResolvedValueOnce(null);
      vi.mocked(expandQueryWithIntent).mockResolvedValueOnce({ queries: ["case 500/2022"], expandedIntent: null });
      vi.mocked(detectEntities).mockResolvedValueOnce([
        { name: "500/2022", type: "case_ref" },
      ]);
      vi.mocked(vectorSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(lexicalSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(graphContextLookup).mockResolvedValueOnce({
        result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
        latencyMs: 5,
      });
      vi.mocked(rerank).mockReturnValueOnce([]);

      // Pin UPDATE (scope-switch)
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // Save "insufficient evidence" message
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-fallback" }], rowCount: 1 });
      // Update conversation count
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ conversationId: "existing-conv", question: "Now tell me about case 500/2022" })
      );

      // Verify scope-switch UPDATE was called with the new case
      const pinCall = queryFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("UPDATE conversation SET pinned_filters")
      );
      expect(pinCall).toBeDefined();
      expect(pinCall![1][0]).toContain("500/2022");
    });

    it("does not pin or apply filter when no CASE_REF detected", async () => {
      vi.mocked(checkCache).mockResolvedValueOnce(null);
      vi.mocked(expandQueryWithIntent).mockResolvedValueOnce({ queries: ["general question"], expandedIntent: null });
      vi.mocked(detectEntities).mockResolvedValueOnce([
        { name: "data privacy", type: "concept" },
      ]);
      vi.mocked(vectorSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(lexicalSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(graphContextLookup).mockResolvedValueOnce({
        result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
        latencyMs: 5,
      });
      vi.mocked(rerank).mockReturnValueOnce([]);

      // Save "insufficient evidence" message
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-fallback" }], rowCount: 1 });
      // Update conversation count
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ question: "What about data privacy?" })
      );

      // No UPDATE conversation pinned_filters call
      const pinCall = queryFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("UPDATE conversation SET pinned_filters")
      );
      expect(pinCall).toBeUndefined();

      // No inferred_filters in result (only concept entity, no case_ref)
      expect(result.retrieval.inferred_filters).toBeUndefined();
    });

    it("includes pinned case scope in cache lookup for follow-up questions", async () => {
      queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [{ is_archived: false }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({
        rows: [{ pinned_filters: { case_reference: "424/2021", last_scope_mode: "single", last_scope_source: "follow_up_single" } }],
        rowCount: 1,
      });
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      vi.mocked(checkCache).mockResolvedValueOnce(null);
      vi.mocked(expandQueryWithIntent).mockResolvedValueOnce({ queries: ["Who are the witnesses in case 424/2021?"], expandedIntent: null });
      vi.mocked(detectEntities).mockResolvedValueOnce([]);
      vi.mocked(vectorSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(lexicalSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(graphContextLookup).mockResolvedValueOnce({
        result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
        latencyMs: 5,
      });
      vi.mocked(rerank).mockReturnValueOnce([]);

      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-fallback" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ conversationId: "existing-conv", question: "Who are the witnesses?" })
      );

      expect(checkCache).toHaveBeenCalledWith(
        { queryFn, llmProvider },
        "ws-1",
        "Who are the witnesses?",
        "balanced",
        "INTERNAL:MEMBER",
        { case_reference: "424/2021", mode: "hybrid" },
      );
    });

    it("filters chunks with mismatched case metadata before answer generation", async () => {
      queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [{ is_archived: false }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({
        rows: [{ pinned_filters: { case_reference: "424/2021", last_scope_mode: "single", last_scope_source: "follow_up_single" } }],
        rowCount: 1,
      });
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      vi.mocked(checkCache).mockResolvedValueOnce(null);
      vi.mocked(expandQueryWithIntent).mockResolvedValueOnce({ queries: ["Who are the witnesses in case 424/2021?"], expandedIntent: null });
      vi.mocked(detectEntities).mockResolvedValueOnce([]);
      vi.mocked(vectorSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(lexicalSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(graphContextLookup).mockResolvedValueOnce({
        result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
        latencyMs: 5,
      });
      vi.mocked(rerank).mockReturnValueOnce([
        {
          chunk_id: "case-424",
          document_id: "doc-424",
          content: "Witness A and Witness B",
          document_title: "Witness List",
          page_start: 3,
          heading_path: null,
          case_reference: "424/2021",
          score: 0.9,
          sources: ["vector"],
        },
        {
          chunk_id: "case-773",
          document_id: "doc-773",
          content: "Unrelated witnesses",
          document_title: "Witness List",
          page_start: 4,
          heading_path: null,
          case_reference: "773/2021",
          score: 0.85,
          sources: ["vector"],
        },
      ]);
      vi.mocked(generateAnswer).mockResolvedValueOnce({
        answer: "Witness A and Witness B [1]",
        citations: [
          {
            citation_index: 1,
            chunk_id: "case-424",
            document_id: "doc-424",
            document_title: "Witness List",
            page_number: 3,
            excerpt: "Witness A and Witness B",
            relevance_score: 0.9,
          },
        ],
        followUpQuestions: [],
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 100,
      });

      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-asst-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      vi.mocked(writeCache).mockResolvedValueOnce(undefined);

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ conversationId: "existing-conv", question: "Who are the witnesses?" })
      );

      expect(generateAnswer).toHaveBeenCalledWith(
        llmProvider,
        "Who are the witnesses?",
        [
          expect.objectContaining({
            chunk_id: "case-424",
            scope_status: "MATCH",
          }),
        ],
        expect.any(String),
        expect.any(Array),
        "balanced",
        undefined,
        expect.arrayContaining([{ name: "424/2021", type: "case_ref" }]),
        expect.objectContaining({
          requestedCaseScopes: ["424/2021"],
          matchedCaseScopes: ["424/2021"],
          scopeMode: "single",
          scopeSource: "follow_up_single",
        }),
        "ANSWER_GENERATION",
      );
    });

    it("keeps matched chunks for each requested case in comparison questions", async () => {
      queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [{ is_archived: false }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      vi.mocked(checkCache).mockResolvedValueOnce(null);
      vi.mocked(expandQueryWithIntent).mockResolvedValueOnce({
        queries: ["What are the key differences between case 424 and 773?"],
        expandedIntent: "Compare two criminal cases",
      });
      vi.mocked(detectEntities).mockResolvedValueOnce([
        { name: "424", type: "case_ref" },
        { name: "773", type: "case_ref" },
      ]);
      vi.mocked(vectorSearch).mockResolvedValue({
        results: [],
        latencyMs: 10,
      });
      vi.mocked(lexicalSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(graphContextLookup).mockResolvedValueOnce({
        result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
        latencyMs: 5,
      });
      vi.mocked(rerank).mockReturnValueOnce([
        {
          chunk_id: "case-424",
          document_id: "doc-424",
          content: "Case 424 facts",
          document_title: "CHARGE SHEET 424 OF 2021",
          page_start: 3,
          heading_path: null,
          case_reference: "424/2021",
          score: 0.9,
          sources: ["vector"],
        },
        {
          chunk_id: "case-773",
          document_id: "doc-773",
          content: "Case 773 facts",
          document_title: "CS 773 Final Modified",
          page_start: 4,
          heading_path: null,
          case_reference: "773/2022",
          score: 0.85,
          sources: ["vector"],
        },
        {
          chunk_id: "unscoped",
          document_id: "doc-x",
          content: "Generic case notes",
          document_title: "General note",
          page_start: 1,
          heading_path: null,
          score: 0.7,
          sources: ["vector"],
        },
      ]);
      vi.mocked(generateAnswer).mockResolvedValueOnce({
        answer: "Case 424 differs from case 773 [1][2]",
        citations: [
          {
            citation_index: 1,
            chunk_id: "case-424",
            document_id: "doc-424",
            document_title: "CHARGE SHEET 424 OF 2021",
            page_number: 3,
            excerpt: "Case 424 facts",
            relevance_score: 0.9,
          },
          {
            citation_index: 2,
            chunk_id: "case-773",
            document_id: "doc-773",
            document_title: "CS 773 Final Modified",
            page_number: 4,
            excerpt: "Case 773 facts",
            relevance_score: 0.85,
          },
        ],
        followUpQuestions: [],
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 100,
      });

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-asst-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      vi.mocked(writeCache).mockResolvedValueOnce(undefined);

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({
          conversationId: "existing-conv",
          question: "What are the key differences between case 424 and 773?",
        })
      );

      expect(vectorSearch).toHaveBeenCalledWith(
        { queryFn, llmProvider },
        "ws-1",
        "case 424",
        20,
        expect.any(Object),
      );
      expect(vectorSearch).toHaveBeenCalledWith(
        { queryFn, llmProvider },
        "ws-1",
        "case 773",
        20,
        expect.any(Object),
      );
      expect(generateAnswer).toHaveBeenCalledWith(
        llmProvider,
        "What are the key differences between case 424 and 773?",
        [
          expect.objectContaining({ chunk_id: "case-424", scope_status: "MATCH" }),
          expect.objectContaining({ chunk_id: "case-773", scope_status: "MATCH" }),
        ],
        expect.any(String),
        expect.any(Array),
        "balanced",
        undefined,
        expect.arrayContaining([
          { name: "424", type: "case_ref" },
          { name: "773", type: "case_ref" },
        ]),
        expect.objectContaining({
          requestedCaseScopes: ["424", "773"],
          matchedCaseScopes: ["424", "773"],
          scopeMode: "multi",
          scopeSource: "explicit_multi",
        }),
        "ANSWER_GENERATION",
      );
    });

    it("stores explicit multi-case scope without overwriting the pinned default case", async () => {
      queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [{ is_archived: false }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({
        rows: [{ pinned_filters: { case_reference: "111/2020" } }],
        rowCount: 1,
      });
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      vi.mocked(checkCache).mockResolvedValueOnce(null);
      vi.mocked(expandQueryWithIntent).mockResolvedValueOnce({
        queries: ["Compare case 424 and case 773"],
        expandedIntent: "Compare two cases",
      });
      vi.mocked(detectEntities).mockResolvedValueOnce([
        { name: "424", type: "case_ref" },
        { name: "773", type: "case_ref" },
      ]);
      vi.mocked(vectorSearch).mockResolvedValue({ results: [], latencyMs: 10 });
      vi.mocked(lexicalSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(graphContextLookup).mockResolvedValueOnce({
        result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
        latencyMs: 5,
      });
      vi.mocked(rerank).mockReturnValueOnce([]);

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-fallback" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({
          conversationId: "existing-conv",
          question: "Compare case 424 and case 773",
        })
      );

      const pinCall = queryFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("UPDATE conversation SET pinned_filters")
      );
      expect(pinCall).toBeDefined();
      expect(JSON.parse(pinCall![1][0])).toEqual({
        case_reference: "111/2020",
        last_multi_case_references: ["424", "773"],
        last_scope_mode: "multi",
        last_scope_source: "explicit_multi",
      });
    });

    it("reuses last multi-case scope only for comparative follow-up questions", async () => {
      queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [{ is_archived: false }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({
        rows: [{
          pinned_filters: {
            case_reference: "111/2020",
            last_multi_case_references: ["424/2021", "773/2022"],
            last_scope_mode: "multi",
            last_scope_source: "follow_up_multi",
          },
        }],
        rowCount: 1,
      });
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      vi.mocked(checkCache).mockResolvedValueOnce(null);
      vi.mocked(expandQueryWithIntent).mockResolvedValueOnce({
        queries: ["Which one involved firearms?"],
        expandedIntent: "Compare two cases by weapon involvement",
      });
      vi.mocked(detectEntities).mockResolvedValueOnce([]);
      vi.mocked(vectorSearch).mockResolvedValue({ results: [], latencyMs: 10 });
      vi.mocked(lexicalSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(graphContextLookup).mockResolvedValueOnce({
        result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
        latencyMs: 5,
      });
      vi.mocked(rerank).mockReturnValueOnce([
        {
          chunk_id: "case-424",
          document_id: "doc-424",
          content: "Case 424 did not involve firearms.",
          document_title: "CHARGE SHEET 424 OF 2021",
          page_start: 3,
          heading_path: null,
          case_reference: "424/2021",
          score: 0.9,
          sources: ["vector"],
        },
        {
          chunk_id: "case-773",
          document_id: "doc-773",
          content: "Case 773 involved illegal firearms.",
          document_title: "CS 773 Final Modified",
          page_start: 4,
          heading_path: null,
          case_reference: "773/2022",
          score: 0.85,
          sources: ["vector"],
        },
      ]);
      vi.mocked(generateAnswer).mockResolvedValueOnce({
        answer: "Case 773 involved firearms [2]",
        citations: [
          {
            citation_index: 2,
            chunk_id: "case-773",
            document_id: "doc-773",
            document_title: "CS 773 Final Modified",
            page_number: 4,
            excerpt: "Case 773 involved illegal firearms.",
            relevance_score: 0.85,
          },
        ],
        followUpQuestions: [],
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 100,
      });

      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-asst-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      vi.mocked(writeCache).mockResolvedValueOnce(undefined);

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({
          conversationId: "existing-conv",
          question: "Which one involved firearms?",
        })
      );

      expect(generateAnswer).toHaveBeenCalledWith(
        llmProvider,
        "Which one involved firearms?",
        [
          expect.objectContaining({ chunk_id: "case-424", scope_status: "MATCH" }),
          expect.objectContaining({ chunk_id: "case-773", scope_status: "MATCH" }),
        ],
        expect.any(String),
        expect.any(Array),
        "balanced",
        undefined,
        expect.arrayContaining([{ name: "111/2020", type: "case_ref" }]),
        expect.objectContaining({
          requestedCaseScopes: ["424/2021", "773/2022"],
          matchedCaseScopes: ["424/2021", "773/2022"],
          scopeMode: "multi",
          scopeSource: "follow_up_multi",
        }),
        "ANSWER_GENERATION",
      );
    });

    it("returns a clarification prompt for ambiguous follow-up after a multi-case turn", async () => {
      queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [{ is_archived: false }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({
        rows: [{
          pinned_filters: {
            case_reference: "111/2020",
            last_multi_case_references: ["424/2021", "773/2022"],
            last_scope_mode: "multi",
            last_scope_source: "explicit_multi",
          },
        }],
        rowCount: 1,
      });
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-clarify-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({
          conversationId: "existing-conv",
          question: "What was the motive?",
        })
      );

      expect(result.answer).toContain("This follow-up is ambiguous");
      expect(result.answer).toContain("424/2021 and 773/2022");
      expect(checkCache).not.toHaveBeenCalled();
      expect(expandQueryWithIntent).not.toHaveBeenCalled();
      expect(vectorSearch).not.toHaveBeenCalled();
      expect(generateAnswer).not.toHaveBeenCalled();
    });

    it("does not inherit prior case scope for global availability questions", async () => {
      queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [{ is_archived: false }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({
        rows: [{ pinned_filters: { case_reference: "424/2021", last_scope_mode: "global", last_scope_source: "global" } }],
        rowCount: 1,
      });
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      vi.mocked(checkCache).mockResolvedValueOnce(null);
      vi.mocked(expandQueryWithIntent).mockResolvedValueOnce({
        queries: ["Which are the cases about which you have information available?"],
        expandedIntent: "List available case scopes",
      });
      vi.mocked(detectEntities).mockResolvedValueOnce([]);
      vi.mocked(vectorSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(lexicalSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(graphContextLookup).mockResolvedValueOnce({
        result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
        latencyMs: 5,
      });
      vi.mocked(rerank).mockReturnValueOnce([]);

      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-fallback" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({
          conversationId: "existing-conv",
          question: "Which are the cases about which you have information available?",
        })
      );

      expect(checkCache).toHaveBeenCalledWith(
        { queryFn, llmProvider },
        "ws-1",
        "Which are the cases about which you have information available?",
        "balanced",
        "INTERNAL:MEMBER",
        { mode: "hybrid" },
      );
    });
  });
});
