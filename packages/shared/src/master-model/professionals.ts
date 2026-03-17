/**
 * Professional schema — architects, engineers, surveyors, etc.
 */
import { z } from "zod";
import { NonEmptyString, ISODate, Phone, Email, AddressSchema } from "./primitives";

export const ProfessionalRoleEnum = z.enum([
  "ARCHITECT", "ENGINEER", "SURVEYOR", "VALUER", "CONTRACTOR", "OTHER",
]);

export const ProfessionalSchema = z.object({
  role: ProfessionalRoleEnum,
  name: NonEmptyString,
  licenseNumber: NonEmptyString,
  validFrom: ISODate.optional(),
  validTo: ISODate.optional(),
  mobile: Phone.optional(),
  email: Email.optional(),
  address: AddressSchema.optional(),
});

export type Professional = z.infer<typeof ProfessionalSchema>;
