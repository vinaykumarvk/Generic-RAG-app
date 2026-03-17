/**
 * Entity detection — extract key entities from query via LLM.
 */

import type { LlmProvider } from "@puda/api-core";

export interface DetectedEntity {
  name: string;
  type: string;
}

export async function detectEntities(
  llmProvider: LlmProvider,
  query: string,
): Promise<DetectedEntity[]> {
  const result = await llmProvider.llmCompleteJson<{ entities: DetectedEntity[] }>(
    {
      messages: [
        {
          role: "user",
          content: `Extract key entities (people, organizations, concepts, dates, locations, technical terms) from this question.

Question: ${query}

Return JSON: {"entities": [{"name": "...", "type": "person|org|concept|date|location|term"}]}`,
        },
      ],
      useCase: "ENTITY_DETECTION",
      maxTokens: 300,
      temperature: 0.1,
    },
    [{ field: "entities", type: "array" }],
  );

  return result?.data.entities || [];
}
