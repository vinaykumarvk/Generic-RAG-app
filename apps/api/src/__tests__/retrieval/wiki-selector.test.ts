import { describe, expect, it, vi } from "vitest";
import { logWikiCoverageGap, selectWikiArticles } from "../../retrieval/wiki-selector";

function createMockQueryFn(rows: unknown[] = []) {
  return vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
}

function createMockLlmProvider() {
  return {
    llmComplete: vi.fn(),
    llmCompleteJson: vi.fn(),
    llmEmbed: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 3,
      latencyMs: 5,
    }),
    getModelForPreset: vi.fn(),
    isLlmAvailable: vi.fn(),
    getActiveProvider: vi.fn(),
    testProvider: vi.fn(),
    getSystemPrompt: vi.fn(),
    invalidateProviderCache: vi.fn(),
  };
}

describe("wiki-selector", () => {
  it("selects approved wiki articles with embedding, FTS, and frontmatter filters", async () => {
    const queryFn = createMockQueryFn([
      {
        article_id: "article-1",
        slug: "ndps-section-50",
        title: "NDPS Section 50",
        summary: "Section 50 doctrine",
        body: "Body",
        frontmatter: {},
        court_scope: ["SCI"],
        statutes: ["NDPS"],
        sections: ["50"],
        issue_tags: ["section_50_ndps"],
        outcome_focus: ["conviction_set_aside"],
        policing_stage: "search",
        source_judgments: ["sci:2024:case"],
        source_chunk_ids: ["chunk-1"],
        corpus_scope: {},
        legal_validity_window: {},
        confidence: 0.9,
        review_status: "approved",
        material_claim_count: 2,
        cited_material_claim_count: 2,
        score: 0.8,
      },
    ]);

    const result = await selectWikiArticles(
      { queryFn, llmProvider: createMockLlmProvider() },
      "ws-1",
      "section 50 search",
      5,
      { statute: "NDPS", section: "50", court_code: "SCI" },
    );

    expect(result.results[0].citation_coverage).toBe(1);
    const sqlCall = queryFn.mock.calls[0];
    expect(sqlCall[0]).toContain("legal_wiki_article lwa");
    expect(sqlCall[0]).toContain("lwa.review_status =");
    expect(sqlCall[0]).toContain("lwa.embedding <=>");
    expect(sqlCall[0]).toContain("unnest(lwa.statutes)");
    expect(sqlCall[0]).toContain("legal_wiki_claim");
  });

  it("logs coverage gaps only when raw evidence exists and no approved article exists", async () => {
    const queryFn = createMockQueryFn();

    await logWikiCoverageGap(queryFn, "ws-1", {
      queryText: "Why did Section 50 fail?",
      queryProfile: "officer_lesson",
      rawEvidenceCount: 4,
      approvedArticleCount: 0,
      statute: "NDPS",
      section: "50",
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(queryFn.mock.calls[0][0]).toContain("legal_wiki_coverage_gap");
  });
});
