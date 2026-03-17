import { describe, it, expect, vi } from "vitest";
import { generateAnswer, type GeneratedAnswer } from "../../retrieval/answer-generator";
import type { RankedChunk } from "../../retrieval/reranker";

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

function makeRankedChunk(overrides: Partial<RankedChunk> = {}): RankedChunk {
  return {
    chunk_id: "chunk-1",
    document_id: "doc-1",
    content: "The regulation requires all operators to maintain records for at least 5 years.",
    document_title: "Regulation Guide",
    page_start: 12,
    heading_path: "Chapter 3 > Record Keeping",
    score: 0.85,
    sources: ["vector"],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("generateAnswer", () => {
  describe("TC-FR014-04: Generates answer with citation references [1], [2]", () => {
    it("produces an answer with extracted citation references matching chunks", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce({
        content: "According to the Regulation Guide [1], operators must maintain records for 5 years. The Compliance Manual [2] further specifies the format requirements.",
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 500,
        fallbackUsed: false,
      });

      const chunks = [
        makeRankedChunk({ chunk_id: "c1", document_id: "doc-1", document_title: "Regulation Guide", page_start: 12, score: 0.9 }),
        makeRankedChunk({ chunk_id: "c2", document_id: "doc-2", document_title: "Compliance Manual", page_start: 45, score: 0.8 }),
      ];

      const result = await generateAnswer(
        llmProvider,
        "How long must records be maintained?",
        chunks,
        "",
        []
      );

      expect(result).not.toBeNull();
      expect(result!.answer).toContain("[1]");
      expect(result!.answer).toContain("[2]");
      expect(result!.citations).toHaveLength(2);

      // Citation 1 maps to first chunk
      expect(result!.citations[0].citation_index).toBe(1);
      expect(result!.citations[0].chunk_id).toBe("c1");
      expect(result!.citations[0].document_title).toBe("Regulation Guide");
      expect(result!.citations[0].page_number).toBe(12);

      // Citation 2 maps to second chunk
      expect(result!.citations[1].citation_index).toBe(2);
      expect(result!.citations[1].chunk_id).toBe("c2");
      expect(result!.citations[1].document_title).toBe("Compliance Manual");
      expect(result!.citations[1].page_number).toBe(45);

      expect(result!.provider).toBe("openai");
      expect(result!.model).toBe("gpt-4o");
      expect(result!.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("TC-FR014-05: Extracts citations correctly from LLM response", () => {
    it("ignores citation indices that exceed chunk count", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce({
        content: "The answer references [1] and [5] which doesn't exist.",
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 300,
        fallbackUsed: false,
      });

      const chunks = [
        makeRankedChunk({ chunk_id: "c1" }),
        makeRankedChunk({ chunk_id: "c2" }),
      ];

      const result = await generateAnswer(
        llmProvider,
        "test query",
        chunks,
        "",
        []
      );

      expect(result).not.toBeNull();
      // Only [1] should be extracted, [5] exceeds chunk count
      expect(result!.citations).toHaveLength(1);
      expect(result!.citations[0].citation_index).toBe(1);
    });

    it("ignores citation index [0] (1-based indexing)", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce({
        content: "See [0] and [1] for details.",
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 200,
        fallbackUsed: false,
      });

      const chunks = [makeRankedChunk({ chunk_id: "c1" })];

      const result = await generateAnswer(llmProvider, "test", chunks, "", []);

      expect(result).not.toBeNull();
      // [0] is filtered out because i >= 1 check
      expect(result!.citations).toHaveLength(1);
      expect(result!.citations[0].citation_index).toBe(1);
    });

    it("deduplicates repeated citation references", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce({
        content: "As stated in [1], the policy is clear. Reiterating [1], we confirm.",
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 200,
        fallbackUsed: false,
      });

      const chunks = [makeRankedChunk({ chunk_id: "c1" })];

      const result = await generateAnswer(llmProvider, "test", chunks, "", []);

      expect(result).not.toBeNull();
      // [1] appears twice in text but should only be cited once
      expect(result!.citations).toHaveLength(1);
    });

    it("truncates excerpt to 300 characters", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce({
        content: "Reference [1].",
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 100,
        fallbackUsed: false,
      });

      const longContent = "A".repeat(500);
      const chunks = [makeRankedChunk({ chunk_id: "c1", content: longContent })];

      const result = await generateAnswer(llmProvider, "test", chunks, "", []);

      expect(result).not.toBeNull();
      expect(result!.citations[0].excerpt).toHaveLength(300);
    });
  });

  describe("Handles no relevant chunks gracefully", () => {
    it("returns null when LLM returns null", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce(null);

      const result = await generateAnswer(
        llmProvider,
        "test query",
        [makeRankedChunk()],
        "",
        []
      );

      expect(result).toBeNull();
    });

    it("returns answer with empty citations when LLM produces no citation markers", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce({
        content: "I could not find relevant information to answer this question.",
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 200,
        fallbackUsed: false,
      });

      const result = await generateAnswer(
        llmProvider,
        "test query",
        [makeRankedChunk()],
        "",
        []
      );

      expect(result).not.toBeNull();
      expect(result!.citations).toHaveLength(0);
    });
  });

  describe("Includes chunk metadata in context prompt", () => {
    it("builds context with document title, page number, and content", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce({
        content: "Answer [1].",
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 100,
        fallbackUsed: false,
      });

      const chunks = [
        makeRankedChunk({
          chunk_id: "c1",
          document_title: "Policy Manual",
          page_start: 7,
          content: "All employees must complete training.",
        }),
      ];

      await generateAnswer(llmProvider, "What training is required?", chunks, "", []);

      // Verify the message content includes chunk metadata
      const callArgs = llmProvider.llmComplete.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
      expect(userMessage.content).toContain("[1] Policy Manual (page 7):");
      expect(userMessage.content).toContain("All employees must complete training.");
    });

    it("omits page number when page_start is null", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce({
        content: "Answer [1].",
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 100,
        fallbackUsed: false,
      });

      const chunks = [
        makeRankedChunk({
          chunk_id: "c1",
          document_title: "Reference Doc",
          page_start: null,
          content: "Some content.",
        }),
      ];

      await generateAnswer(llmProvider, "query", chunks, "", []);

      const callArgs = llmProvider.llmComplete.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
      expect(userMessage.content).toContain("[1] Reference Doc:");
      expect(userMessage.content).not.toContain("(page");
    });

    it("includes graph context when provided", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce({
        content: "Answer.",
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 100,
        fallbackUsed: false,
      });

      const graphContext = "[concept] Data Privacy: Protection of personal information\nRelationship: GDPR --[regulates]--> Data Privacy";

      await generateAnswer(
        llmProvider,
        "What is data privacy?",
        [makeRankedChunk()],
        graphContext,
        []
      );

      const callArgs = llmProvider.llmComplete.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
      expect(userMessage.content).toContain("Knowledge Graph Context:");
      expect(userMessage.content).toContain("Data Privacy");
      expect(userMessage.content).toContain("GDPR");
    });

    it("includes conversation history (limited to last 4 turns)", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce({
        content: "Answer.",
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 100,
        fallbackUsed: false,
      });

      const history = [
        { role: "user" as const, content: "First question" },
        { role: "assistant" as const, content: "First answer" },
        { role: "user" as const, content: "Second question" },
        { role: "assistant" as const, content: "Second answer" },
        { role: "user" as const, content: "Third question" },
        { role: "assistant" as const, content: "Third answer" },
      ];

      await generateAnswer(
        llmProvider,
        "Follow-up question",
        [makeRankedChunk()],
        "",
        history
      );

      const callArgs = llmProvider.llmComplete.mock.calls[0][0];
      const messages = callArgs.messages;

      // System message + last 4 history items + user context message = 6
      expect(messages).toHaveLength(6);
      expect(messages[0].role).toBe("system");
      // Last 4 from history (items 2-5)
      expect(messages[1].content).toBe("Second question");
      expect(messages[2].content).toBe("Second answer");
      expect(messages[3].content).toBe("Third question");
      expect(messages[4].content).toBe("Third answer");
      // Final user message with context
      expect(messages[5].role).toBe("user");
      expect(messages[5].content).toContain("Follow-up question");
    });

    it("passes correct LLM request parameters", async () => {
      const llmProvider = createMockLlmProvider();
      llmProvider.llmComplete.mockResolvedValueOnce({
        content: "Answer.",
        provider: "openai",
        model: "gpt-4o",
        latencyMs: 100,
        fallbackUsed: false,
      });

      await generateAnswer(llmProvider, "test", [makeRankedChunk()], "", []);

      const callArgs = llmProvider.llmComplete.mock.calls[0][0];
      expect(callArgs.useCase).toBe("ANSWER_GENERATION");
      expect(callArgs.maxTokens).toBe(2048);
      expect(callArgs.temperature).toBe(0.2);
    });
  });
});
