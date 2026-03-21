/**
 * Provider-agnostic LLM integration layer (extracted from social-media-api).
 *
 * Supports OpenAI, Claude, Gemini, and Ollama with:
 * - Adapter pattern for each provider's API differences
 * - DB-backed config with env-var fallback
 * - Resilient fetch: timeout, retry, per-host circuit breaker
 * - Fire-and-forget prediction logging
 *
 * Dependency-injected queryFn instead of direct DB import.
 */

import { logInfo, logWarn, logError } from "../logging/logger";
import type { QueryFn } from "../types";

// ── Model Routing ────────────────────────────────────────────────────────────

/** Model routing: maps use cases/presets to specific models via env vars */
export interface ModelRoutingConfig {
  [useCase: string]: {
    concise?: string;
    balanced?: string;
    detailed?: string;
  };
}

/** Valid retrieval preset names */
export type RetrievalPreset = "concise" | "balanced" | "detailed";

/**
 * Read model routing from environment variables.
 * Pattern: LLM_MODEL_{PRESET} for global routing,
 *          LLM_MODEL_{USECASE}_{PRESET} for per-use-case routing.
 */
function loadModelRoutingConfig(): ModelRoutingConfig {
  const presets: RetrievalPreset[] = ["concise", "balanced", "detailed"];
  const config: ModelRoutingConfig = {};

  // Global routing: LLM_MODEL_CONCISE, LLM_MODEL_BALANCED, LLM_MODEL_DETAILED
  const globalEntry: ModelRoutingConfig["_global"] = {};
  for (const preset of presets) {
    const envVal = process.env[`LLM_MODEL_${preset.toUpperCase()}`];
    if (envVal) {
      globalEntry[preset] = envVal;
    }
  }
  if (Object.keys(globalEntry).length > 0) {
    config._global = globalEntry;
  }

  return config;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type LlmUseCase =
  | "CLASSIFICATION"
  | "TRANSLATION"
  | "NARCOTICS_ANALYSIS"
  | "RISK_NARRATIVE"
  | "INVESTIGATION_SUMMARY"
  | "CASE_SUMMARY"
  | "LEGAL_REFERENCES"
  | "FINAL_SUBMISSION"
  | "NL_QUERY"
  | "PAGE_AGENT"
  // RAG-specific use cases
  | "EMBEDDING"
  | "CHUNK_SUMMARY"
  | "KG_EXTRACTION"
  | "QUERY_EXPANSION"
  | "ENTITY_DETECTION"
  | "RERANK"
  | "ANSWER_GENERATION"
  | "DOCUMENT_CLASSIFY"
  | "OCR_CORRECTION"
  | "GENERAL";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  useCase?: LlmUseCase;
  entityType?: string;
  entityId?: string;
  /** When true, inject JSON-output instruction into messages */
  jsonMode?: boolean;
  /** Override the default model for this request (e.g. per-preset answer generation) */
  modelOverride?: string;
}

export interface LlmCompletionResponse {
  content: string;
  provider: string;
  model: string;
  promptTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs: number;
  fallbackUsed: boolean;
}

export interface LlmProviderConfig {
  config_id: string;
  provider: string;
  display_name: string;
  api_base_url: string;
  api_key_enc: string | null;
  model_id: string;
  is_active: boolean;
  is_default: boolean;
  max_tokens: number;
  temperature: number;
  timeout_ms: number;
  max_retries: number;
  config_jsonb: Record<string, unknown>;
}

export type JsonFieldSpec = {
  field: string;
  type: "string" | "number" | "object" | "array" | "boolean";
};

// ── Embedding Types ─────────────────────────────────────────────────────────

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  provider: string;
  model: string;
  dimensions: number;
  latencyMs: number;
}

// ── Embedding Provider Adapters ─────────────────────────────────────────────

interface EmbeddingProviderAdapter {
  buildRequest(
    config: LlmProviderConfig,
    input: string[],
    model?: string,
  ): { url: string; headers: Record<string, string>; body: unknown };

  parseResponse(json: unknown): { embeddings: number[][] };
}

const OllamaEmbeddingAdapter: EmbeddingProviderAdapter = {
  buildRequest(config, input, model) {
    return {
      url: `${config.api_base_url}/api/embed`,
      headers: { "Content-Type": "application/json" },
      body: { model: model || config.config_jsonb?.embedding_model || "nomic-embed-text", input },
    };
  },
  parseResponse(json: unknown) {
    const j = json as Record<string, unknown>;
    return { embeddings: (j.embeddings as number[][]) || [] };
  },
};

