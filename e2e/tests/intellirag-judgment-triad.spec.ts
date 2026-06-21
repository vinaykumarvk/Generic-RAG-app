import { test, expect, type Page } from "@playwright/test";

const mockToken = "mock-jwt-token-for-tests";

async function seedAuth(page: Page) {
  await page.addInitScript(({ token }) => {
    localStorage.setItem("intellirag_token", token);
    localStorage.setItem("intellirag_tour_complete", "true");
  }, { token: mockToken });
}

async function installJudgmentApiMocks(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (req.method() === "GET" && path === "/api/v1/users/me") {
      return route.fulfill({ status: 200, json: { user_id: "usr-1", full_name: "Officer User", user_type: "USER" } });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces") {
      return route.fulfill({
        status: 200,
        json: {
          workspaces: [{
            workspace_id: "ws-judgments",
            name: "Judgments",
            slug: "judgments",
            status: "ACTIVE",
            settings: { workspaceKind: "judgments" },
            document_count: 50,
          }],
        },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-judgments") {
      return route.fulfill({
        status: 200,
        json: {
          workspace_id: "ws-judgments",
          name: "Judgments",
          slug: "judgments",
          status: "ACTIVE",
          settings: { workspaceKind: "judgments" },
          document_count: 50,
        },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-judgments/conversations") {
      return route.fulfill({ status: 200, json: { conversations: [] } });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-judgments/conversations/conv-judgment") {
      return route.fulfill({
        status: 200,
        json: {
          messages: [
            {
              message_id: "msg-user-judgment",
              role: "user",
              content: "What is the doctrine on NDPS Section 50?",
            },
            {
              message_id: "msg-judgment",
              role: "assistant",
              content: [
                "Reviewed position",
                "Section 50 requires a source-backed personal-search analysis [1].",
                "",
                "Why the State/police succeeded or failed",
                "The answer turns on whether the court accepted compliance evidence.",
                "",
                "Limits",
                "This mocked response is limited to the pilot corpus.",
              ].join("\n"),
              retrieval_run_id: "rr-judgment",
              citations: [{
                citation_index: 1,
                document_title: "State v Accused, NDPS Section 50",
                page_number: 12,
                excerpt: "The court discussed Section 50 compliance.",
                relevance_score: 0.91,
              }],
            },
          ],
        },
      });
    }

    if (req.method() === "POST" && path === "/api/v1/workspaces/ws-judgments/query") {
      return route.fulfill({
        status: 200,
        json: {
          answer: [
            "Reviewed position",
            "Section 50 requires a source-backed personal-search analysis [1].",
            "",
            "Why the State/police succeeded or failed",
            "The answer turns on whether the court accepted compliance evidence.",
            "",
            "Limits",
            "This mocked response is limited to the pilot corpus.",
          ].join("\n"),
          conversationId: "conv-judgment",
          messageId: "msg-judgment",
          retrieval_run_id: "rr-judgment",
          citations: [{
            citation_index: 1,
            document_title: "State v Accused, NDPS Section 50",
            page_number: 12,
            excerpt: "The court discussed Section 50 compliance.",
            relevance_score: 0.91,
          }],
          retrieval: {
            preset: "balanced",
            mode: "hybrid",
            total_latency_ms: 1200,
            cache_hit: false,
            chunks_retrieved: 4,
            query_profile: "doctrine",
            wiki_articles: 1,
            graph_paths: 1,
          },
        },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-judgments/messages/msg-judgment/trace") {
      return route.fulfill({
        status: 200,
        json: {
          trace: {
            message_id: "msg-judgment",
            retrieval_run_id: "rr-judgment",
            question: "What is the doctrine on NDPS Section 50?",
            answer: "Reviewed position\nSection 50 requires source-backed analysis [1].",
            preset: "balanced",
            retrieval_mode: "hybrid",
            cache_hit: false,
            created_at: "2026-05-22T00:00:00.000Z",
            citations: [{
              citation_index: 1,
              document_title: "State v Accused, NDPS Section 50",
              page_number: 12,
              excerpt: "The court discussed Section 50 compliance.",
              relevance_score: 0.91,
            }],
            metrics: {
              total_latency_ms: 1200,
              vector_results_count: 4,
              lexical_results_count: 2,
              graph_results_count: 1,
              final_chunks_count: 4,
            },
            steps: [
              {
                step_key: "wiki_selection",
                step_index: 1,
                title: "Legal wiki selection",
                status: "completed",
                item_count: 1,
                payload: {
                  articles: [{
                    title: "NDPS Section 50",
                    review_status: "approved",
                    citation_coverage: 1,
                    statutes: ["NDPS"],
                    sections: ["50"],
                    issue_tags: ["section_50_ndps"],
                  }],
                  source_chunk_ids: ["chunk-1"],
                },
              },
              {
                step_key: "graph_path_extraction",
                step_index: 2,
                title: "Graph path extraction",
                status: "completed",
                item_count: 1,
                payload: {
                  paths: [{
                    source_name: "Conviction set aside",
                    edge_type: "outcome_caused_by",
                    target_name: "Section 50 lapse",
                    review_status: "needs_review",
                    confidence: 0.9,
                    evidence_chunk_id: "chunk-1",
                  }],
                  assertions: [],
                },
              },
              {
                step_key: "evidence_fusion",
                step_index: 3,
                title: "Evidence fusion",
                status: "completed",
                item_count: 4,
                payload: { fused_chunks: [] },
              },
            ],
          },
        },
      });
    }

    return route.fulfill({ status: 404, json: { error: `Unmocked: ${req.method()} ${path}` } });
  });
}

test.describe("Judgment triad retrieval", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await installJudgmentApiMocks(page);
  });

  test("officer can inspect wiki, graph, and raw judgment evidence", async ({ page }) => {
    await page.goto("/workspace/ws-judgments/query");
    await page.getByPlaceholder(/ask a question/i).fill("What is the doctrine on NDPS Section 50?");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByText("Reviewed position")).toBeVisible();
    await page.getByRole("button", { name: /1 reference/i }).click();
    await expect(page.getByText("State v Accused, NDPS Section 50")).toBeVisible();

    await page.getByRole("button", { name: /show answer journey/i }).click();
    await expect(page.getByRole("button", { name: /1\. Legal wiki selection/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /2\. Graph path extraction/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /3\. Evidence fusion/i })).toBeVisible();
  });
});
