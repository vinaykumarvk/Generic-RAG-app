/**
 * Decision & output artifacts bundle.
 */
import { z } from "zod";
import { NonEmptyString, ISODate, ISODateTime, AttachmentRefSchema } from "./primitives";

export const DecisionTypeEnum = z.enum(["APPROVE", "REJECT", "RETURN", "PARTIAL_APPROVE"]);

export const DecisionSchema = z.object({
  decisionType: DecisionTypeEnum,
  decidedAt: ISODateTime,
  decidedByRole: z.string().optional(),
  decidedByUserId: z.string().optional(),
  reasonCodes: z.array(z.string()).default([]),
  remarks: z.string().optional(),
  conditions: z.array(z.string()).default([]),
});

export const ArtifactTypeEnum = z.enum([
  "CERTIFICATE", "NOC", "LETTER", "ORDER", "PERMISSION", "LICENSE", "OTHER",
]);

export const OutputArtifactSchema = z.object({
  artifactType: ArtifactTypeEnum,
  artifactNumber: NonEmptyString,
  issuedAt: ISODateTime,
  validFrom: ISODate.optional(),
  validTo: ISODate.optional(),
  signedDocument: AttachmentRefSchema.optional(),
  qrToken: z.string().optional(),
});

export const DecisionOutputsBundleSchema = z.object({
  decision: DecisionSchema.optional(),
  outputs: z.array(OutputArtifactSchema).default([]),
});

export type DecisionOutputsBundle = z.infer<typeof DecisionOutputsBundleSchema>;
