/**
 * Feedback routes — /api/v1/workspaces/:wid/feedback
 * FR-019: Three-level feedback, structured issue_tags, admin resolve workflow.
 */

import { FastifyInstance } from "fastify";
import { send400, send404, sendError } from "@puda/api-core";
import type { QueryFn } from "@puda/api-core";

export function createFeedbackRoutes(app: FastifyInstance, deps: { queryFn: QueryFn }) {
  const { queryFn } = deps;

  // Submit feedback (FR-019: 3-level + issue_tags)
  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/feedback",
    async (request, reply) => {
      const { wid } = request.params;
      const { message_id, feedback_level, feedback_type, feedback_text, issue_tags, comment, correction } = request.body as {
        message_id: string;
        feedback_level?: "HELPFUL" | "PARTIALLY_HELPFUL" | "NOT_HELPFUL";
        feedback_type?: string;
        feedback_text?: string;
        issue_tags?: string[];
        comment?: string;
        correction?: string;
      };

      if (!message_id) return send400(reply, "message_id is required");

      // Get conversation_id from message
      const msgResult = await queryFn("SELECT conversation_id FROM message WHERE message_id = $1", [message_id]);
      if (msgResult.rows.length === 0) return send400(reply, "Message not found");

      // Validate issue_tags if provided
      if (issue_tags && issue_tags.length > 10) {
        return send400(reply, "Maximum 10 issue tags allowed");
      }

      const validLevels = ["HELPFUL", "PARTIALLY_HELPFUL", "NOT_HELPFUL"];
      const level = feedback_level && validLevels.includes(feedback_level) ? feedback_level : null;

      const result = await queryFn(
        `INSERT INTO feedback (message_id, conversation_id, workspace_id, user_id,
         feedback_type, feedback_level, comment, correction, issue_tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          message_id, msgResult.rows[0].conversation_id, wid, request.authUser!.userId,
          feedback_type || (level ? level : "TEXT"),
          level,
          comment || feedback_text || null,
          correction || null,
          issue_tags && issue_tags.length > 0 ? issue_tags : null,
        ]
      );

      reply.code(201);
      return result.rows[0];
    }
  );

  // List feedback (FR-019: filter by level, visibility controls)
  app.get<{ Params: { wid: string }; Querystring: { type?: string; level?: string; status?: string; page?: string; limit?: string } }>(
    "/api/v1/workspaces/:wid/feedback",
    async (request) => {
      const { wid } = request.params;
      const { type, level, status } = request.query;
      const page = Math.max(1, parseInt(request.query.page || "1", 10));
      const limit = Math.min(50, parseInt(request.query.limit || "20", 10));
      const offset = (page - 1) * limit;

      // FR-019: Visibility — admin sees all, others see only own feedback
      let whereClause = "f.workspace_id = $1";
      const params: unknown[] = [wid];

      if (request.authUser?.userType !== "ADMIN") {
        params.push(request.authUser!.userId);
        whereClause += ` AND f.user_id = $${params.length}`;
      }

      if (type) {
        params.push(type);
        whereClause += ` AND f.feedback_type = $${params.length}`;
      }

      if (level) {
        params.push(level);
        whereClause += ` AND f.feedback_level = $${params.length}`;
      }

      if (status === "unresolved") {
        whereClause += " AND f.resolved_at IS NULL";
      } else if (status === "resolved") {
        whereClause += " AND f.resolved_at IS NOT NULL";
      }

      const [countResult, result] = await Promise.all([
        queryFn(`SELECT count(*) FROM feedback f WHERE ${whereClause}`, params),
        queryFn(
          `SELECT f.*, m.content as message_content, u.full_name as user_name
           FROM feedback f
           JOIN message m ON m.message_id = f.message_id
           JOIN user_account u ON u.user_id = f.user_id
           WHERE ${whereClause}
           ORDER BY f.created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        ),
      ]);

      return {
        feedback: result.rows,
        total: parseInt(countResult.rows[0].count, 10),
        page,
        limit,
      };
    }
  );

  // FR-019: Admin resolve feedback
  app.patch<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/feedback/:id",
    async (request, reply) => {
      if (request.authUser?.userType !== "ADMIN") {
        return sendError(reply, 403, "FORBIDDEN", "Admin access required");
      }

      const { wid, id } = request.params;
      const { admin_notes, status } = request.body as {
        admin_notes?: string;
        status?: "resolved" | "dismissed";
      };

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (admin_notes !== undefined) {
        fields.push(`admin_notes = $${idx++}`);
        values.push(admin_notes);
      }

      if (status === "resolved" || status === "dismissed") {
        fields.push(`resolved_at = now()`);
        fields.push(`resolved_by = $${idx++}`);
        values.push(request.authUser!.userId);
      }

      if (fields.length === 0) return send400(reply, "No fields to update");

      values.push(id, wid);
      const result = await queryFn(
        `UPDATE feedback SET ${fields.join(", ")}
         WHERE feedback_id = $${idx++} AND workspace_id = $${idx}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) return send404(reply, "Feedback not found");
      return result.rows[0];
    }
  );

  // FR-019: Feedback stats/trends for admin
  app.get<{ Params: { wid: string }; Querystring: { days?: string } }>(
    "/api/v1/workspaces/:wid/feedback/stats",
    async (request, reply) => {
      if (request.authUser?.userType !== "ADMIN") {
        return sendError(reply, 403, "FORBIDDEN", "Admin access required");
      }

      const { wid } = request.params;
      const days = Math.min(90, Math.max(1, parseInt(request.query.days || "30", 10)));

      const [levelStats, tagStats, trendStats] = await Promise.all([
        queryFn(
          `SELECT feedback_level, count(*)::int as count
           FROM feedback WHERE workspace_id = $1 AND created_at > now() - $2::int * interval '1 day'
           GROUP BY feedback_level`,
          [wid, days]
        ),
        queryFn(
          `SELECT unnest(issue_tags) as tag, count(*)::int as count
           FROM feedback WHERE workspace_id = $1 AND issue_tags IS NOT NULL
             AND created_at > now() - $2::int * interval '1 day'
           GROUP BY tag ORDER BY count DESC LIMIT 20`,
          [wid, days]
        ),
        queryFn(
          `SELECT date_trunc('day', created_at)::date as day, feedback_level, count(*)::int as count
           FROM feedback WHERE workspace_id = $1 AND created_at > now() - $2::int * interval '1 day'
           GROUP BY day, feedback_level ORDER BY day`,
          [wid, days]
        ),
      ]);

      return {
        period_days: days,
        by_level: levelStats.rows,
        top_tags: tagStats.rows,
        daily_trend: trendStats.rows,
      };
    }
  );
}
