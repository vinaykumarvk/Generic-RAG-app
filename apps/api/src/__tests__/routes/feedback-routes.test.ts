import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFeedbackRoutes } from "../../routes/feedback-routes";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MockRouteHandler {
  method: string;
  path: string;
  handler: (request: unknown, reply: unknown) => Promise<unknown>;
}

// ── Mock Helpers ──────────────────────────────────────────────────────────────

function createMockQueryFn() {
  return vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
}

function createMockReply() {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

function createMockApp() {
  const routes: MockRouteHandler[] = [];

  return {
    get: vi.fn((path: string, handler: unknown) => {
      routes.push({ method: "GET", path, handler: handler as MockRouteHandler["handler"] });
    }),
    post: vi.fn((path: string, handler: unknown) => {
      routes.push({ method: "POST", path, handler: handler as MockRouteHandler["handler"] });
    }),
    patch: vi.fn((path: string, handler: unknown) => {
      routes.push({ method: "PATCH", path, handler: handler as MockRouteHandler["handler"] });
    }),
    _routes: routes,
    findRoute(method: string, path: string) {
      return routes.find((r) => r.method === method && r.path === path);
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("feedback-routes", () => {
  let app: ReturnType<typeof createMockApp>;
  let queryFn: ReturnType<typeof createMockQueryFn>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createMockApp();
    queryFn = createMockQueryFn();

    createFeedbackRoutes(app as never, { queryFn });
  });

  describe("TC-FR019-01: Submit feedback with 3-level", () => {
    it("creates feedback record with HELPFUL level", async () => {
      const submitRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/feedback");
      expect(submitRoute).toBeDefined();

      // Message lookup
      queryFn.mockResolvedValueOnce({ rows: [{ conversation_id: "conv-1" }], rowCount: 1 });

      // Insert feedback
      const feedbackRow = {
        feedback_id: "fb-1",
        message_id: "msg-1",
        feedback_level: "HELPFUL",
        comment: "Great answer",
      };
      queryFn.mockResolvedValueOnce({ rows: [feedbackRow], rowCount: 1 });

      const request = {
        params: { wid: "ws-1" },
        body: { message_id: "msg-1", feedback_level: "HELPFUL", comment: "Great answer" },
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      const result = await submitRoute!.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result).toEqual(feedbackRow);

      const insertCall = queryFn.mock.calls[1];
      expect(insertCall[0]).toContain("INSERT INTO feedback");
      expect(insertCall[1][0]).toBe("msg-1");
    });

    it("creates NOT_HELPFUL feedback with issue_tags", async () => {
      const submitRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/feedback");

      queryFn.mockResolvedValueOnce({ rows: [{ conversation_id: "conv-1" }], rowCount: 1 });

      const feedbackRow = {
        feedback_id: "fb-2",
        feedback_level: "NOT_HELPFUL",
        issue_tags: ["inaccurate", "missing_info"],
      };
      queryFn.mockResolvedValueOnce({ rows: [feedbackRow], rowCount: 1 });

      const request = {
        params: { wid: "ws-1" },
        body: {
          message_id: "msg-2",
          feedback_level: "NOT_HELPFUL",
          issue_tags: ["inaccurate", "missing_info"],
        },
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      const result = await submitRoute!.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result).toEqual(feedbackRow);
    });
  });

  describe("TC-FR019-02: List feedback for workspace", () => {
    it("returns paginated feedback list (admin sees all)", async () => {
      const listRoute = app.findRoute("GET", "/api/v1/workspaces/:wid/feedback");
      expect(listRoute).toBeDefined();

      const feedbackRows = [
        { feedback_id: "fb-1", feedback_level: "HELPFUL", user_name: "John" },
        { feedback_id: "fb-2", feedback_level: "NOT_HELPFUL", user_name: "Jane" },
      ];
      queryFn
        .mockResolvedValueOnce({ rows: [{ count: "2" }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: feedbackRows, rowCount: 2 });

      const request = {
        params: { wid: "ws-1" },
        query: { page: "1", limit: "20" },
        authUser: { userId: "admin-1", userType: "ADMIN" },
      };

      const result = await listRoute!.handler(request, createMockReply());
      const res = result as { feedback: unknown[]; page: number; limit: number; total: number };

      expect(res.feedback).toEqual(feedbackRows);
      expect(res.page).toBe(1);
      expect(res.limit).toBe(20);
      expect(res.total).toBe(2);
    });

    it("non-admin sees only own feedback", async () => {
      const listRoute = app.findRoute("GET", "/api/v1/workspaces/:wid/feedback");

      queryFn
        .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const request = {
        params: { wid: "ws-1" },
        query: {},
        authUser: { userId: "user-1", userType: "ANALYST" },
      };

      await listRoute!.handler(request, createMockReply());

      // Should include user_id filter for non-admin
      const countCall = queryFn.mock.calls[0];
      expect(countCall[0]).toContain("f.user_id = $");
      expect(countCall[1]).toContain("user-1");
    });
  });

  describe("TC-FR019-03: Admin resolve feedback", () => {
    it("admin can resolve feedback with notes", async () => {
      const resolveRoute = app.findRoute("PATCH", "/api/v1/workspaces/:wid/feedback/:id");
      expect(resolveRoute).toBeDefined();

      const updatedRow = {
        feedback_id: "fb-1",
        admin_notes: "Investigated and fixed",
        resolved_at: "2026-03-18T00:00:00Z",
      };
      queryFn.mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 });

      const request = {
        params: { wid: "ws-1", id: "fb-1" },
        body: { admin_notes: "Investigated and fixed", status: "resolved" },
        authUser: { userId: "admin-1", userType: "ADMIN" },
      };

      const result = await resolveRoute!.handler(request, createMockReply());
      expect(result).toEqual(updatedRow);

      const updateCall = queryFn.mock.calls[0];
      expect(updateCall[0]).toContain("UPDATE feedback");
      expect(updateCall[0]).toContain("admin_notes");
      expect(updateCall[0]).toContain("resolved_at");
    });

    it("non-admin is rejected", async () => {
      const resolveRoute = app.findRoute("PATCH", "/api/v1/workspaces/:wid/feedback/:id");

      const request = {
        params: { wid: "ws-1", id: "fb-1" },
        body: { status: "resolved" },
        authUser: { userId: "user-1", userType: "ANALYST" },
      };

      const reply = createMockReply();
      await resolveRoute!.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
    });
  });

  describe("Validation", () => {
    it("returns 400 when message_id is missing", async () => {
      const submitRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/feedback");

      const request = {
        params: { wid: "ws-1" },
        body: { feedback_level: "HELPFUL" },
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      await submitRoute!.handler(request, reply);

      expect(queryFn).not.toHaveBeenCalled();
    });

    it("returns 400 when message does not exist", async () => {
      const submitRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/feedback");

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const request = {
        params: { wid: "ws-1" },
        body: { message_id: "nonexistent-msg", feedback_level: "HELPFUL" },
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      await submitRoute!.handler(request, reply);

      expect(queryFn).toHaveBeenCalledTimes(1);
      const insertCalls = queryFn.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO feedback")
      );
      expect(insertCalls).toHaveLength(0);
    });

    it("rejects >10 issue_tags", async () => {
      const submitRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/feedback");

      queryFn.mockResolvedValueOnce({ rows: [{ conversation_id: "conv-1" }], rowCount: 1 });

      const request = {
        params: { wid: "ws-1" },
        body: {
          message_id: "msg-1",
          feedback_level: "NOT_HELPFUL",
          issue_tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`),
        },
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      await submitRoute!.handler(request, reply);

      // Insert should not have been called
      const insertCalls = queryFn.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO feedback")
      );
      expect(insertCalls).toHaveLength(0);
    });
  });

  describe("Route registration", () => {
    it("registers POST, GET, PATCH, and stats routes", () => {
      expect(app._routes).toHaveLength(4);
      expect(app.findRoute("POST", "/api/v1/workspaces/:wid/feedback")).toBeDefined();
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/feedback")).toBeDefined();
      expect(app.findRoute("PATCH", "/api/v1/workspaces/:wid/feedback/:id")).toBeDefined();
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/feedback/stats")).toBeDefined();
    });
  });
});
