import { describe, it, expect, vi, beforeEach } from "vitest";
import { vectorSearch, type VectorSearchResult } from "../../retrieval/vector-search";

// ── Mock Helpers ──────────────────────────────────────────────────────────────

function createMockQueryFn() {
  return vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
}

function createMockLlmProvider(embeddings: number[][] = [[0.1, 0.2, 0.3]]) {
  return {
    llmComplete: vi.fn(),
    llmCompleteJson: vi.fn(),
    llmEmbed: vi.fn().mockResolvedValue({
      embeddings,
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 3,
      latencyMs: 10,
    }),
    isLlmAvailable: vi.fn().mockResolvedValue(true),
    getActiveProvider: vi.fn(),
    testProvider: vi.fn(),
    getSystemPrompt: vi.fn(),
    invalidateProviderCache: vi.fn(),
  };
}

function makeChunkRow(overrides: Partial<VectorSearchResult> = {}): VectorSearchResult {
  return {
    chunk_id: "chunk-1",
    document_id: "doc-1",
    content: "Sample chunk content about regulations",
    similarity: 0.92,
    chunk_type: "paragraph",
    page_start: 5,
    heading_path: "Section 1 > Subsection A",
    document_title: "Regulation Guide",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("vectorSearch", () => {
  describe("TC-FR008-01: Returns chunks ordered by cosine similarity", () => {
    it("returns chunks sorted by similarity descending", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      const rows = [
        makeChunkRow({ chunk_id: "c1", similarity: 0.95 }),
        makeChunkRow({ chunk_id: "c2", similarity: 0.88 }),
        makeChunkRow({ chunk_id: "c3", similarity: 0.72 }),
      ];
      queryFn.mockResolvedValueOnce({ rows, rowCount: 3 });

      const { results, latencyMs } = await vectorSearch(
        { queryFn, llmProvider },
        "ws-1",
        "What are the regulations?",
        10
      );

      expect(results).toHaveLength(3);
      expect(results[0].chunk_id).toBe("c1");
      expect(results[0].similarity).toBe(0.95);
      expect(results[1].chunk_id).toBe("c2");
      expect(results[2].chunk_id).toBe("c3");
      expect(latencyMs).toBeGreaterThanOrEqual(0);

      // Verify embed was called with the query
      expect(llmProvider.llmEmbed).toHaveBeenCalledWith({ input: "What are the regulations?" });

      // Verify SQL includes workspace filter and ordering
      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).toContain("workspace_id = $2");
      expect(sqlCall[0]).toContain("ORDER BY c.embedding <=> $1::vector");
      expect(sqlCall[1][1]).toBe("ws-1");
      expect(sqlCall[1][2]).toBe(10);
    });
  });

  describe("TC-FR008-02: Respects document filter", () => {
    it("adds document_id filter clause when documentIds provided", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await vectorSearch(
        { queryFn, llmProvider },
        "ws-1",
        "test query",
        10,
        { documentIds: ["doc-a", "doc-b"] }
      );

      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).toContain("c.document_id = ANY($4)");
      expect(sqlCall[1][3]).toEqual(["doc-a", "doc-b"]);
    });
  });

  describe("Respects category filter", () => {
    it("adds category filter clause when categories provided", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await vectorSearch(
        { queryFn, llmProvider },
        "ws-1",
        "test query",
        10,
        { categories: ["policy", "legal"] }
      );

      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).toContain("d.category = ANY($4)");
      expect(sqlCall[1][3]).toEqual(["policy", "legal"]);
    });

    it("adds both document and category filters when both provided", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await vectorSearch(
        { queryFn, llmProvider },
        "ws-1",
        "test query",
        10,
        { documentIds: ["doc-a"], categories: ["policy"] }
      );

      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).toContain("c.document_id = ANY($4)");
      expect(sqlCall[0]).toContain("d.category = ANY($5)");
      expect(sqlCall[1][3]).toEqual(["doc-a"]);
      expect(sqlCall[1][4]).toEqual(["policy"]);
    });
  });

  describe("Returns empty array when no chunks match", () => {
    it("returns empty results when DB returns no rows", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const { results } = await vectorSearch(
        { queryFn, llmProvider },
        "ws-1",
        "obscure unrelated query",
        10
      );

      expect(results).toEqual([]);
    });

    it("returns empty results when embedding generation fails", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      llmProvider.llmEmbed.mockResolvedValueOnce(null);

      const { results } = await vectorSearch(
        { queryFn, llmProvider },
        "ws-1",
        "test query",
        10
      );

      expect(results).toEqual([]);
      // queryFn should not have been called since embedding failed
      expect(queryFn).not.toHaveBeenCalled();
    });

    it("returns empty results when embedding response has empty array", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      llmProvider.llmEmbed.mockResolvedValueOnce({
        embeddings: [],
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 0,
        latencyMs: 5,
      });

      const { results } = await vectorSearch(
        { queryFn, llmProvider },
        "ws-1",
        "test query",
        10
      );

      expect(results).toEqual([]);
      expect(queryFn).not.toHaveBeenCalled();
    });
  });

  describe("Limit parameter controls result count", () => {
    it("passes maxResults as LIMIT parameter to SQL query", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await vectorSearch(
        { queryFn, llmProvider },
        "ws-1",
        "test",
        5
      );

      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).toContain("LIMIT $3");
      expect(sqlCall[1][2]).toBe(5);
    });

    it("correctly formats embedding as vector string for pgvector", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider([[0.1, 0.2, 0.3]]);

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await vectorSearch(
        { queryFn, llmProvider },
        "ws-1",
        "test",
        10
      );

      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[1][0]).toBe("[0.1,0.2,0.3]");
    });
  });
});
