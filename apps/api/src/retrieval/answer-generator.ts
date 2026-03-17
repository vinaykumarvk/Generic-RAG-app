/**
 * Answer generation — LLM call with retrieved chunks as context + citation extraction.
 */

import type { LlmProvider } from "@puda/api-core";
import type { RankedChunk } from "./reranker";

export interface GeneratedAnswer {
  answer: string;
  citations: Array<{
    citation_index: number;
    chunk_id: string;
    document_id: string;
    document_title: string;
    page_number: number | null;
    excerpt: string;
    relevance_score: number;
  }>;
  provider: string;
  model: string;
  latencyMs: number;
}

export async function generateAnswer(
  llmProvider: LlmProvider,
  query: string,
  chunks: RankedChunk[],
  graphContext: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<GeneratedAnswer | null> {
  // Build context from chunks
  const contextParts = chunks.map((chunk, i) => {
    const pagePart = chunk.page_start ? ` (page ${chunk.page_start})` : "";
    return `[${i + 1}] ${chunk.document_title}${pagePart}:\n${chunk.content}`;
  });

  let systemContent = `You are a knowledgeable assistant that answers questions using provided context.

RULES:
- Always cite your sources using [1], [2], etc. notation matching the chunk indices below.
- If the context does not contain enough information to answer, say so clearly.
- Do not make up information not present in the context.
- Be thorough but concise.`;

  const contextBlock = contextParts.join("\n\n---\n\n");

  let userContent = `Context:\n${contextBlock}`;

  if (graphContext) {
    userContent += `\n\nKnowledge Graph Context:\n${graphContext}`;
  }

  userContent += `\n\nQuestion: ${query}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemContent },
  ];

  // Add conversation history (last 4 turns max for context)
  const recentHistory = conversationHistory.slice(-4);
  for (const msg of recentHistory) {
    messages.push(msg);
  }

  messages.push({ role: "user", content: userContent });

  const start = Date.now();
  const result = await llmProvider.llmComplete({
    messages,
    useCase: "ANSWER_GENERATION",
    maxTokens: 2048,
    temperature: 0.2,
  });

  if (!result) return null;

  // Extract citations from the answer
  const citationRegex = /\[(\d+)\]/g;
  const citedIndices = new Set<number>();
  let match;
  while ((match = citationRegex.exec(result.content)) !== null) {
    citedIndices.add(parseInt(match[1], 10));
  }

  const citations = Array.from(citedIndices)
    .filter((i) => i >= 1 && i <= chunks.length)
    .map((i) => {
      const chunk = chunks[i - 1];
      return {
        citation_index: i,
        chunk_id: chunk.chunk_id,
        document_id: chunk.document_id,
        document_title: chunk.document_title,
        page_number: chunk.page_start,
        excerpt: chunk.content.slice(0, 300),
        relevance_score: chunk.score,
      };
    });

  return {
    answer: result.content,
    citations,
    provider: result.provider,
    model: result.model,
    latencyMs: Date.now() - start,
  };
}
