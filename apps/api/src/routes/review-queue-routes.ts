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
  app.get<{
    Params: { wid: string };
    Querystring: {
      status?: string;
      entity_type?: string;
      review_category?: string;
      legal?: string;
      min_priority?: string;
      page?: string;
      limit?: string;
    };
  }>(
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
      if (request.query.review_category) {
        params.push(request.query.review_category);
        whereClause += ` AND r.review_category = $${params.length}`;
      }
      if (request.query.legal === "true") {
        whereClause += ` AND (r.review_category LIKE 'legal_kg%' OR r.details->>'domain' = 'legal_kg')`;
      }
      if (request.query.min_priority) {
        const minPriority = parseInt(request.query.min_priority, 10);
        if (!Number.isNaN(minPriority)) {
          params.push(minPriority);
          whereClause += ` AND r.priority_score >= $${params.length}`;
        }
      }

      const [countResult, result] = await Promise.all([
        queryFn(`SELECT count(*) FROM review_queue r WHERE ${whereClause}`, params),
        queryFn(
          `SELECT r.*, u.full_name as assigned_to_name
           FROM review_queue r
           LEFT JOIN user_account u ON u.user_id = r.assigned_to
           WHERE ${whereClause}
           ORDER BY r.priority_score DESC, r.created_at DESC
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

  // Legal wiki article review workflow.
  app.patch<{ Params: { wid: string; articleId: string } }>(
    "/api/v1/workspaces/:wid/legal-wiki/articles/:articleId/review",
    async (request, reply) => {
      const { wid, articleId } = request.params;
      const { status, review_note } = request.body as {
        status?: "draft" | "pending_legal_review" | "approved" | "rejected" | "deprecated";
        review_note?: string;
      };

      const allowed = new Set(["draft", "pending_legal_review", "approved", "rejected", "deprecated"]);
      if (!status || !allowed.has(status)) {
        return send400(reply, "valid status is required");
      }

      if (status === "approved") {
        const coverage = await queryFn(
          `SELECT
             count(*) FILTER (WHERE material = true)::int as material_claims,
             count(*) FILTER (
               WHERE material = true
                 AND citation_status IN ('cited','verified')
                 AND (source_chunk_id IS NOT NULL OR source_span != '{}'::jsonb)
             )::int as cited_material_claims
           FROM legal_wiki_claim
           WHERE article_id = $1 AND workspace_id = $2`,
          [articleId, wid]
        );
        const row = coverage.rows[0] || { material_claims: 0, cited_material_claims: 0 };
        if (Number(row.material_claims) === 0 || Number(row.material_claims) !== Number(row.cited_material_claims)) {
          return send400(reply, "Cannot approve wiki article until every material claim has a verified source chunk or source span");
        }
      }

      const result = await queryFn(
        `UPDATE legal_wiki_article
         SET review_status = $1,
             review_note = $2,
             reviewed_by = CASE WHEN $1 IN ('approved','rejected','deprecated') THEN $3 ELSE reviewed_by END,
             reviewed_at = CASE WHEN $1 IN ('approved','rejected','deprecated') THEN now() ELSE reviewed_at END,
             updated_at = now()
         WHERE workspace_id = $4 AND article_id = $5
         RETURNING *`,
        [status, review_note || null, request.authUser!.userId, wid, articleId]
      );

      if (result.rows.length === 0) return send404(reply, "Legal wiki article not found");

      await queryFn(
        `UPDATE review_queue
         SET status = CASE WHEN $1 IN ('approved','rejected','deprecated') THEN 'RESOLVED' ELSE status END,
             resolution = COALESCE($2, resolution),
             resolved_by = CASE WHEN $1 IN ('approved','rejected','deprecated') THEN $3 ELSE resolved_by END,
             resolved_at = CASE WHEN $1 IN ('approved','rejected','deprecated') THEN now() ELSE resolved_at END
         WHERE workspace_id = $4
           AND entity_type = 'LEGAL_WIKI_ARTICLE'
           AND entity_id = $5
           AND status IN ('OPEN','ASSIGNED')`,
        [status, review_note || null, request.authUser!.userId, wid, articleId]
      );

      return result.rows[0];
    }
  );
}
