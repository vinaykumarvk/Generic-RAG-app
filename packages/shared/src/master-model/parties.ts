/**
 * Party schema — additional parties linked to the application
 * (co-owners, buyers, sellers, transferees, witnesses, etc.)
 */
import { z } from "zod";
import { NonEmptyString, Phone, Email, AddressSchema, AttachmentRefSchema } from "./primitives";
import { IdProofTypeEnum } from "./applicant";

export const PartyRoleEnum = z.enum([
  "CO_OWNER",
  "JOINT_ALLOTTEE",
  "BUYER",
  "SELLER",
  "TRANSFEREE",
  "TRANSFEROR",
  "ATTORNEY",
  "AUTHORIZED_SIGNATORY",
  "WITNESS",
  "OTHER",
]);

export const PartyTypeEnum = z.enum([
  "INDIVIDUAL", "FIRM", "COMPANY", "SOCIETY", "GOVT", "OTHER",
]);

export const PartyIdProofSchema = z.object({
  type: IdProofTypeEnum.optional(),
  number: z.string().optional(),
  document: AttachmentRefSchema.optional(),
});

export const PartySchema = z.object({
  role: PartyRoleEnum,
  partyType: PartyTypeEnum,
  name: NonEmptyString,
  fatherOrSpouseName: z.string().optional(),
  mobile: Phone.optional(),
  email: Email.optional(),
  address: AddressSchema.optional(),
  idProof: PartyIdProofSchema.optional(),
});

export type Party = z.infer<typeof PartySchema>;
