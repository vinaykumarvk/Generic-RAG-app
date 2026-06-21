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

export const KgNodeTypeDefSchema = z.object({
  type: z.string(),
  label: z.string(),
  color: z.string().optional(),
  subtypes: z.array(z.string()).optional(),
  attributeSchema: z.record(z.string(), z.object({
    type: z.string(),
    required: z.boolean().optional(),
    controlled: z.array(z.string()).optional(),
  })).optional(),
});
export type KgNodeTypeDef = z.infer<typeof KgNodeTypeDefSchema>;

export const KgEdgeTypeDefSchema = z.object({
  type: z.string(),
  label: z.string(),
  directed: z.boolean().default(true),
  sourceTypes: z.array(z.string()).optional(),
  targetTypes: z.array(z.string()).optional(),
});
export type KgEdgeTypeDef = z.infer<typeof KgEdgeTypeDefSchema>;

export const KgOntologySchema = z.object({
  version: z.string().optional(),
  domain: z.string().optional(),
  description: z.string().optional(),
  closedSchema: z.boolean().optional(),
  nodeTypes: z.array(KgNodeTypeDefSchema),
  edgeTypes: z.array(KgEdgeTypeDefSchema),
  assertionTypes: z.array(z.string()).optional(),
  extractionRules: z.array(z.string()).optional(),
  answerUseGuidance: z.array(z.string()).optional(),
  phase0EvidenceContract: z.record(z.string(), z.unknown()).optional(),
  extractionTemplates: z.record(z.string(), z.object({
    prompt: z.string(),
    examples: z.array(z.string()).optional(),
  })).optional(),
  controlledVocabularies: z.record(z.string(), z.array(z.string())).optional(),
}).passthrough();
export type KgOntology = z.infer<typeof KgOntologySchema>;

export const WorkspaceKindSchema = z.enum(["general", "case_history", "judgments"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

export const JudgmentRetrievalProfileSchema = z.enum([
  "case_specific",
  "doctrine",
  "pattern_analysis",
  "officer_lesson",
  "precedent_trace",
  "comparison",
]);
export type JudgmentRetrievalProfile = z.infer<typeof JudgmentRetrievalProfileSchema>;

export const RetrievalProfileConfigSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  weights: z.record(z.string(), z.number()).optional(),
  requiresCorpusCard: z.boolean().optional(),
  requiresReviewedWiki: z.boolean().optional(),
  requiresSourceCitations: z.boolean().optional(),
}).passthrough();
export type RetrievalProfileConfig = z.infer<typeof RetrievalProfileConfigSchema>;

export const WorkspaceSettingsSchema = z.object({
  workspaceKind: WorkspaceKindSchema.default("general").optional(),
  embeddingModel: z.string().default("text-embedding-3-large"),
  embeddingDimensions: z.number().int().default(1536),
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
  kgOntologyVersion: z.string().optional(),
  retrievalProfiles: z.record(z.string(), RetrievalProfileConfigSchema).optional(),
  defaultRetrievalProfile: JudgmentRetrievalProfileSchema.optional(),
  sourceIdentifiers: z.array(z.string()).optional(),
  judgmentEvidenceContract: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const WorkspaceSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(100),
  description: z.string().optional(),
  status: WorkspaceStatusSchema.default("ACTIVE"),
  settings: WorkspaceSettingsSchema.default({
    embeddingModel: "text-embedding-3-large",
    embeddingDimensions: 1536,
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
