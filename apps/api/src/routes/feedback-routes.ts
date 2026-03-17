/**
 * Feedback routes — /api/v1/workspaces/:wid/feedback
 */

import { FastifyInstance } from "fastify";
import { send400 } from "@puda/api-core";
import type { QueryFn } from "@puda/api-core";

export function createFeedbackRoutes(app: FastifyInstance, deps: { queryFn: QueryFn }) {
  const { queryFn } = deps;

  // Submit feedback
  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/feedback",
    async (request, reply) => {
      const { wid } = request.params;
      const { message_id, feedback_type, rating, comment, correction } = request.body as {
        message_id: string; feedback_type: string; rating?: number; comment?: string; correction?: string;
      };

      if (!message_id || !feedback_type) return send400(reply, "message_id and feedback_type are required");

      // Get conversation_id from message
      const msgResult = await queryFn("SELECT conversation_id FROM message WHERE message_id = $1", [message_id]);
      if (msgResult.rows.length === 0) return send400(reply, "Message not found");

      const result = await queryFn(
        `INSERT INTO feedback (message_id, conversation_id, workspace_id, user_id, feedback_type, rating, comment, correction)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [message_id, msgResult.rows[0].conversation_id, wid, request.authUser!.userId,
         feedback_type, rating || null, comment || null, correction || null]
      );

      reply.code(201);
      return result.rows[0];
    }
  );

  // List feedback
  app.get<{ Params: { wid: string }; Querystring: { type?: string; page?: string; limit?: string } }>(
    "/api/v1/workspaces/:wid/feedback",
    async (request) => {
      const { wid } = request.params;
      const { type } = request.query;
      const page = Math.max(1, parseInt(request.query.page || "1", 10));
      const limit = Math.min(50, parseInt(request.query.limit || "20", 10));
      const offset = (page - 1) * limit;

      let whereClause = "f.workspace_id = $1";
      const params: unknown[] = [wid];

      if (type) {
        params.push(type);
        whereClause += ` AND f.feedback_type = $${params.length}`;
      }

      params.push(limit, offset);
      const result = await queryFn(
        `SELECT f.*, m.content as message_content, u.full_name as user_name
         FROM feedback f
         JOIN message m ON m.message_id = f.message_id
         JOIN user_account u ON u.user_id = f.user_id
         WHERE ${whereClause}
         ORDER BY f.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      return { feedback: result.rows, page, limit };
    }
  );
}
