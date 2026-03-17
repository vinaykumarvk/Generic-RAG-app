/**
 * Applicant schema — citizen / entity filing the application.
 */
import { z } from "zod";
import { NonEmptyString, Phone, Email, AddressSchema, AttachmentRefSchema } from "./primitives";

export const ApplicantTypeEnum = z.enum([
  "INDIVIDUAL", "FIRM", "COMPANY", "SOCIETY", "GOVT", "OTHER",
]);

export const RelationshipToPropertyEnum = z.enum([
  "OWNER", "CO_OWNER", "ALLOTTEE", "ATTORNEY", "AUTHORIZED_REPRESENTATIVE", "OTHER",
]);

export const IdProofTypeEnum = z.enum([
  "AADHAAR", "PAN", "PASSPORT", "DRIVING_LICENSE", "VOTER_ID", "OTHER",
]);

export const IdProofSchema = z.object({
  type: IdProofTypeEnum.optional(),
  number: NonEmptyString.optional(),
  document: AttachmentRefSchema.optional(),
});

export const PortalSecuritySchema = z.object({
  otpVerified: z.boolean().optional(),
  securityQuestion: z.string().optional(),
  securityAnswerHash: z.string().optional(),
});

export const ApplicantSchema = z.object({
  fullName: NonEmptyString,
  fatherOrSpouseName: z.string().optional(),
  applicantType: ApplicantTypeEnum.optional(),
  relationshipToProperty: RelationshipToPropertyEnum,
  mobile: Phone,
  alternateMobile: Phone.optional(),
  email: Email.optional(),
  landline: Phone.optional(),
  permanentAddress: AddressSchema.optional(),
  correspondenceAddress: AddressSchema.optional(),
  idProof: IdProofSchema.optional(),
  portalSecurity: PortalSecuritySchema.optional(),
});

export type Applicant = z.infer<typeof ApplicantSchema>;
