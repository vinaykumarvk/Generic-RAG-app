import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFeedbackRoutes } from "../../routes/feedback-routes";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MockRouteHandler {
  method: string;
  path: string;
  handler: (request: any, reply: any) => Promise<any>;
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
    get: vi.fn((path: string, handler: any) => {
      routes.push({ method: "GET", path, handler });
    }),
    post: vi.fn((path: string, handler: any) => {
      routes.push({ method: "POST", path, handler });
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

    createFeedbackRoutes(app as any, { queryFn });
  });

  describe("TC-FR018-01: Submit feedback with rating", () => {
    it("creates feedback record with numeric rating", async () => {
      const submitRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/feedback");
      expect(submitRoute).toBeDefined();

      // Lookup message to get conversation_id
      queryFn.mockResolvedValueOnce({
        rows: [{ conversation_id: "conv-1" }],
        rowCount: 1,
      });

      // Insert feedback
      const feedbackRow = {
        feedback_id: "fb-1",
        message_id: "msg-1",
        conversation_id: "conv-1",
        workspace_id: "ws-1",
        user_id: "user-1",
        feedback_type: "rating",
        rating: 4,
        comment: "Very helpful answer",
        correction: null,
      };
      queryFn.mockResolvedValueOnce({ rows: [feedbackRow], rowCount: 1 });

      const request = {
        params: { wid: "ws-1" },
        body: {
          message_id: "msg-1",
          feedback_type: "rating",
          rating: 4,
          comment: "Very helpful answer",
        },
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      const result = await submitRoute!.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result.feedback_id).toBe("fb-1");
      expect(result.rating).toBe(4);
      expect(result.feedback_type).toBe("rating");

      // Verify the insert params
      const insertCall = queryFn.mock.calls[1];
      expect(insertCall[0]).toContain("INSERT INTO feedback");
      expect(insertCall[1][0]).toBe("msg-1"); // message_id
      expect(insertCall[1][1]).toBe("conv-1"); // conversation_id
      expect(insertCall[1][2]).toBe("ws-1"); // workspace_id
      expect(insertCall[1][3]).toBe("user-1"); // user_id
      expect(insertCall[1][4]).toBe("rating"); // feedback_type
      expect(insertCall[1][5]).toBe(4); // rating
      expect(insertCall[1][6]).toBe("Very helpful answer"); // comment
    });
  });

  describe("TC-FR018-02: Submit feedback with thumbs up/down", () => {
    it("creates feedback record with thumbs_up type", async () => {
      const submitRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/feedback");

      queryFn.mockResolvedValueOnce({
        rows: [{ conversation_id: "conv-1" }],
        rowCount: 1,
      });

      const feedbackRow = {
        feedback_id: "fb-2",
        message_id: "msg-2",
        feedback_type: "thumbs_up",
        rating: null,
      };
      queryFn.mockResolvedValueOnce({ rows: [feedbackRow], rowCount: 1 });

      const request = {
        params: { wid: "ws-1" },
        body: {
          message_id: "msg-2",
          feedback_type: "thumbs_up",
        },
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      const result = await submitRoute!.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result.feedback_type).toBe("thumbs_up");

      // rating should be null when not provided
      const insertCall = queryFn.mock.calls[1];
      expect(insertCall[1][5]).toBeNull(); // rating is null
    });

    it("creates feedback record with thumbs_down type and correction", async () => {
      const submitRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/feedback");

      queryFn.mockResolvedValueOnce({
        rows: [{ conversation_id: "conv-1" }],
        rowCount: 1,
      });

      const feedbackRow = {
        feedback_id: "fb-3",
        message_id: "msg-3",
        feedback_type: "thumbs_down",
        correction: "The correct answer is...",
      };
      queryFn.mockResolvedValueOnce({ rows: [feedbackRow], rowCount: 1 });

      const request = {
        params: { wid: "ws-1" },
        body: {
          message_id: "msg-3",
          feedback_type: "thumbs_down",
          correction: "The correct answer is...",
        },
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      const result = await submitRoute!.handler(request, reply);

      expect(result.feedback_type).toBe("thumbs_down");
      expect(result.correction).toBe("The correct answer is...");

      const insertCall = queryFn.mock.calls[1];
      expect(insertCall[1][7]).toBe("The correct answer is..."); // correction
    });
  });

  describe("TC-FR018-03: List feedback for workspace", () => {
    it("returns paginated feedback list", async () => {
      const listRoute = app.findRoute("GET", "/api/v1/workspaces/:wid/feedback");
      expect(listRoute).toBeDefined();

      const feedbackRows = [
        { feedback_id: "fb-1", feedback_type: "rating", rating: 5, message_content: "Answer text", user_name: "John" },
        { feedback_id: "fb-2", feedback_type: "thumbs_up", rating: null, message_content: "Another answer", user_name: "Jane" },
      ];
      queryFn.mockResolvedValueOnce({ rows: feedbackRows, rowCount: 2 });

      const request = {
        params: { wid: "ws-1" },
        query: { page: "1", limit: "20" },
      };

      const result = await listRoute!.handler(request, createMockReply());

      expect(result.feedback).toEqual(feedbackRows);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("filters by feedback type when specified", async () => {
      const listRoute = app.findRoute("GET", "/api/v1/workspaces/:wid/feedback");

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const request = {
        params: { wid: "ws-1" },
        query: { type: "thumbs_down", page: "1", limit: "10" },
      };

      await listRoute!.handler(request, createMockReply());

      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).toContain("feedback_type = $2");
      expect(sqlCall[1]).toContain("thumbs_down");
    });

    it("applies default pagination values", async () => {
      const listRoute = app.findRoute("GET", "/api/v1/workspaces/:wid/feedback");

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const request = {
        params: { wid: "ws-1" },
        query: {},
      };

      const result = await listRoute!.handler(request, createMockReply());

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  describe("Validation", () => {
    it("returns 400 when message_id is missing", async () => {
      const submitRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/feedback");

      const request = {
        params: { wid: "ws-1" },
        body: {
          feedback_type: "rating",
          rating: 5,
        },
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      await submitRoute!.handler(request, reply);

      // send400 is called — no feedback insert should happen
      expect(queryFn).not.toHaveBeenCalled();
    });

    it("returns 400 when feedback_type is missing", async () => {
      const submitRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/feedback");

      const request = {
        params: { wid: "ws-1" },
        body: {
          message_id: "msg-1",
          rating: 5,
        },
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      await submitRoute!.handler(request, reply);

      expect(queryFn).not.toHaveBeenCalled();
    });

    it("returns 400 when message does not exist", async () => {
      const submitRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/feedback");

      // Message lookup returns empty
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const request = {
        params: { wid: "ws-1" },
        body: {
          message_id: "nonexistent-msg",
          feedback_type: "thumbs_up",
        },
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      await submitRoute!.handler(request, reply);

      // Only the message lookup should have been called, no insert
      expect(queryFn).toHaveBeenCalledTimes(1);
      const insertCalls = queryFn.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO feedback")
      );
      expect(insertCalls).toHaveLength(0);
    });
  });

  describe("Route registration", () => {
    it("registers POST and GET feedback routes", () => {
      expect(app._routes).toHaveLength(2);
      expect(app.findRoute("POST", "/api/v1/workspaces/:wid/feedback")).toBeDefined();
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/feedback")).toBeDefined();
    });
  });
});
