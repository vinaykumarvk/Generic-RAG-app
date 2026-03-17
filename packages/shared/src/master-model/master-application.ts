/**
 * PUDA Master Application Model — top-level schema.
 *
 * This is the canonical shape of `application.data_jsonb`.
 * Not all bundles are required — which bundles are active is controlled by
 * `serviceConfig.modulesEnabled`. In code, use the lenient `MasterApplicationSchema`
 * (all optional) for reads and the strict `validateMasterApplication()` for submit-time.
 */
import { z } from "zod";

import { ApplicationSchema } from "./application";
import { ApplicantSchema } from "./applicant";
import { PropertySchema } from "./property";
import { ServiceRequestSchema } from "./service-request";
import { PartySchema } from "./parties";
import { ProfessionalSchema } from "./professionals";
import { DocumentsBundleSchema } from "./documents";
import { DeclarationsBundleSchema } from "./declarations";
import { WorkflowBundleSchema } from "./workflow";
import { FeesPaymentsBundleSchema } from "./fees-payments";
import { CommunicationsBundleSchema } from "./communications";
import { InspectionsBundleSchema } from "./inspections";
import { DecisionOutputsBundleSchema } from "./decision-outputs";
import { AuditBundleSchema } from "./audit";
import { ServiceConfigSchema, type ServiceConfig } from "./service-config";
import { NonEmptyString, Phone } from "./primitives";

// ---------------------------------------------------------------------------
// Current schema version — bump on every breaking change to data_jsonb shape.
// ---------------------------------------------------------------------------
export const CURRENT_SCHEMA_VERSION = "1.0";

// ---------------------------------------------------------------------------
// Lenient schema — every top-level bundle is optional.
// Use for reading / partial drafts.
// ---------------------------------------------------------------------------

export const MasterApplicationSchema = z.object({
  /** Structural version of this data_jsonb shape. Used for forward-compatible migrations. */
  schemaVersion: z.string().default(CURRENT_SCHEMA_VERSION),
  /** Service pack version that was active when this application was created / last saved. */
  serviceVersion: z.string().optional(),
  /** Authority / tenant that owns this application (e.g. PUDA, GMADA, GLADA). */
  tenantId: z.string().optional(),

  application: ApplicationSchema.optional(),
  applicant: ApplicantSchema.optional(),
  property: PropertySchema.optional(),
  serviceRequest: ServiceRequestSchema.optional(),
  parties: z.array(PartySchema).default([]),
  professionals: z.array(ProfessionalSchema).default([]),
  documents: DocumentsBundleSchema.optional(),
  declarations: DeclarationsBundleSchema.optional(),
  workflow: WorkflowBundleSchema.optional(),
  feesPayments: FeesPaymentsBundleSchema.optional(),
  communications: CommunicationsBundleSchema.optional(),
  inspections: InspectionsBundleSchema.optional(),
  decisionOutputs: DecisionOutputsBundleSchema.optional(),
  audit: AuditBundleSchema.optional(),
  serviceConfig: ServiceConfigSchema.optional(),
}).passthrough(); // allow service-specific extra keys in data_jsonb

export type MasterApplication = z.infer<typeof MasterApplicationSchema>;

// ---------------------------------------------------------------------------
// Submit schema — core sections required for submission.
// Includes compatibility for current UAT payload shapes while preserving
// canonical validation when canonical keys are present.
// ---------------------------------------------------------------------------

const LegacyApplicantCompatSchema = z.object({
  fullName: z.string().optional(),
  full_name: z.string().optional(),
  mobile: z.string().optional(),
}).passthrough().superRefine((applicant, ctx) => {
  if (
    !NonEmptyString.safeParse(applicant.fullName).success &&
    !NonEmptyString.safeParse(applicant.full_name).success
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["full_name"],
      message: "full_name (or fullName) is required",
    });
  }

  if (!Phone.safeParse(applicant.mobile).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mobile"],
      message: "mobile is required and must be 8-15 numeric digits",
    });
  }
});

const LEGACY_PROPERTY_IDENTIFIER_KEYS = [
  "upn",
  "propertyNumber",
  "plotNo",
  "plot_no",
  "plot_number",
  "khasraNumber",
  "khasra_number",
  "uniquePropertyNumber",
];

const LegacyPropertyCompatSchema = z.object({}).passthrough().superRefine((property, ctx) => {
  const hasIdentifier = LEGACY_PROPERTY_IDENTIFIER_KEYS.some((key) => {
    const value = (property as Record<string, unknown>)[key];
    return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
  });
  if (!hasIdentifier) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: `property must include at least one identifier (${LEGACY_PROPERTY_IDENTIFIER_KEYS.join(", ")})`,
    });
  }
});

const SubmissionEnvelopeSchema = z.object({
  serviceConfig: ServiceConfigSchema.optional(),
  parties: z.array(PartySchema).default([]),
  professionals: z.array(ProfessionalSchema).default([]),
  documents: DocumentsBundleSchema.optional(),
  declarations: DeclarationsBundleSchema.optional(),
  feesPayments: FeesPaymentsBundleSchema.optional(),
  inspections: InspectionsBundleSchema.optional(),
}).passthrough();

