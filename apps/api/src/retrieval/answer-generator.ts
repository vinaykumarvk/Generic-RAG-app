/**
 * Answer generation — LLM call with retrieved chunks as context + citation extraction.
 * FR-014: preset-based word/token limits, model routing, source references.
 * FR-015: Structured references are carried separately in citations.
 * FR-016: Brief/detailed format instructions, caution language, filter suggestions.
 */

import type { LlmProvider, LlmUseCase } from "@puda/api-core";
import type { RankedChunk } from "./reranker";

/** Word/token limits by preset (FR-014/AC-04) */
const PRESET_LIMITS: Record<string, { words: number; tokens: number; maxCitations: number; format: string }> = {
  concise:  { words: 150,  tokens: 4096,  maxCitations: 5,  format: "Use bullet points. Be brief and direct." },
  balanced: { words: 500,  tokens: 8192,  maxCitations: 10, format: "Use clear paragraphs with headers if needed." },
  detailed: { words: 900,  tokens: 32768, maxCitations: 10, format: "Use section headings. Provide thorough analysis with supporting details." },
};

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
  followUpQuestions: string[];
  provider: string;
  model: string;
  promptTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs: number;
}

export interface AnswerScopeContext {
  requestedCaseScopes?: string[];
  matchedCaseScopes?: string[];
  scopeMode?: "single" | "multi" | "global";
  scopeSource?: "explicit_single" | "explicit_multi" | "follow_up_single" | "follow_up_multi" | "global";
}

