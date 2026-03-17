import { z } from "zod";

// ---------------------------------------------------------------------------
// Knowledge Graph
// ---------------------------------------------------------------------------

export const GraphNodeSchema = z.object({
  node_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string().min(1),
  normalized_name: z.string(),
  node_type: z.string(),
  description: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
  source_count: z.number().int().default(1),
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
