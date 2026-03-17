import { z } from "zod";

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export const WorkspaceStatusSchema = z.enum(["ACTIVE", "ARCHIVED", "SUSPENDED"]);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

export const DocumentTaxonomySchema = z.object({
  categories: z.array(z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    subcategories: z.array(z.object({
      id: z.string(),
      label: z.string(),
    })).optional(),
  })),
});
export type DocumentTaxonomy = z.infer<typeof DocumentTaxonomySchema>;

export const KgOntologySchema = z.object({
  nodeTypes: z.array(z.object({
    type: z.string(),
    label: z.string(),
    color: z.string().optional(),
  })),
  edgeTypes: z.array(z.object({
    type: z.string(),
    label: z.string(),
    directed: z.boolean().default(true),
  })),
});
export type KgOntology = z.infer<typeof KgOntologySchema>;

export const WorkspaceSettingsSchema = z.object({
  embeddingModel: z.string().default("nomic-embed-text"),
  embeddingDimensions: z.number().int().default(768),
  chunkSize: z.number().int().default(700),
  chunkOverlap: z.number().default(0.12),
  maxFileBytes: z.number().int().default(52_428_800),
  allowedMimeTypes: z.array(z.string()).default([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/markdown",
    "text/csv",
  ]),
  taxonomy: DocumentTaxonomySchema.optional(),
  kgOntology: KgOntologySchema.optional(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const WorkspaceSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(100),
  description: z.string().optional(),
  status: WorkspaceStatusSchema.default("ACTIVE"),
  settings: WorkspaceSettingsSchema.default({
    embeddingModel: "nomic-embed-text",
    embeddingDimensions: 768,
    chunkSize: 700,
    chunkOverlap: 0.12,
    maxFileBytes: 52_428_800,
    allowedMimeTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/markdown",
      "text/csv",
    ],
  }),
  created_by: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(100),
  description: z.string().optional(),
  settings: WorkspaceSettingsSchema.optional(),
});
export type CreateWorkspace = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  settings: WorkspaceSettingsSchema.partial().optional(),
  status: WorkspaceStatusSchema.optional(),
});
export type UpdateWorkspace = z.infer<typeof UpdateWorkspaceSchema>;
