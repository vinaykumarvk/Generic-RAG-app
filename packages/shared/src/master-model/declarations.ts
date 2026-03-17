/**
 * Declarations & consents bundle.
 */
import { z } from "zod";
import { NonEmptyString, ISODateTime } from "./primitives";

export const DeclarationItemSchema = z.object({
  code: NonEmptyString,
  text: z.string().optional(),
  accepted: z.boolean(),
  acceptedAt: ISODateTime.optional(),
  acceptedBy: z.enum(["APPLICANT", "REPRESENTATIVE"]).optional(),
});

export const ConsentTypeEnum = z.enum([
  "SMS_EMAIL", "E_SIGN", "E_KYC", "DATA_SHARING", "PUSH_NOTIFICATIONS", "OTHER",
]);

export const ConsentItemSchema = z.object({
  type: ConsentTypeEnum,
  consentFlag: z.boolean(),
  consentAt: ISODateTime.optional(),
});

export const DeclarationsBundleSchema = z.object({
  declarations: z.array(DeclarationItemSchema).default([]),
  consents: z.array(ConsentItemSchema).default([]),
});

export type DeclarationsBundle = z.infer<typeof DeclarationsBundleSchema>;
