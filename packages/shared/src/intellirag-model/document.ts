import { z } from "zod";

// ---------------------------------------------------------------------------
// Document lifecycle states
// ---------------------------------------------------------------------------

export const DocumentStatusSchema = z.enum([
  "UPLOADED",
  "VALIDATING",
  "NORMALIZING",
  "CHUNKING",
  "EMBEDDING",
  "SEARCHABLE",
  "KG_EXTRACTING",
  "ACTIVE",
  "FAILED",
  "DELETED",
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export const DocumentSchema = z.object({
  document_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  file_name: z.string(),
  mime_type: z.string(),
  file_size_bytes: z.number().int(),
  file_path: z.string(),
  sha256: z.string(),
  status: DocumentStatusSchema.default("UPLOADED"),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  page_count: z.number().int().optional(),
  chunk_count: z.number().int().default(0),
  error_message: z.string().optional(),
  uploaded_by: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().optional(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const DocumentVersionSchema = z.object({
  version_id: z.string().uuid(),
  document_id: z.string().uuid(),
  version_number: z.number().int(),
  file_path: z.string(),
  sha256: z.string(),
  file_size_bytes: z.number().int(),
  created_by: z.string().uuid(),
  created_at: z.string().datetime(),
});
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

export const UploadDocumentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UploadDocument = z.infer<typeof UploadDocumentSchema>;
