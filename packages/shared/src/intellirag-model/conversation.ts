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
});
export type Citation = z.infer<typeof CitationSchema>;
