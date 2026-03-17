/**
 * Inspections bundle — appointment requests + inspection records.
 */
import { z } from "zod";
import { NonEmptyString, ISODate, ISODateTime, AttachmentRefSchema } from "./primitives";

export const AppointmentRequestSchema = z.object({
  preferredSlot: z.string().optional(),
  preferredDate: ISODate.optional(),
  remarks: z.string().optional(),
});

export const InspectionOutcomeEnum = z.enum(["PASS", "FAIL", "REINSPECTION_REQUIRED", "NA"]);

export const InspectionRecordSchema = z.object({
  inspectionType: NonEmptyString,
  scheduledAt: ISODateTime,
  actualAt: ISODateTime.optional(),
  officerUserId: z.string().optional(),
  findingsSummary: z.string().optional(),
  observations: z.record(z.string(), z.any()).optional(),
  photos: z.array(AttachmentRefSchema).default([]),
  outcome: InspectionOutcomeEnum.optional(),
});

export const InspectionsBundleSchema = z.object({
  appointmentRequest: AppointmentRequestSchema.optional(),
  inspectionRecords: z.array(InspectionRecordSchema).default([]),
});

export type InspectionsBundle = z.infer<typeof InspectionsBundleSchema>;
