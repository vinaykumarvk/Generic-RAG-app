import { z } from "zod";

// ---------------------------------------------------------------------------
// Ingestion Job (PostgreSQL-backed queue)
// ---------------------------------------------------------------------------

export const JobStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "RETRYING",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobStepSchema = z.enum([
  "VALIDATE",
  "NORMALIZE",
  "CHUNK",
  "EMBED",
  "KG_EXTRACT",
]);
export type JobStep = z.infer<typeof JobStepSchema>;

export const IngestionJobSchema = z.object({
  job_id: z.string().uuid(),
  document_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  step: JobStepSchema,
  status: JobStatusSchema.default("PENDING"),
  priority: z.number().int().default(0),
  attempt: z.number().int().default(0),
  max_attempts: z.number().int().default(3),
  error_message: z.string().optional(),
  progress: z.number().min(0).max(100).default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  locked_until: z.string().datetime().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type IngestionJob = z.infer<typeof IngestionJobSchema>;
