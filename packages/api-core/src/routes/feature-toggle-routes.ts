/**
 * Feature Toggle Routes — runtime feature flag management.
 *
 * GET  /api/v1/assistant/features/status — public: enabled flags for current user
 * GET  /api/v1/assistant/features        — admin: list all flags
 * PUT  /api/v1/assistant/features/:key   — admin: update flag
 */

import { FastifyInstance } from "fastify";
import type { QueryFn } from "../types";
import { sendError, send403 } from "../errors";

export interface FeatureToggleRouteDeps {
  queryFn: QueryFn;
  /** Role keys that can manage feature flags */
  adminRoles?: string[];
  /** Extract user from request (varies by app — authUser, user, etc.) */
  getUser?: (request: any) => any;
}

export function createFeatureToggleRoutes(deps: FeatureToggleRouteDeps) {
  const { queryFn, adminRoles = ["ADMIN", "SUPER_ADMIN", "SYSTEM_ADMIN"], getUser = (r: any) => r.authUser || r.user } = deps;

  function isAdmin(user: any): boolean {
    if (!user) return false;
    // Support roles array (flat) or postings array (with system_role_ids)
    if (user.roles?.length) {
      return user.roles.some((r: string) => adminRoles.includes(r));
    }
    if (user.postings?.length) {
      return user.postings.some((p: any) => {
        const roles = p.system_role_ids || (p.role_key ? [p.role_key] : []);
        return roles.some((r: string) => adminRoles.includes(r));
      });
    }
    // Fallback: only ADMIN userType gets admin access (not all officers)
    if (user.userType === "ADMIN") return true;
    return false;
  }

  return async function registerFeatureToggleRoutes(app: FastifyInstance): Promise<void> {
    // ── GET /api/v1/assistant/features/status ─────────────────────────────────
    // Public endpoint — returns globally enabled feature flags.
    // No auth required so the UI can decide whether to show the FAB.
    app.get("/api/v1/assistant/features/status", {
      config: { skipStrictReadSchema: true },
    }, async (_request, _reply) => {
      const result = await queryFn(
        `SELECT flag_key, enabled FROM feature_flag WHERE TRUE`,
      );

      const flags: Record<string, boolean> = {};
      for (const row of result.rows) {
        flags[row.flag_key] = row.enabled;
      }
      return { flags };
    });

    // ── GET /api/v1/assistant/features ────────────────────────────────────────
    app.get("/api/v1/assistant/features", {
      config: { skipStrictReadSchema: true },
    }, async (request, reply) => {
      const user = getUser(request);
      if (!isAdmin(user)) return send403(reply, "FORBIDDEN", "Admin access required");

      const result = await queryFn(
        `SELECT flag_key, enabled, description, updated_at, updated_by_user_id
         FROM feature_flag
         WHERE TRUE
         ORDER BY flag_key ASC`,
      );
      return { features: result.rows };
    });

    // ── PUT /api/v1/assistant/features/:key ───────────────────────────────────
    app.put("/api/v1/assistant/features/:key", {
      schema: {
        params: {
          type: "object",
          required: ["key"],
          additionalProperties: false,
          properties: {
            key: { type: "string", pattern: "^[a-z][a-z0-9_]*$" },
          },
        },
        body: {
          type: "object",
          required: ["enabled"],
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
          },
        },
      },
    }, async (request, reply) => {
      const user = getUser(request);
      if (!isAdmin(user)) return send403(reply, "FORBIDDEN", "Admin access required");

      const { key } = request.params as { key: string };
      const { enabled } = request.body as { enabled: boolean };

      const result = await queryFn(
        `UPDATE feature_flag SET enabled = $1, updated_at = now(), updated_by_user_id = $2
         WHERE flag_key = $3 AND is_archived = FALSE
         RETURNING flag_key, enabled, description, updated_at`,
        [enabled, user.userId || user.user_id, key],
      );

      if (result.rows.length === 0) {
        return sendError(reply, 404, "FLAG_NOT_FOUND", `Feature flag '${key}' not found`);
      }
      return { feature: result.rows[0] };
    });
  };
}
