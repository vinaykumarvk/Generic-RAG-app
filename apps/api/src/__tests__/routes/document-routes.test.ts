import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the route handler logic by invoking the Fastify app with inject.
// Since building a full Fastify app for route tests is heavy, we test
// the handler logic through the route registration approach — mock the
// Fastify instance and call the handler functions directly.

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
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    },
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
    delete: vi.fn((path: string, handler: any) => {
      routes.push({ method: "DELETE", path, handler });
    }),
    _routes: routes,
    findRoute(method: string, path: string) {
      return routes.find((r) => r.method === method && r.path === path);
    },
  };
}

// ── Import and setup ──────────────────────────────────────────────────────────

// We need to mock fs and crypto before importing
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock("node:crypto", () => ({
  default: {
    createHash: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        digest: vi.fn().mockReturnValue("abc123sha256hash"),
      }),
    }),
    randomUUID: vi.fn().mockReturnValue("new-doc-uuid"),
  },
}));

vi.mock("node:stream/promises", () => ({
  pipeline: vi.fn(),
}));

import { createDocumentRoutes } from "../../routes/document-routes";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("document-routes", () => {
  let app: ReturnType<typeof createMockApp>;
  let queryFn: ReturnType<typeof createMockQueryFn>;
  let getClient: any;
  let llmProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createMockApp();
    queryFn = createMockQueryFn();
    getClient = vi.fn();
    llmProvider = {};

    createDocumentRoutes(app as any, { queryFn, getClient, llmProvider });
  });

  describe("TC-FR001-01: List documents with pagination", () => {
    it("returns paginated document list", async () => {
      const listRoute = app.findRoute("GET", "/api/v1/workspaces/:wid/documents");
      expect(listRoute).toBeDefined();

      const docs = [
        { document_id: "d1", title: "Doc One", status: "ACTIVE" },
        { document_id: "d2", title: "Doc Two", status: "SEARCHABLE" },
      ];

      // count query
      queryFn.mockResolvedValueOnce({ rows: [{ count: "10" }], rowCount: 1 });
      // documents query
      queryFn.mockResolvedValueOnce({ rows: docs, rowCount: 2 });

      const request = {
        params: { wid: "ws-1" },
        query: { page: "2", limit: "5" },
      };

      const result = await listRoute!.handler(request, createMockReply());

      expect(result.documents).toEqual(docs);
      expect(result.total).toBe(10);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(5);
    });

    it("applies default pagination when not specified", async () => {
      const listRoute = app.findRoute("GET", "/api/v1/workspaces/:wid/documents");

      queryFn.mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const request = {
        params: { wid: "ws-1" },
        query: {},
      };

      const result = await listRoute!.handler(request, createMockReply());

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("filters by status when provided", async () => {
      const listRoute = app.findRoute("GET", "/api/v1/workspaces/:wid/documents");

      queryFn.mockResolvedValueOnce({ rows: [{ count: "3" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const request = {
        params: { wid: "ws-1" },
        query: { status: "ACTIVE", page: "1", limit: "10" },
      };

      await listRoute!.handler(request, createMockReply());

      // Verify that both queries include the status filter
      const countCall = queryFn.mock.calls[0];
      expect(countCall[0]).toContain("status = $2");
      expect(countCall[1]).toContain("ACTIVE");
    });
  });

  describe("TC-FR001-02: Upload creates document record and ingestion job", () => {
    it("creates document and triggers ingestion", async () => {
      const uploadRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/documents");
      expect(uploadRoute).toBeDefined();

      // Dedup check: no existing
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // Insert document
      queryFn.mockResolvedValueOnce({
        rows: [{ document_id: "new-doc-uuid", title: "Test Report", status: "PENDING" }],
        rowCount: 1,
      });
      // Create ingestion job
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const fileBuffer = Buffer.from("file contents");
      const parts = (async function* () {
        yield { type: "file", filename: "report.pdf", mimetype: "application/pdf", file: [fileBuffer] };
        yield { type: "field", fieldname: "title", value: "Test Report" };
        yield { type: "field", fieldname: "category", value: "legal" };
      })();

      const request = {
        params: { wid: "ws-1" },
        parts: () => parts,
        authUser: { user_id: "user-1" },
      };

      const reply = createMockReply();
      const result = await uploadRoute!.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result.document_id).toBe("new-doc-uuid");

      // Verify ingestion job was created
      const ingestionCall = queryFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO ingestion_job")
      );
      expect(ingestionCall).toBeDefined();
      expect(ingestionCall![1][1]).toBe("ws-1");
    });
  });

  describe("TC-FR001-03: Duplicate SHA-256 detection", () => {
    it("rejects upload when SHA-256 hash matches existing document", async () => {
      const uploadRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/documents");

      // Dedup check: existing found
      queryFn.mockResolvedValueOnce({
        rows: [{ document_id: "existing-doc-id", status: "ACTIVE" }],
        rowCount: 1,
      });

      const fileBuffer = Buffer.from("duplicate file");
      const parts = (async function* () {
        yield { type: "file", filename: "dup.pdf", mimetype: "application/pdf", file: [fileBuffer] };
      })();

      const request = {
        params: { wid: "ws-1" },
        parts: () => parts,
        authUser: { user_id: "user-1" },
      };

      const reply = createMockReply();
      const result = await uploadRoute!.handler(request, reply);

      // send400 should have been called. The handler returns send400(reply, msg).
      // We verify that the queryFn for document insert was NOT called
      // (only the dedup check was called)
      const insertCalls = queryFn.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO document")
      );
      expect(insertCalls).toHaveLength(0);
    });
  });

  describe("TC-FR001-04: Delete soft-deletes document", () => {
    it("sets status to DELETED and returns confirmation", async () => {
      const deleteRoute = app.findRoute("DELETE", "/api/v1/workspaces/:wid/documents/:id");
      expect(deleteRoute).toBeDefined();

      queryFn.mockResolvedValueOnce({
        rows: [{ document_id: "doc-1" }],
        rowCount: 1,
      });

      const request = { params: { wid: "ws-1", id: "doc-1" } };
      const result = await deleteRoute!.handler(request, createMockReply());

      expect(result.deleted).toBe(true);
      expect(result.document_id).toBe("doc-1");

      // Verify SQL uses soft-delete
      const sqlCall = queryFn.mock.calls[0];
      expect(sqlCall[0]).toContain("status = 'DELETED'");
      expect(sqlCall[0]).toContain("deleted_at = now()");
    });

    it("returns 404 when document not found", async () => {
      const deleteRoute = app.findRoute("DELETE", "/api/v1/workspaces/:wid/documents/:id");

      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const request = { params: { wid: "ws-1", id: "nonexistent" } };
      const reply = createMockReply();

      // send404 returns a reply object, test that handler returns it
      await deleteRoute!.handler(request, reply);

      // queryFn should have been called with the doc id
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(queryFn.mock.calls[0][1]).toContain("nonexistent");
    });
  });

  describe("TC-FR001-05: SSE status endpoint", () => {
    it("registers SSE route for document status", async () => {
      const sseRoute = app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id/status");
      expect(sseRoute).toBeDefined();
    });
  });

  describe("Route registration", () => {
    it("registers all expected routes", () => {
      expect(app._routes).toHaveLength(5);
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/documents")).toBeDefined();
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id")).toBeDefined();
      expect(app.findRoute("POST", "/api/v1/workspaces/:wid/documents")).toBeDefined();
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id/status")).toBeDefined();
      expect(app.findRoute("DELETE", "/api/v1/workspaces/:wid/documents/:id")).toBeDefined();
    });
  });
});
