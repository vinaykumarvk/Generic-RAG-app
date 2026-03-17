/**
 * Export routes — export conversations as PDF/DOCX.
 * Reuses @puda/api-integrations PDF/DOCX generators.
 */

import { FastifyInstance } from "fastify";
import { send404 } from "@puda/api-core";
import type { QueryFn } from "@puda/api-core";

export function createExportRoutes(app: FastifyInstance, deps: { queryFn: QueryFn }) {
  const { queryFn } = deps;

  // Export conversation as JSON (PDF/DOCX via api-integrations can be added later)
  app.get<{ Params: { wid: string; id: string }; Querystring: { format?: string } }>(
    "/api/v1/workspaces/:wid/conversations/:id/export",
    async (request, reply) => {
      const { wid, id } = request.params;
      const format = request.query.format || "json";

      const convResult = await queryFn(
        "SELECT * FROM conversation WHERE conversation_id = $1 AND workspace_id = $2",
        [id, wid]
      );
      if (convResult.rows.length === 0) return send404(reply, "Conversation not found");

      const messagesResult = await queryFn(
        `SELECT m.role, m.content, m.created_at,
                (SELECT json_agg(json_build_object(
                  'document_title', c.document_title,
                  'page_number', c.page_number,
                  'excerpt', c.excerpt
                ) ORDER BY c.citation_index)
                FROM citation c WHERE c.message_id = m.message_id) as citations
         FROM message m WHERE m.conversation_id = $1 ORDER BY m.created_at`,
        [id]
      );

      if (format === "json") {
        return {
          conversation: convResult.rows[0],
          messages: messagesResult.rows,
          exported_at: new Date().toISOString(),
        };
      }

      // For PDF/DOCX, integrate with @puda/api-integrations generators
      return send404(reply, `Export format '${format}' not yet implemented. Use 'json'.`);
    }
  );
}
