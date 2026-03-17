import { z } from "zod";

// ---------------------------------------------------------------------------
// Chunk
// ---------------------------------------------------------------------------

export const ChunkTypeSchema = z.enum(["NARRATIVE", "TABLE", "HEADING", "LIST", "CODE", "IMAGE_OCR"]);
export type ChunkType = z.infer<typeof ChunkTypeSchema>;

export const ChunkSchema = z.object({
  chunk_id: z.string().uuid(),
  document_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  chunk_index: z.number().int(),
  content: z.string(),
  chunk_type: ChunkTypeSchema.default("NARRATIVE"),
  token_count: z.number().int(),
  page_start: z.number().int().optional(),
  page_end: z.number().int().optional(),
  heading_path: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  // embedding stored as vector(768) in PostgreSQL — not in Zod
  fts_vector: z.string().optional(), // tsvector representation
  created_at: z.string().datetime(),
});
export type Chunk = z.infer<typeof ChunkSchema>;

export const ExtractionResultSchema = z.object({
  extraction_id: z.string().uuid(),
  document_id: z.string().uuid(),
  extraction_type: z.enum(["TEXT", "OCR", "TABLE", "METADATA"]),
  content: z.string(),
  page_number: z.number().int().optional(),
  confidence: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
