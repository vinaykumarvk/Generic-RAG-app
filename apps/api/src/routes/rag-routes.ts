/**
 * RAG query routes — /api/v1/workspaces/:wid/query, /api/v1/workspaces/:wid/conversations
 * FR-003: Expanded filters (org_unit, case_ref, fir, language, date).
 * FR-013: Archive/reopen, pinned_filters.
 * FR-014: Retrieval mode param.
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
      const { question, conversation_id, preset, mode, skip_cache, regenerate, filters } = request.body as {
        question: string;
        conversation_id?: string;
        preset?: "concise" | "balanced" | "detailed";
        mode?: "hybrid" | "vector_only" | "metadata_only" | "graph_only";
        skip_cache?: boolean;
        regenerate?: boolean;
        filters?: {
          categories?: string[];
          document_ids?: string[];
          date_from?: string;
          date_to?: string;
          org_unit_id?: string;
          case_reference?: string;
          fir_number?: string;
          station_code?: string;
          language?: string;
          sensitivity_levels?: string[];
        };
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
            mode: mode || "hybrid",
            skipCache: skip_cache || regenerate || false,
            skipUserMessage: regenerate || false,
            userClearance: (request.authUser as { sensitivityClearance?: string })?.sensitivityClearance || "INTERNAL",
            userType: request.authUser!.userType,
            filters: filters ? {
              categories: filters.categories,
              documentIds: filters.document_ids,
              date_from: filters.date_from,
              date_to: filters.date_to,
              org_unit_id: filters.org_unit_id,
              case_reference: filters.case_reference,
              fir_number: filters.fir_number,
              station_code: filters.station_code,
              language: filters.language,
              sensitivity_levels: filters.sensitivity_levels,
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
      const { question, conversation_id, preset, mode, filters } = request.body as {
        question: string;
        conversation_id?: string;
        preset?: "concise" | "balanced" | "detailed";
        mode?: string;
        filters?: Record<string, unknown>;
      };

      if (!question) return send400(reply, "question is required");

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      reply.raw.write(`data: ${JSON.stringify({ type: "status", step: "expanding_query" })}\n\n`);

      try {
        const result = await executeRetrievalPipeline(
          { queryFn, llmProvider },
          {
            question: question.trim(),
            workspaceId: wid,
            conversationId: conversation_id,
            userId: request.authUser!.userId,
            preset: (preset || "balanced") as "concise" | "balanced" | "detailed",
            mode: (mode || "hybrid") as "hybrid" | "vector_only" | "metadata_only" | "graph_only",
            userClearance: (request.authUser as { sensitivityClearance?: string })?.sensitivityClearance || "INTERNAL",
            userType: request.authUser!.userType,
            filters: filters as PipelineFilters | undefined,
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

  // List conversations (FR-013: include is_archived filter)
  app.get<{ Params: { wid: string }; Querystring: { page?: string; limit?: string; archived?: string } }>(
    "/api/v1/workspaces/:wid/conversations",
    async (request) => {
      const { wid } = request.params;
      const userId = request.authUser!.userId;
      const page = Math.max(1, parseInt(request.query.page || "1", 10));
      const limit = Math.min(50, Math.max(1, parseInt(request.query.limit || "20", 10)));
      const offset = (page - 1) * limit;
      const showArchived = request.query.archived === "true";

      const archivedClause = showArchived ? "" : "AND is_archived = false";

      const result = await queryFn(
        `SELECT conversation_id, title, preset, message_count, is_pinned, is_archived,
                pinned_filters, created_at, updated_at
         FROM conversation
         WHERE workspace_id = $1 AND user_id = $2 ${archivedClause}
         ORDER BY is_pinned DESC NULLS LAST, updated_at DESC
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
        `SELECT m.message_id, m.role, m.content, m.retrieval_run_id, m.model_provider, m.model_id, m.latency_ms, m.created_at,
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

  app.get<{ Params: { wid: string; messageId: string } }>(
    "/api/v1/workspaces/:wid/messages/:messageId/trace",
    async (request, reply) => {
      const { wid, messageId } = request.params;

      const messageResult = await queryFn(
        `SELECT
            m.message_id,
            m.content AS answer,
            m.model_provider,
            m.model_id,
            m.latency_ms,
            m.created_at AS message_created_at,
            m.retrieval_run_id,
            rr.original_query,
            rr.expanded_intent,
            rr.step_back_question,
            rr.preset,
            rr.retrieval_mode,
            rr.inferred_filters,
            rr.vector_results_count,
            rr.lexical_results_count,
            rr.graph_results_count,
            rr.final_chunks_count,
            rr.cache_hit,
            rr.total_latency_ms,
            rr.vector_latency_ms,
            rr.lexical_latency_ms,
            rr.graph_latency_ms,
            rr.rerank_latency_ms,
            rr.generation_latency_ms,
            rr.created_at AS retrieval_created_at,
            (
              SELECT json_agg(json_build_object(
                'citation_index', c.citation_index,
                'document_title', c.document_title,
                'page_number', c.page_number,
                'excerpt', c.excerpt,
                'relevance_score', c.relevance_score
              ) ORDER BY c.citation_index)
              FROM citation c
              WHERE c.message_id = m.message_id
            ) AS citations
         FROM message m
         JOIN conversation c ON c.conversation_id = m.conversation_id
         LEFT JOIN retrieval_run rr ON rr.retrieval_run_id = m.retrieval_run_id
         WHERE m.message_id = $1 AND c.workspace_id = $2 AND c.user_id = $3`,
        [messageId, wid, request.authUser!.userId],
      );

      if (messageResult.rows.length === 0) {
        return send404(reply, "Message not found");
      }

      const messageRow = messageResult.rows[0];
      if (!messageRow.retrieval_run_id) {
        return { trace: null };
      }

      const stepResult = await queryFn(
        `SELECT step_key, step_index, title, status, latency_ms, item_count, summary, payload, created_at
         FROM retrieval_step
         WHERE retrieval_run_id = $1
         ORDER BY step_index`,
        [messageRow.retrieval_run_id],
      );

      return {
        trace: {
          message_id: messageRow.message_id,
          retrieval_run_id: messageRow.retrieval_run_id,
          question: messageRow.original_query,
          answer: messageRow.answer,
          model_provider: messageRow.model_provider,
          model_id: messageRow.model_id,
          latency_ms: messageRow.latency_ms,
          preset: messageRow.preset,
          retrieval_mode: messageRow.retrieval_mode,
          cache_hit: messageRow.cache_hit,
          expanded_intent: messageRow.expanded_intent,
          step_back_question: messageRow.step_back_question,
          inferred_filters: messageRow.inferred_filters || {},
          created_at: messageRow.retrieval_created_at,
          citations: messageRow.citations || [],
          metrics: {
            total_latency_ms: messageRow.total_latency_ms,
            vector_latency_ms: messageRow.vector_latency_ms,
            lexical_latency_ms: messageRow.lexical_latency_ms,
            graph_latency_ms: messageRow.graph_latency_ms,
            rerank_latency_ms: messageRow.rerank_latency_ms,
            generation_latency_ms: messageRow.generation_latency_ms,
            vector_results_count: messageRow.vector_results_count,
            lexical_results_count: messageRow.lexical_results_count,
            graph_results_count: messageRow.graph_results_count,
            final_chunks_count: messageRow.final_chunks_count,
          },
          steps: stepResult.rows,
        },
      };
    },
  );

  // Update conversation (title, is_pinned, pinned_filters, is_archived) — FR-013, FR-017
  app.patch<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/conversations/:id",
    async (request, reply) => {
      const { wid, id } = request.params;
      const { title, is_pinned, pinned_filters, is_archived } = request.body as {
        title?: string;
        is_pinned?: boolean;
        pinned_filters?: Record<string, unknown>;
        is_archived?: boolean;
      };

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (title !== undefined) { fields.push(`title = $${idx++}`); values.push(title); }
      if (is_pinned !== undefined) { fields.push(`is_pinned = $${idx++}`); values.push(is_pinned); }
      if (pinned_filters !== undefined) { fields.push(`pinned_filters = $${idx++}`); values.push(JSON.stringify(pinned_filters)); }
      if (is_archived !== undefined) { fields.push(`is_archived = $${idx++}`); values.push(is_archived); }

      if (fields.length === 0) return send400(reply, "No fields to update");

      fields.push("updated_at = now()");
      values.push(id, wid, request.authUser!.userId);

      const result = await queryFn(
        `UPDATE conversation SET ${fields.join(", ")}
         WHERE conversation_id = $${idx++} AND workspace_id = $${idx++} AND user_id = $${idx}
         RETURNING conversation_id, title, is_pinned, is_archived, pinned_filters`,
        values
      );

      if (result.rows.length === 0) return send404(reply, "Conversation not found");
      return result.rows[0];
    }
  );

  // Delete conversation
  app.delete<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/conversations/:id",
    async (request, reply) => {
      const { wid, id } = request.params;
      request.log.info({ wid, id, userId: request.authUser?.userId }, "DELETE_CONVERSATION_ATTEMPT");
      const result = await queryFn(
        `DELETE FROM conversation WHERE conversation_id = $1 AND workspace_id = $2 AND user_id = $3 RETURNING conversation_id`,
        [id, wid, request.authUser!.userId]
      );
      request.log.info({ rowsAffected: result.rows.length }, "DELETE_CONVERSATION_RESULT");
      if (result.rows.length === 0) return send404(reply, "Conversation not found");
      return { deleted: true };
    }
  );

  // ── Conversation Summary ──────────────────────────────────────────

  // GET summary
  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/conversations/:id/summary",
    async (request, reply) => {
      const { wid, id } = request.params;

      // Verify ownership
      const conv = await queryFn(
        "SELECT conversation_id FROM conversation WHERE conversation_id = $1 AND workspace_id = $2 AND user_id = $3",
        [id, wid, request.authUser!.userId]
      );
      if (conv.rows.length === 0) return send404(reply, "Conversation not found");

      const result = await queryFn(
        "SELECT summary_id, content, model_provider, model_id, latency_ms, token_count, created_at, updated_at FROM conversation_summary WHERE conversation_id = $1",
        [id]
      );

      return { summary: result.rows[0] || null };
    }
  );

  // POST generate summary
  app.post<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/conversations/:id/summary",
    async (request, reply) => {
      const { wid, id } = request.params;
      const { force } = (request.body as { force?: boolean }) || {};

      // Verify ownership
      const conv = await queryFn(
        "SELECT conversation_id FROM conversation WHERE conversation_id = $1 AND workspace_id = $2 AND user_id = $3",
        [id, wid, request.authUser!.userId]
      );
      if (conv.rows.length === 0) return send404(reply, "Conversation not found");

      // Check existing
      const existing = await queryFn(
        "SELECT summary_id FROM conversation_summary WHERE conversation_id = $1",
        [id]
      );
      if (existing.rows.length > 0 && !force) {
        return send400(reply, "Summary already exists. Use force=true to overwrite.");
      }

      // Fetch assistant messages
      const messages = await queryFn(
        "SELECT content FROM message WHERE conversation_id = $1 AND role = 'assistant' ORDER BY created_at",
        [id]
      );
      if (messages.rows.length === 0) {
        return send400(reply, "No messages to summarize");
      }

      const combined = messages.rows.map((r: { content: string }) => r.content).join("\n\n---\n\n");

      const start = Date.now();
      const result = await llmProvider.llmComplete({
        messages: [
          { role: "system", content: "Summarize the following conversation answers into a clear, comprehensive summary. Preserve key facts, findings, and any referenced sources." },
          { role: "user", content: combined },
        ],
        useCase: "GENERAL",
        maxTokens: 2048,
        temperature: 0.3,
      });

      if (!result) {
        return sendError(reply, 500, "LLM_ERROR", "Failed to generate summary");
      }

      const latencyMs = Date.now() - start;

      // Upsert
      await queryFn(
        `INSERT INTO conversation_summary (conversation_id, content, model_provider, model_id, latency_ms, token_count)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (conversation_id) DO UPDATE SET
           content = EXCLUDED.content,
           model_provider = EXCLUDED.model_provider,
           model_id = EXCLUDED.model_id,
           latency_ms = EXCLUDED.latency_ms,
           token_count = EXCLUDED.token_count,
           updated_at = now()
         RETURNING summary_id, content, model_provider, model_id, latency_ms, token_count, created_at, updated_at`,
        [id, result.content, result.provider, result.model, latencyMs, (result.promptTokens || 0) + (result.outputTokens || 0) || null]
      );

      const summary = await queryFn(
        "SELECT summary_id, content, model_provider, model_id, latency_ms, token_count, created_at, updated_at FROM conversation_summary WHERE conversation_id = $1",
        [id]
      );

      return { summary: summary.rows[0] };
    }
  );

  // ── Translation ───────────────────────────────────────────────────

  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/translations",
    async (request, reply) => {
      const { wid } = request.params;
      const body = request.body as { source_type?: string; source_id?: string; target_language?: string };

      if (!body.source_type || !body.source_id || !body.target_language) {
        return send400(reply, "source_type, source_id, and target_language are required");
      }

      const validTypes = ["message", "summary"];
      const validLanguages = ["te", "ur", "hi"];
      if (!validTypes.includes(body.source_type)) return send400(reply, "Invalid source_type");
      if (!validLanguages.includes(body.target_language)) return send400(reply, "Invalid target_language");

      // Check cache
      const cached = await queryFn(
        "SELECT translation_id, translated_content, model_provider, model_id FROM translation WHERE source_type = $1 AND source_id = $2 AND target_language = $3",
        [body.source_type, body.source_id, body.target_language]
      );
      if (cached.rows.length > 0) {
        return { translation: cached.rows[0], cached: true };
      }

      // Fetch source content
      let sourceContent: string | null = null;
      if (body.source_type === "message") {
        // Verify message belongs to user's conversation in this workspace
        const msg = await queryFn(
          `SELECT m.content FROM message m
           JOIN conversation c ON c.conversation_id = m.conversation_id
           WHERE m.message_id = $1 AND c.workspace_id = $2 AND c.user_id = $3`,
          [body.source_id, wid, request.authUser!.userId]
        );
        sourceContent = msg.rows[0]?.content || null;
      } else {
        const sum = await queryFn(
          `SELECT cs.content FROM conversation_summary cs
           JOIN conversation c ON c.conversation_id = cs.conversation_id
           WHERE cs.summary_id = $1 AND c.workspace_id = $2 AND c.user_id = $3`,
          [body.source_id, wid, request.authUser!.userId]
        );
        sourceContent = sum.rows[0]?.content || null;
      }

      if (!sourceContent) return send404(reply, "Source content not found");

      const langNames: Record<string, string> = { te: "Telugu", ur: "Urdu", hi: "Hindi" };
      const langName = langNames[body.target_language] || body.target_language;

      const translationModel = process.env.LLM_MODEL_TRANSLATION || undefined;
      const result = await llmProvider.llmComplete({
        messages: [
          { role: "system", content: `Translate the following text to ${langName}. Preserve formatting and structure. Return only the translation.` },
          { role: "user", content: sourceContent },
        ],
        useCase: "GENERAL",
        maxTokens: 4096,
        temperature: 0.2,
        modelOverride: translationModel,
      });

      if (!result) {
        return sendError(reply, 500, "LLM_ERROR", "Translation failed");
      }

      // Save to cache
      const insertResult = await queryFn(
        `INSERT INTO translation (source_type, source_id, target_language, translated_content, model_provider, model_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (source_type, source_id, target_language) DO UPDATE SET
           translated_content = EXCLUDED.translated_content,
           model_provider = EXCLUDED.model_provider,
           model_id = EXCLUDED.model_id
         RETURNING translation_id, translated_content, model_provider, model_id`,
        [body.source_type, body.source_id, body.target_language, result.content, result.provider, result.model]
      );

      return { translation: insertResult.rows[0], cached: false };
    }
  );
}

// Helper type for pipeline filters
type PipelineFilters = {
  categories?: string[];
  documentIds?: string[];
  date_from?: string;
  date_to?: string;
  org_unit_id?: string;
  case_reference?: string;
  fir_number?: string;
  station_code?: string;
  language?: string;
  sensitivity_levels?: string[];
};
