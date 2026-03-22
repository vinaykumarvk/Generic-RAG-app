import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmProvider, type LlmProviderConfig } from "../src/llm/llm-provider";

const baseConfig: LlmProviderConfig = {
  config_id: "cfg-1",
  provider: "openai",
  display_name: "Qwen via OpenRouter",
  api_base_url: "https://openrouter.ai/api/v1",
  api_key_enc: "test-key",
  model_id: "qwen/qwen3.5-35b-a3b",
  is_active: true,
  is_default: true,
  max_tokens: 1024,
  temperature: 0.2,
  timeout_ms: 1000,
  max_retries: 0,
  config_jsonb: {},
};

describe("llm-provider OpenRouter reasoning handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disables reasoning for Qwen on OpenRouter chat completions", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.reasoning).toEqual({ effort: "none" });
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "QWEN_OK",
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 4,
          },
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLlmProvider({
      queryFn: vi.fn(async () => ({ rows: [baseConfig] })),
    });

    const result = await provider.llmComplete({
      messages: [{ role: "user", content: "Reply with exactly: QWEN_OK" }],
      maxTokens: 32,
      useCase: "GENERAL",
    });

    expect(result?.content).toBe("QWEN_OK");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps actual OpenAI model overrides on the Responses API and not OpenRouter", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("/responses")
        ? {
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "OK" }],
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          }
        : {
            choices: [{ message: { content: "OK" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          },
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLlmProvider({
      queryFn: vi.fn(async () => ({
        rows: [{
          ...baseConfig,
          api_base_url: "https://api.openai.com/v1",
          model_id: "gpt-4.1-mini",
        }],
      })),
    });

    await provider.llmComplete({
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      modelOverride: "gpt-5-mini",
      useCase: "GENERAL",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/responses");
  });

  it("keeps OpenRouter model overrides on chat completions", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "OK" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLlmProvider({
      queryFn: vi.fn(async () => ({ rows: [baseConfig] })),
    });

    await provider.llmComplete({
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      modelOverride: "qwen/qwen3.5-35b-a3b",
      useCase: "GENERAL",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/chat/completions");
  });

  it("allows OpenRouter Qwen default reasoning for larger answer-generation calls", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.reasoning).toBeUndefined();
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Detailed answer" } }],
          usage: { prompt_tokens: 100, completion_tokens: 2000 },
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLlmProvider({
      queryFn: vi.fn(async () => ({ rows: [baseConfig] })),
    });

    const result = await provider.llmComplete({
      messages: [{ role: "user", content: "Explain the evidence in detail." }],
      maxTokens: 8192,
      useCase: "ANSWER_GENERATION",
    });

    expect(result?.content).toBe("Detailed answer");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
