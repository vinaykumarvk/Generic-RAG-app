import { z } from "zod";

// ---------------------------------------------------------------------------
// Conversation & Message
// ---------------------------------------------------------------------------

export const ConversationSchema = z.object({
  conversation_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string().max(500).optional(),
  preset: z.enum(["concise", "balanced", "detailed"]).default("balanced"),
  message_count: z.number().int().default(0),
  is_pinned: z.boolean().default(false),
  pinned_filters: z.record(z.string(), z.unknown()).default({}),
  is_archived: z.boolean().default(false),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);

export const MessageSchema = z.object({
  message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string(),
  token_count: z.number().int().optional(),
  retrieval_run_id: z.string().uuid().optional(),
  model_provider: z.string().optional(),
  model_id: z.string().optional(),
  latency_ms: z.number().int().optional(),
  created_at: z.string().datetime(),
});
export type Message = z.infer<typeof MessageSchema>;

// ---------------------------------------------------------------------------
// Conversation Summary
// ---------------------------------------------------------------------------

export const ConversationSummarySchema = z.object({
  summary_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  content: z.string(),
  model_provider: z.string().optional(),
  model_id: z.string().optional(),
  latency_ms: z.number().int().optional(),
  token_count: z.number().int().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

export const TRANSLATION_LANGUAGES: Record<string, string> = {
  te: "Telugu",
  ur: "Urdu",
  hi: "Hindi",
};

export const TranslationLanguageSchema = z.enum(["te", "ur", "hi"]);
export type TranslationLanguage = z.infer<typeof TranslationLanguageSchema>;

export const TranslationSchema = z.object({
  translation_id: z.string().uuid(),
  source_type: z.enum(["message", "summary"]),
  source_id: z.string().uuid(),
  target_language: TranslationLanguageSchema,
  translated_content: z.string(),
  model_provider: z.string().optional(),
  model_id: z.string().optional(),
  created_at: z.string().datetime(),
});
export type Translation = z.infer<typeof TranslationSchema>;

export const TranslationRequestSchema = z.object({
  source_type: z.enum(["message", "summary"]),
  source_id: z.string().uuid(),
  target_language: TranslationLanguageSchema,
});

// ---------------------------------------------------------------------------
// Citation
// ---------------------------------------------------------------------------

export const CitationSchema = z.object({
  citation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  chunk_id: z.string().uuid(),
  document_id: z.string().uuid(),
  document_title: z.string(),
  page_number: z.number().int().optional(),
  excerpt: z.string(),
  relevance_score: z.number(),
  citation_index: z.number().int(),
  version_id: z.string().uuid().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;
