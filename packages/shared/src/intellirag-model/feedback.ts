import { z } from "zod";

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export const FeedbackTypeSchema = z.enum(["THUMBS_UP", "THUMBS_DOWN", "CORRECTION", "FLAG"]);
export type FeedbackType = z.infer<typeof FeedbackTypeSchema>;

export const FeedbackLevelSchema = z.enum(["HELPFUL", "PARTIALLY_HELPFUL", "NOT_HELPFUL"]);
export type FeedbackLevel = z.infer<typeof FeedbackLevelSchema>;

export const FeedbackSchema = z.object({
  feedback_id: z.string().uuid(),
  message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  feedback_type: FeedbackTypeSchema,
  feedback_level: FeedbackLevelSchema.optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).optional(),
  correction: z.string().max(4000).optional(),
  issue_tags: z.array(z.string()).default([]),
  admin_notes: z.string().optional(),
  resolved_at: z.string().datetime().optional(),
  resolved_by: z.string().uuid().optional(),
  created_at: z.string().datetime(),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

export const SubmitFeedbackSchema = z.object({
  message_id: z.string().uuid(),
  feedback_type: FeedbackTypeSchema,
  feedback_level: FeedbackLevelSchema.optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).optional(),
  correction: z.string().max(4000).optional(),
  issue_tags: z.array(z.string().max(50)).max(10).optional(),
});
export type SubmitFeedback = z.infer<typeof SubmitFeedbackSchema>;

export const ResolveFeedbackSchema = z.object({
  admin_notes: z.string().max(4000),
});
export type ResolveFeedback = z.infer<typeof ResolveFeedbackSchema>;
