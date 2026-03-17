/**
 * ServiceRequest schema — what the citizen is asking for.
 *
 * Tier-2 review change:
 *  - `parametersMap` added as a typed key→value object alongside the legacy
 *    `parameters` array.  New service packs should prefer `parametersMap` for
 *    easier querying and validation; the array is retained for backward
 *    compatibility with existing UAT-1 services.
 */
import { z } from "zod";
import { NonEmptyString, ISODate } from "./primitives";

export const RequestTypeEnum = z.enum([
  "NEW", "RENEWAL", "AMENDMENT", "DUPLICATE", "CORRECTION", "TRANSFER", "NOC", "OTHER",
]);

export const DeliveryModeEnum = z.enum(["DOWNLOAD", "COLLECT", "POST"]);

export const DataTypeEnum = z.enum([
  "STRING", "NUMBER", "BOOLEAN", "DATE", "ENUM", "JSON",
]);

export const ServiceParameterSchema = z.object({
  name: NonEmptyString,
  value: z.any(),
  dataType: DataTypeEnum.optional(),
  validationRuleId: z.string().optional(),
});

export const ServiceRequestSchema = z.object({
  serviceCategory: NonEmptyString,
  serviceCode: z.string().optional(),
  serviceName: NonEmptyString,
  requestType: RequestTypeEnum,
  purposeCode: z.string().optional(),
  purposeRemarks: z.string().optional(),
  effectiveDate: ISODate.optional(),
  preferredDeliveryMode: DeliveryModeEnum.optional(),
  /**
   * @deprecated Prefer `parametersMap` for new services.
   * Retained for backward compatibility with UAT-1 service packs.
   */
  parameters: z.array(ServiceParameterSchema).default([]),
  /**
   * Service-specific parameters as a typed key→value map.
   * Schema per service is defined in the service pack's rules/form config.
   * Easier to query (e.g. `data_jsonb->'serviceRequest'->'parametersMap'->>'feeWaiver'`)
   * and validate than the array form.
   */
  parametersMap: z.record(z.string(), z.unknown()).optional(),
});

export type ServiceRequest = z.infer<typeof ServiceRequestSchema>;