const OpenAiEmbeddingAdapter: EmbeddingProviderAdapter = {
  buildRequest(config, input, model) {
    return {
      url: `${config.api_base_url}/embeddings`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.api_key_enc}`,
      },
      body: {
        model: model || config.config_jsonb?.embedding_model || "text-embedding-3-small",
        input,
        ...(config.config_jsonb?.embedding_dimensions ? { dimensions: config.config_jsonb.embedding_dimensions } : {}),
      },
    };
  },
  parseResponse(json: unknown) {
    const j = json as Record<string, unknown>;
    const data = j.data as Array<Record<string, unknown>>;
    return { embeddings: (data || []).map((d) => d.embedding as number[]) };
  },
};

const GeminiEmbeddingAdapter: EmbeddingProviderAdapter = {
  buildRequest(config, input, model) {
    const modelName = model || config.config_jsonb?.embedding_model || "text-embedding-004";
    return {
      url: `${config.api_base_url}/models/${modelName}:batchEmbedContents?key=${config.api_key_enc}`,
      headers: { "Content-Type": "application/json" },
      body: {
        requests: input.map((text) => ({
          model: `models/${modelName}`,
          content: { parts: [{ text }] },
        })),
      },
    };
  },
  parseResponse(json: unknown) {
    const j = json as Record<string, unknown>;
    const embeddings = j.embeddings as Array<Record<string, unknown>>;
    return { embeddings: (embeddings || []).map((e) => e.values as number[]) };
  },
};

const EMBEDDING_ADAPTERS: Record<string, EmbeddingProviderAdapter> = {
  ollama: OllamaEmbeddingAdapter,
  openai: OpenAiEmbeddingAdapter,
  gemini: GeminiEmbeddingAdapter,
};

// ── Provider Adapters ────────────────────────────────────────────────────────

interface LlmProviderAdapter {
  buildRequest(
    config: LlmProviderConfig,
    messages: LlmMessage[],
    maxTokens: number,
    temperature: number | undefined,
    options?: { jsonMode?: boolean },
  ): { url: string; headers: Record<string, string>; body: unknown };

  parseResponse(json: unknown): {
    content: string;
    promptTokens?: number;
    outputTokens?: number;
  };

  testPayload(): { messages: LlmMessage[]; maxTokens: number; temperature: number };
}

const JSON_INSTRUCTION =
  "IMPORTANT: You MUST respond with valid JSON only. No markdown fences, no explanation, no text outside the JSON object.";

function injectJsonInstruction(messages: LlmMessage[]): LlmMessage[] {
  const result = [...messages];
  const sysIdx = result.findIndex((m) => m.role === "system");
  if (sysIdx >= 0) {
    result[sysIdx] = { ...result[sysIdx], content: `${result[sysIdx].content}\n\n${JSON_INSTRUCTION}` };
  } else {
    result.unshift({ role: "system", content: JSON_INSTRUCTION });
  }
  return result;
}

const OpenAiAdapter: LlmProviderAdapter = {
  buildRequest(config, messages, maxTokens, temperature, options) {
    const finalMessages = options?.jsonMode ? injectJsonInstruction(messages) : messages;
    return {
      url: `${config.api_base_url}/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.api_key_enc}`,
      },
      body: {
        model: config.model_id,
        messages: finalMessages,
        max_completion_tokens: maxTokens,
        ...(temperature !== undefined && { temperature }),
      },
    };
  },
  parseResponse(json: unknown) {
    const j = json as Record<string, unknown>;
    const choices = j.choices as Array<Record<string, unknown>>;
    const msg = choices?.[0]?.message as Record<string, unknown>;
    const usage = j.usage as Record<string, number> | undefined;
    return {
      content: (msg?.content as string) || "",
      promptTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    };
  },
  testPayload() {
    return { messages: [{ role: "user" as const, content: "Reply with: OK" }], maxTokens: 5, temperature: 0 };
  },
};

/**
 * OpenAI Responses API adapter — used for model-overridden requests (reasoning models).
 * Unlike Chat Completions, the Responses API counts reasoning tokens separately
 * from max_output_tokens, so the full token budget goes to visible output.
 */
const OpenAiResponsesAdapter: LlmProviderAdapter = {
  buildRequest(config, messages, maxTokens, _temperature, options) {
    const finalMessages = options?.jsonMode ? injectJsonInstruction(messages) : messages;
    const systemMsg = finalMessages.find((m) => m.role === "system");
    const nonSystem = finalMessages.filter((m) => m.role !== "system");
    return {
      url: `${config.api_base_url}/responses`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.api_key_enc}`,
      },
      body: {
        model: config.model_id,
        ...(systemMsg && { instructions: systemMsg.content }),
        input: nonSystem.map((m) => ({ role: m.role, content: m.content })),
      },
    };
  },
  parseResponse(json: unknown) {
    const j = json as Record<string, unknown>;
    const output = j.output as Array<Record<string, unknown>> | undefined;
    let content = "";
    if (output) {
      for (const item of output) {
        if (item.type === "message") {
          const contentBlocks = item.content as Array<Record<string, unknown>> | undefined;
          if (contentBlocks) {
            for (const block of contentBlocks) {
              if (block.type === "output_text" && typeof block.text === "string") {
                content += block.text;
              }
            }
          }
        }
      }
    }
    const usage = j.usage as Record<string, number> | undefined;
    return {
      content,
      promptTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
    };
  },
  testPayload() {
    return { messages: [{ role: "user" as const, content: "Reply with: OK" }], maxTokens: 5, temperature: 0 };
  },
};

