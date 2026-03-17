/**
 * Documents bundle — checklist + uploaded documents.
 *
 * Each DocumentUpload now carries:
 *  - `documentId`  — stable UUID across re-uploads (links all versions)
 *  - `version`     — monotonic version counter per document
 *  - `attachments` — allows multiple files per document (e.g. front + back of ID)
 *  - `reviewedBy` / `reviewedAt` / `rejectionReasonCode` — officer review trail
 *
 * The legacy single `attachment` field is retained for backward compatibility
 * but new code should use `attachments[]`.
 */
import { z } from "zod";
import { NonEmptyString, ISODate, ISODateTime, AttachmentRefSchema } from "./primitives";

export const ChecklistItemSchema = z.object({
  docTypeCode: NonEmptyString,
  docName: NonEmptyString,
  mandatory: z.boolean(),
  conditionRuleId: z.string().optional(),
});

export const DocumentVerificationStatusEnum = z.enum(["PENDING", "VERIFIED", "REJECTED"]);

export const DocumentUploadSchema = z.object({
  /** Stable identifier for this document across versions (UUID). */
  documentId: NonEmptyString.optional(),
  /** Monotonically increasing version number; starts at 1. */
  version: z.number().int().min(1).default(1),
  docTypeCode: NonEmptyString,
  docNumber: z.string().optional(),
  docDate: ISODate.optional(),
  issuingAuthority: z.string().optional(),
  validFrom: ISODate.optional(),
  validTo: ISODate.optional(),
  /**
   * @deprecated Use `attachments` for new uploads. Retained for backward compatibility.
   */
  attachment: AttachmentRefSchema.optional(),
  /** Multiple file attachments per document (e.g. front + back of ID card). */
  attachments: z.array(AttachmentRefSchema).default([]),
  verificationStatus: DocumentVerificationStatusEnum.optional(),
  verificationRemarks: z.string().optional(),
  /** User ID of the officer who reviewed this document. */
  reviewedBy: z.string().optional(),
  /** Timestamp when the officer reviewed this document. */
  reviewedAt: ISODateTime.optional(),
  /** Standardised rejection reason code (for analytics / re-upload prompts). */
  rejectionReasonCode: z.string().optional(),
});

export const DocumentsBundleSchema = z.object({
  checklist: z.array(ChecklistItemSchema).default([]),
  uploads: z.array(DocumentUploadSchema).default([]),
});

export type DocumentUpload = z.infer<typeof DocumentUploadSchema>;
export type DocumentsBundle = z.infer<typeof DocumentsBundleSchema>;
