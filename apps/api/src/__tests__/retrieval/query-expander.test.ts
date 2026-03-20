import { describe, it, expect, vi } from "vitest";
import { expandQuery, expandQueryWithIntent } from "../../retrieval/query-expander";

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
    getModelForPreset: vi.fn().mockReturnValue(undefined),
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
      expect(callArgs[0].maxTokens).toBe(300);
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
        data: { queries: ["what is the original query"] },
        raw: { content: "{}", provider: "openai", model: "gpt-4o", latencyMs: 50, fallbackUsed: false },
      });

      await expandQuery(llmProvider, "what is the original query");

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

describe("expandQueryWithIntent — conversation history", () => {
  it("injects history context into prompt when conversationHistory is provided", async () => {
    const llmProvider = createMockLlmProvider();
    llmProvider.llmCompleteJson.mockResolvedValueOnce({
      data: {
        expanded_intent: "Status of case 424/2021",
        step_back_question: "What is the current status?",
        queries: ["What is the status of case 424/2021?"],
      },
      raw: { content: "{}", provider: "openai", model: "gpt-4o", latencyMs: 100, fallbackUsed: false },
    });

    await expandQueryWithIntent(
      llmProvider,
      "What is the status of the case?",
      [
        { role: "user", content: "Tell me about case 424/2021" },
        { role: "assistant", content: "Case 424/2021 is a..." },
        { role: "user", content: "What is the status of the case?" },
      ],
    );

    const callArgs = llmProvider.llmCompleteJson.mock.calls[0];
    const prompt = callArgs[0].messages[0].content;
    expect(prompt).toContain("Recent conversation");
    expect(prompt).toContain("Tell me about case 424/2021");
    expect(prompt).toContain("What is the status of the case?");
    // Assistant messages should not be included in history context
    expect(prompt).not.toContain("Case 424/2021 is a...");
  });

  it("does not include history section when no conversationHistory provided", async () => {
    const llmProvider = createMockLlmProvider();
    llmProvider.llmCompleteJson.mockResolvedValueOnce({
      data: {
        expanded_intent: "Data privacy",
        step_back_question: "What are the rules?",
        queries: ["What are the data privacy regulations?"],
      },
      raw: { content: "{}", provider: "openai", model: "gpt-4o", latencyMs: 100, fallbackUsed: false },
    });

    await expandQueryWithIntent(llmProvider, "What are the data privacy regulations?");

    const callArgs = llmProvider.llmCompleteJson.mock.calls[0];
    const prompt = callArgs[0].messages[0].content;
    expect(prompt).not.toContain("Recent conversation");
  });

  it("returns the step-back question when the LLM provides one", async () => {
    const llmProvider = createMockLlmProvider();
    llmProvider.llmCompleteJson.mockResolvedValueOnce({
      data: {
        expanded_intent: "Data privacy",
        step_back_question: "What broader privacy obligations apply here?",
        queries: ["What are the data privacy regulations?"],
      },
      raw: { content: "{}", provider: "openai", model: "gpt-4o", latencyMs: 100, fallbackUsed: false },
    });

    const result = await expandQueryWithIntent(llmProvider, "What are the data privacy regulations?");

    expect(result.expandedIntent).toBe("Data privacy");
    expect(result.stepBackQuestion).toBe("What broader privacy obligations apply here?");
  });

  it("limits history to last 3 user messages truncated to 200 chars", async () => {
    const llmProvider = createMockLlmProvider();
    llmProvider.llmCompleteJson.mockResolvedValueOnce({
      data: { expanded_intent: "test", step_back_question: "test", queries: ["test query here"] },
      raw: { content: "{}", provider: "openai", model: "gpt-4o", latencyMs: 100, fallbackUsed: false },
    });

    const longMsg = "A".repeat(300);
    await expandQueryWithIntent(
      llmProvider,
      "test query here",
      [
        { role: "user", content: "msg1" },
        { role: "user", content: "msg2" },
        { role: "user", content: "msg3" },
        { role: "user", content: longMsg },
        { role: "user", content: "test query here" },
      ],
    );

    const callArgs = llmProvider.llmCompleteJson.mock.calls[0];
    const prompt = callArgs[0].messages[0].content;
    // Only last 3 user messages
    expect(prompt).not.toContain("msg1");
    expect(prompt).not.toContain("msg2");
    expect(prompt).toContain("msg3");
    // Long message is truncated to 200 chars
    expect(prompt).toContain("A".repeat(200));
    expect(prompt).not.toContain("A".repeat(201));
  });
});
