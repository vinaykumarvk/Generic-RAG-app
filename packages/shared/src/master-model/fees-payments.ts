/**
 * Fees & payments bundle — fee assessments, payment transactions, refund requests.
 *
 * Tier-2 review changes:
 *  - PaymentModeEnum expanded: UPI, CARD, NETBANKING added alongside existing modes.
 *  - PaymentTransactionSchema gains provider-level tracking fields
 *    (providerTransactionId, providerName, failureReason, reconciledAt,
 *     reconciliationStatus) for gateway integration and back-office reconciliation.
 *  - FeeAssessmentSchema gains assessmentVersion and calculatedBy for auditability.
 */
import { z } from "zod";
import { NonEmptyString, ISODate, ISODateTime, AttachmentRefSchema } from "./primitives";

export const FeeAssessmentSchema = z.object({
  feeHeadCode: NonEmptyString,
  baseAmount: z.number().min(0).optional(),
  calculationInputs: z.record(z.string(), z.any()).optional(),
  amount: z.number().min(0),
  currency: z.string().default("INR"),
  waiverOrAdjustment: z.number().min(0).default(0),
  /** Version of the fee schedule used for this assessment (for audit trail). */
  assessmentVersion: z.string().optional(),
  /** Who/what computed this assessment (userId or "SYSTEM"). */
  calculatedBy: z.string().optional(),
});

export const PaymentModeEnum = z.enum([
  "GATEWAY",   // Generic online payment gateway
  "UPI",       // UPI (PhonePe, GPay, BHIM, etc.)
  "CARD",      // Credit / Debit card
  "NETBANKING",// Internet banking
  "CHALLAN",   // Offline challan
  "NEFT",      // Bank transfer (NEFT/RTGS/IMPS)
  "COUNTER",   // Cash / in-person counter payment
]);

export const PaymentStatusEnum = z.enum(["INITIATED", "SUCCESS", "FAILED", "REFUNDED"]);

export const ReconciliationStatusEnum = z.enum([
  "PENDING",      // Not yet reconciled
  "RECONCILED",   // Matched with bank/gateway settlement
  "MISMATCH",     // Amount or reference mismatch
  "MANUAL_REVIEW",// Flagged for manual verification
]);

export const PaymentTransactionSchema = z.object({
  mode: PaymentModeEnum,
  gatewayOrBankRef: z.string().optional(),
  initiatedAt: ISODateTime,
  paidAt: ISODateTime.optional(),
  amount: z.number().min(0),
  status: PaymentStatusEnum,
  receiptNumber: z.string().optional(),
  receiptDate: ISODate.optional(),
  receiptAttachment: AttachmentRefSchema.optional(),
  /** Transaction ID returned by the payment provider (Razorpay, PayU, bank, etc.). */
  providerTransactionId: z.string().optional(),
  /** Payment provider / gateway name for multi-gateway setups. */
  providerName: z.string().optional(),
  /** Human-readable reason if the payment failed or was declined. */
  failureReason: z.string().optional(),
  /** Timestamp when this payment was matched with the bank/gateway settlement. */
  reconciledAt: ISODateTime.optional(),
  /** Status of back-office reconciliation. */
  reconciliationStatus: ReconciliationStatusEnum.optional(),
});

export const RefundStatusEnum = z.enum(["REQUESTED", "APPROVED", "REJECTED", "PROCESSED"]);

export const BankDetailsSchema = z.object({
  accountName: z.string().optional(),
  accountNumber: z.string().optional(),
  ifsc: z.string().optional(),
  bankName: z.string().optional(),
});

export const RefundRequestSchema = z.object({
  reason: NonEmptyString,
  amount: z.number().min(0),
  requestedAt: ISODateTime,
  status: RefundStatusEnum,
  bankDetails: BankDetailsSchema.optional(),
});

export const FeesPaymentsBundleSchema = z.object({
  feeAssessments: z.array(FeeAssessmentSchema).default([]),
  transactions: z.array(PaymentTransactionSchema).default([]),
  refundRequests: z.array(RefundRequestSchema).default([]),
});

export type FeesPaymentsBundle = z.infer<typeof FeesPaymentsBundleSchema>;
