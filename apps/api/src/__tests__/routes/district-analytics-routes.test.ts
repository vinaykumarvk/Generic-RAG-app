import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDistrictAnalyticsRoutes } from "../../routes/district-analytics-routes";

interface MockRouteHandler {
  method: string;
  path: string;
  handler: (request: any, reply: any) => Promise<any>;
}

function createMockQueryFn() {
  return vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
}

function createMockApp() {
  const routes: MockRouteHandler[] = [];
  const registerRoute = (method: string, path: string, handler: any) => {
    routes.push({ method, path, handler });
  };

  return {
    get: vi.fn((path: string, handler: any) => registerRoute("GET", path, handler)),
    post: vi.fn((path: string, handler: any) => registerRoute("POST", path, handler)),
    _routes: routes,
    findRoute(method: string, path: string) {
      return routes.find((route) => route.method === method && route.path === path);
    },
  };
}

function createReply() {
  return {
    headers: {} as Record<string, string>,
    payload: undefined as unknown,
    statusCode: 200,
    code: vi.fn(function (this: any, statusCode: number) {
      this.statusCode = statusCode;
      return this;
    }),
    header: vi.fn(function (this: any, key: string, value: string) {
      this.headers[key] = value;
      return this;
    }),
    send: vi.fn(function (this: any, payload: unknown) {
      this.payload = payload;
      return payload;
    }),
  };
}

