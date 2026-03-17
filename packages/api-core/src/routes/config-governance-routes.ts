import { FastifyInstance } from "fastify";
import type { QueryFn } from "../types";
import { sendError, send400, send403, send404 } from "../errors";

export interface ConfigGovernanceRouteDeps {
  queryFn: QueryFn;
  tableName?: string;
}

/**
 * Versioned configuration governance with lifecycle:
 * DRAFT → PENDING_REVIEW → APPROVED → PUBLISHED → ROLLED_BACK
 */
export function createConfigGovernanceRoutes(deps: ConfigGovernanceRouteDeps) {
  const { queryFn, tableName = "config_governance" } = deps;

  function requireAdmin(request: import("fastify").FastifyRequest): boolean {
    const roles = request.authUser?.roles ?? [];
    return roles.includes("ADMINISTRATOR") || roles.includes("PLATFORM_ADMINISTRATOR");
  }

  return async function registerConfigGovernanceRoutes(app: FastifyInstance): Promise<void> {

    // POST /api/v1/config/versions — create a new draft config version
    app.post("/api/v1/config/versions", {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["configType", "content"],
          properties: {
            configType: { type: "string", minLength: 1, maxLength: 100 },
            content: { type: "object" },
            description: { type: "string", maxLength: 500 },
          },
        },
      },
    }, async (request, reply) => {
      const { configType, content, description } = request.body as {
        configType: string;
        content: Record<string, unknown>;
        description?: string;
      };
      const userId = request.authUser!.userId;

      // Get next version number for this config type
      const versionResult = await queryFn(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM ${tableName} WHERE config_type = $1`,
        [configType],
      );
      const versionNumber = versionResult.rows[0].next_version;

      const result = await queryFn(
        `INSERT INTO ${tableName} (config_type, version_number, status, content_jsonb, description, created_by, created_at)
         VALUES ($1, $2, 'DRAFT', $3, $4, $5, NOW())
         RETURNING id, config_type, version_number, status, description, created_by, created_at`,
        [configType, versionNumber, JSON.stringify(content), description || null, userId],
      );

      reply.code(201);
      return { version: result.rows[0] };
    });

    // GET /api/v1/config/versions — list config versions with optional filters
    app.get("/api/v1/config/versions", {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            configType: { type: "string" },
            status: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            offset: { type: "integer", minimum: 0, default: 0 },
          },
        },
      },
    }, async (request) => {
      const { configType, status, limit, offset } = request.query as {
        configType?: string;
        status?: string;
        limit: number;
        offset: number;
      };

      const conditions: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (configType) {
        conditions.push(`config_type = $${paramIdx++}`);
        params.push(configType);
      }
      if (status) {
        conditions.push(`status = $${paramIdx++}`);
        params.push(status);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countResult = await queryFn(
        `SELECT COUNT(*)::int AS total FROM ${tableName} ${where}`,
        params,
      );
      const total = countResult.rows[0]?.total || 0;

      const result = await queryFn(
        `SELECT id, config_type, version_number, status, description, created_by, approved_by, published_at, created_at
         FROM ${tableName} ${where}
         ORDER BY config_type ASC, version_number DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      );

      return { versions: result.rows, total };
    });

    // GET /api/v1/config/versions/:id — get a single config version with content
    app.get("/api/v1/config/versions/:id", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      },
    }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await queryFn(
        `SELECT * FROM ${tableName} WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) return send404(reply, "VERSION_NOT_FOUND", "Config version not found");
      return { version: result.rows[0] };
    });

    // PATCH /api/v1/config/versions/:id/submit — submit draft for review
    app.patch("/api/v1/config/versions/:id/submit", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      },
    }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await queryFn(
        `UPDATE ${tableName} SET status = 'PENDING_REVIEW', updated_at = NOW()
         WHERE id = $1 AND status = 'DRAFT'
         RETURNING id, config_type, version_number, status`,
        [id],
      );
      if (result.rows.length === 0) {
        return send400(reply, "INVALID_TRANSITION", "Config version must be in DRAFT status to submit for review");
      }
      return { version: result.rows[0] };
    });

    // PATCH /api/v1/config/versions/:id/approve — approve a pending version
    app.patch("/api/v1/config/versions/:id/approve", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      },
    }, async (request, reply) => {
      if (!requireAdmin(request)) {
        return send403(reply, "FORBIDDEN", "Administrator access required to approve config versions");
      }
      const userId = request.authUser!.userId;
      const { id } = request.params as { id: string };

      // Ensure approver is not the creator (four-eyes principle)
      const check = await queryFn(`SELECT created_by FROM ${tableName} WHERE id = $1`, [id]);
      if (check.rows.length > 0 && check.rows[0].created_by === userId) {
        return send403(reply, "SELF_APPROVAL", "Cannot approve your own config version");
      }

      const result = await queryFn(
        `UPDATE ${tableName} SET status = 'APPROVED', approved_by = $1, updated_at = NOW()
         WHERE id = $2 AND status = 'PENDING_REVIEW'
         RETURNING id, config_type, version_number, status, approved_by`,
        [userId, id],
      );
      if (result.rows.length === 0) {
        return send400(reply, "INVALID_TRANSITION", "Config version must be in PENDING_REVIEW status to approve");
      }
      return { version: result.rows[0] };
    });

    // PATCH /api/v1/config/versions/:id/publish — publish an approved version
    app.patch("/api/v1/config/versions/:id/publish", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      },
    }, async (request, reply) => {
      if (!requireAdmin(request)) {
        return send403(reply, "FORBIDDEN", "Administrator access required to publish config versions");
      }
      const { id } = request.params as { id: string };

      // Get the version to be published
      const versionCheck = await queryFn(`SELECT config_type FROM ${tableName} WHERE id = $1 AND status = 'APPROVED'`, [id]);
      if (versionCheck.rows.length === 0) {
        return send400(reply, "INVALID_TRANSITION", "Config version must be in APPROVED status to publish");
      }

      const configType = versionCheck.rows[0].config_type;

      // Unpublish any currently published version of this config type
      await queryFn(
        `UPDATE ${tableName} SET status = 'SUPERSEDED', updated_at = NOW()
         WHERE config_type = $1 AND status = 'PUBLISHED'`,
        [configType],
      );

      const result = await queryFn(
        `UPDATE ${tableName} SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'APPROVED'
         RETURNING id, config_type, version_number, status, published_at`,
        [id],
      );

      return { version: result.rows[0] };
    });

    // POST /api/v1/config/versions/:id/rollback — rollback a published version
    app.post("/api/v1/config/versions/:id/rollback", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            reason: { type: "string", maxLength: 500 },
          },
        },
      },
    }, async (request, reply) => {
      if (!requireAdmin(request)) {
        return send403(reply, "FORBIDDEN", "Administrator access required to rollback config versions");
      }
      const { id } = request.params as { id: string };
      const { reason } = (request.body as { reason?: string }) || {};

      // Mark the published version as rolled back
      const result = await queryFn(
        `UPDATE ${tableName} SET status = 'ROLLED_BACK', rollback_reason = $1, updated_at = NOW()
         WHERE id = $2 AND status = 'PUBLISHED'
         RETURNING id, config_type, version_number, status`,
        [reason || null, id],
      );
      if (result.rows.length === 0) {
        return send400(reply, "INVALID_TRANSITION", "Config version must be in PUBLISHED status to rollback");
      }

      // Re-publish the previous version of this config type (if one exists)
      const configType = result.rows[0].config_type;
      const versionNumber = result.rows[0].version_number;

      if (versionNumber > 1) {
        await queryFn(
          `UPDATE ${tableName} SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW()
           WHERE config_type = $1 AND version_number = (
             SELECT MAX(version_number) FROM ${tableName}
             WHERE config_type = $1 AND version_number < $2 AND status IN ('SUPERSEDED', 'APPROVED')
           )`,
          [configType, versionNumber],
        );
      }

      return { version: result.rows[0], message: "Config version rolled back" };
    });

    // GET /api/v1/config/versions/active/:configType — get the currently published version
    app.get("/api/v1/config/versions/active/:configType", {
      schema: {
        params: { type: "object", required: ["configType"], properties: { configType: { type: "string" } } },
      },
    }, async (request, reply) => {
      const { configType } = request.params as { configType: string };
      const result = await queryFn(
        `SELECT * FROM ${tableName} WHERE config_type = $1 AND status = 'PUBLISHED' LIMIT 1`,
        [configType],
      );
      if (result.rows.length === 0) return send404(reply, "NO_PUBLISHED_VERSION", `No published config version for type: ${configType}`);
      return { version: result.rows[0] };
    });
  };
}