function prefixIssues(pathPrefix: string, issues: z.ZodIssue[]): z.ZodIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: [pathPrefix, ...issue.path],
  }));
}

export interface SubmissionValidationOptions {
  requireProperty?: boolean;
}

function validateSubmissionCore(
  raw: unknown,
  options: SubmissionValidationOptions = {}
): z.ZodIssue[] {
  const requireProperty = options.requireProperty ?? true;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [{
      code: z.ZodIssueCode.custom,
      path: [],
      message: "submission payload must be an object",
    }];
  }

  const payload = raw as Record<string, unknown>;
  const issues: z.ZodIssue[] = [];

  const applicantRaw = payload.applicant;
  if (applicantRaw === undefined) {
    issues.push({
      code: z.ZodIssueCode.custom,
      path: ["applicant"],
      message: "applicant section is required",
    });
  } else {
    const canonicalApplicant = ApplicantSchema.safeParse(applicantRaw);
    if (!canonicalApplicant.success) {
      const legacyApplicant = LegacyApplicantCompatSchema.safeParse(applicantRaw);
      if (!legacyApplicant.success) {
        issues.push(...prefixIssues("applicant", legacyApplicant.error.issues));
      }
    }
  }

  const propertyRaw = payload.property;
  if (propertyRaw === undefined) {
    if (requireProperty) {
      issues.push({
        code: z.ZodIssueCode.custom,
        path: ["property"],
        message: "property section is required",
      });
    }
  } else {
    const canonicalProperty = PropertySchema.safeParse(propertyRaw);
    if (!canonicalProperty.success) {
      const legacyProperty = LegacyPropertyCompatSchema.safeParse(propertyRaw);
      if (!legacyProperty.success) {
        issues.push(...prefixIssues("property", legacyProperty.error.issues));
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export interface ValidationResult {
  success: boolean;
  data?: MasterApplication;
  errors?: z.ZodIssue[];
}

/**
 * Parse any JSON into the lenient MasterApplication shape.
 * Useful for reading data_jsonb from DB without rejecting legacy data.
 */
export function parseMasterApplication(raw: unknown): ValidationResult {
  const result = MasterApplicationSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues };
}

/**
 * Validate data_jsonb at submit time.
 *
 * 1. Always validates the core sections (applicant and property).
 *    `property` can be made optional via `options.requireProperty = false`.
 *    serviceRequest remains optional for backward compatibility.
 * 2. If a serviceConfig is present, validates that each enabled module's bundle
 *    is present and structurally valid.
 */
export function validateForSubmission(
  raw: unknown,
  options: SubmissionValidationOptions = {}
): ValidationResult {
  // Step 1: parse only what this validator depends on for module gating.
  // This keeps submit validation compatible with legacy applicant/property keys
  // while still validating module toggles from serviceConfig.
  const envelope = SubmissionEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return { success: false, errors: envelope.error.issues };
  }

  // Step 2: validate core
  const coreIssues = validateSubmissionCore(raw, options);
  if (coreIssues.length > 0) {
    return { success: false, errors: coreIssues };
  }

  // Step 3: validate enabled modules if serviceConfig present
  const data = envelope.data;
  const config: ServiceConfig | undefined = data.serviceConfig;

  if (config) {
    const issues: z.ZodIssue[] = [];
    const modules = config.modulesEnabled;

    if (modules.parties && data.parties.length === 0) {
      // Parties enabled but none provided — this is a *warning*, not necessarily blocking.
      // Individual services can make this stricter via service-pack rules.
    }

    if (modules.professionals && data.professionals.length === 0) {
      issues.push({
        code: z.ZodIssueCode.custom,
        path: ["professionals"],
        message: "At least one professional is required when professionals module is enabled",
      });
    }

    if (modules.documents && !data.documents) {
      issues.push({
        code: z.ZodIssueCode.custom,
        path: ["documents"],
        message: "Documents bundle is required when documents module is enabled",
      });
    }

    if (modules.declarations && !data.declarations) {
      issues.push({
        code: z.ZodIssueCode.custom,
        path: ["declarations"],
        message: "Declarations bundle is required when declarations module is enabled",
      });
    }

    if (modules.feesPayments && !data.feesPayments) {
      issues.push({
        code: z.ZodIssueCode.custom,
        path: ["feesPayments"],
        message: "Fees/payments bundle is required when payments module is enabled",
      });
    }

    if (modules.inspections && !data.inspections) {
      // Inspections may be created later by officers; not blocking at submit.
    }

    if (issues.length > 0) {
      return { success: false, errors: issues };
    }
  }

  const canonical = MasterApplicationSchema.safeParse(raw);
  if (canonical.success) {
    return { success: true, data: canonical.data };
  }
  return { success: true, data: raw as MasterApplication };
}
