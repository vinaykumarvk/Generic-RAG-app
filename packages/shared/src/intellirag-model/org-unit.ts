import { z } from "zod";

// ---------------------------------------------------------------------------
// Org Unit (FR-003)
// ---------------------------------------------------------------------------

export const OrgUnitSchema = z.object({
  org_unit_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  parent_id: z.string().uuid().optional(),
  is_active: z.boolean().default(true),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type OrgUnit = z.infer<typeof OrgUnitSchema>;

export const CreateOrgUnitSchema = z.object({
  name: z.string().min(1).max(200),
  parent_id: z.string().uuid().optional(),
});
export type CreateOrgUnit = z.infer<typeof CreateOrgUnitSchema>;

export const UpdateOrgUnitSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});
export type UpdateOrgUnit = z.infer<typeof UpdateOrgUnitSchema>;
