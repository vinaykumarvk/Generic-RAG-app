import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDistrictBatchRoutes } from "../../routes/district-batch-routes";

interface MockRouteHandler {
  method: string;
  path: string;
  handler: (request: any, reply: any) => Promise<any>;
}

function createMockApp() {
  const routes: MockRouteHandler[] = [];
  const register = (method: string, path: string, handler: any) => routes.push({ method, path, handler });
  return {
    get: vi.fn((path: string, handler: any) => register("GET", path, handler)),
    post: vi.fn((path: string, handler: any) => register("POST", path, handler)),
    _routes: routes,
    findRoute(method: string, path: string) {
      return routes.find((r) => r.method === method && r.path === path);
    },
  };
}

function createReply() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    code: vi.fn(function (this: any, statusCode: number) {
      this.statusCode = statusCode;
      return this;
    }),
    send: vi.fn(function (this: any, payload: unknown) {
      this.payload = payload;
      return payload;
    }),
  };
}

const ADMIN = { userType: "ADMIN", userId: "admin-1" };
const MEMBER = { userType: "USER", userId: "user-1" };

describe("district-batch-routes", () => {
  let app: ReturnType<typeof createMockApp>;
  let queryFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createMockApp();
    queryFn = vi.fn().mockResolvedValue({ rows: [{ district_batch_job_id: "job-1" }], rowCount: 1 });
    createDistrictBatchRoutes(app as any, { queryFn, getClient: vi.fn(), llmProvider: {} as any });
  });

  it("rejects seed for non-admin users", async () => {
    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/seed");
    const reply = createReply();
    await route!.handler({ params: { wid: "ws-1" }, body: {}, authUser: MEMBER }, reply);
    expect(reply.statusCode).toBe(403);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("enqueues a seed job for admins with bounded limit", async () => {
    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/seed");
    const reply = createReply();
    await route!.handler({ params: { wid: "ws-1" }, body: { limit: 999_999_999 }, authUser: ADMIN }, reply);
    expect(reply.statusCode).toBe(202);
    expect(queryFn.mock.calls[0][0]).toContain("INSERT INTO district_batch_job");
    const [wid, jobType, paramsJson, requestedBy] = queryFn.mock.calls[0][1];
    expect(wid).toBe("ws-1");
    expect(jobType).toBe("seed");
    expect(JSON.parse(paramsJson).limit).toBe(100_000); // clamped to MAX_SEED_LIMIT
    expect(requestedBy).toBe("admin-1");
  });

  it("enqueues a seed job filtered by state and year", async () => {
    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/seed");
    const reply = createReply();
    await route!.handler({ params: { wid: "ws-1" }, body: { state_code: 9, year: 2019 }, authUser: ADMIN }, reply);
    expect(reply.statusCode).toBe(202);
    const params = JSON.parse(queryFn.mock.calls[0][1][2]);
    expect(params.state_code).toBe(9);
    expect(params.year).toBe(2019);
    expect(params.limit).toBe(1000);
  });

  it("rejects a seed job with an invalid year", async () => {
    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/seed");
    const reply = createReply();
    await route!.handler({ params: { wid: "ws-1" }, body: { year: 99 }, authUser: ADMIN }, reply);
    expect(reply.statusCode).toBe(400);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("rejects discover with an invalid state code", async () => {
    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/discover");
    const reply = createReply();
    await route!.handler(
      { params: { wid: "ws-1" }, body: { state: "U", establishment: "LU", court_code: 1, year: 2018 }, authUser: ADMIN },
      reply,
    );
    expect(reply.statusCode).toBe(400);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("enqueues a discover job with normalized, bounded params", async () => {
    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/discover");
    const reply = createReply();
    await route!.handler(
      { params: { wid: "ws-1" }, body: { state: "up", establishment: "lu", court_code: 1, year: 2018, count: 5000 }, authUser: ADMIN },
      reply,
    );
    expect(reply.statusCode).toBe(202);
    const params = JSON.parse(queryFn.mock.calls[0][1][2]);
    expect(params.state).toBe("UP");
    expect(params.establishment).toBe("LU");
    expect(params.count).toBe(1000); // clamped to MAX_DISCOVER_COUNT
    expect(params.start).toBe(1);
  });

  it("enqueues a process job for admins with bounded limit", async () => {
    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/process");
    const reply = createReply();
    await route!.handler({ params: { wid: "ws-1" }, body: { limit: 999_999 }, authUser: ADMIN }, reply);
    expect(reply.statusCode).toBe(202);
    const [wid, jobType, paramsJson] = queryFn.mock.calls[0][1];
    expect(wid).toBe("ws-1");
    expect(jobType).toBe("process");
    expect(JSON.parse(paramsJson).limit).toBe(10_000); // clamped to MAX_PROCESS_LIMIT
  });

  it("rejects process for non-admin users", async () => {
    const route = app.findRoute("POST", "/api/v1/workspaces/:wid/district/process");
    const reply = createReply();
    await route!.handler({ params: { wid: "ws-1" }, body: {}, authUser: MEMBER }, reply);
    expect(reply.statusCode).toBe(403);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("returns per-stage counts", async () => {
    queryFn
      .mockResolvedValueOnce({ rows: [{ queued_for_fetch: 12, fetch_failed: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stored_awaiting_processing: 7, processed: 30 }], rowCount: 1 });
    const route = app.findRoute("GET", "/api/v1/workspaces/:wid/district/stage-counts");
    const result = await route!.handler({ params: { wid: "ws-1" } }, createReply());
    expect(result.queued_for_fetch).toBe(12);
    expect(result.stored_awaiting_processing).toBe(7);
    expect(result.processed).toBe(30);
    expect(result.fetch_failed).toBe(2);
  });

  it("lists recent batch jobs", async () => {
    queryFn.mockResolvedValueOnce({ rows: [{ district_batch_job_id: "job-1", status: "succeeded" }], rowCount: 1 });
    const route = app.findRoute("GET", "/api/v1/workspaces/:wid/district/batch-jobs");
    const result = await route!.handler({ params: { wid: "ws-1" } }, createReply());
    expect(result.jobs).toHaveLength(1);
    expect(queryFn.mock.calls[0][1]).toEqual(["ws-1", 50]);
  });

  it("returns 404 for an unknown batch job", async () => {
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const route = app.findRoute("GET", "/api/v1/workspaces/:wid/district/batch-jobs/:jobId");
    const reply = createReply();
    await route!.handler({ params: { wid: "ws-1", jobId: "missing" } }, reply);
    expect(reply.statusCode).toBe(404);
  });
});
