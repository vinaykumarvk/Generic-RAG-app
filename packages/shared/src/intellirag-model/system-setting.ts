import { z } from "zod";

// ---------------------------------------------------------------------------
// System Setting (FR-023)
// ---------------------------------------------------------------------------

export const SystemSettingValueTypeSchema = z.enum(["string", "number", "boolean", "json"]);
export type SystemSettingValueType = z.infer<typeof SystemSettingValueTypeSchema>;

export const SystemSettingSchema = z.object({
  key: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  value: z.string(),
  value_type: SystemSettingValueTypeSchema.default("string"),
  description: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type SystemSetting = z.infer<typeof SystemSettingSchema>;

export const UpdateSystemSettingSchema = z.object({
  value: z.string().min(1),
});
export type UpdateSystemSetting = z.infer<typeof UpdateSystemSettingSchema>;

export const SYSTEM_SETTING_CATEGORIES = [
  "storage",
  "chunking",
  "knowledge_graph",
  "ocr",
  "retrieval",
] as const;
