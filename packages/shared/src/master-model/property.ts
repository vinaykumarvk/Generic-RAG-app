/**
 * Property schema — plot / unit / building that the application pertains to.
 */
import { z } from "zod";
import { NonEmptyString, ISODate, AddressSchema } from "./primitives";

export const AuthorityEnum = z.enum(["PUDA", "GMADA", "GLADA", "OTHER"]);

export const UsageTypeEnum = z.enum([
  "RESIDENTIAL", "COMMERCIAL", "INSTITUTIONAL", "INDUSTRIAL", "MIXED", "OTHER",
]);

export const PropertyTypeEnum = z.enum([
  "PLOT", "HOUSE", "FLAT", "BOOTH", "SCO", "SCF", "INDUSTRIAL_PLOT", "OTHER",
]);

export const AllotmentRefTypeEnum = z.enum(["LOI", "ALLOTMENT_LETTER", "OTHER"]);

export const AllotmentSchema = z.object({
  referenceType: AllotmentRefTypeEnum.optional(),
  referenceNumber: z.string().optional(),
  allotmentDate: ISODate.optional(),
  allotteeNameAsPerRecord: z.string().optional(),
});

export const RevenueDetailsSchema = z.object({
  khasraNumber: z.string().optional(),
  village: z.string().optional(),
  tehsil: z.string().optional(),
  district: z.string().optional(),
});

export const DimensionsSchema = z.object({
  frontageM: z.number().min(0).optional(),
  depthM: z.number().min(0).optional(),
});

export const BoundariesSchema = z.object({
  north: z.string().optional(),
  south: z.string().optional(),
  east: z.string().optional(),
  west: z.string().optional(),
});

export const PhysicalSchema = z.object({
  plotAreaSqm: z.number().min(0).optional(),
  cornerPlot: z.boolean().optional(),
  dimensions: DimensionsSchema.optional(),
  boundaries: BoundariesSchema.optional(),
});

export const PlanningControlsSchema = z.object({
  permittedLandUse: z.string().optional(),
  groundCoveragePct: z.number().min(0).max(100).optional(),
  far: z.number().min(0).optional(),
  parkingRequirement: z.string().optional(),
});

export const FinancialLedgerSchema = z.object({
  accountId: z.string().optional(),
  outstandingAmount: z.number().min(0).optional(),
  currency: z.string().default("INR"),
});

export const PropertySchema = z.object({
  propertyId: z.string().optional(),
  authority: AuthorityEnum,
  location: NonEmptyString,
  sector: NonEmptyString,
  usageType: UsageTypeEnum,
  propertyType: PropertyTypeEnum,
  propertyNumber: NonEmptyString,
  uniquePropertyNumber: z.string().optional(),
  allotment: AllotmentSchema.optional(),
  revenueDetails: RevenueDetailsSchema.optional(),
  propertyAddress: AddressSchema.optional(),
  physical: PhysicalSchema.optional(),
  planningControls: PlanningControlsSchema.optional(),
  financialLedger: FinancialLedgerSchema.optional(),
});

export type Property = z.infer<typeof PropertySchema>;
