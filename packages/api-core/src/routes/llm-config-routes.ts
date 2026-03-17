/**
 * LLM Config Routes — provider config + system prompt management.
 *
 * GET/POST /api/v1/assistant/llm/providers — CRUD for provider configs
 * POST     /api/v1/assistant/llm/test      — test provider connection
 * GET/PUT  /api/v1/assistant/llm/prompts   — system prompt management
 */

import { FastifyInstance } from "fastify";
import type { QueryFn } from "../types";
import type { LlmProvider, LlmProviderConfig } from "../llm/llm-provider";
import { sendError, send403 } from "../errors";

export interface LlmConfigRouteDeps {
  queryFn: QueryFn;
  llmProvider: LlmProvider;
  adminRoles?: string[];
  /** Extract user from request (varies by app — authUser, user, etc.) */
  getUser?: (request: any) => any;
}

export function createLlmConfigRoutes(deps: LlmConfigRouteDeps) {
  const { queryFn, llmProvider, adminRoles = ["ADMIN", "SUPER_ADMIN", "SYSTEM_ADMIN"], getUser = (r: any) => r.authUser || r.user } = deps;

  function isAdmin(user: any): boolean {
    if (!user) return false;
    if (user.roles?.length) {
      return user.roles.some((r: string) => adminRoles.includes(r));
    }
    if (user.postings?.length) {
      return user.postings.some((p: any) => {
        const roles = p.system_role_ids || (p.role_key ? [p.role_key] : []);
        return roles.some((r: string) => adminRoles.includes(r));
      });
    }
    if (user.userType === "ADMIN") return true;
    return false;
  }

  return async function registerLlmConfigRoutes(app: FastifyInstance): Promise<void> {
    // ── GET /api/v1/assistant/llm/providers ───────────────────────────────────
    app.get("/api/v1/assistant/llm/providers", {
      config: { skipStrictReadSchema: true },
    }, async (request, reply) => {
      const user = getUser(request);
      if (!isAdmin(user)) return send403(reply, "FORBIDDEN", "Admin access required");

      const result = await queryFn(
        `SELECT config_id, provider, display_name, api_base_url, model_id,
                is_active, is_default, max_tokens, temperature, timeout_ms, max_retries,
                created_at, updated_at
         FROM llm_provider_config
         ORDER BY is_default DESC, provider ASC`,
      );
      // Never return api_key_enc
      return { providers: result.rows };
    });

    // ── POST /api/v1/assistant/llm/providers ──────────────────────────────────
    app.post("/api/v1/assistant/llm/providers", {
      schema: {
        body: {
          type: "object",
          required: ["provider", "displayName", "apiBaseUrl", "modelId"],
          additionalProperties: false,
          properties: {
            provider: { type: "string", enum: ["openai", "claude", "gemini", "ollama"] },
            displayName: { type: "string", minLength: 1, maxLength: 100 },
            apiBaseUrl: { type: "string", minLength: 1, maxLength: 500 },
            apiKeyEnc: { type: "string", maxLength: 500 },
            modelId: { type: "string", minLength: 1, maxLength: 100 },
            isActive: { type: "boolean" },
            isDefault: { type: "boolean" },
            maxTokens: { type: "integer", minimum: 1, maximum: 32768 },
            temperature: { type: "number", minimum: 0, maximum: 2 },
            timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
            maxRetries: { type: "integer", minimum: 0, maximum: 5 },
          },
        },
      },
    }, async (request, reply) => {
      const user = getUser(request);
      if (!isAdmin(user)) return send403(reply, "FORBIDDEN", "Admin access required");

      const body = request.body as {
        provider: string; displayName: string; apiBaseUrl: string;
        apiKeyEnc?: string; modelId: string; isActive?: boolean; isDefault?: boolean;
        maxTokens?: number; temperature?: number; timeoutMs?: number; maxRetries?: number;
      };

      // If setting as default, unset existing default
      if (body.isDefault) {
        await queryFn(`UPDATE llm_provider_config SET is_default = FALSE WHERE is_default = TRUE`);
      }

      const result = await queryFn(
        `INSERT INTO llm_provider_config
           (provider, display_name, api_base_url, api_key_enc, model_id,
            is_active, is_default, max_tokens, temperature, timeout_ms, max_retries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING config_id, provider, display_name, model_id, is_active, is_default`,
        [
          body.provider, body.displayName, body.apiBaseUrl,
          body.apiKeyEnc || null, body.modelId,
          body.isActive ?? true, body.isDefault ?? false,
          body.maxTokens ?? 2048, body.temperature ?? 0.3,
          body.timeoutMs ?? 30000, body.maxRetries ?? 2,
        ],
      );

      llmProvider.invalidateProviderCache();
      reply.code(201);
      return { provider: result.rows[0] };
    });

    // ── POST /api/v1/assistant/llm/test ───────────────────────────────────────
    app.post("/api/v1/assistant/llm/test", {
      schema: {
        body: {
          type: "object",
          required: ["provider", "apiBaseUrl", "modelId"],
          additionalProperties: false,
          properties: {
            provider: { type: "string", enum: ["openai", "claude", "gemini", "ollama"] },
            apiBaseUrl: { type: "string" },
            apiKeyEnc: { type: "string" },
            modelId: { type: "string" },
            timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
          },
        },
      },
    }, async (request, reply) => {
      const user = getUser(request);
      if (!isAdmin(user)) return send403(reply, "FORBIDDEN", "Admin access required");

      const body = request.body as {
        provider: string; apiBaseUrl: string; apiKeyEnc?: string;
        modelId: string; timeoutMs?: number;
      };

      const testConfig: LlmProviderConfig = {
        config_id: "test",
        provider: body.provider,
        display_name: "Test",
        api_base_url: body.apiBaseUrl,
        api_key_enc: body.apiKeyEnc || null,
        model_id: body.modelId,
        is_active: true,
        is_default: false,
        max_tokens: 5,
        temperature: 0,
        timeout_ms: body.timeoutMs || 15000,
        max_retries: 0,
        config_jsonb: {},
      };

      const result = await llmProvider.testProvider(testConfig);
      return result;
    });

    // ── GET /api/v1/assistant/llm/prompts ─────────────────────────────────────
    app.get("/api/v1/assistant/llm/prompts", {
      config: { skipStrictReadSchema: true },
    }, async (request, reply) => {
      const user = getUser(request);
      if (!isAdmin(user)) return send403(reply, "FORBIDDEN", "Admin access required");

      const result = await queryFn(
        `SELECT prompt_id, use_case, prompt_text, version, is_active, created_at, updated_at
         FROM llm_system_prompt
         ORDER BY use_case ASC, version DESC`,
      );
      return { prompts: result.rows };
    });

    // ── PUT /api/v1/assistant/llm/prompts ─────────────────────────────────────
    app.put("/api/v1/assistant/llm/prompts", {
      schema: {
        body: {
          type: "object",
          required: ["useCase", "promptText"],
          additionalProperties: false,
          properties: {
            useCase: { type: "string", maxLength: 50 },
            promptText: { type: "string", minLength: 1, maxLength: 10000 },
          },
        },
      },
    }, async (request, reply) => {
      const user = getUser(request);
      if (!isAdmin(user)) return send403(reply, "FORBIDDEN", "Admin access required");

      const { useCase, promptText } = request.body as { useCase: string; promptText: string };

      // Deactivate existing prompts for this use case
      await queryFn(
        `UPDATE llm_system_prompt SET is_active = FALSE WHERE use_case = $1`,
        [useCase],
      );

      // Insert new version
      const result = await queryFn(
        `INSERT INTO llm_system_prompt (use_case, prompt_text, version, is_active)
         VALUES ($1, $2, COALESCE((SELECT MAX(version) FROM llm_system_prompt WHERE use_case = $1), 0) + 1, TRUE)
         RETURNING prompt_id, use_case, version, is_active`,
        [useCase, promptText],
      );

      return { prompt: result.rows[0] };
    });
  };
}
