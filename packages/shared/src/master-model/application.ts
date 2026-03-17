/**
 * Application header schema — top-level metadata for an application.
 *
 * `status` is the **canonical** application state. `workflow.currentStage`
 * describes *where* inside the workflow the application sits, but the
 * authoritative lifecycle state is always `application.status`.
 *
 * `statusHistory` records every status transition for audit / SLA tracking.
 */
import { z } from "zod";
import { NonEmptyString, ISODateTime } from "./primitives";

export const ApplicationStatusEnum = z.enum([
  "DRAFT",
  "SUBMITTED",
  "UNDER_SCRUTINY",
  "QUERY_RAISED",
  "RESUBMITTED",
  "APPROVED",
  "REJECTED",
  "CLOSED",
]);

export const ChannelEnum = z.enum(["WEB", "MOBILE", "CSC", "COUNTER"]);
export const LanguageEnum = z.enum(["EN", "PA"]);

/**
 * A single entry in the status-change audit trail.
 * Captures who changed the status, when, and optionally why.
 */
export const StatusChangeSchema = z.object({
  from: ApplicationStatusEnum,
  to: ApplicationStatusEnum,
  changedAt: ISODateTime,
  changedBy: z.string().optional(),       // userId or "SYSTEM"
  changedByRole: z.string().optional(),    // e.g. "CLERK", "CITIZEN"
  remarks: z.string().optional(),
});

export type StatusChange = z.infer<typeof StatusChangeSchema>;

export const ApplicationSchema = z.object({
  applicationId: NonEmptyString,
  fileNumber: z.string().optional(),
  /** Canonical lifecycle state — single source of truth. */
  status: ApplicationStatusEnum,
  channel: ChannelEnum,
  language: LanguageEnum.optional(),
  createdAt: ISODateTime,
  submittedAt: ISODateTime.optional(),
  lastUpdatedAt: ISODateTime.optional(),
  /** Ordered history of every status transition (oldest first). */
  statusHistory: z.array(StatusChangeSchema).default([]),
});

export type Application = z.infer<typeof ApplicationSchema>;
