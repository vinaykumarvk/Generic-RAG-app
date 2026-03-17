import { z } from "zod";

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export const FeedbackTypeSchema = z.enum(["THUMBS_UP", "THUMBS_DOWN", "CORRECTION", "FLAG"]);
export type FeedbackType = z.infer<typeof FeedbackTypeSchema>;

export const FeedbackSchema = z.object({
  feedback_id: z.string().uuid(),
  message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  feedback_type: FeedbackTypeSchema,
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).optional(),
  correction: z.string().max(4000).optional(),
  created_at: z.string().datetime(),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

export const SubmitFeedbackSchema = z.object({
  message_id: z.string().uuid(),
  feedback_type: FeedbackTypeSchema,
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).optional(),
  correction: z.string().max(4000).optional(),
});
export type SubmitFeedback = z.infer<typeof SubmitFeedbackSchema>;
