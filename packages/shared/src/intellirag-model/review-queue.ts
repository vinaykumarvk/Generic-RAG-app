import { z } from "zod";

// ---------------------------------------------------------------------------
// Review Queue (FR-011, FR-012)
// ---------------------------------------------------------------------------

export const ReviewEntityTypeSchema = z.enum(["DOCUMENT", "GRAPH_NODE", "GRAPH_EDGE", "CHUNK", "METADATA"]);
export type ReviewEntityType = z.infer<typeof ReviewEntityTypeSchema>;

export const ReviewStatusSchema = z.enum(["OPEN", "ASSIGNED", "RESOLVED", "DISMISSED"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const ReviewQueueSchema = z.object({
  review_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  entity_type: ReviewEntityTypeSchema,
  entity_id: z.string().uuid(),
  reason: z.string(),
  status: ReviewStatusSchema.default("OPEN"),
  assigned_to: z.string().uuid().optional(),
  resolved_by: z.string().uuid().optional(),
  resolution: z.string().optional(),
  created_at: z.string().datetime(),
  resolved_at: z.string().datetime().optional(),
});
export type ReviewQueue = z.infer<typeof ReviewQueueSchema>;

export const ResolveReviewSchema = z.object({
  resolution: z.string().min(1).max(2000),
  status: z.enum(["RESOLVED", "DISMISSED"]),
});
export type ResolveReview = z.infer<typeof ResolveReviewSchema>;
