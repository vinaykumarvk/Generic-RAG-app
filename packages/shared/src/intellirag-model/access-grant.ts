import { z } from "zod";

// ---------------------------------------------------------------------------
// Access Grant (FR-002)
// ---------------------------------------------------------------------------

export const AccessGrantSchema = z.object({
  grant_id: z.string().uuid(),
  user_id: z.string().uuid(),
  document_id: z.string().uuid().optional(),
  sensitivity_level: z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "SEALED"]).optional(),
  granted_by: z.string().uuid(),
  expires_at: z.string().datetime().optional(),
  created_at: z.string().datetime(),
});
export type AccessGrant = z.infer<typeof AccessGrantSchema>;

export const CreateAccessGrantSchema = z.object({
  user_id: z.string().uuid(),
  document_id: z.string().uuid().optional(),
  sensitivity_level: z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "SEALED"]).optional(),
  expires_at: z.string().datetime().optional(),
});
export type CreateAccessGrant = z.infer<typeof CreateAccessGrantSchema>;
