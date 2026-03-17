/**
 * Communications bundle — notification log + formal notices / letters.
 */
import { z } from "zod";
import { NonEmptyString, ISODateTime, AddressSchema, AttachmentRefSchema } from "./primitives";

export const NotificationChannelEnum = z.enum(["SMS", "EMAIL", "IN_APP"]);
export const NotificationStatusEnum = z.enum(["SENT", "FAILED", "DELIVERED", "UNKNOWN"]);

export const NotificationLogSchema = z.object({
  channel: NotificationChannelEnum,
  templateCode: NonEmptyString,
  recipient: z.string().optional(),
  sentAt: ISODateTime,
  status: NotificationStatusEnum,
});

export const NoticeTypeEnum = z.enum([
  "QUERY", "DEFICIENCY", "APPROVAL", "REJECTION", "DEMAND_LETTER", "OTHER",
]);

export const DispatchModeEnum = z.enum(["ELECTRONIC", "PHYSICAL"]);

export const NoticeLetterSchema = z.object({
  noticeType: NoticeTypeEnum,
  templateCode: z.string().optional(),
  generatedAt: ISODateTime,
  dispatchMode: DispatchModeEnum.optional(),
  dispatchAddress: AddressSchema.optional(),
  signedArtifact: AttachmentRefSchema.optional(),
  qrToken: z.string().optional(),
});

export const CommunicationsBundleSchema = z.object({
  notifications: z.array(NotificationLogSchema).default([]),
  notices: z.array(NoticeLetterSchema).default([]),
});

export type CommunicationsBundle = z.infer<typeof CommunicationsBundleSchema>;
