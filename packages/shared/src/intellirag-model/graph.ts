import { z } from "zod";

// ---------------------------------------------------------------------------
// Knowledge Graph
// ---------------------------------------------------------------------------

export const SensitivityLevelSchema = z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "RESTRICTED"]);
export type SensitivityLevel = z.infer<typeof SensitivityLevelSchema>;

export const GraphNodeSchema = z.object({
  node_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string().min(1),
  normalized_name: z.string(),
  node_type: z.string(),
  subtype: z.string().optional(),
  description: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
  source_count: z.number().int().default(1),
  confidence: z.number().min(0).max(1).default(1.0),
  sensitivity_level: SensitivityLevelSchema.default("NONE"),
  aliases: z.array(z.string()).default([]),
  // description_embedding stored as vector(768) in PostgreSQL
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  edge_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  source_node_id: z.string().uuid(),
  target_node_id: z.string().uuid(),
  edge_type: z.string(),
  label: z.string().optional(),
  weight: z.number().default(1.0),
  properties: z.record(z.string(), z.unknown()).default({}),
  evidence_chunk_id: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
  created_at: z.string().datetime(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

// ---------------------------------------------------------------------------
// KG Assertion
// ---------------------------------------------------------------------------

export const KgAssertionTypeSchema = z.enum([
  "CLAIM", "CONTRADICTION", "FINDING", "OPINION", "FACT", "ALLEGATION", "RULING",
]);
export type KgAssertionType = z.infer<typeof KgAssertionTypeSchema>;

export const KgAssertionStatusSchema = z.enum(["ACTIVE", "RETRACTED", "SUPERSEDED"]);
export type KgAssertionStatus = z.infer<typeof KgAssertionStatusSchema>;

export const KgAssertionSchema = z.object({
  assertion_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  assertion_type: KgAssertionTypeSchema,
  subject_node_id: z.string().uuid().optional(),
  predicate: z.string(),
  object_node_id: z.string().uuid().optional(),
  object_value: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1.0),
  status: KgAssertionStatusSchema.default("ACTIVE"),
  evidence_edge_id: z.string().uuid().optional(),
  source_chunk_id: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type KgAssertion = z.infer<typeof KgAssertionSchema>;

// ---------------------------------------------------------------------------
// KG Provenance
// ---------------------------------------------------------------------------

export const KgProvenanceEntityTypeSchema = z.enum(["NODE", "EDGE", "ASSERTION"]);
export type KgProvenanceEntityType = z.infer<typeof KgProvenanceEntityTypeSchema>;

export const KgProvenanceSchema = z.object({
  provenance_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  entity_type: KgProvenanceEntityTypeSchema,
  entity_id: z.string().uuid(),
  source_chunk_id: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
  extraction_model: z.string().optional(),
  extraction_prompt_hash: z.string().optional(),
  raw_extraction: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().min(0).max(1).default(1.0),
  extracted_at: z.string().datetime(),
});
export type KgProvenance = z.infer<typeof KgProvenanceSchema>;
