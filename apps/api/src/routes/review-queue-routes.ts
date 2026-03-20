/**
 * Review Queue routes — /api/v1/workspaces/:wid/reviews (FR-011, FR-012)
 * CRUD for review queue items (OCR review, metadata review, graph conflict review).
 */

import { FastifyInstance } from "fastify";
import { send400, send404, sendError } from "@puda/api-core";
import type { QueryFn } from "@puda/api-core";

export function createReviewQueueRoutes(app: FastifyInstance, deps: { queryFn: QueryFn }) {
  const { queryFn } = deps;

  // List review items
  app.get<{ Params: { wid: string }; Querystring: { status?: string; entity_type?: string; page?: string; limit?: string } }>(
    "/api/v1/workspaces/:wid/reviews",
    async (request) => {
      const { wid } = request.params;
      const page = Math.max(1, parseInt(request.query.page || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || "20", 10)));
      const offset = (page - 1) * limit;

      let whereClause = "r.workspace_id = $1";
      const params: unknown[] = [wid];

      if (request.query.status) {
        params.push(request.query.status);
        whereClause += ` AND r.status = $${params.length}`;
      }
      if (request.query.entity_type) {
        params.push(request.query.entity_type);
        whereClause += ` AND r.entity_type = $${params.length}`;
      }

      const [countResult, result] = await Promise.all([
        queryFn(`SELECT count(*) FROM review_queue r WHERE ${whereClause}`, params),
        queryFn(
          `SELECT r.*, u.full_name as assigned_to_name
           FROM review_queue r
           LEFT JOIN user_account u ON u.user_id = r.assigned_to
           WHERE ${whereClause}
           ORDER BY r.created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        ),
      ]);

      return {
        reviews: result.rows,
        total: parseInt(countResult.rows[0].count, 10),
        page,
        limit,
      };
    }
  );

  // Assign review item
  app.patch<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/reviews/:id/assign",
    async (request, reply) => {
      const { wid, id } = request.params;
      const userId = request.authUser!.userId;

      const result = await queryFn(
        `UPDATE review_queue SET assigned_to = $1, status = 'ASSIGNED', resolved_at = NULL
         WHERE review_id = $2 AND workspace_id = $3 AND status = 'OPEN'
         RETURNING *`,
        [userId, id, wid]
      );

      if (result.rows.length === 0) return send404(reply, "Review item not found or already assigned");
      return result.rows[0];
    }
  );

  // Resolve review item
  app.patch<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/reviews/:id/resolve",
    async (request, reply) => {
      const { wid, id } = request.params;
      const { resolution, status } = request.body as { resolution?: string; status?: string };

      if (!resolution) return send400(reply, "resolution is required");
      const resolveStatus = status === "DISMISSED" ? "DISMISSED" : "RESOLVED";

      const result = await queryFn(
        `UPDATE review_queue SET status = $1, resolution = $2, resolved_by = $3, resolved_at = now()
         WHERE review_id = $4 AND workspace_id = $5 AND status IN ('OPEN', 'ASSIGNED')
         RETURNING *`,
        [resolveStatus, resolution, request.authUser!.userId, id, wid]
      );

      if (result.rows.length === 0) return send404(reply, "Review item not found or already resolved");
      return result.rows[0];
    }
  );
}
