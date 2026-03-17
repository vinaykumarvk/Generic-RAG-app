import { describe, it, expect, vi } from "vitest";
import { expandQuery } from "../../retrieval/query-expander";

// ── Mock Helpers ──────────────────────────────────────────────────────────────

function createMockLlmProvider() {
  return {
    llmComplete: vi.fn(),
    llmCompleteJson: vi.fn(),
    llmEmbed: vi.fn(),
    isLlmAvailable: vi.fn().mockResolvedValue(true),
    getActiveProvider: vi.fn(),
    testProvider: vi.fn(),
    getSystemPrompt: vi.fn(),
    invalidateProviderCache: vi.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("expandQuery", () => {
  describe("TC-FR012-01: Expands query into multiple alternative phrasings", () => {
    it("returns expanded queries from LLM response", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmCompleteJson.mockResolvedValueOnce({
        data: {
          queries: [
            "What are the data privacy regulations?",
            "What rules govern data privacy?",
            "Data privacy compliance requirements",
          ],
        },
        raw: { content: "{}", provider: "openai", model: "gpt-4o", latencyMs: 100, fallbackUsed: false },
      });

      const result = await expandQuery(llmProvider, "What are the data privacy regulations?");

      expect(result).toHaveLength(3);
      expect(result).toContain("What are the data privacy regulations?");
      expect(result).toContain("What rules govern data privacy?");
      expect(result).toContain("Data privacy compliance requirements");

      // Verify LLM was called with correct parameters
      expect(llmProvider.llmCompleteJson).toHaveBeenCalledTimes(1);
      const callArgs = llmProvider.llmCompleteJson.mock.calls[0];
      expect(callArgs[0].useCase).toBe("QUERY_EXPANSION");
      expect(callArgs[0].maxTokens).toBe(200);
      expect(callArgs[0].temperature).toBe(0.3);
      expect(callArgs[0].messages[0].content).toContain("What are the data privacy regulations?");
    });
  });

  describe("TC-FR012-02: Returns original query when LLM fails", () => {
    it("returns original query wrapped in array when LLM returns null", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmCompleteJson.mockResolvedValueOnce(null);

      const result = await expandQuery(llmProvider, "What is the refund policy?");

      expect(result).toEqual(["What is the refund policy?"]);
    });

    it("returns original query when LLM returns empty queries array", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmCompleteJson.mockResolvedValueOnce({
        data: { queries: [] },
        raw: { content: "{}", provider: "openai", model: "gpt-4o", latencyMs: 50, fallbackUsed: false },
      });

      const result = await expandQuery(llmProvider, "What is the refund policy?");

      expect(result).toEqual(["What is the refund policy?"]);
    });
  });

  describe("Parses JSON response from LLM correctly", () => {
    it("passes correct required fields spec to llmCompleteJson", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmCompleteJson.mockResolvedValueOnce({
        data: { queries: ["original query"] },
        raw: { content: "{}", provider: "openai", model: "gpt-4o", latencyMs: 50, fallbackUsed: false },
      });

      await expandQuery(llmProvider, "original query");

      const callArgs = llmProvider.llmCompleteJson.mock.calls[0];
      expect(callArgs[1]).toEqual([{ field: "queries", type: "array" }]);
    });

    it("handles query with special characters in prompt", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmCompleteJson.mockResolvedValueOnce({
        data: { queries: ["query with special chars: @#$"] },
        raw: { content: "{}", provider: "openai", model: "gpt-4o", latencyMs: 50, fallbackUsed: false },
      });

      const result = await expandQuery(llmProvider, "query with special chars: @#$");

      expect(result).toEqual(["query with special chars: @#$"]);
    });
  });
});
