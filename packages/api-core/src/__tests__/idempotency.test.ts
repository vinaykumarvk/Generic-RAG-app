import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createIdempotencyMiddleware } from "../middleware/idempotency";
import type { QueryFn } from "../types";

function createMockQueryFn(): QueryFn & ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) as any;
}

async function buildApp(queryFn: QueryFn, overrides?: { headerName?: string; methods?: string[] }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const middleware = createIdempotencyMiddleware({
    queryFn,
    ...overrides,
  });
  middleware.register(app);

  app.post("/items", async (_req, reply) => {
    reply.code(201).send({ id: "item-1", name: "Widget" });
  });

  app.get("/items", async (_req, reply) => {
    reply.code(200).send([{ id: "item-1" }]);
  });

  app.post("/fail", async (_req, reply) => {
    reply.code(422).send({ error: "VALIDATION_ERROR", message: "Bad input" });
  });

  app.post("/server-error", async (_req, reply) => {
    reply.code(500).send({ error: "INTERNAL", message: "Something broke" });
  });

  await app.ready();
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createIdempotencyMiddleware", () => {
  it("passes through requests without an idempotency key", async () => {
    const queryFn = createMockQueryFn();
    const app = await buildApp(queryFn);

    const res = await app.inject({
      method: "POST",
      url: "/items",
      payload: { name: "Widget" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: "item-1", name: "Widget" });
    // queryFn should not be called for cache lookup or store when no key is provided
    // (it may be called by the cleanup interval setup, but not for cache operations)
    const cacheCalls = (queryFn as any).mock.calls.filter(
      (c: any[]) => String(c[0]).includes("idempotency_cache") && !String(c[0]).includes("DELETE"),
    );
    expect(cacheCalls).toHaveLength(0);

    await app.close();
  });

  it("passes through GET requests (not in default methods)", async () => {
    const queryFn = createMockQueryFn();
    const app = await buildApp(queryFn);

    const res = await app.inject({
      method: "GET",
      url: "/items",
      headers: { "idempotency-key": "get-key-123" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: "item-1" }]);
    // No cache lookup should happen for GET
    const cacheCalls = (queryFn as any).mock.calls.filter(
      (c: any[]) => String(c[0]).includes("SELECT") && String(c[0]).includes("idempotency_cache"),
    );
    expect(cacheCalls).toHaveLength(0);

    await app.close();
  });

  it("returns cached response for duplicate idempotency key", async () => {
    const queryFn = createMockQueryFn();

    // First call: cache miss (no rows), then INSERT for storing
    queryFn
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })        // SELECT — cache miss
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });        // INSERT — store response

    const app = await buildApp(queryFn);

    // First request — processes normally
    const res1 = await app.inject({
      method: "POST",
      url: "/items",
      payload: { name: "Widget" },
      headers: { "idempotency-key": "unique-key-abc" },
    });

    expect(res1.statusCode).toBe(201);
    expect(res1.json()).toEqual({ id: "item-1", name: "Widget" });

    // Now set up queryFn for the second (duplicate) request: cache HIT
    queryFn.mockResolvedValueOnce({
      rows: [{ response_status: 201, response_body: { id: "item-1", name: "Widget" } }],
      rowCount: 1,
    });

    // Second request — same key, should return cached
    const res2 = await app.inject({
      method: "POST",
      url: "/items",
      payload: { name: "Widget" },
      headers: { "idempotency-key": "unique-key-abc" },
    });

    expect(res2.statusCode).toBe(201);
    expect(res2.json()).toEqual({ id: "item-1", name: "Widget" });
    expect(res2.headers["x-idempotent-replayed"]).toBe("true");

    await app.close();
  });

  it("rejects idempotency keys longer than 255 characters", async () => {
    const queryFn = createMockQueryFn();
    const app = await buildApp(queryFn);

    const longKey = "k".repeat(256);

    const res = await app.inject({
      method: "POST",
      url: "/items",
      payload: { name: "Widget" },
      headers: { "idempotency-key": longKey },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "IDEMPOTENCY_KEY_TOO_LONG",
      message: "Idempotency key must be 255 characters or fewer",
    });

    // No cache lookup should have been attempted
    const selectCalls = (queryFn as any).mock.calls.filter(
      (c: any[]) => String(c[0]).includes("SELECT"),
    );
    expect(selectCalls).toHaveLength(0);

    await app.close();
  });

  it("accepts idempotency keys of exactly 255 characters", async () => {
    const queryFn = createMockQueryFn();
    // Cache miss on lookup, then store
    queryFn
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // SELECT — miss
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });   // INSERT — store

    const app = await buildApp(queryFn);

    const exactKey = "k".repeat(255);

    const res = await app.inject({
      method: "POST",
      url: "/items",
      payload: { name: "Widget" },
      headers: { "idempotency-key": exactKey },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: "item-1", name: "Widget" });

    await app.close();
  });

  it("stores response on first successful request", async () => {
    const queryFn = createMockQueryFn();
    // Cache miss on lookup
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });   // SELECT — miss
    // Store will be next call
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });   // INSERT

    const app = await buildApp(queryFn);

    await app.inject({
      method: "POST",
      url: "/items",
      payload: { name: "Widget" },
      headers: { "idempotency-key": "store-test-key" },
    });

    // Find the INSERT call
    const insertCalls = (queryFn as any).mock.calls.filter(
      (c: any[]) => String(c[0]).includes("INSERT INTO idempotency_cache"),
    );
    expect(insertCalls).toHaveLength(1);

    const insertParams = insertCalls[0][1];
    expect(insertParams[0]).toBe("store-test-key");        // idempotency_key
    expect(insertParams[1]).toBe(201);                     // response_status
    expect(insertParams[2]).toEqual({ id: "item-1", name: "Widget" }); // response_body
    expect(typeof insertParams[3]).toBe("string");         // expires_at ISO string

    await app.close();
  });

  it("does NOT cache 4xx error responses", async () => {
    const queryFn = createMockQueryFn();
    // Cache miss on lookup
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT — miss

    const app = await buildApp(queryFn);

    const res = await app.inject({
      method: "POST",
      url: "/fail",
      payload: { bad: true },
      headers: { "idempotency-key": "error-key-4xx" },
    });

    expect(res.statusCode).toBe(422);

    // No INSERT should have been called — only the SELECT for cache lookup
    const insertCalls = (queryFn as any).mock.calls.filter(
      (c: any[]) => String(c[0]).includes("INSERT"),
    );
    expect(insertCalls).toHaveLength(0);

    await app.close();
  });

  it("does NOT cache 5xx error responses", async () => {
    const queryFn = createMockQueryFn();
    // Cache miss on lookup
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT — miss

    const app = await buildApp(queryFn);

    const res = await app.inject({
      method: "POST",
      url: "/server-error",
      payload: {},
      headers: { "idempotency-key": "error-key-5xx" },
    });

    expect(res.statusCode).toBe(500);

    const insertCalls = (queryFn as any).mock.calls.filter(
      (c: any[]) => String(c[0]).includes("INSERT"),
    );
    expect(insertCalls).toHaveLength(0);

    await app.close();
  });

  it("proceeds normally when cache lookup fails", async () => {
    const queryFn = createMockQueryFn();
    // Cache lookup throws an error
    queryFn.mockRejectedValueOnce(new Error("connection refused"));
    // Store call after successful response
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const app = await buildApp(queryFn);

    const res = await app.inject({
      method: "POST",
      url: "/items",
      payload: { name: "Widget" },
      headers: { "idempotency-key": "resilience-key" },
    });

    // Request should still succeed despite cache lookup failure
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: "item-1", name: "Widget" });

    await app.close();
  });

  it("respects custom header name", async () => {
    const queryFn = createMockQueryFn();
    // Cache hit using custom header
    queryFn.mockResolvedValueOnce({
      rows: [{ response_status: 200, response_body: { cached: true } }],
      rowCount: 1,
    });

    const app = await buildApp(queryFn, { headerName: "x-request-id" });

    const res = await app.inject({
      method: "POST",
      url: "/items",
      payload: {},
      headers: { "x-request-id": "custom-header-key" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cached: true });
    expect(res.headers["x-idempotent-replayed"]).toBe("true");

    await app.close();
  });

  it("respects custom methods list", async () => {
    const queryFn = createMockQueryFn();
    // Cache hit for GET (when GET is in custom methods list)
    queryFn.mockResolvedValueOnce({
      rows: [{ response_status: 200, response_body: [{ id: "cached-item" }] }],
      rowCount: 1,
    });

    const app = await buildApp(queryFn, { methods: ["GET"] });

    const res = await app.inject({
      method: "GET",
      url: "/items",
      headers: { "idempotency-key": "get-idem-key" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: "cached-item" }]);
    expect(res.headers["x-idempotent-replayed"]).toBe("true");

    // POST should pass through without idempotency check since it's not in the methods list
    const res2 = await app.inject({
      method: "POST",
      url: "/items",
      payload: {},
      headers: { "idempotency-key": "post-key-ignored" },
    });

    expect(res2.statusCode).toBe(201);
    expect(res2.headers["x-idempotent-replayed"]).toBeUndefined();

    await app.close();
  });
});