const ClaudeAdapter: LlmProviderAdapter = {
  buildRequest(config, messages, maxTokens, temperature, options) {
    const finalMessages = options?.jsonMode ? injectJsonInstruction(messages) : messages;
    const systemMsg = finalMessages.find((m) => m.role === "system");
    const nonSystem = finalMessages.filter((m) => m.role !== "system");
    return {
      url: `${config.api_base_url}/messages`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.api_key_enc || "",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: config.model_id,
        max_tokens: maxTokens,
        temperature,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
      },
    };
  },
  parseResponse(json: unknown) {
    const j = json as Record<string, unknown>;
    const content = j.content as Array<Record<string, unknown>>;
    const usage = j.usage as Record<string, number> | undefined;
    return {
      content: (content?.[0]?.text as string) || "",
      promptTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
    };
  },
  testPayload() {
    return { messages: [{ role: "user" as const, content: "Reply with: OK" }], maxTokens: 5, temperature: 0 };
  },
};

const GeminiAdapter: LlmProviderAdapter = {
  buildRequest(config, messages, maxTokens, temperature, options) {
    const finalMessages = options?.jsonMode ? injectJsonInstruction(messages) : messages;
    const systemMsg = finalMessages.find((m) => m.role === "system");
    const nonSystem = finalMessages.filter((m) => m.role !== "system");
    const url = `${config.api_base_url}/models/${config.model_id}:generateContent?key=${config.api_key_enc}`;
    return {
      url,
      headers: { "Content-Type": "application/json" },
      body: {
        ...(systemMsg ? { system_instruction: { parts: [{ text: systemMsg.content }] } } : {}),
        contents: nonSystem.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      },
    };
  },
  parseResponse(json: unknown) {
    const j = json as Record<string, unknown>;
    const candidates = j.candidates as Array<Record<string, unknown>>;
    const content = candidates?.[0]?.content as Record<string, unknown>;
    const parts = content?.parts as Array<Record<string, unknown>>;
    const usage = j.usageMetadata as Record<string, number> | undefined;
    return {
      content: (parts?.[0]?.text as string) || "",
      promptTokens: usage?.promptTokenCount,
      outputTokens: usage?.candidatesTokenCount,
    };
  },
  testPayload() {
    return { messages: [{ role: "user" as const, content: "Reply with: OK" }], maxTokens: 5, temperature: 0 };
  },
};

const OllamaAdapter: LlmProviderAdapter = {
  buildRequest(config, messages, maxTokens, temperature) {
    return {
      url: `${config.api_base_url}/api/chat`,
      headers: { "Content-Type": "application/json" },
      body: { model: config.model_id, messages, stream: false, options: { num_predict: maxTokens, temperature } },
    };
  },
  parseResponse(json: unknown) {
    const j = json as Record<string, unknown>;
    const msg = j.message as Record<string, unknown>;
    return {
      content: (msg?.content as string) || "",
      promptTokens: (j.prompt_eval_count as number) || undefined,
      outputTokens: (j.eval_count as number) || undefined,
    };
  },
  testPayload() {
    return { messages: [{ role: "user" as const, content: "Reply with: OK" }], maxTokens: 5, temperature: 0 };
  },
};

