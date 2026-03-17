import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { QueryFn } from "../types";

export interface IdempotencyMiddlewareConfig {
  queryFn: QueryFn;
  ttlMs?: number;
  headerName?: string;
  methods?: string[];
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_HEADER = "idempotency-key";
const DEFAULT_METHODS = ["POST", "PUT", "PATCH"];

export function createIdempotencyMiddleware(config: IdempotencyMiddlewareConfig) {
  const {
    queryFn,
    ttlMs = DEFAULT_TTL_MS,
    headerName = DEFAULT_HEADER,
    methods = DEFAULT_METHODS,
  } = config;

  function register(app: FastifyInstance): void {
    // Cleanup expired entries periodically (every 60 min)
    const cleanupInterval = setInterval(async () => {
      try {
        await queryFn("DELETE FROM idempotency_cache WHERE expires_at < NOW()");
      } catch {
        // best-effort cleanup
      }
    }, 60 * 60 * 1000);
    cleanupInterval.unref();

    app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      if (!methods.includes(request.method)) return;

      const key = request.headers[headerName] as string | undefined;
      if (!key) return; // no idempotency key — proceed normally

      if (key.length > 255) {
        reply.code(400).send({
          error: "IDEMPOTENCY_KEY_TOO_LONG",
          message: "Idempotency key must be 255 characters or fewer",
        });
        return;
      }

      try {
        const cached = await queryFn(
          "SELECT response_status, response_body FROM idempotency_cache WHERE idempotency_key = $1 AND expires_at > NOW()",
          [key]
        );

        if (cached.rows.length > 0) {
          const { response_status, response_body } = cached.rows[0];
          reply
            .code(response_status)
            .header("x-idempotent-replayed", "true")
            .send(response_body);
          return;
        }
      } catch (err) {
        // If cache lookup fails, proceed with the request
        request.log.warn({ error: (err as Error).message }, "IDEMPOTENCY_CACHE_LOOKUP_FAILED");
      }

      // Store the key for the onResponse hook
      (request as any)._idempotencyKey = key;
    });

    app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
      const key = (request as any)._idempotencyKey as string | undefined;
      if (!key) return;

      // Only cache successful responses (2xx)
      if (reply.statusCode < 200 || reply.statusCode >= 300) return;

      try {
        const expiresAt = new Date(Date.now() + ttlMs).toISOString();
        // Use ON CONFLICT to handle race conditions
        await queryFn(
          `INSERT INTO idempotency_cache (idempotency_key, response_status, response_body, expires_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [key, reply.statusCode, (reply as any)._idempotencyBody ?? null, expiresAt]
        );
      } catch (err) {
        request.log.warn({ error: (err as Error).message }, "IDEMPOTENCY_CACHE_STORE_FAILED");
      }
    });

    // Capture the response body for caching
    app.addHook("onSend", async (request: FastifyRequest, reply: FastifyReply, payload: string) => {
      const key = (request as any)._idempotencyKey as string | undefined;
      if (!key) return payload;

      if (reply.statusCode >= 200 && reply.statusCode < 300) {
        try {
          (reply as any)._idempotencyBody = typeof payload === "string" ? JSON.parse(payload) : payload;
        } catch {
          (reply as any)._idempotencyBody = null;
        }
      }
      return payload;
    });
  }

  return { register };
}

export type IdempotencyMiddleware = ReturnType<typeof createIdempotencyMiddleware>;
