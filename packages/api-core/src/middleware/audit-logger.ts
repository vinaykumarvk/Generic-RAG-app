import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { QueryFn } from "../types";
import { redactValue } from "../logging/redact";

export interface AuditLoggerConfig {
  queryFn: QueryFn;
  tableName?: string;
  skipReadPaths?: string[];
}

const SKIP_PATHS = ["/health", "/ready"];

const DEFAULT_SKIP_READ_PATHS = ["/health", "/ready", "/docs", "/api/v1/config/", "/api/v1/dashboard/"];

const METHOD_TO_EVENT: Record<string, string> = {
  POST: "CREATE",
  PUT: "UPDATE",
  PATCH: "UPDATE",
  DELETE: "DELETE",
  GET: "READ",
};

function extractEntityInfo(url: string): { entityType: string | null; entityId: string | null } {
  const path = url.split("?")[0];
  const segments = path.split("/").filter(Boolean);

  let entityType: string | null = null;
  let entityId: string | null = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === "api" || /^v\d+$/.test(seg)) continue;

    if (!entityType) {
      entityType = seg;
      continue;
    }

    if (/^[0-9a-f-]{8,}$/i.test(seg) || /^\d+$/.test(seg)) {
      entityId = seg;
      break;
    }

    entityType = seg;
  }

  return { entityType, entityId };
}

export function createAuditLogger(config: AuditLoggerConfig) {
  const {
    queryFn,
    tableName = "audit_event",
    skipReadPaths = DEFAULT_SKIP_READ_PATHS,
  } = config;

  let consecutiveAuditFailures = 0;
  const MAX_AUDIT_FAILURES = 5;

  function register(app: FastifyInstance): void {
    // Circuit breaker: block mutations when audit logging is unavailable (disabled in test)
    const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
    app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isTest && consecutiveAuditFailures >= MAX_AUDIT_FAILURES) {
        const mutationMethods = ["POST", "PUT", "PATCH", "DELETE"];
        if (mutationMethods.includes(request.method)) {
          const urlPath = request.url.split("?")[0];
          if (!SKIP_PATHS.some((p) => urlPath === p || urlPath.startsWith(p))) {
            reply.code(503).send({ error: "AUDIT_UNAVAILABLE", message: "Audit logging is unavailable. Mutations are blocked.", statusCode: 503 });
          }
        }
      }
    });

    app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
      const method = request.method;
      const eventType = METHOD_TO_EVENT[method];
      if (!eventType) return;

      const urlPath = request.url.split("?")[0];

      if (eventType === "READ") {
        if (skipReadPaths.some((p) => urlPath === p || urlPath.startsWith(p))) return;
      } else {
        if (SKIP_PATHS.some((p) => urlPath === p || urlPath.startsWith(p))) return;
      }

      try {

        const actorId = (request as any).authUser?.userId ?? "00000000-0000-0000-0000-000000000000";
        const actorRole = (request as any).authUser?.roles?.join(",") || null;
        const { entityType, entityId } = extractEntityInfo(request.url);

        let payloadSummary: string | null = null;
        if (request.body) {
          const full = JSON.stringify(redactValue(request.body));
          if (full.length > 4000) {
            app.log.warn({ originalSize: full.length, url: request.url }, "AUDIT_PAYLOAD_TRUNCATED");
          }
          payloadSummary = full.slice(0, 4000);
        }

        await queryFn(
          `INSERT INTO ${tableName}
             (entity_type, entity_id, event_type, actor_type, actor_id, payload_jsonb, ip_address, request_id, actor_role, response_status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [entityType || "unknown", entityId || "00000000-0000-0000-0000-000000000000", eventType, "SYSTEM_AUDIT", actorId, payloadSummary, request.ip, request.id, actorRole, reply.statusCode]
        );

        consecutiveAuditFailures = 0;
      } catch (err) {
        consecutiveAuditFailures++;
        app.log.error(
          { error: (err as Error).message, consecutiveFailures: consecutiveAuditFailures, url: request.url },
          "AUDIT_LOG_FAILURE"
        );
      }
    });
  }

  return { register };
}

export type AuditLogger = ReturnType<typeof createAuditLogger>;
