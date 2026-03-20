import { describe, it, expect, vi } from "vitest";
import { lexicalSearch, type LexicalSearchResult } from "../../retrieval/lexical-search";

// ── Mock Helpers ──────────────────────────────────────────────────────────────

function createMockQueryFn() {
  return vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
}

function makeChunkRow(overrides: Partial<LexicalSearchResult> = {}): LexicalSearchResult {
  return {
    chunk_id: "chunk-1",
    document_id: "doc-1",
    content: "Content matching search terms",
    rank: 0.75,
    chunk_type: "paragraph",
    page_start: 3,
    document_title: "Test Document",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("lexicalSearch", () => {
  describe("TC-FR014-03: Returns chunks matching search terms via ts_rank", () => {
    it("returns ranked chunks from full-text search", async () => {
      const queryFn = createMockQueryFn();
      const rows = [
        makeChunkRow({ chunk_id: "c1", rank: 0.95 }),
        makeChunkRow({ chunk_id: "c2", rank: 0.72 }),
        makeChunkRow({ chunk_id: "c3", rank: 0.51 }),
      ];
      queryFn.mockResolvedValueOnce({ rows, rowCount: 3 });

      const { results, latencyMs } = await lexicalSearch(
        queryFn,
        "ws-1",
        "regulatory compliance",
        10
      );

      expect(results).toHaveLength(3);
      expect(results[0].chunk_id).toBe("c1");
      expect(results[0].rank).toBe(0.95);
      expect(latencyMs).toBeGreaterThanOrEqual(0);

      // Verify SQL uses ts_rank and full-text search
      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).toContain("ts_rank");
      expect(sqlCall[0]).toContain("to_tsquery");
      expect(sqlCall[0]).toContain("fts_vector");
      expect(sqlCall[0]).toContain("workspace_id = $2");
      expect(sqlCall[0]).toContain("ORDER BY rank DESC");

      // Query words should be joined with OR for tsquery
      expect(sqlCall[1][0]).toBe("regulatory | compliance");
      expect(sqlCall[1][1]).toBe("ws-1");
      expect(sqlCall[1][2]).toBe(10);
    });
  });

  describe("Handles multi-word queries", () => {
    it("converts multi-word query to OR-joined tsquery format", async () => {
      const queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await lexicalSearch(queryFn, "ws-1", "data privacy regulation law", 20);

      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[1][0]).toBe("data | privacy | regulation | law");
    });

    it("strips special characters from query words", async () => {
      const queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await lexicalSearch(queryFn, "ws-1", "what's the (best) policy?", 10);

      const sqlCall = queryFn.mock.calls[0];
      // Special chars stripped, single-char words filtered
      expect(sqlCall[1][0]).toBe("whats | the | best | policy");
    });

    it("filters out single-character words", async () => {
      const queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await lexicalSearch(queryFn, "ws-1", "a b test query", 10);

      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[1][0]).toBe("test | query");
    });
  });

  describe("Returns empty array for no matches", () => {
    it("returns empty results when DB returns no rows", async () => {
      const queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const { results } = await lexicalSearch(
        queryFn,
        "ws-1",
        "xyznonexistentterm",
        10
      );

      expect(results).toEqual([]);
    });

    it("returns empty results for empty query (after processing)", async () => {
      const queryFn = createMockQueryFn();

      // Query that becomes empty after stripping specials and filtering short words
      const { results } = await lexicalSearch(
        queryFn,
        "ws-1",
        "? ! @",
        10
      );

      expect(results).toEqual([]);
      // queryFn should NOT be called when tsQuery is empty
      expect(queryFn).not.toHaveBeenCalled();
    });
  });

  describe("Filter support", () => {
    it("adds document filter when documentIds provided", async () => {
      const queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await lexicalSearch(queryFn, "ws-1", "test query", 10, {
        documentIds: ["doc-1", "doc-2"],
      });

      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).toContain("c.document_id = ANY($4)");
      expect(sqlCall[1][3]).toEqual(["doc-1", "doc-2"]);
    });

    it("adds category filter when categories provided", async () => {
      const queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await lexicalSearch(queryFn, "ws-1", "test query", 10, {
        categories: ["legal"],
      });

      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).toContain("d.category = ANY($4)");
      expect(sqlCall[1][3]).toEqual(["legal"]);
    });

    it("does not apply case_reference as a hard SQL filter", async () => {
      const queryFn = createMockQueryFn();
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await lexicalSearch(queryFn, "ws-1", "test query", 10, {
        case_reference: "424/2021",
      });

      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).not.toContain("d.case_reference =");
      expect(sqlCall[0]).toContain("d.case_reference");
      expect(sqlCall[0]).toContain("d.fir_number");
      expect(sqlCall[0]).toContain("d.station_code");
    });
  });
});
