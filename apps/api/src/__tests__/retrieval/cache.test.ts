import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkCache, writeCache } from "../../retrieval/cache";

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("answer cache", () => {
  describe("checkCache", () => {
    describe("TC-FR015-01: Cache hit when similarity >= 0.80", () => {
      it("returns cached answer when similarity meets threshold", async () => {
        const queryFn = createMockQueryFn();
        const llmProvider = createMockLlmProvider();
        const cachedRow = {
          cache_id: "cache-1",
          answer_text: "Cached answer about regulations",
          citations: JSON.stringify([
            { chunk_id: "c1", document_title: "Policy Doc", excerpt: "Section 1..." },
          ]),
          similarity: 0.92,
        };

        // First call: SELECT from answer_cache
        queryFn.mockResolvedValueOnce({ rows: [cachedRow], rowCount: 1 });
        // Second call: UPDATE hit_count
        queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const result = await checkCache(
          { queryFn, llmProvider },
          "ws-1",
          "What are the regulations?",
          "balanced"
        );

        expect(result).not.toBeNull();
        expect(result!.answer_text).toBe("Cached answer about regulations");
        expect(result!.cache_id).toBe("cache-1");
        expect(result!.citations).toHaveLength(1);
        expect(result!.citations[0].document_title).toBe("Policy Doc");

        // Should have called embed for the query
        expect(llmProvider.llmEmbed).toHaveBeenCalledWith({ input: "What are the regulations?" });

        // Should have incremented hit count
        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(queryFn.mock.calls[1][0]).toContain("UPDATE answer_cache SET hit_count");
      });
    });

    describe("TC-FR015-02: Cache miss when similarity < 0.80", () => {
      it("returns null when no cached entry meets the similarity threshold", async () => {
        const queryFn = createMockQueryFn();
        const llmProvider = createMockLlmProvider();

        // Query returns no rows (DB filters by threshold)
        queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const result = await checkCache(
          { queryFn, llmProvider },
          "ws-1",
          "A very different question",
          "balanced"
        );

        expect(result).toBeNull();
      });
    });

    it("returns null when embedding generation fails", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider([]);

      // Override to return empty embeddings
      llmProvider.llmEmbed.mockResolvedValueOnce({
        embeddings: [],
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 0,
        latencyMs: 10,
      });

      const result = await checkCache(
        { queryFn, llmProvider },
        "ws-1",
        "test query",
        "balanced"
      );

      expect(result).toBeNull();
      expect(queryFn).not.toHaveBeenCalled();
    });

    it("returns null when embedding result is null", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();
      llmProvider.llmEmbed.mockResolvedValueOnce(null);

      const result = await checkCache(
        { queryFn, llmProvider },
        "ws-1",
        "test query",
        "balanced"
      );

      expect(result).toBeNull();
    });

    it("handles citations stored as parsed JSON object (not string)", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();
      const cachedRow = {
        cache_id: "cache-2",
        answer_text: "Answer",
        citations: [{ chunk_id: "c1", document_title: "Doc", excerpt: "text" }],
        similarity: 0.95,
      };

      queryFn.mockResolvedValueOnce({ rows: [cachedRow], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await checkCache(
        { queryFn, llmProvider },
        "ws-1",
        "query",
        "balanced"
      );

      expect(result).not.toBeNull();
      expect(result!.citations[0].chunk_id).toBe("c1");
    });

    it("scopes cache lookup to workspace", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await checkCache(
        { queryFn, llmProvider },
        "ws-specific-id",
        "test query",
        "concise"
      );

      // The SQL query should include workspace_id and preset params
      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).toContain("workspace_id = $2");
      expect(sqlCall[0]).toContain("preset = $3");
      expect(sqlCall[1]).toContain("ws-specific-id");
      expect(sqlCall[1]).toContain("concise");
    });

    it("filters out expired cache entries (24h TTL enforced by SQL)", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      // DB returns no rows because expires_at > now() filtered them out
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await checkCache(
        { queryFn, llmProvider },
        "ws-1",
        "test query",
        "balanced"
      );

      expect(result).toBeNull();
      // Verify the SQL includes the expiry check
      expect(queryFn.mock.calls[0][0]).toContain("expires_at > now()");
    });

    it("returns null gracefully when answer_cache table does not exist", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      queryFn.mockRejectedValueOnce(new Error('relation "answer_cache" does not exist'));

      const result = await checkCache(
        { queryFn, llmProvider },
        "ws-1",
        "test query",
        "balanced"
      );

      expect(result).toBeNull();
    });
  });

  describe("writeCache", () => {
    it("stores answer with embedding and citations", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider([[0.5, 0.6, 0.7]]);

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await writeCache(
        { queryFn, llmProvider },
        "ws-1",
        "What is the policy?",
        "The policy states that...",
        [{ chunk_id: "c1", document_title: "Policy", excerpt: "Section 1" }],
        "balanced"
      );

      expect(llmProvider.llmEmbed).toHaveBeenCalledWith({ input: "What is the policy?" });
      expect(queryFn).toHaveBeenCalledTimes(1);

      const insertCall = queryFn.mock.calls[0];
      expect(insertCall[0]).toContain("INSERT INTO answer_cache");
      expect(insertCall[1][0]).toBe("ws-1"); // workspace_id
      expect(insertCall[1][1]).toBe("What is the policy?"); // query_text
      expect(insertCall[1][2]).toBe("[0.5,0.6,0.7]"); // embedding vector string
      expect(insertCall[1][3]).toBe("The policy states that..."); // answer_text
      expect(JSON.parse(insertCall[1][4])).toEqual([
        { chunk_id: "c1", document_title: "Policy", excerpt: "Section 1" },
      ]);
      expect(insertCall[1][5]).toBe("balanced"); // preset
    });

    it("does nothing when embedding generation fails", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();
      llmProvider.llmEmbed.mockResolvedValueOnce({ embeddings: [], provider: "x", model: "y", dimensions: 0, latencyMs: 0 });

      await writeCache(
        { queryFn, llmProvider },
        "ws-1",
        "query",
        "answer",
        [],
        "balanced"
      );

      expect(queryFn).not.toHaveBeenCalled();
    });

    it("does not throw when cache write fails", async () => {
      const queryFn = createMockQueryFn();
      const llmProvider = createMockLlmProvider();

      queryFn.mockRejectedValueOnce(new Error("unique constraint violation"));

      // Should not throw
      await expect(
        writeCache(
          { queryFn, llmProvider },
          "ws-1",
          "query",
          "answer",
          [],
          "balanced"
        )
      ).resolves.toBeUndefined();
    });
  });
});
