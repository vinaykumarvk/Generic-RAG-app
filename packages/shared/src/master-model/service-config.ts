/**
 * ServiceConfig — per-service module toggles that control which bundles are active.
 */
import { z } from "zod";

export const ModulesEnabledSchema = z.object({
  parties: z.boolean(),
  professionals: z.boolean(),
  documents: z.boolean(),
  declarations: z.boolean(),
  workflow: z.boolean(),
  feesPayments: z.boolean(),
  communications: z.boolean(),
  inspections: z.boolean(),
  decisionOutputs: z.boolean(),
  audit: z.boolean(),
});

export const ServiceConfigSchema = z.object({
  modulesEnabled: ModulesEnabledSchema,
});

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
