import { z } from "zod";

// ---------------------------------------------------------------------------
// Document lifecycle states
// ---------------------------------------------------------------------------

export const DocumentStatusSchema = z.enum([
  "UPLOADED",
  "VALIDATING",
  "NORMALIZING",
  "CONVERTING",
  "METADATA_EXTRACTING",
  "CHUNKING",
  "EMBEDDING",
  "SEARCHABLE",
  "KG_EXTRACTING",
  "ACTIVE",
  "FAILED",
  "DELETED",
  "REPROCESSING",
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export const DocumentSensitivitySchema = z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "SEALED"]);
export type DocumentSensitivity = z.infer<typeof DocumentSensitivitySchema>;

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
  source_path: z.string().optional(),
  gcs_uri: z.string().optional(),
  storage_class: z.string().default("STANDARD"),
  ocr_applied: z.boolean().default(false),
  ocr_confidence: z.number().min(0).max(1).optional(),
  extracted_metadata: z.record(z.string(), z.unknown()).default({}),
  language: z.string().optional(),
  custom_tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  page_count: z.number().int().optional(),
  chunk_count: z.number().int().default(0),
  error_message: z.string().optional(),
  uploaded_by: z.string().uuid(),
  // FR-002: Access control fields
  sensitivity_level: DocumentSensitivitySchema.default("INTERNAL"),
  case_reference: z.string().optional(),
  fir_number: z.string().optional(),
  station_code: z.string().optional(),
  org_unit_id: z.string().uuid().optional(),
  // FR-007: OCR/metadata quality
  review_required: z.boolean().default(false),
  metadata_confidence: z.number().min(0).max(1).optional(),
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
  is_current: z.boolean().default(false),
  created_by: z.string().uuid(),
  created_at: z.string().datetime(),
});
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

export const UploadDocumentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  source_path: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // FR-003/FR-002: Scoping and access control fields
  sensitivity_level: DocumentSensitivitySchema.optional(),
  case_reference: z.string().max(100).optional(),
  fir_number: z.string().max(100).optional(),
  station_code: z.string().max(50).optional(),
  org_unit_id: z.string().uuid().optional(),
  language: z.string().max(10).optional(),
});
export type UploadDocument = z.infer<typeof UploadDocumentSchema>;
