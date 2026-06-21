import { test, expect, type Page } from "@playwright/test";

const mockToken = "mock-jwt-token-for-tests";

async function seedAuth(page: Page) {
  await page.addInitScript(({ token }) => {
    localStorage.setItem("intellirag_token", token);
    localStorage.setItem("intellirag_tour_complete", "true");
  }, { token: mockToken });
}

async function installDistrictApiMocks(page: Page) {
  let judgmentFetchQueued = false;

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
            workspace_id: "ws-district",
            name: "Judgement Workspace",
            slug: "judgement-workspace",
            status: "ACTIVE",
            settings: { workspaceKind: "judgments" },
            document_count: 25,
          }],
        },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-district") {
      return route.fulfill({
        status: 200,
        json: {
          workspace_id: "ws-district",
          name: "Judgement Workspace",
          slug: "judgement-workspace",
          status: "ACTIVE",
          settings: { workspaceKind: "judgments" },
          document_count: 25,
        },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-district/conversations") {
      return route.fulfill({ status: 200, json: { conversations: [] } });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-district/conversations/conv-district") {
      return route.fulfill({
        status: 200,
        json: {
          messages: [
            {
              message_id: "msg-district",
              role: "assistant",
              content: [
                "District coverage analytics: 1,200 district-court metadata cases match the current analytics slice.",
                "",
                "Criminal targets: 750. Text available: 300. Translated: 210. RAG active: 160.",
                "",
                "This answer was routed to district analytics because the question asks for metadata aggregates rather than source-text legal reasoning.",
              ].join("\n"),
              citations: [],
            },
          ],
        },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-district/district/analytics/summary") {
      return route.fulfill({
        status: 200,
        json: {
          totals: {
            total_cases: 1200,
            criminal_targets: 750,
            text_available: 300,
            ocr_required: 40,
            translated: 210,
            redacted: 180,
            rag_active: 160,
            fetch_failed: 12,
          },
          delay: { avg_days_registration_to_decision: 240, p95_days_registration_to_decision: 900 },
          last_refresh: { completed_at: "2026-05-22T08:00:00.000Z", inserted_fact_rows: 18 },
          filters: {},
        },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-district/district/analytics/coverage") {
      return route.fulfill({
        status: 200,
        json: {
          coverage: [{
            state_code: 9,
            district_code: 101,
            court_level: "district",
            language: "hi",
            source_name: "ddl",
            total_cases: 1200,
            criminal_targets: 750,
            text_available: 300,
            translated: 210,
            redacted: 180,
            rag_active: 160,
          }],
        },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-district/district/analytics/volume") {
      return route.fulfill({
        status: 200,
        json: { bucket: "month", volume: [{ bucket: "2026-01-01", state_code: 9, district_code: 101, total_cases: 1200, criminal_targets: 750, text_available: 300 }] },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-district/district/analytics/outcomes") {
      return route.fulfill({
        status: 200,
        json: { outcomes: [{ disposition: "convicted", total_cases: 430, criminal_targets: 430, text_available: 150, avg_delay_days: 240 }] },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-district/district/analytics/source-performance") {
      return route.fulfill({
        status: 200,
        json: {
          period_days: 7,
          sources: [{ source_name: "ddl", license_classification: "commercial_safe", commercial_safe: true, total_cases: 1200, text_available: 300, translated: 210, fetch_failed: 12 }],
          queue: judgmentFetchQueued
            ? [{ source_name: "indian_kanoon", status: "pending", count: 1 }]
            : [{ source_name: "ddl", status: "queued", count: 25 }],
          attempts: [{ source_name: "ddl", outcome: "hit", count: 300 }],
          quota: [],
        },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-district/district/cases") {
      return route.fulfill({
        status: 200,
        json: {
          total: 1,
          limit: 25,
          offset: 0,
          cases: [{
            district_case_id: "case-district-1",
            cnr: "UPLK041081982015",
            source_case_id: "13-24-03-204400055662015",
            source_name: "ddl",
            metadata_source: "ddl_ecourts",
            dataset_version: "pilot",
            state_code: 13,
            state_name: "Uttar Pradesh",
            district_code: 24,
            district_name: "Lucknow",
            court_no: 3,
            court_code: "DC-13-24-3",
            court_name: "CJM Lucknow",
            court_level: "magistrate",
            case_type: "CR",
            filing_date: "2015-01-01",
            registration_date: "2015-01-02",
            decision_date: "2017-01-02",
            disposition: "convicted",
            purpose_name: "Judgment",
            judge_position: "CJM",
            acts_cited: ["IPC"],
            sections_cited: ["302"],
            offence_categories: ["murder"],
            is_criminal_target: true,
            text_status: judgmentFetchQueued ? "targeted" : "metadata_only",
            commercial_safe: true,
            license_classification: "commercial_safe",
            sensitive_data_flags: [],
            created_at: "2026-05-22T08:00:00.000Z",
            updated_at: "2026-05-22T08:00:00.000Z",
          }],
        },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-district/district/cases/case-district-1") {
      return route.fulfill({
        status: 200,
        json: {
          case: {
            district_case_id: "case-district-1",
            cnr: "UPLK041081982015",
            source_case_id: "13-24-03-204400055662015",
            source_name: "ddl",
            metadata_source: "ddl_ecourts",
            dataset_version: "pilot",
            state_code: 13,
            state_name: "Uttar Pradesh",
            district_code: 24,
            district_name: "Lucknow",
            court_no: 3,
            court_code: "DC-13-24-3",
            court_name: "CJM Lucknow",
            court_level: "magistrate",
            case_type: "CR",
            filing_date: "2015-01-01",
            registration_date: "2015-01-02",
            decision_date: "2017-01-02",
            disposition: "convicted",
            purpose_name: "Judgment",
            judge_position: "CJM",
            acts_cited: ["IPC"],
            sections_cited: ["302"],
            offence_categories: ["murder"],
            is_criminal_target: true,
            text_status: judgmentFetchQueued ? "targeted" : "metadata_only",
            commercial_safe: true,
            license_classification: "commercial_safe",
            sensitive_data_flags: [],
            source_confidence: 1,
            bailable: null,
            under_trial: null,
            source_payload: { source: "ddl" },
            created_at: "2026-05-22T08:00:00.000Z",
            updated_at: "2026-05-22T08:00:00.000Z",
          },
          sources: [],
          events: [],
          artifacts: [],
          acquisition_queue: judgmentFetchQueued
            ? [{
                district_acquisition_queue_id: "queue-ik-1",
                source_name: "indian_kanoon",
                status: "pending",
                attempt_count: 0,
                max_attempts: 3,
                error_message: null,
                result_metadata: {},
                next_attempt_at: null,
                created_at: "2026-05-23T10:00:00.000Z",
                updated_at: "2026-05-23T10:00:00.000Z",
              }, {
                district_acquisition_queue_id: "queue-ecourts-1",
                source_name: "ecourts",
                status: "pending",
                attempt_count: 0,
                max_attempts: 3,
                error_message: null,
                result_metadata: {},
                next_attempt_at: null,
                created_at: "2026-05-23T10:00:00.000Z",
                updated_at: "2026-05-23T10:00:00.000Z",
              }]
            : [],
          fetch_attempts: [],
        },
      });
    }

    if (req.method() === "POST" && path === "/api/v1/workspaces/ws-district/district/cases/case-district-1/fetch-judgment") {
      judgmentFetchQueued = true;
      return route.fulfill({
        status: 200,
        json: {
          action: "queued",
          already_available: false,
          queued: true,
          document_id: null,
          artifact_id: null,
          text_status: "targeted",
          planned_sources: ["indian_kanoon", "ecourts"],
          artifacts: [],
          acquisition_queue: [{
            district_acquisition_queue_id: "queue-ik-1",
            source_name: "indian_kanoon",
            status: "pending",
            attempt_count: 0,
            max_attempts: 3,
            error_message: null,
            result_metadata: {},
            next_attempt_at: null,
            created_at: "2026-05-23T10:00:00.000Z",
            updated_at: "2026-05-23T10:00:00.000Z",
          }, {
            district_acquisition_queue_id: "queue-ecourts-1",
            source_name: "ecourts",
            status: "pending",
            attempt_count: 0,
            max_attempts: 3,
            error_message: null,
            result_metadata: {},
            next_attempt_at: null,
            created_at: "2026-05-23T10:00:00.000Z",
            updated_at: "2026-05-23T10:00:00.000Z",
          }],
          fetch_attempts: [],
        },
      });
    }

    if (req.method() === "POST" && path === "/api/v1/workspaces/ws-district/query") {
      return route.fulfill({
        status: 200,
        json: {
          answer: [
            "District coverage analytics: 1,200 district-court metadata cases match the current analytics slice.",
            "",
            "Criminal targets: 750. Text available: 300. Translated: 210. RAG active: 160.",
            "",
            "This answer was routed to district analytics because the question asks for metadata aggregates rather than source-text legal reasoning.",
          ].join("\n"),
          conversationId: "conv-district",
          messageId: "msg-district",
          retrieval_run_id: "rr-district",
          citations: [],
          retrieval: {
            preset: "balanced",
            mode: "district_analytics",
            total_latency_ms: 300,
            cache_hit: false,
            chunks_retrieved: 0,
            query_profile: "district_analytics",
            wiki_articles: 0,
            graph_paths: 0,
          },
        },
      });
    }

    return route.fulfill({ status: 404, json: { error: `Unmocked: ${req.method()} ${path}` } });
  });
}

test.describe("District court analytics and routing", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await installDistrictApiMocks(page);
  });

  test("dashboard shows metadata, translation, and source coverage", async ({ page }) => {
    await page.goto("/workspace/ws-district/district-analytics");

    await expect(page.getByRole("heading", { name: "District Analytics" })).toBeVisible();
    await expect(page.getByText("Metadata Cases")).toBeVisible();
    await expect(page.getByText("1200").first()).toBeVisible();
    await expect(page.getByText("Coverage By Source")).toBeVisible();
    await expect(page.getByText("ddl").first()).toBeVisible();
    await expect(page.getByText("Source Operations")).toBeVisible();
  });

  test("case details expand inline and show judgment fetch progress", async ({ page }) => {
    await page.goto("/workspace/ws-district/district-analytics");
    await page.getByRole("button", { name: "Load Filtered" }).click();

    const caseRow = page.getByRole("row").filter({ hasText: "UPLK041081982015" }).first();
    await expect(caseRow).toBeVisible();
    await expect(page.getByText("Judgment Fetch Progress")).toBeVisible();

    const rowBox = await caseRow.boundingBox();
    const progressBox = await page.getByText("Judgment Fetch Progress").boundingBox();
    expect(rowBox).not.toBeNull();
    expect(progressBox).not.toBeNull();
    expect(progressBox!.y).toBeGreaterThan(rowBox!.y);
    expect(progressBox!.y - rowBox!.y).toBeLessThan(260);

    await page.getByRole("button", { name: "Fetch judgment" }).click();
    await expect(page.getByRole("button", { name: "Fetch queued" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "indian_kanoon", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "ecourts", exact: true })).toBeVisible();
    await expect(page.getByText("0 / 3").first()).toBeVisible();
  });

  test("chat aggregate question returns district analytics answer without citations", async ({ page }) => {
    await page.goto("/workspace/ws-district/query");
    const input = page.getByPlaceholder(/ask a question about your documents/i);
    await expect(input).toBeVisible();
    await input.fill("How many district court POCSO cases have text coverage?");
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.getByText(/District coverage analytics/)).toBeVisible();
    await expect(page.getByText(/routed to district analytics/)).toBeVisible();
    await expect(page.getByText(/1,200 district-court metadata cases/)).toBeVisible();
  });
});
