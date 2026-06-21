import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDistrictSourceRoutes } from "../../routes/district-source-routes";

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
    _routes: routes,
    findRoute(method: string, path: string) {
      return routes.find((route) => route.method === method && route.path === path);
    },
  };
}

describe("district-source-routes", () => {
  let app: ReturnType<typeof createMockApp>;
  let queryFn: ReturnType<typeof createMockQueryFn>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createMockApp();
    queryFn = createMockQueryFn();
    createDistrictSourceRoutes(app as any, { queryFn, getClient: vi.fn(), llmProvider: {} as any });
  });

  it("returns source, queue, attempt, and artifact status groups", async () => {
    queryFn
      .mockResolvedValueOnce({ rows: [{ source_name: "ddl", total_cases: 10 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ source_name: "ecourts", status: "pending", count: 3 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ source_name: "ecourts", outcome: "hit", count: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ source_name: "ecourts", artifact_type: "source_pdf", count: 1 }], rowCount: 1 });

    const route = app.findRoute("GET", "/api/v1/workspaces/:wid/district/sources/status");
    expect(route).toBeDefined();

    const result = await route!.handler({ params: { wid: "ws-1" } }, {});

    expect(result.cases).toHaveLength(1);
    expect(result.queue).toHaveLength(1);
    expect(result.attempts_24h).toHaveLength(1);
    expect(result.artifacts).toHaveLength(1);
    expect(queryFn).toHaveBeenCalledTimes(4);
  });

  it("returns target summary grouped by district dimensions", async () => {
    queryFn.mockResolvedValueOnce({
      rows: [{ state_code: 9, district_code: 101, offence_category: "murder", cases: 4 }],
      rowCount: 1,
    });

    const route = app.findRoute("GET", "/api/v1/workspaces/:wid/district/targets/summary");
    expect(route).toBeDefined();

    const result = await route!.handler({ params: { wid: "ws-1" } }, {});

    expect(result.targets[0].offence_category).toBe("murder");
    expect(queryFn.mock.calls[0][1]).toEqual(["ws-1"]);
  });
});

