/**
 * Page Agent Routes — LLM proxy + audit logging for browser-based page agent.
 *
 * POST /api/v1/page-agent/complete — proxy LLM call (keeps API key server-side)
 * POST /api/v1/page-agent/audit    — log agent actions from frontend
 */

import { FastifyInstance } from "fastify";
import type { QueryFn } from "../types";
import type { LlmProvider } from "../llm/llm-provider";
import { sendError } from "../errors";
import { logWarn } from "../logging/logger";

export interface PageAgentRouteDeps {
  queryFn: QueryFn;
  llmProvider: LlmProvider;
  /** Extract user from request (varies by app — authUser, user, etc.) */
  getUser?: (request: any) => any;
}

export function createPageAgentRoutes(deps: PageAgentRouteDeps) {
  const { queryFn, llmProvider, getUser = (r: any) => r.authUser || r.user } = deps;

  return async function registerPageAgentRoutes(app: FastifyInstance): Promise<void> {
    // ── POST /api/v1/page-agent/complete ───────────────────────────────────
    // Proxies LLM calls so the API key never reaches the browser.
    app.post("/api/v1/page-agent/complete", {
      schema: {
        body: {
          type: "object",
          required: ["messages"],
          additionalProperties: false,
          properties: {
            messages: {
              type: "array",
              items: {
                type: "object",
                required: ["role", "content"],
                additionalProperties: false,
                properties: {
                  role: { type: "string", enum: ["system", "user", "assistant"] },
                  content: { type: "string" },
                },
              },
            },
            maxTokens: { type: "integer", minimum: 1, maximum: 4096 },
            temperature: { type: "number", minimum: 0, maximum: 2 },
          },
        },
      },
    }, async (request, reply) => {
      const user = getUser(request);
      if (!user) return sendError(reply, 401, "UNAUTHORIZED", "Authentication required");

      const { messages, maxTokens, temperature } = request.body as {
        messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
        maxTokens?: number;
        temperature?: number;
      };

      const result = await llmProvider.llmComplete({
        messages,
        maxTokens: maxTokens || 1024,
        temperature: temperature ?? 0.2,
        useCase: "PAGE_AGENT",
      });

      if (!result) {
        return sendError(reply, 503, "LLM_UNAVAILABLE", "LLM provider is not available");
      }

      return {
        content: result.content,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
      };
    });

    // ── POST /api/v1/page-agent/audit ──────────────────────────────────────
    // Logs page-agent actions for compliance/audit trail.
    app.post("/api/v1/page-agent/audit", {
      schema: {
        body: {
          type: "object",
          required: ["actionType", "instruction"],
          additionalProperties: false,
          properties: {
            actionType: { type: "string", maxLength: 100 },
            instruction: { type: "string", maxLength: 2000 },
            targetSelector: { type: "string", maxLength: 500 },
            wasBlocked: { type: "boolean" },
            userConfirmed: { type: "boolean" },
            pageUrl: { type: "string", maxLength: 2000 },
            metadata: { type: "object", additionalProperties: true },
          },
        },
      },
    }, async (request, reply) => {
      const user = getUser(request);
      if (!user) return sendError(reply, 401, "UNAUTHORIZED", "Authentication required");

      const body = request.body as {
        actionType: string;
        instruction: string;
        targetSelector?: string;
        wasBlocked?: boolean;
        userConfirmed?: boolean;
        pageUrl?: string;
        metadata?: Record<string, unknown>;
      };

      queryFn(
        `INSERT INTO page_agent_audit_log
           (user_id, action_type, instruction, target_selector, was_blocked, user_confirmed, page_url, metadata_jsonb, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [
          user.userId || user.user_id,
          body.actionType,
          body.instruction,
          body.targetSelector || null,
          body.wasBlocked ?? false,
          body.userConfirmed ?? false,
          body.pageUrl || null,
          body.metadata ? JSON.stringify(body.metadata) : null,
        ],
      ).catch((err) => logWarn("Page agent audit log write failed", { error: String(err) }));

      return { ok: true };
    });
  };
}
