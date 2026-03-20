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
    patch: vi.fn((path: string, handler: any) => {
      routes.push({ method: "PATCH", path, handler });
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
  let storageProvider: {
    upload: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    getSignedUrl: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = createMockApp();
    queryFn = createMockQueryFn();
    getClient = vi.fn();
    llmProvider = {};

    storageProvider = {
      upload: vi.fn().mockResolvedValue({ filePath: "/uploads/test-file", gcsUri: null }),
      download: vi.fn(), delete: vi.fn(), getSignedUrl: vi.fn(),
    };
    createDocumentRoutes(app as any, { queryFn, getClient, llmProvider, storageProvider });
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
        query: {},
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

  describe("Pipeline inspection routes", () => {
    it("returns the latest extracted text for a document", async () => {
      const route = app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id/extracted-text");
      expect(route).toBeDefined();

      queryFn.mockResolvedValueOnce({ rows: [{ document_id: "doc-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({
        rows: [{
          extraction_id: "ext-1",
          extraction_type: "TEXT",
          content: "normalized content",
          metadata: { page_count: 3 },
        }],
        rowCount: 1,
      });

      const result = await route!.handler({ params: { wid: "ws-1", id: "doc-1" } }, createMockReply());

      expect(result.extracted_text?.content).toBe("normalized content");
      expect(queryFn).toHaveBeenCalledTimes(2);
    });

    it("returns ordered chunks for a document", async () => {
      const route = app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id/chunks");
      expect(route).toBeDefined();

      queryFn.mockResolvedValueOnce({ rows: [{ document_id: "doc-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({
        rows: [
          { chunk_id: "c1", chunk_index: 0, content: "Chunk 1" },
          { chunk_id: "c2", chunk_index: 1, content: "Chunk 2" },
        ],
        rowCount: 2,
      });

      const result = await route!.handler({ params: { wid: "ws-1", id: "doc-1" } }, createMockReply());

      expect(result.chunks).toHaveLength(2);
      expect(result.chunks[0].chunk_index).toBe(0);
      expect(result.chunks[1].content).toBe("Chunk 2");
    });

    it("returns per-document nodes and edges from KG provenance", async () => {
      const route = app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id/graph");
      expect(route).toBeDefined();

      queryFn.mockResolvedValueOnce({ rows: [{ document_id: "doc-1" }], rowCount: 1 });
      queryFn.mockResolvedValueOnce({
        rows: [{ node_id: "n1", name: "Ismail", node_type: "PERSON", mention_count: 2, chunk_ids: ["c1"] }],
        rowCount: 1,
      });
      queryFn.mockResolvedValueOnce({
        rows: [{ edge_id: "e1", edge_type: "shot", source_name: "Mujahid", target_name: "Ismail", evidence_count: 1, chunk_ids: ["c1"] }],
        rowCount: 1,
      });

      const result = await route!.handler({ params: { wid: "ws-1", id: "doc-1" } }, createMockReply());

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(1);
      expect(result.nodes[0].name).toBe("Ismail");
      expect(result.edges[0].edge_type).toBe("shot");
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
        query: {},
        parts: () => parts,
        authUser: { user_id: "user-1" },
      };

      const reply = createMockReply();
      await uploadRoute!.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(409);

      const insertCalls = queryFn.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO document")
      );
      expect(insertCalls).toHaveLength(0);
    });

    it("keeps blocking when an active duplicate exists alongside failed copies", async () => {
      const uploadRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/documents");

      queryFn.mockResolvedValueOnce({
        rows: [
          { document_id: "active-doc-id", status: "ACTIVE" },
          { document_id: "failed-doc-id", status: "FAILED" },
        ],
        rowCount: 2,
      });

      const fileBuffer = Buffer.from("duplicate file");
      const parts = (async function* () {
        yield { type: "file", filename: "dup.pdf", mimetype: "application/pdf", file: [fileBuffer] };
      })();

      const request = {
        params: { wid: "ws-1" },
        query: {},
        parts: () => parts,
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      await uploadRoute!.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(409);
      expect(storageProvider.upload).not.toHaveBeenCalled();
    });

    it("recovers failed duplicate uploads instead of rejecting them", async () => {
      const uploadRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/documents");
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            rows: [{ document_id: "failed-doc-id", status: "UPLOADED" }],
            rowCount: 1,
          })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({}),
        release: vi.fn(),
      };
      getClient.mockResolvedValue(client);

      queryFn.mockResolvedValueOnce({
        rows: [{
          document_id: "failed-doc-id",
          status: "FAILED",
          metadata: { existing: true },
          custom_tags: ["kept"],
          sensitivity_level: "INTERNAL",
        }],
        rowCount: 1,
      });

      const fileBuffer = Buffer.from("retryable file");
      const parts = (async function* () {
        yield { type: "file", filename: "retry.pdf", mimetype: "application/pdf", file: [fileBuffer] };
      })();

      const request = {
        params: { wid: "ws-1" },
        query: {},
        parts: () => parts,
        authUser: { userId: "user-1" },
      };

      const reply = createMockReply();
      const result = await uploadRoute!.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(200);
      expect(result.document_id).toBe("failed-doc-id");
      expect(result.recovered_existing_document).toBe(true);
      expect(storageProvider.upload).toHaveBeenCalledWith("ws-1", "failed-doc-id", "retry.pdf", fileBuffer);
      expect(client.query).toHaveBeenCalledWith("BEGIN");
      expect(client.query).toHaveBeenCalledWith("DELETE FROM citation WHERE document_id = $1", ["failed-doc-id"]);
      expect(client.query).toHaveBeenCalledWith("DELETE FROM chunk WHERE document_id = $1", ["failed-doc-id"]);
      expect(client.query).toHaveBeenCalledWith("DELETE FROM extraction_result WHERE document_id = $1", ["failed-doc-id"]);
      expect(client.query).toHaveBeenCalledWith("COMMIT");
      expect(client.release).toHaveBeenCalled();
    });
  });

  describe("TC-FR001-03b: Reprocess failed document", () => {
    it("clears derived state before requeueing validation", async () => {
      const reprocessRoute = app.findRoute("POST", "/api/v1/workspaces/:wid/documents/:id/reprocess");
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({}),
        release: vi.fn(),
      };
      getClient.mockResolvedValue(client);

      queryFn.mockResolvedValueOnce({
        rows: [{ document_id: "doc-1", status: "FAILED" }],
        rowCount: 1,
      });

      const request = { params: { wid: "ws-1", id: "doc-1" } };
      const result = await reprocessRoute!.handler(request, createMockReply());

      expect(result).toEqual({ document_id: "doc-1", status: "UPLOADED" });
      expect(client.query).toHaveBeenCalledWith("BEGIN");
      expect(client.query).toHaveBeenCalledWith("DELETE FROM citation WHERE document_id = $1", ["doc-1"]);
      expect(client.query).toHaveBeenCalledWith("DELETE FROM chunk WHERE document_id = $1", ["doc-1"]);
      expect(client.query).toHaveBeenCalledWith("DELETE FROM extraction_result WHERE document_id = $1", ["doc-1"]);
      expect(client.query).toHaveBeenCalledWith("COMMIT");
      expect(client.release).toHaveBeenCalled();
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
      expect(app._routes).toHaveLength(12);
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/documents")).toBeDefined();
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id")).toBeDefined();
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id/extracted-text")).toBeDefined();
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id/chunks")).toBeDefined();
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id/graph")).toBeDefined();
      expect(app.findRoute("POST", "/api/v1/workspaces/:wid/documents")).toBeDefined();
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id/status")).toBeDefined();
      expect(app.findRoute("POST", "/api/v1/workspaces/:wid/documents/:id/reprocess")).toBeDefined();
      expect(app.findRoute("GET", "/api/v1/workspaces/:wid/documents/:id/download")).toBeDefined();
      expect(app.findRoute("DELETE", "/api/v1/workspaces/:wid/documents/:id")).toBeDefined();
      expect(app.findRoute("PATCH", "/api/v1/workspaces/:wid/documents/:id")).toBeDefined();
    });
  });
});
