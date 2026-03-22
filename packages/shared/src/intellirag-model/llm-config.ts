import { z } from "zod";

// ---------------------------------------------------------------------------
// RAG-specific LLM Use Cases
// ---------------------------------------------------------------------------

export const RagLlmUseCaseSchema = z.enum([
  "EMBEDDING",
  "CHUNK_SUMMARY",
  "KG_EXTRACTION",
  "QUERY_EXPANSION",
  "ENTITY_DETECTION",
  "RERANK",
  "ANSWER_GENERATION",
  "ANSWER_REGENERATION",
  "DOCUMENT_CLASSIFY",
  "OCR_CORRECTION",
  "GENERAL",
]);
export type RagLlmUseCase = z.infer<typeof RagLlmUseCaseSchema>;
