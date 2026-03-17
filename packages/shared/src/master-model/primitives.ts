/**
 * Primitive / reusable Zod types for the PUDA Master Application Model.
 * Derived from Data Model.md JSON Schema $defs.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

export const NonEmptyString = z.string().min(1);
export const ISODate = z.string().date();           // "YYYY-MM-DD"
export const ISODateTime = z.string().datetime({ offset: true }).or(z.string().datetime());
export const Email = z.string().email();
export const Phone = z.string().regex(/^[0-9]{8,15}$/, "Numeric phone, 8-15 digits");
export const Pincode = z.string().regex(/^[0-9]{6}$/, "6-digit PIN code");

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

export const AddressSchema = z.object({
  line1: NonEmptyString,
  line2: z.string().optional(),
  locality: z.string().optional(),
  cityOrVillage: z.string(),
  district: z.string(),
  state: z.string(),
  pincode: Pincode,
});

export type Address = z.infer<typeof AddressSchema>;

// ---------------------------------------------------------------------------
// Attachment reference (for uploaded files)
// ---------------------------------------------------------------------------

export const AttachmentRefSchema = z.object({
  fileId: NonEmptyString,
  fileName: NonEmptyString,
  mimeType: NonEmptyString,
  sizeBytes: z.number().int().min(1),
  sha256: NonEmptyString,
  uploadedAt: ISODateTime,
  uploadedBy: z.enum(["APPLICANT", "REPRESENTATIVE", "OFFICER", "SYSTEM"]).optional(),
});

export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;