describe("district-analytics-routes", () => {
  let app: ReturnType<typeof createMockApp>;
  let queryFn: ReturnType<typeof createMockQueryFn>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createMockApp();
    queryFn = createMockQueryFn();
    createDistrictAnalyticsRoutes(app as any, { queryFn, getClient: vi.fn(), llmProvider: {} as any });
  });

  it("returns aggregate summary from district facts with commercial-safe default", async () => {
    queryFn
      .mockResolvedValueOnce({
        rows: [{
          total_cases: 100,
          criminal_targets: 40,
          text_available: 12,
          translated: 5,
          redacted: 6,
          rag_active: 4,
          fetch_failed: 2,
          avg_delay_days: 120,
          p95_delay_days: 400,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ completed_at: "2026-05-22T00:00:00Z", inserted_fact_rows: 9 }], rowCount: 1 });

    const route = app.findRoute("GET", "/api/v1/workspaces/:wid/district/analytics/summary");
    expect(route).toBeDefined();

    const result = await route!.handler(
      { params: { wid: "ws-1" }, query: { state_code: "9", statute: "IPC" } },
      createReply(),
    );

    expect(result.totals.total_cases).toBe(100);
    expect(result.totals.translated).toBe(5);
    expect(result.delay.p95_days_registration_to_decision).toBe(400);
    expect(queryFn.mock.calls[0][0]).toContain("district_case_fact_daily");
    expect(queryFn.mock.calls[0][0]).toContain("commercial_safe = true");
    expect(queryFn.mock.calls[0][1]).toEqual(["ws-1", [9], ["ipc"]]);
  });

  it("accepts repeated multi-select filters for aggregate queries", async () => {
    queryFn
      .mockResolvedValueOnce({ rows: [{ total_cases: 10 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const route = app.findRoute("GET", "/api/v1/workspaces/:wid/district/analytics/summary");
    expect(route).toBeDefined();

    await route!.handler(
      { params: { wid: "ws-1" }, query: { state_code: ["1", "13"], section: ["302", "376"], district_key: ["1:25", "13:24"] } },
      createReply(),
    );

    expect(queryFn.mock.calls[0][0]).toContain("state_code = ANY");
    expect(queryFn.mock.calls[0][0]).toContain("LOWER(COALESCE(section, '')) = ANY");
    expect(queryFn.mock.calls[0][0]).toContain("(state_code = $2 AND district_code = $3)");
    expect(queryFn.mock.calls[0][1]).toEqual(["ws-1", 1, 25, 13, 24, [1, 13], ["302", "376"]]);
  });

  it("refreshes district analytics through the database function", async () => {
    queryFn.mockResolvedValueOnce({
      rows: [{ refreshed_workspace_id: "ws-1", inserted_rows: 10, refreshed_at: "2026-05-22T00:00:00Z" }],
      rowCount: 1,
    });

    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/analytics/refresh");
    expect(route).toBeDefined();

    const result = await route!.handler({ params: { wid: "ws-1" } }, createReply());

    expect(result.refreshed[0].inserted_rows).toBe(10);
    expect(queryFn.mock.calls[0][0]).toContain("refresh_district_case_fact_daily");
    expect(queryFn.mock.calls[0][1]).toEqual(["ws-1"]);
  });

  it("exports filtered CNRs as CSV without forcing non-commercial data when opted out", async () => {
    queryFn.mockResolvedValueOnce({
      rows: [{
        cnr: "UP123",
        source_case_id: "case-1",
        source_name: "ddl",
        state_code: 9,
        state_name: "Uttar Pradesh",
        district_code: 101,
        district_name: "Lucknow",
        court_level: "district",
        court_name: "Sessions Court",
        case_type: "Sessions",
        filing_date: "2020-01-01",
        registration_date: "2020-01-02",
        decision_date: "2021-01-01",
        disposition: "convicted",
        offence_categories: "murder",
        text_status: "metadata_only",
        commercial_safe: true,
      }],
      rowCount: 1,
    });

    const route = app.findRoute("GET", "/api/v1/workspaces/:wid/district/analytics/cnrs.csv");
    expect(route).toBeDefined();
    const reply = createReply();

    await route!.handler(
      { params: { wid: "ws-1" }, query: { offence_category: "murder", commercial_safe: "false" } },
      reply,
    );

    expect(reply.header).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
    expect(String(reply.payload)).toContain("UP123");
    expect(queryFn.mock.calls[0][0]).not.toContain("commercial_safe = true");
  });

  it("returns filter options for dropdowns", async () => {
    queryFn
      .mockResolvedValueOnce({ rows: [{ value: "13", label: "Uttar Pradesh (13)", count: 10 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ value: "13:24", label: "Lucknow, Uttar Pradesh (13:24)", count: 5 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ kind: "section", value: "302", label: "302", count: 7 }], rowCount: 1 });

    const route = app.findRoute("GET", "/api/v1/workspaces/:wid/district/analytics/filter-options");
    expect(route).toBeDefined();

    const result = await route!.handler({ params: { wid: "ws-1" }, query: {} }, createReply());

    expect(result.states[0].value).toBe("13");
    expect(result.districts[0].label).toContain("Lucknow");
    expect(result.sections[0].value).toBe("302");
    expect(queryFn).toHaveBeenCalledTimes(3);
  });

  it("searches district cases for drilldown", async () => {
    queryFn
      .mockResolvedValueOnce({
        rows: [{ district_case_id: "case-uuid", source_case_id: "ddl-case-1", cnr: "UP123" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ total: 1 }], rowCount: 1 });

    const route = app.findRoute("GET", "/api/v1/workspaces/:wid/district/cases");
    expect(route).toBeDefined();

    const result = await route!.handler(
      { params: { wid: "ws-1" }, query: { case_search: "UP123", limit: "10" } },
      createReply(),
    );

    expect(result.cases[0].cnr).toBe("UP123");
    expect(result.total).toBe(1);
    expect(queryFn.mock.calls[0][0]).toContain("LOWER(COALESCE(cnr");
  });

  it("returns district case detail metadata", async () => {
    queryFn
      .mockResolvedValueOnce({ rows: [{ district_case_id: "case-uuid", source_payload: { raw: true } }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    const route = app.findRoute("GET", "/api/v1/workspaces/:wid/district/cases/:caseId");
    expect(route).toBeDefined();

    const result = await route!.handler(
      { params: { wid: "ws-1", caseId: "case-uuid" }, query: {} },
      createReply(),
    );

    expect(result.case.source_payload.raw).toBe(true);
    expect(result.sources).toEqual([]);
  });

  it("returns an existing linked judgment artifact without requeueing", async () => {
    queryFn
      .mockResolvedValueOnce({
        rows: [{
          district_case_id: "case-uuid",
          workspace_id: "ws-1",
          cnr: "UPLK041081982015",
          source_case_id: "13-24-03-204400055662015",
          state_code: 13,
          state_name: "Uttar Pradesh",
          district_code: 24,
          district_name: "Lucknow",
          offence_categories: ["criminal"],
          is_criminal_target: true,
          text_status: "text_ready",
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          district_text_artifact_id: "artifact-1",
          artifact_type: "source_text",
          source_name: "indian_kanoon",
          document_id: "doc-1",
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/cases/:caseId/fetch-judgment");
    expect(route).toBeDefined();

    const result = await route!.handler(
      { params: { wid: "ws-1", caseId: "case-uuid" }, body: {} },
      createReply(),
    );

    expect(result.action).toBe("available");
    expect(result.already_available).toBe(true);
    expect(result.document_id).toBe("doc-1");
    expect(queryFn).toHaveBeenCalledTimes(4);
    expect(queryFn.mock.calls.some((call) => String(call[0]).includes("INSERT INTO district_acquisition_queue"))).toBe(false);
  });

  it("queues approved judgment sources for a metadata-only district case", async () => {
    queryFn
      .mockResolvedValueOnce({
        rows: [{
          district_case_id: "case-uuid",
          workspace_id: "ws-1",
          cnr: "UPLK041081982015",
          source_case_id: "13-24-03-204400055662015",
          state_code: 13,
          state_name: "Uttar Pradesh",
          district_code: 24,
          district_name: "Lucknow",
          court_name: "CJM Lucknow",
          court_level: "magistrate",
          case_type: "CR",
          decision_date: "2015-01-02",
          offence_categories: ["criminal"],
          is_criminal_target: true,
          text_status: "metadata_only",
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          { source_name: "indian_kanoon", status: "pending" },
          { source_name: "ecourts", status: "pending" },
          { source_name: "hldc", status: "pending" },
        ],
        rowCount: 3,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/cases/:caseId/fetch-judgment");
    expect(route).toBeDefined();

    const result = await route!.handler(
      { params: { wid: "ws-1", caseId: "case-uuid" }, body: {} },
      createReply(),
    );

    expect(result.action).toBe("queued");
    expect(result.planned_sources).toEqual(["indian_kanoon", "ecourts", "hldc"]);
    const insertCalls = queryFn.mock.calls.filter((call) => String(call[0]).includes("INSERT INTO district_acquisition_queue"));
    expect(insertCalls).toHaveLength(3);
    expect(insertCalls[0][1][2]).toBe("indian_kanoon");
    expect(insertCalls[1][1][2]).toBe("ecourts");
    expect(insertCalls[2][1][2]).toBe("hldc");
  });

  it("does not duplicate pending judgment fetch queue rows", async () => {
    queryFn
      .mockResolvedValueOnce({
        rows: [{
          district_case_id: "case-uuid",
          workspace_id: "ws-1",
          cnr: "UPLK041081982015",
          source_case_id: "13-24-03-204400055662015",
          offence_categories: ["criminal"],
          is_criminal_target: true,
          text_status: "targeted",
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ source_name: "ecourts", status: "pending" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/cases/:caseId/fetch-judgment");
    expect(route).toBeDefined();

    const result = await route!.handler(
      { params: { wid: "ws-1", caseId: "case-uuid" }, body: {} },
      createReply(),
    );

    expect(result.action).toBe("pending");
    expect(result.queued).toBe(false);
    expect(queryFn.mock.calls.some((call) => String(call[0]).includes("INSERT INTO district_acquisition_queue"))).toBe(false);
  });
});
