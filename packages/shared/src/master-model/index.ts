/**
 * PUDA Master Application Model — barrel export.
 *
 * Usage:
 *   import { MasterApplicationSchema, parseMasterApplication, validateForSubmission } from "@puda/shared/master-model";
 *   import type { MasterApplication, Applicant, Property } from "@puda/shared/master-model";
 */

// Primitives
export {
  NonEmptyString,
  ISODate,
  ISODateTime,
  Email,
  Phone,
  Pincode,
  AddressSchema,
  AttachmentRefSchema,
  type Address,
  type AttachmentRef,
} from "./primitives";

// Application header
export {
  ApplicationSchema,
  ApplicationStatusEnum,
  ChannelEnum,
  LanguageEnum,
  StatusChangeSchema,
  type Application,
  type StatusChange,
} from "./application";

// Applicant
export {
  ApplicantSchema,
  ApplicantTypeEnum,
  RelationshipToPropertyEnum,
  IdProofTypeEnum,
  IdProofSchema,
  PortalSecuritySchema,
  type Applicant,
} from "./applicant";

// Property
export {
  PropertySchema,
  AuthorityEnum,
  UsageTypeEnum,
  PropertyTypeEnum,
  AllotmentRefTypeEnum,
  AllotmentSchema,
  RevenueDetailsSchema,
  PhysicalSchema,
  PlanningControlsSchema,
  FinancialLedgerSchema,
  type Property,
} from "./property";

// Service request
export {
  ServiceRequestSchema,
  RequestTypeEnum,
  DeliveryModeEnum,
  DataTypeEnum,
  ServiceParameterSchema,
  type ServiceRequest,
} from "./service-request";

// Parties
export {
  PartySchema,
  PartyRoleEnum,
  PartyTypeEnum,
  type Party,
} from "./parties";

// Professionals
export {
  ProfessionalSchema,
  ProfessionalRoleEnum,
  type Professional,
} from "./professionals";

// Documents
export {
  DocumentsBundleSchema,
  ChecklistItemSchema,
  DocumentUploadSchema,
  DocumentVerificationStatusEnum,
  type DocumentUpload,
  type DocumentsBundle,
} from "./documents";

// Declarations
export {
  DeclarationsBundleSchema,
  DeclarationItemSchema,
  ConsentItemSchema,
  ConsentTypeEnum,
  type DeclarationsBundle,
} from "./declarations";

// Workflow
export {
  WorkflowBundleSchema,
  JurisdictionSchema,
  SLASchema,
  SLAClassEnum,
  AssignmentSchema,
  WorkflowEventSchema,
  QueryCycleSchema,
  EditableSectionEnum,
  FieldUnlockSchema,
  type WorkflowBundle,
} from "./workflow";

// Fees & payments
export {
  FeesPaymentsBundleSchema,
  FeeAssessmentSchema,
  PaymentTransactionSchema,
  PaymentModeEnum,
  PaymentStatusEnum,
  ReconciliationStatusEnum,
  RefundRequestSchema,
  RefundStatusEnum,
  BankDetailsSchema,
  type FeesPaymentsBundle,
} from "./fees-payments";

// Communications
export {
  CommunicationsBundleSchema,
  NotificationLogSchema,
  NotificationChannelEnum,
  NotificationStatusEnum,
  NoticeLetterSchema,
  NoticeTypeEnum,
  DispatchModeEnum,
  type CommunicationsBundle,
} from "./communications";

// Inspections
export {
  InspectionsBundleSchema,
  AppointmentRequestSchema,
  InspectionRecordSchema,
  InspectionOutcomeEnum,
  type InspectionsBundle,
} from "./inspections";

// Decision & outputs
export {
  DecisionOutputsBundleSchema,
  DecisionSchema,
  DecisionTypeEnum,
  OutputArtifactSchema,
  ArtifactTypeEnum,
  type DecisionOutputsBundle,
} from "./decision-outputs";

// Audit
export {
  AuditBundleSchema,
  AuditEventSchema,
  type AuditBundle,
} from "./audit";

// Service config
export {
  ServiceConfigSchema,
  ModulesEnabledSchema,
  type ServiceConfig,
} from "./service-config";

// Master application (top-level)
export {
  CURRENT_SCHEMA_VERSION,
  MasterApplicationSchema,
  parseMasterApplication,
  validateForSubmission,
  type MasterApplication,
  type ValidationResult,
} from "./master-application";