export async function generateAnswer(
  llmProvider: LlmProvider,
  query: string,
  chunks: RankedChunk[],
  graphContext: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  preset: string = "balanced",
  modelOverride?: string,
  scopeEntities?: Array<{ name: string; type: string }>,
  scopeContext?: AnswerScopeContext,
  useCase: Extract<LlmUseCase, "ANSWER_GENERATION" | "ANSWER_REGENERATION"> = "ANSWER_GENERATION",
): Promise<GeneratedAnswer | null> {
  // FR-014/AC-06: zero-chunks check before LLM call
  if (chunks.length === 0) {
    return null;
  }

  const limits = PRESET_LIMITS[preset] || PRESET_LIMITS.balanced;
  const entityCaseRefs = collectCaseScopes(
    (scopeEntities || [])
      .filter((e) => e.type === "case_ref" || e.type === "CASE_REF")
      .map((e) => e.name.trim())
      .filter(Boolean)
  );
  const requestedCaseScopes = collectCaseScopes(
    scopeContext?.requestedCaseScopes && scopeContext.requestedCaseScopes.length > 0
      ? scopeContext.requestedCaseScopes
      : entityCaseRefs
  );
  const matchedCaseScopes = collectCaseScopes(scopeContext?.matchedCaseScopes || []);
  const scopeMode = scopeContext?.scopeMode || (requestedCaseScopes.length > 1 ? "multi" : requestedCaseScopes.length === 1 ? "single" : "global");

  // Build context from chunks with [Source: Doc, Page X] format (FR-014/AC-03)
  const formattedChunks = chunks.map((chunk, i) => {
    const sourceParts = [chunk.document_title];
    if (chunk.page_start) sourceParts.push(`Page ${chunk.page_start}`);
    if (chunk.case_reference) sourceParts.push(`Case ${chunk.case_reference}`);
    if (chunk.fir_number) sourceParts.push(`FIR ${chunk.fir_number}`);
    if (chunk.scope_status === "MATCH") sourceParts.push("Scope match");
    if (chunk.scope_status === "UNKNOWN") sourceParts.push("Scope unresolved");
    return {
      chunk,
      index: i + 1,
      text: `[${i + 1}] [Source: ${sourceParts.join(", ")}]:\n${chunk.content}`,
    };
  });
  const contextBlock = buildContextBlock(formattedChunks, requestedCaseScopes, scopeMode);

  let scopeInstruction = "";
  if (requestedCaseScopes.length > 1) {
    const refNames = requestedCaseScopes.join(", ");
    const missingCaseScopes = requestedCaseScopes.filter((scope) => !matchedCaseScopes.some((matched) => caseScopeMatches(matched, scope)));
    const comparisonGuidance = looksLikeComparisonQuery(query)
      ? `
- This is a comparison question. Organize the answer by direct differences between the requested cases when possible.
- If evidence is available for only one requested case, explicitly name the missing case and say the comparison is incomplete.`
      : "";
    scopeInstruction = `
SCOPE (IMPORTANT — follow strictly):
- Requested cases for this turn: ${refNames}. Use ONLY evidence from documents that relate to these requested cases.
- Do NOT cite or use evidence from any unrequested case.
- Treat this as a turn-scoped multi-case comparison. Do not reintroduce prior single-case context unless it appears in the retrieved evidence.
- Prefer chunks labeled "Scope match" over chunks labeled "Scope unresolved".${missingCaseScopes.length > 0
  ? `
- Retrieved evidence is missing a confident case match for: ${missingCaseScopes.join(", ")}. State that explicitly.`
  : ""}${comparisonGuidance}`;
  } else if (requestedCaseScopes.length === 1) {
    const refNames = requestedCaseScopes[0];
    scopeInstruction = `
SCOPE (IMPORTANT — follow strictly):
- Requested case for this turn: ${refNames}. Use ONLY evidence from documents that relate to this case.
- Some retrieved chunks may come from other cases (different case/FIR/CR numbers). Do NOT cite or use those chunks as evidence for ${refNames}.
- Prefer chunks labeled "Scope match" over chunks labeled "Scope unresolved".
- Only mention other cases if the user explicitly asks about cross-case connections.`;
  }

  const systemContent = `You are a knowledgeable assistant that answers questions using provided context.

RULES:
- Always cite your sources using [1], [2], etc. notation matching the chunk indices below.
- If the context does not contain enough information to answer, say so clearly.
- Do not make up information not present in the context.
- Keep your answer within approximately ${limits.words} words.
- ${limits.format}
- At the very end, after your answer, add a line "FOLLOW_UP_QUESTIONS:" followed by 2-3 concise follow-up questions the user might ask, one per line.${scopeInstruction}`;

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
    useCase,
    maxTokens: limits.tokens,
    temperature: modelOverride ? undefined : 0.2,
    modelOverride,
  });

  if (!result) return null;

  // Extract follow-up questions and strip from content
  let answerContent = result.content;
  const followUpQuestions: string[] = [];
  const followUpIdx = answerContent.indexOf("FOLLOW_UP_QUESTIONS:");
  if (followUpIdx !== -1) {
    const followUpBlock = answerContent.slice(followUpIdx + "FOLLOW_UP_QUESTIONS:".length).trim();
    followUpBlock.split("\n").forEach((line) => {
      const cleaned = line.replace(/^[-\d.)\s]+/, "").trim();
      if (cleaned.length > 5 && cleaned.length < 200) followUpQuestions.push(cleaned);
    });
    answerContent = answerContent.slice(0, followUpIdx).trim();
  }

  // Extract citations from the answer
  const citationRegex = /\[(\d+)\]/g;
  const citedIndices = new Set<number>();
  let match;
  while ((match = citationRegex.exec(answerContent)) !== null) {
    citedIndices.add(parseInt(match[1], 10));
  }

  const citations = Array.from(citedIndices)
    .filter((i) => i >= 1 && i <= chunks.length)
    .slice(0, limits.maxCitations)
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
    answer: answerContent,
    citations,
    followUpQuestions: followUpQuestions.slice(0, 3),
    provider: result.provider,
    model: result.model,
    promptTokens: result.promptTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
    latencyMs: Date.now() - start,
  };
}

function looksLikeComparisonQuery(query: string): boolean {
  return /\b(compare|comparison|difference|differences|different|versus|vs\.?|contrast|similarit(?:y|ies))\b/i.test(query);
}

