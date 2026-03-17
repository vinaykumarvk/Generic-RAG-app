/**
 * Audit bundle — versioning + field-level change tracking.
 */
import { z } from "zod";
import { NonEmptyString, ISODateTime } from "./primitives";

export const AuditEventSchema = z.object({
  entity: NonEmptyString,
  action: NonEmptyString,
  field: z.string().optional(),
  oldValue: z.any().optional(),
  newValue: z.any().optional(),
  actorRole: z.string().optional(),
  actorUserId: z.string().optional(),
  timestamp: ISODateTime,
});

export const AuditBundleSchema = z.object({
  draftVersion: z.number().int().min(0).default(0),
  submittedVersion: z.number().int().min(0).default(0),
  events: z.array(AuditEventSchema).default([]),
});

export type AuditBundle = z.infer<typeof AuditBundleSchema>;
