/**
 * RAG query routes — /api/v1/workspaces/:wid/query, /api/v1/workspaces/:wid/conversations
 */

import { FastifyInstance } from "fastify";
import { send400, send404, sendError } from "@puda/api-core";
import { logError } from "@puda/api-core";
import type { QueryFn, GetClientFn, LlmProvider } from "@puda/api-core";
import { executeRetrievalPipeline } from "../retrieval/pipeline";

export interface RagRouteDeps {
  queryFn: QueryFn;
  getClient: GetClientFn;
  llmProvider: LlmProvider;
}

export function createRagRoutes(app: FastifyInstance, deps: RagRouteDeps) {
  const { queryFn, llmProvider } = deps;

  // Query endpoint
  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/query",
    async (request, reply) => {
      const { wid } = request.params;
      const { question, conversation_id, preset, filters } = request.body as {
        question: string;
        conversation_id?: string;
        preset?: "concise" | "balanced" | "detailed";
        filters?: { categories?: string[]; document_ids?: string[] };
      };

      if (!question || question.trim().length === 0) {
        return send400(reply, "question is required");
      }

      try {
        const result = await executeRetrievalPipeline(
          { queryFn, llmProvider },
          {
            question: question.trim(),
            workspaceId: wid,
            conversationId: conversation_id,
            userId: request.authUser!.userId,
            preset: preset || "balanced",
            filters: filters ? {
              categories: filters.categories,
              documentIds: filters.document_ids,
            } : undefined,
          },
        );

        return result;
      } catch (err) {
        logError("RAG pipeline failed", { error: err instanceof Error ? err.message : String(err), workspaceId: wid });
        return sendError(reply, 500, "PIPELINE_ERROR", "Failed to process query. Please try again.");
      }
    }
  );

  // Streaming query endpoint (SSE)
  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/query/stream",
    async (request, reply) => {
      const { wid } = request.params;
      const { question, conversation_id, preset, filters } = request.body as {
        question: string;
        conversation_id?: string;
        preset?: "concise" | "balanced" | "detailed";
        filters?: { categories?: string[]; document_ids?: string[] };
      };

      if (!question) return send400(reply, "question is required");

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Send status updates as the pipeline progresses
      reply.raw.write(`data: ${JSON.stringify({ type: "status", step: "expanding_query" })}\n\n`);

      try {
        const result = await executeRetrievalPipeline(
          { queryFn, llmProvider },
          {
            question: question.trim(),
            workspaceId: wid,
            conversationId: conversation_id,
            userId: request.authUser!.userId,
            preset: preset || "balanced",
            filters: filters ? {
              categories: filters.categories,
              documentIds: filters.document_ids,
            } : undefined,
          },
        );

        reply.raw.write(`data: ${JSON.stringify({ type: "answer", ...result })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      } catch (err) {
        reply.raw.write(`data: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "Pipeline failed" })}\n\n`);
      }

      reply.raw.end();
    }
  );

  // List conversations
  app.get<{ Params: { wid: string }; Querystring: { page?: string; limit?: string } }>(
    "/api/v1/workspaces/:wid/conversations",
    async (request) => {
      const { wid } = request.params;
      const userId = request.authUser!.userId;
      const page = Math.max(1, parseInt(request.query.page || "1", 10));
      const limit = Math.min(50, Math.max(1, parseInt(request.query.limit || "20", 10)));
      const offset = (page - 1) * limit;

      const result = await queryFn(
        `SELECT conversation_id, title, preset, message_count, created_at, updated_at
         FROM conversation
         WHERE workspace_id = $1 AND user_id = $2
         ORDER BY updated_at DESC
         LIMIT $3 OFFSET $4`,
        [wid, userId, limit, offset]
      );

      return { conversations: result.rows, page, limit };
    }
  );

  // Get conversation with messages
  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/conversations/:id",
    async (request, reply) => {
      const { wid, id } = request.params;

      const convResult = await queryFn(
        `SELECT * FROM conversation WHERE conversation_id = $1 AND workspace_id = $2 AND user_id = $3`,
        [id, wid, request.authUser!.userId]
      );
      if (convResult.rows.length === 0) return send404(reply, "Conversation not found");

      const messagesResult = await queryFn(
        `SELECT m.message_id, m.role, m.content, m.model_provider, m.latency_ms, m.created_at,
                (SELECT json_agg(json_build_object(
                  'citation_index', c.citation_index,
                  'document_title', c.document_title,
                  'page_number', c.page_number,
                  'excerpt', c.excerpt,
                  'relevance_score', c.relevance_score
                ) ORDER BY c.citation_index)
                FROM citation c WHERE c.message_id = m.message_id) as citations
         FROM message m
         WHERE m.conversation_id = $1
         ORDER BY m.created_at`,
        [id]
      );

      return {
        ...convResult.rows[0],
        messages: messagesResult.rows,
      };
    }
  );

  // Delete conversation
  app.delete<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/conversations/:id",
    async (request, reply) => {
      const { wid, id } = request.params;
      const result = await queryFn(
        `DELETE FROM conversation WHERE conversation_id = $1 AND workspace_id = $2 AND user_id = $3 RETURNING conversation_id`,
        [id, wid, request.authUser!.userId]
      );
      if (result.rows.length === 0) return send404(reply, "Conversation not found");
      return { deleted: true };
    }
  );
}
