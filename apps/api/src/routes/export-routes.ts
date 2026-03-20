/**
 * Export routes — export conversations as PDF/DOCX/CSV/JSON.
 * FR-022: User identification, audit trail, masking, stale version detection.
 */

import { FastifyInstance } from "fastify";
import { send400, send404 } from "@puda/api-core";
import type { QueryFn } from "@puda/api-core";
import { applyMasking } from "../util/masking";

interface ExportMessage {
  message_id: string;
  role: string;
  content: string;
  created_at: string;
  citations: Array<{ citation_index: number; document_title: string; page_number: number; excerpt: string; version_id: string | null }> | null;
}

export function createExportRoutes(app: FastifyInstance, deps: { queryFn: QueryFn }) {
  const { queryFn } = deps;

  // Export conversation
  app.get<{ Params: { wid: string; id: string }; Querystring: { format?: string } }>(
    "/api/v1/workspaces/:wid/conversations/:id/export",
    async (request, reply) => {
      const { wid, id } = request.params;
      const format = request.query.format || "json";
      const userId = request.authUser!.userId;
      const userType = request.authUser!.userType;

      const convResult = await queryFn(
        "SELECT * FROM conversation WHERE conversation_id = $1 AND workspace_id = $2",
        [id, wid]
      );
      if (convResult.rows.length === 0) return send404(reply, "Conversation not found");

      const messagesResult = await queryFn(
        `SELECT m.message_id, m.role, m.content, m.created_at,
                (SELECT json_agg(json_build_object(
                  'citation_index', c.citation_index,
                  'document_title', c.document_title,
                  'page_number', c.page_number,
                  'excerpt', c.excerpt,
                  'version_id', c.version_id
                ) ORDER BY c.citation_index)
                FROM citation c WHERE c.message_id = m.message_id) as citations
         FROM message m WHERE m.conversation_id = $1 ORDER BY m.created_at`,
        [id]
      );

      // FR-022: Apply masking for restricted content
      const userClearance = (request.authUser as { sensitivityClearance?: string })?.sensitivityClearance || "INTERNAL";
      const needsMasking = userClearance === "PUBLIC" || userClearance === "INTERNAL";

      const messages: ExportMessage[] = messagesResult.rows.map((msg: Record<string, unknown>) => {
        const content = needsMasking ? applyMasking(msg.content as string) : (msg.content as string);
        return {
          message_id: msg.message_id as string,
          role: msg.role as string,
          content,
          created_at: msg.created_at as string,
          citations: msg.citations as ExportMessage["citations"],
        };
      });

      // FR-022: Stale version detection
      const staleWarnings: string[] = [];
      for (const msg of messages) {
        if (msg.citations) {
          for (const cit of msg.citations) {
            if (cit.version_id) {
              const versionCheck = await queryFn(
                "SELECT is_current FROM document_version WHERE version_id = $1",
                [cit.version_id]
              );
              if (versionCheck.rows.length > 0 && !versionCheck.rows[0].is_current) {
                staleWarnings.push(`Citation "${cit.document_title}" references a superseded document version`);
              }
            }
          }
        }
      }

      // FR-022: Audit log export event
      await queryFn(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, workspace_id, details, event_subtype)
         VALUES ($1, 'conversation.export', 'conversation', $2, $3, $4, 'EXPORT')`,
        [userId, id, wid, JSON.stringify({ format, message_count: messages.length })]
      );

      // FR-022: User identification in export
      const userResult = await queryFn(
        "SELECT full_name, email FROM user_account WHERE user_id = $1",
        [userId]
      );
      const exportedBy = userResult.rows[0] || { full_name: "Unknown", email: "" };

      const exportData = {
        conversation: convResult.rows[0],
        messages,
        exported_at: new Date().toISOString(),
        exported_by: { name: exportedBy.full_name, email: exportedBy.email },
        watermark: "Confidential - Internal Use Only",
        stale_warnings: staleWarnings.length > 0 ? staleWarnings : undefined,
      };

      if (format === "csv") {
        reply.header("Content-Type", "text/csv");
        reply.header("Content-Disposition", `attachment; filename="conversation_${id}.csv"`);

        const headers = ["role", "content", "created_at", "citations"];
        const rows = [headers.join(",")];
        for (const msg of messages) {
          const citStr = msg.citations
            ? msg.citations.map((c) => c.document_title).join("; ")
            : "";
          rows.push([
            JSON.stringify(msg.role),
            JSON.stringify(String(msg.content).substring(0, 5000)),
            JSON.stringify(msg.created_at),
            JSON.stringify(citStr),
          ].join(","));
        }
        return rows.join("\n");
      }

      if (format === "json") {
        return exportData;
      }

      return send400(reply, `Unsupported export format: ${format}. Use 'json' or 'csv'.`);
    }
  );

  // FR-022: Clipboard audit beacon
  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/export/clipboard-audit",
    async (request) => {
      const { wid } = request.params;
      const { message_id, content_preview } = request.body as {
        message_id?: string;
        content_preview?: string;
      };

      await queryFn(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, workspace_id, details, event_subtype)
         VALUES ($1, 'content.copy', 'message', $2, $3, $4, 'EXPORT')`,
        [
          request.authUser!.userId,
          message_id || null,
          wid,
          JSON.stringify({ preview: (content_preview || "").substring(0, 100) }),
        ]
      );

      return { logged: true };
    }
  );
}
