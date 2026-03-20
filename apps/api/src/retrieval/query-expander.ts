/**
 * Query expansion — step-back intent expansion via LLM.
 * FR-012: skip expansion for short queries, add timeout with fallback.
 */

import type { LlmProvider } from "@puda/api-core";

const EXPANSION_TIMEOUT_MS = 5000;

export async function expandQuery(
  llmProvider: LlmProvider,
  query: string,
): Promise<string[]> {
  // FR-012/AC-05: skip expansion for queries shorter than 3 words
  const wordCount = query.trim().split(/\s+/).length;
  if (wordCount < 3) {
    return [query];
  }

  // FR-012/AC-02: timeout with fallback to original query
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), EXPANSION_TIMEOUT_MS);
  });

  const expansionPromise = llmProvider.llmCompleteJson<{ expanded_intent: string; queries: string[] }>(
    {
      messages: [
        {
          role: "user",
          content: `Given this question, first determine the broader intent (step-back reasoning), then generate 2-3 alternative phrasings that capture the same intent but use different terminology. Include the original question.

Question: ${query}

Return JSON: {"expanded_intent": "the broader topic/intent behind this question", "queries": ["...", "...", "..."]}`,
        },
      ],
      useCase: "QUERY_EXPANSION",
      maxTokens: 300,
      temperature: 0.3,
    },
    [{ field: "queries", type: "array" }],
  );

  const result = await Promise.race([expansionPromise, timeoutPromise]);

  if (!result) return [query];
  return result.data.queries.length > 0 ? result.data.queries : [query];
}

/** FR-012/AC-01: Expand query and return both queries and expanded_intent */
export async function expandQueryWithIntent(
  llmProvider: LlmProvider,
  query: string,
  conversationHistory?: Array<{ role: string; content: string }>,
): Promise<{ queries: string[]; expandedIntent: string | null; stepBackQuestion?: string | null }> {
  const wordCount = query.trim().split(/\s+/).length;
  if (wordCount < 3) {
    return { queries: [query], expandedIntent: null, stepBackQuestion: null };
  }

  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), EXPANSION_TIMEOUT_MS);
  });

  // Build conversation history context for coreference resolution
  let historyContext = "";
  if (conversationHistory?.length) {
    const recentUserMsgs = conversationHistory
      .filter((m) => m.role === "user")
      .slice(-3)
      .map((m) => m.content.slice(0, 200));
    if (recentUserMsgs.length > 0) {
      historyContext = `\n\nRecent conversation (resolve pronouns/references like "the case", "that document" using this context):\n${recentUserMsgs.map((m, i) => `${i + 1}. ${m}`).join("\n")}\n`;
    }
  }

  // FR-014: Add scope constraint to step-back prompt
  const expansionPromise = llmProvider.llmCompleteJson<{ expanded_intent: string; step_back_question: string; queries: string[] }>(
    {
      messages: [
        {
          role: "user",
          content: `Given this question, first determine the broader intent (step-back reasoning), formulate a step-back question that captures the broader context, then generate 2-3 alternative phrasings that capture the same intent but use different terminology. Include the original question. Only reference documents within the user's authorized scope.${historyContext}

Question: ${query}

Return JSON: {"expanded_intent": "the broader topic/intent behind this question", "step_back_question": "a broader question that provides context", "queries": ["...", "...", "..."]}`,
        },
      ],
      useCase: "QUERY_EXPANSION",
      maxTokens: 300,
      temperature: 0.3,
    },
    [{ field: "queries", type: "array" }],
  );

  const result = await Promise.race([expansionPromise, timeoutPromise]);

  if (!result) return { queries: [query], expandedIntent: null, stepBackQuestion: null };
  return {
    queries: result.data.queries.length > 0 ? result.data.queries : [query],
    expandedIntent: result.data.expanded_intent || null,
    stepBackQuestion: result.data.step_back_question || null,
  };
}
