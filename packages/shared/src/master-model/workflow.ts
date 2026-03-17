/**
 * Workflow bundle — jurisdiction, SLA, current stage, assignment, history, queries.
 */
import { z } from "zod";
import { NonEmptyString, ISODateTime } from "./primitives";

export const JurisdictionSchema = z.object({
  zone: z.string().optional(),
  circle: z.string().optional(),
  estateOffice: z.string().optional(),
});

export const SLAClassEnum = z.enum(["NORMAL", "URGENT"]);

export const SLASchema = z.object({
  slaClass: SLAClassEnum.optional(),
  slaStartAt: ISODateTime.optional(),
  slaDueAt: ISODateTime.optional(),
});

export const AssignmentSchema = z.object({
  assignedToUserId: z.string().optional(),
  assignedToRole: z.string().optional(),
  assignedAt: ISODateTime.optional(),
});

export const WorkflowEventSchema = z.object({
  stage: NonEmptyString,
  action: NonEmptyString,
  actorRole: NonEmptyString,
  actorUserId: z.string().optional(),
  actedAt: ISODateTime,
  remarks: z.string().optional(),
  outcome: z.string().optional(),
});

export const EditableSectionEnum = z.enum([
  "APPLICANT", "PROPERTY", "SERVICE_REQUEST", "PARTIES", "DOCUMENTS", "PAYMENTS",
]);

export const FieldUnlockSchema = z.object({
  editableSections: z.array(EditableSectionEnum).default([]),
});

export const QueryCycleSchema = z.object({
  raisedAt: ISODateTime,
  raisedByRole: NonEmptyString,
  reasonCodes: z.array(z.string()).default([]),
  queryRemarks: z.string().optional(),
  responseDueAt: ISODateTime.optional(),
  responseAt: ISODateTime.optional(),
  applicantResponseRemarks: z.string().optional(),
  fieldUnlock: FieldUnlockSchema.optional(),
  resubmissionCount: z.number().int().min(0).default(0),
});

export const WorkflowBundleSchema = z.object({
  jurisdiction: JurisdictionSchema.optional(),
  sla: SLASchema.optional(),
  currentStage: z.string().optional(),
  assignment: AssignmentSchema.optional(),
  history: z.array(WorkflowEventSchema).default([]),
  queryCycles: z.array(QueryCycleSchema).default([]),
});

export type WorkflowBundle = z.infer<typeof WorkflowBundleSchema>;
