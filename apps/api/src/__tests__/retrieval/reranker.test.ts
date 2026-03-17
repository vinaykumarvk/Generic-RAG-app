import { describe, it, expect } from "vitest";
import { rerank, type RankedChunk } from "../../retrieval/reranker";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeVectorResult(overrides: Partial<{
  chunk_id: string; document_id: string; content: string; similarity: number;
  document_title: string; page_start: number | null; heading_path: string | null;
}> = {}) {
  return {
    chunk_id: "chunk-1",
    document_id: "doc-1",
    content: "Vector result content",
    similarity: 0.9,
    document_title: "Doc Title",
    page_start: 1,
    heading_path: "Introduction",
    ...overrides,
  };
}

function makeLexicalResult(overrides: Partial<{
  chunk_id: string; document_id: string; content: string; rank: number;
  document_title: string; page_start: number | null;
}> = {}) {
  return {
    chunk_id: "chunk-2",
    document_id: "doc-1",
    content: "Lexical result content",
    rank: 0.8,
    document_title: "Doc Title",
    page_start: 2,
    ...overrides,
  };
}

const DEFAULT_WEIGHTS = {
  vectorWeight: 0.4,
  lexicalWeight: 0.2,
  graphWeight: 0.2,
  metadataWeight: 0.2,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("reranker", () => {
  describe("TC-FR014-01: Weighted merge with all four sources", () => {
    it("combines vector (40%), lexical (20%), graph (20%), metadata (20%) weighted scores", () => {
      const vectorResults = [
        makeVectorResult({ chunk_id: "c1", similarity: 0.9 }),
        makeVectorResult({ chunk_id: "c2", similarity: 0.7 }),
      ];
      const lexicalResults = [
        makeLexicalResult({ chunk_id: "c3", rank: 0.5 }),
        makeLexicalResult({ chunk_id: "c4", rank: 1.0 }),
      ];
      const graphChunkIds = new Set(["c1", "c3"]);

      const results = rerank(vectorResults, lexicalResults, graphChunkIds, DEFAULT_WEIGHTS, 10);

      expect(results.length).toBe(4);

      // c1: vector 0.9 * 0.4 = 0.36, graph boost 0.2 = 0.56
      const c1 = results.find((r) => r.chunk_id === "c1")!;
      expect(c1.score).toBeCloseTo(0.56, 5);
      expect(c1.sources).toContain("vector");
      expect(c1.sources).toContain("graph");

      // c4: lexical 1.0/1.0 * 0.2 = 0.2, no graph
      const c4 = results.find((r) => r.chunk_id === "c4")!;
      expect(c4.score).toBeCloseTo(0.2, 5);
      expect(c4.sources).toContain("lexical");
      expect(c4.sources).not.toContain("graph");

      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe("TC-FR014-02: Deduplication of chunks appearing in multiple sources", () => {
    it("merges scores when a chunk appears in both vector and lexical results", () => {
      const vectorResults = [
        makeVectorResult({ chunk_id: "shared-chunk", similarity: 0.85 }),
      ];
      const lexicalResults = [
        makeLexicalResult({ chunk_id: "shared-chunk", rank: 0.9 }),
      ];

      const results = rerank(vectorResults, lexicalResults, new Set(), DEFAULT_WEIGHTS, 10);

      // Should produce exactly one entry for the shared chunk
      expect(results.length).toBe(1);
      expect(results[0].chunk_id).toBe("shared-chunk");

      // Score should combine both: vector 0.85 * 0.4 + lexical (0.9/0.9) * 0.2 = 0.34 + 0.2 = 0.54
      expect(results[0].score).toBeCloseTo(0.54, 5);
      expect(results[0].sources).toContain("vector");
      expect(results[0].sources).toContain("lexical");
    });
  });

  describe("TC-FR014-03: Top-N selection respects maxChunks from preset", () => {
    it("limits output to the specified maxChunks count", () => {
      const vectorResults = Array.from({ length: 20 }, (_, i) =>
        makeVectorResult({ chunk_id: `chunk-${i}`, similarity: 1 - i * 0.04 })
      );

      const results = rerank(vectorResults, [], new Set(), DEFAULT_WEIGHTS, 5);

      expect(results.length).toBe(5);
      // Should be the top 5 by score
      expect(results[0].chunk_id).toBe("chunk-0");
      expect(results[4].chunk_id).toBe("chunk-4");
    });
  });

  describe("TC-FR014-04: Empty sources handled gracefully", () => {
    it("returns empty array when all sources are empty", () => {
      const results = rerank([], [], new Set(), DEFAULT_WEIGHTS, 10);
      expect(results).toEqual([]);
    });

    it("returns results from vector only when lexical is empty", () => {
      const vectorResults = [
        makeVectorResult({ chunk_id: "c1", similarity: 0.9 }),
      ];

      const results = rerank(vectorResults, [], new Set(), DEFAULT_WEIGHTS, 10);

      expect(results.length).toBe(1);
      expect(results[0].chunk_id).toBe("c1");
      expect(results[0].sources).toEqual(["vector"]);
    });

    it("returns results from lexical only when vector is empty", () => {
      const lexicalResults = [
        makeLexicalResult({ chunk_id: "c1", rank: 0.5 }),
      ];

      const results = rerank([], lexicalResults, new Set(), DEFAULT_WEIGHTS, 10);

      expect(results.length).toBe(1);
      expect(results[0].chunk_id).toBe("c1");
      expect(results[0].sources).toEqual(["lexical"]);
    });
  });

  describe("TC-FR014-05: Graph weight activated only when graph results present", () => {
    it("does not add graph boost when graphChunkIds is empty", () => {
      const vectorResults = [
        makeVectorResult({ chunk_id: "c1", similarity: 0.9 }),
      ];

      const results = rerank(vectorResults, [], new Set(), DEFAULT_WEIGHTS, 10);

      expect(results[0].score).toBeCloseTo(0.9 * 0.4, 5);
      expect(results[0].sources).not.toContain("graph");
    });

    it("adds graph boost only to chunks referenced by graph entities", () => {
      const vectorResults = [
        makeVectorResult({ chunk_id: "c1", similarity: 0.9 }),
        makeVectorResult({ chunk_id: "c2", similarity: 0.9 }),
      ];
      const graphChunkIds = new Set(["c1"]);

      const results = rerank(vectorResults, [], graphChunkIds, DEFAULT_WEIGHTS, 10);

      const c1 = results.find((r) => r.chunk_id === "c1")!;
      const c2 = results.find((r) => r.chunk_id === "c2")!;

      // c1 gets graph boost, c2 does not
      expect(c1.score).toBeCloseTo(0.9 * 0.4 + 0.2, 5);
      expect(c2.score).toBeCloseTo(0.9 * 0.4, 5);
      expect(c1.sources).toContain("graph");
      expect(c2.sources).not.toContain("graph");
    });
  });
});
