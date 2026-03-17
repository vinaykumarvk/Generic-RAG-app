/**
 * Query expansion — step-back intent expansion via LLM.
 */

import type { LlmProvider } from "@puda/api-core";

export async function expandQuery(
  llmProvider: LlmProvider,
  query: string,
): Promise<string[]> {
  const result = await llmProvider.llmCompleteJson<{ queries: string[] }>(
    {
      messages: [
        {
          role: "user",
          content: `Given this question, generate 2-3 alternative phrasings that capture the same intent but use different terminology. Include the original question.

Question: ${query}

Return JSON: {"queries": ["...", "...", "..."]}`,
        },
      ],
      useCase: "QUERY_EXPANSION",
      maxTokens: 200,
      temperature: 0.3,
    },
    [{ field: "queries", type: "array" }],
  );

  if (!result) return [query];
  return result.data.queries.length > 0 ? result.data.queries : [query];
}