const ADAPTERS: Record<string, LlmProviderAdapter> = {
  openai: OpenAiAdapter,
  claude: ClaudeAdapter,
  gemini: GeminiAdapter,
  ollama: OllamaAdapter,
};

// ── Circuit Breaker (per host) ───────────────────────────────────────────────

const circuitState: Record<string, { failures: number; openUntil: number }> = {};
const CB_THRESHOLD = 5;
const CB_COOLDOWN_MS = 60_000;

function isCircuitOpen(host: string): boolean {
  const s = circuitState[host];
  if (!s) return false;
  if (s.failures >= CB_THRESHOLD && Date.now() < s.openUntil) return true;
  if (Date.now() >= s.openUntil) s.failures = 0;
  return false;
}

function recordFailure(host: string) {
  if (!circuitState[host]) circuitState[host] = { failures: 0, openUntil: 0 };
  circuitState[host].failures++;
  if (circuitState[host].failures >= CB_THRESHOLD) {
    circuitState[host].openUntil = Date.now() + CB_COOLDOWN_MS;
    logWarn("LLM circuit breaker OPEN", { host, cooldownMs: CB_COOLDOWN_MS });
  }
}

function recordSuccess(host: string) {
  if (circuitState[host]) circuitState[host].failures = 0;
}

// ── Resilient Fetch ──────────────────────────────────────────────────────────

async function resilientFetch(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  maxRetries: number,
): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`LLM API ${res.status}: ${errBody.slice(0, 200)}`);
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const backoff = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastError || new Error("LLM fetch failed");
}

// ── Factory ──────────────────────────────────────────────────────────────────

export interface LlmProviderDeps {
  queryFn: QueryFn;
}

export interface LlmProvider {
  llmComplete(request: LlmCompletionRequest): Promise<LlmCompletionResponse | null>;
  llmCompleteJson<T = Record<string, unknown>>(
    request: LlmCompletionRequest,
    requiredFields?: JsonFieldSpec[],
  ): Promise<{ data: T; raw: LlmCompletionResponse } | null>;
  llmEmbed(request: EmbeddingRequest): Promise<EmbeddingResponse | null>;
  isLlmAvailable(): Promise<boolean>;
  getActiveProvider(): Promise<{ available: boolean; provider?: string; model?: string; mode: "LLM" | "RULES_ONLY" }>;
  testProvider(config: LlmProviderConfig): Promise<{ success: boolean; latencyMs: number; error?: string }>;
  getSystemPrompt(useCase: LlmUseCase): Promise<string | null>;
  invalidateProviderCache(): void;
  /** Get model override for a given use case + retrieval preset from env-based routing config */
  getModelForPreset(useCase: string, preset: string): string | undefined;
}