function buildContextBlock(
  formattedChunks: Array<{ chunk: RankedChunk; index: number; text: string }>,
  requestedCaseScopes: string[],
  scopeMode: "single" | "multi" | "global",
): string {
  if (scopeMode !== "multi" || requestedCaseScopes.length <= 1) {
    return formattedChunks.map((entry) => entry.text).join("\n\n---\n\n");
  }

  const usedChunkIds = new Set<string>();
  const sections: string[] = [];

  for (const scope of requestedCaseScopes) {
    const caseChunks = formattedChunks.filter((entry) => {
      const matchedScopes = getChunkCaseScopes(entry.chunk);
      return matchedScopes.length === 1 && caseScopeMatches(matchedScopes[0], scope);
    });
    for (const entry of caseChunks) {
      usedChunkIds.add(entry.chunk.chunk_id);
    }
    sections.push(
      `Case ${scope} Evidence:\n${caseChunks.length > 0
        ? caseChunks.map((entry) => entry.text).join("\n\n")
        : "No retrieved evidence for this case."}`
    );
  }

  const sharedChunks = formattedChunks.filter((entry) => !usedChunkIds.has(entry.chunk.chunk_id));
  if (sharedChunks.length > 0) {
    sections.push(
      `Shared / unresolved evidence:\n${sharedChunks.map((entry) => entry.text).join("\n\n")}`
    );
  }

  return sections.join("\n\n---\n\n");
}

function getChunkCaseScopes(chunk: RankedChunk): string[] {
  if (chunk.matched_case_scopes && chunk.matched_case_scopes.length > 0) {
    return collectCaseScopes(chunk.matched_case_scopes);
  }

  const caseSignals: string[] = [];
  if (chunk.case_reference) caseSignals.push(chunk.case_reference);
  if (chunk.fir_number) caseSignals.push(chunk.fir_number);
  caseSignals.push(...extractCaseScopes(chunk.document_title));
  return collectCaseScopes(caseSignals);
}

function extractCaseScopes(text: string): string[] {
  const matches = new Set<string>();
  const patterns = [
    /(?:\bcase\b|\bcr(?:ime)?\b|\bcr\.\b|\bfir\b)\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z0-9]+(?:[/-][A-Z0-9]+)+|\d{1,8})/gi,
    /\b([A-Z0-9]+(?:\/[A-Z0-9]+)+)\b/gi,
    /\b(\d{3,8}\s*(?:\/|-|\bOF\b)\s*\d{2,4})\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const normalized = normalizeCaseScope(match[1] || match[0]);
      if (normalized) matches.add(normalized);
    }
  }

  return Array.from(matches);
}

function collectCaseScopes(values: string[]): string[] {
  const scopes = new Map<string, string>();
  for (const value of values) {
    if (!value || value.trim().length === 0) continue;
    const normalized = normalizeCaseScope(value);
    if (!normalized) continue;
    const key = getCaseScopeKey(normalized);
    const existing = scopes.get(key);
    scopes.set(key, pickPreferredCaseScope(existing, normalized));
  }
  return Array.from(scopes.values());
}

function normalizeCaseScope(value: string): string {
  return value
    .toUpperCase()
    .replace(/\b(CASE|CRIME|CR|FIR|NO|NUMBER)\b/g, " ")
    .replace(/\bOF\b/g, "/")
    .replace(/-/g, "/")
    .replace(/[^A-Z0-9/]+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function getCaseScopeKey(scope: string): string {
  return scope.split("/")[0] || scope;
}

function pickPreferredCaseScope(existing: string | undefined, candidate: string): string {
  if (!existing) return candidate;
  return getCaseScopeSpecificity(candidate) > getCaseScopeSpecificity(existing) ? candidate : existing;
}

function getCaseScopeSpecificity(scope: string): number {
  return scope.includes("/") ? 100 + scope.length : scope.length;
}

function caseScopeMatches(left: string, right: string): boolean {
  if (left === right) return true;
  const leftKey = getCaseScopeKey(left);
  const rightKey = getCaseScopeKey(right);
  if (leftKey !== rightKey) return false;
  return !left.includes("/") || !right.includes("/");
}
