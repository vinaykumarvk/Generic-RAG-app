import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies before importing the pipeline module
vi.mock("../../retrieval/cache", () => ({
  checkCache: vi.fn(),
  writeCache: vi.fn(),
}));

vi.mock("../../retrieval/query-expander", () => ({
  expandQuery: vi.fn(),
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
import { expandQuery } from "../../retrieval/query-expander";
import { detectEntities } from "../../retrieval/entity-detector";
import { vectorSearch } from "../../retrieval/vector-search";
import { lexicalSearch } from "../../retrieval/lexical-search";
import { graphContextLookup } from "../../retrieval/graph-context";
import { rerank } from "../../retrieval/reranker";
import { generateAnswer } from "../../retrieval/answer-generator";

// ── Mock Helpers ──────────────────────────────────────────────────────────────

function createMockQueryFn() {
  return vi.fn();
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
  });

  function setupFullPipelineMocks() {
    // Step 1: Cache miss
    vi.mocked(checkCache).mockResolvedValueOnce(null);

    // Step 2: Query expansion
    vi.mocked(expandQuery).mockResolvedValueOnce([
      "What are the data privacy regulations?",
      "Data privacy rules and requirements",
    ]);

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
      result: { nodes: [], edges: [], contextText: "" },
      latencyMs: 20,
    });

    // Step 8: Rerank
    vi.mocked(rerank).mockReturnValueOnce([
      { chunk_id: "c1", document_id: "doc-1", content: "Privacy regulation text.", document_title: "Privacy Guide", page_start: 5, heading_path: "Section 1", score: 0.56, sources: ["vector"] },
      { chunk_id: "c2", document_id: "doc-2", content: "Data rules text.", document_title: "Data Handbook", page_start: 10, heading_path: null, score: 0.34, sources: ["vector"] },
    ]);

    // Conversation history query
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    // Step 9: Answer generation
    vi.mocked(generateAnswer).mockResolvedValueOnce({
      answer: "According to the Privacy Guide [1], data privacy regulations require...",
      citations: [
        { citation_index: 1, chunk_id: "c1", document_id: "doc-1", document_title: "Privacy Guide", page_number: 5, excerpt: "Privacy regulation text.", relevance_score: 0.56 },
      ],
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
      expect(expandQuery).toHaveBeenCalledTimes(1);
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
      expect(expandQuery).not.toHaveBeenCalled();
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
      expect(params[10]).toBe(false); // cache_hit
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

      // Save user message (no conversation creation)
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-user-1" }], rowCount: 1 });
      // Update conversation
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      setupFullPipelineMocks();

      const result = await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ conversationId: "existing-conv-id" })
      );

      expect(result.conversationId).toBe("existing-conv-id");

      // First call should be saving the user message, not creating conversation
      const firstCall = queryFn.mock.calls[0];
      expect(firstCall[0]).toContain("INSERT INTO message");
    });

    it("returns fallback message when answer generation fails", async () => {
      vi.mocked(checkCache).mockResolvedValueOnce(null);
      vi.mocked(expandQuery).mockResolvedValueOnce(["test query"]);
      vi.mocked(detectEntities).mockResolvedValueOnce([]);
      vi.mocked(vectorSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(lexicalSearch).mockResolvedValueOnce({ results: [], latencyMs: 10 });
      vi.mocked(graphContextLookup).mockResolvedValueOnce({
        result: { nodes: [], edges: [], contextText: "" },
        latencyMs: 5,
      });
      vi.mocked(rerank).mockReturnValueOnce([]);

      // Conversation history
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      vi.mocked(generateAnswer).mockResolvedValueOnce(null);

      // Save fallback assistant message
      queryFn.mockResolvedValueOnce({ rows: [{ message_id: "msg-fallback" }], rowCount: 1 });

      const result = await executeRetrievalPipeline(
        { queryFn, llmProvider },
        makeRequest({ question: "test query" })
      );

      expect(result.answer).toContain("unable to generate an answer");
      expect(result.citations).toEqual([]);
      expect(result.retrieval.cache_hit).toBe(false);
    });
  });
});
