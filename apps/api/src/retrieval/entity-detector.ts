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
          content: `Extract key entities from this question. Entity types:
- person, org, concept, date, location, term (general)
- case_ref: case/FIR references (e.g. "case 424/2021", "Cr. No. 424/2021", "FIR 123/2020")
- station: police station or office names
- language: spoken/written language references

Question: ${query}

Return JSON: {"entities": [{"name": "...", "type": "person|org|concept|date|location|term|case_ref|station|language"}]}`,
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