export function createLlmProvider(deps: LlmProviderDeps): LlmProvider {
  const { queryFn } = deps;

  // ── Model Routing Config ───────────────────────────────────────────────
  const modelRouting = loadModelRoutingConfig();

  /**
   * Get model override for a use case + preset combination (FR-014/AC-05).
   * Checks use-case-specific env vars first, then global preset env vars.
   * Returns undefined if no override is configured (use default model).
   */
  function getModelForPreset(useCase: string, preset: string): string | undefined {
    const normalizedPreset = preset.toLowerCase();
    if (normalizedPreset !== "concise" && normalizedPreset !== "balanced" && normalizedPreset !== "detailed") {
      return undefined;
    }

    // Check use-case-specific routing first: LLM_MODEL_{USECASE}_{PRESET}
    const useCaseKey = `LLM_MODEL_${useCase.toUpperCase()}_${normalizedPreset.toUpperCase()}`;
    const useCaseModel = process.env[useCaseKey];
    if (useCaseModel) return useCaseModel;

    // Fall back to global routing
    const globalEntry = modelRouting._global;
    if (globalEntry) {
      const model = globalEntry[normalizedPreset as RetrievalPreset];
      if (model) return model;
    }

    return undefined;
  }

  // ── Config Cache ─────────────────────────────────────────────────────────
  let cachedConfig: LlmProviderConfig | null = null;
  let cacheExpiry = 0;
  const CACHE_TTL_MS = 60_000;

  // Use-case-specific provider cache (keyed by use case)
  const useCaseCache: Record<string, { config: LlmProviderConfig; expiry: number }> = {};

  function invalidateProviderCache() {
    cachedConfig = null;
    cacheExpiry = 0;
    for (const key of Object.keys(useCaseCache)) {
      delete useCaseCache[key];
    }
  }

  async function loadConfigForUseCase(useCase: string): Promise<LlmProviderConfig | null> {
    const cached = useCaseCache[useCase];
    if (cached && Date.now() < cached.expiry) return cached.config;

    try {
      const res = await queryFn(
        `SELECT * FROM llm_provider_config
         WHERE is_active = TRUE AND config_jsonb->'assigned_use_cases' ? $1
         LIMIT 1`,
        [useCase],
      );
      if (res.rows.length > 0) {
        const config = res.rows[0] as unknown as LlmProviderConfig;
        useCaseCache[useCase] = { config, expiry: Date.now() + CACHE_TTL_MS };
        return config;
      }
    } catch {
      // Table may not exist yet or column missing
    }
    return null;
  }

  async function loadDefaultConfig(): Promise<LlmProviderConfig | null> {
    if (cachedConfig && Date.now() < cacheExpiry) return cachedConfig;

    const envKey = process.env.OPEN_AI_API_KEY || process.env.OPENAI_API_KEY;
    const envModel = process.env.OPEN_AI_MODEL || "gpt-4o";

    try {
      const res = await queryFn(
        `SELECT * FROM llm_provider_config WHERE is_default = TRUE AND is_active = TRUE LIMIT 1`,
      );
      if (res.rows.length > 0) {
        cachedConfig = res.rows[0] as unknown as LlmProviderConfig;
        if (!cachedConfig.api_key_enc && envKey) cachedConfig.api_key_enc = envKey;
        if (envModel && cachedConfig.provider === "openai") cachedConfig.model_id = envModel;
        cacheExpiry = Date.now() + CACHE_TTL_MS;
        return cachedConfig;
      }
    } catch {
      // Table may not exist yet
    }

    // Env-var fallbacks
    if (envKey) {
      cachedConfig = {
        config_id: "env-fallback", provider: "openai", display_name: "OpenAI (env)",
        api_base_url: "https://api.openai.com/v1", api_key_enc: envKey, model_id: envModel,
        is_active: true, is_default: true, max_tokens: 2048, temperature: 0.3,
        timeout_ms: 30_000, max_retries: 2, config_jsonb: {},
      };
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      return cachedConfig;
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      cachedConfig = {
        config_id: "env-fallback-anthropic", provider: "claude", display_name: "Claude (env)",
        api_base_url: "https://api.anthropic.com/v1", api_key_enc: anthropicKey,
        model_id: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
        is_active: true, is_default: true, max_tokens: 2048, temperature: 0.3,
        timeout_ms: 60_000, max_retries: 2, config_jsonb: {},
      };
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      return cachedConfig;
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      cachedConfig = {
        config_id: "env-fallback-gemini", provider: "gemini", display_name: "Gemini (env)",
        api_base_url: "https://generativelanguage.googleapis.com/v1beta", api_key_enc: geminiKey,
        model_id: process.env.GEMINI_MODEL || "gemini-2.0-flash",
        is_active: true, is_default: true, max_tokens: 2048, temperature: 0.3,
        timeout_ms: 30_000, max_retries: 2, config_jsonb: {},
      };
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      return cachedConfig;
    }

    return null;
  }

  // ── System Prompt Cache ──────────────────────────────────────────────────
  const promptCache: Record<string, { text: string; expiry: number }> = {};

  async function getSystemPrompt(useCase: LlmUseCase): Promise<string | null> {
    const cached = promptCache[useCase];
    if (cached && Date.now() < cached.expiry) return cached.text;
    try {
      const res = await queryFn(
        `SELECT prompt_text FROM llm_system_prompt WHERE use_case = $1 AND is_active = TRUE ORDER BY version DESC LIMIT 1`,
        [useCase],
      );
      if (res.rows.length > 0) {
        const text = res.rows[0].prompt_text as string;
        promptCache[useCase] = { text, expiry: Date.now() + CACHE_TTL_MS };
        return text;
      }
    } catch {
      // Table may not exist
    }
    return null;
  }

  // ── Prediction Logging ───────────────────────────────────────────────────
  function logPrediction(response: LlmCompletionResponse, request: LlmCompletionRequest) {
    queryFn(
      `INSERT INTO model_prediction_log
         (provider, model_name, prompt_tokens, output_tokens, use_case,
          entity_type, entity_id, prediction, latency_ms, fallback_used, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      [
        response.provider, response.model,
        response.promptTokens || null, response.outputTokens || null,
        request.useCase || null, request.entityType || null, request.entityId || null,
        JSON.stringify({ content: response.content.slice(0, 2000) }),
        response.latencyMs, response.fallbackUsed,
      ],
    ).catch((err) => logWarn("Prediction log write failed", { error: String(err) }));
  }

  // ── Core Completion ──────────────────────────────────────────────────────
  async function llmComplete(request: LlmCompletionRequest): Promise<LlmCompletionResponse | null> {
    // Check for use-case-specific provider first, then fall back to default
    let baseConfig: LlmProviderConfig | null = null;
    if (request.useCase) {
      baseConfig = await loadConfigForUseCase(request.useCase);
    }
    if (!baseConfig) {
      baseConfig = await loadDefaultConfig();
    }
    if (!baseConfig) return null;

    const config = request.modelOverride
      ? { ...baseConfig, model_id: request.modelOverride }
      : baseConfig;

    // Use Responses API for OpenAI model overrides (handles reasoning tokens separately)
    const adapter = (request.modelOverride && config.provider === "openai")
      ? OpenAiResponsesAdapter
      : ADAPTERS[config.provider];
    if (!adapter) {
      logWarn("Unknown LLM provider", { provider: config.provider });
      return null;
    }

    let host: string;
    try { host = new URL(config.api_base_url).host; } catch { host = config.api_base_url; }

    if (isCircuitOpen(host)) {
      logWarn("LLM circuit breaker open, skipping", { host });
      return null;
    }

    const messages = [...request.messages];
    if (request.useCase && !messages.some((m) => m.role === "system")) {
      const systemPrompt = await getSystemPrompt(request.useCase);
      if (systemPrompt) messages.unshift({ role: "system", content: systemPrompt });
    }

    const maxTokens = request.maxTokens || Number(config.max_tokens) || 2048;
    const temperature = request.temperature !== undefined
      ? Number(request.temperature)
      : request.modelOverride ? undefined : (Number(config.temperature) || 0.3);
    const { url, headers: hdrs, body } = adapter.buildRequest(config, messages, maxTokens, temperature, { jsonMode: request.jsonMode });

    const start = Date.now();
    try {
      const json = await resilientFetch(url, hdrs, body, config.timeout_ms, config.max_retries);
      const parsed = adapter.parseResponse(json);
      recordSuccess(host);

      // Calculate cost from token counts + pricing in config_jsonb
      const inputCostPerM = config.config_jsonb?.input_cost_per_million as number | undefined;
      const outputCostPerM = config.config_jsonb?.output_cost_per_million as number | undefined;
      let costUsd: number | undefined;
      if (inputCostPerM != null && outputCostPerM != null && parsed.promptTokens && parsed.outputTokens) {
        costUsd = (parsed.promptTokens * inputCostPerM + parsed.outputTokens * outputCostPerM) / 1_000_000;
      }

      const response: LlmCompletionResponse = {
        content: parsed.content, provider: config.display_name || config.provider, model: config.model_id,
        promptTokens: parsed.promptTokens, outputTokens: parsed.outputTokens, costUsd,
        latencyMs: Date.now() - start, fallbackUsed: false,
      };
      logPrediction(response, request);
      logInfo("LLM completion success", { provider: config.provider, model: config.model_id, useCase: request.useCase, latencyMs: response.latencyMs });
      return response;
    } catch (err) {
      recordFailure(host);
      logError("LLM completion failed", { provider: config.provider, model: config.model_id, error: err instanceof Error ? err.message : String(err) });
      logPrediction({ content: "", provider: config.display_name || config.provider, model: config.model_id, latencyMs: Date.now() - start, fallbackUsed: true }, request);
      return null;
    }
  }

  // ── JSON-mode Completion ─────────────────────────────────────────────────
  async function llmCompleteJson<T = Record<string, unknown>>(
    request: LlmCompletionRequest,
    requiredFields?: JsonFieldSpec[],
  ): Promise<{ data: T; raw: LlmCompletionResponse } | null> {
    const jsonRequest = { ...request, jsonMode: true };

    const attempt = async (req: LlmCompletionRequest): Promise<{ data: T; raw: LlmCompletionResponse } | null> => {
      const result = await llmComplete(req);
      if (!result) return null;
      let parsed: T;
      try {
        let content = result.content.trim();
        if (content.startsWith("```")) content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
        parsed = JSON.parse(content) as T;
      } catch {
        logWarn("LLM JSON parse failed", { useCase: req.useCase, content: result.content.slice(0, 200) });
        return null;
      }
      if (requiredFields) {
        const obj = parsed as Record<string, unknown>;
        for (const spec of requiredFields) {
          const val = obj[spec.field];
          if (val === undefined || val === null) return null;
          if (spec.type === "array" && !Array.isArray(val)) return null;
          if (spec.type !== "array" && typeof val !== spec.type) return null;
        }
      }
      return { data: parsed, raw: result };
    };

    const first = await attempt(jsonRequest);
    if (first) return first;

    logInfo("LLM JSON retry with repair prompt", { useCase: request.useCase });
    const repairMessages: LlmMessage[] = [
      ...jsonRequest.messages,
      { role: "user", content: "Your previous output did not match the required JSON schema. Return ONLY corrected JSON. Do not omit required fields. Do not add markdown." },
    ];
    return attempt({ ...jsonRequest, messages: repairMessages });
  }

  // ── Utility methods ──────────────────────────────────────────────────────
  async function isLlmAvailable(): Promise<boolean> {
    const config = await loadDefaultConfig();
    if (!config) return false;
    if (config.provider !== "ollama" && !config.api_key_enc) return false;
    return true;
  }

  async function getActiveProvider() {
    const config = await loadDefaultConfig();
    if (!config) return { available: false, mode: "RULES_ONLY" as const };
    return { available: true, provider: config.provider, model: config.model_id, mode: "LLM" as const };
  }

  async function testProvider(config: LlmProviderConfig): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const adapter = ADAPTERS[config.provider];
    if (!adapter) return { success: false, latencyMs: 0, error: "Unknown provider" };
    const { messages, maxTokens, temperature } = adapter.testPayload();
    const { url, headers, body } = adapter.buildRequest(config, messages, maxTokens, temperature);
    const start = Date.now();
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(config.timeout_ms || 15_000) });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        return { success: false, latencyMs, error: `HTTP ${res.status}: ${errBody.slice(0, 200)}` };
      }
      const json = await res.json();
      const parsed = adapter.parseResponse(json);
      return { success: !!parsed.content, latencyMs };
    } catch (err) {
      return { success: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Embedding ─────────────────────────────────────────────────────────────
  async function llmEmbed(request: EmbeddingRequest): Promise<EmbeddingResponse | null> {
    const config = await loadDefaultConfig();
    if (!config) return null;

    const adapter = EMBEDDING_ADAPTERS[config.provider];
    if (!adapter) {
      logWarn("No embedding adapter for provider", { provider: config.provider });
      return null;
    }

    const inputArr = Array.isArray(request.input) ? request.input : [request.input];

    let host: string;
    try { host = new URL(config.api_base_url).host; } catch { host = config.api_base_url; }

    if (isCircuitOpen(host)) {
      logWarn("LLM circuit breaker open for embeddings, skipping", { host });
      return null;
    }

    const { url, headers: hdrs, body } = adapter.buildRequest(config, inputArr, request.model);
    const start = Date.now();

    try {
      const json = await resilientFetch(url, hdrs, body, config.timeout_ms, config.max_retries);
      const parsed = adapter.parseResponse(json);
      recordSuccess(host);

      const dimensions = parsed.embeddings[0]?.length || 0;
      const response: EmbeddingResponse = {
        embeddings: parsed.embeddings,
        provider: config.provider,
        model: request.model || (config.config_jsonb?.embedding_model as string) || config.model_id,
        dimensions,
        latencyMs: Date.now() - start,
      };
      logInfo("Embedding success", { provider: config.provider, count: inputArr.length, dimensions, latencyMs: response.latencyMs });
      return response;
    } catch (err) {
      recordFailure(host);
      logError("Embedding failed", { provider: config.provider, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  return { llmComplete, llmCompleteJson, llmEmbed, isLlmAvailable, getActiveProvider, testProvider, getSystemPrompt, invalidateProviderCache, getModelForPreset };
}
