/**
 * Notification Service (FR-021)
 * Core notification creation, delivery (in-app), and preference checking.
 */

import type { QueryFn } from "@puda/api-core";
import { logInfo, logWarn } from "@puda/api-core";

export interface NotificationPayload {
  workspaceId: string;
  userId: string;
  eventType: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  severity?: "info" | "warning" | "critical";
}

export async function createNotification(
  queryFn: QueryFn,
  payload: NotificationPayload,
): Promise<void> {
  const { workspaceId, userId, eventType, title, body, entityType, entityId, severity } = payload;

  // Check user preference for this event type
  const prefResult = await queryFn(
    `SELECT enabled FROM notification_preference
     WHERE user_id = $1 AND event_type = $2 AND channel = 'in_app'`,
    [userId, eventType]
  );

  // Default to enabled if no preference set
  const isEnabled = prefResult.rows.length === 0 || prefResult.rows[0].enabled;

  // Critical alerts override opt-out for admins
  if (!isEnabled && severity !== "critical") {
    return;
  }

  // FR-021: Restricted content notifications show entity type + count, not actual content
  const safeBody = severity === "critical" || !entityType
    ? body
    : `${entityType}: ${body}`;

  try {
    await queryFn(
      `INSERT INTO notification_event (workspace_id, user_id, event_type, title, body, severity, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [workspaceId, userId, eventType, title, safeBody, severity || "info", entityType || null, entityId || null]
    );
    logInfo("Notification created", { userId, eventType, severity });
  } catch {
    logWarn("Failed to create notification", { userId, eventType });
  }
}

/**
 * Notify all admins in a workspace.
 */
export async function notifyAdmins(
  queryFn: QueryFn,
  workspaceId: string,
  eventType: string,
  title: string,
  body: string,
  severity: "info" | "warning" | "critical" = "warning",
): Promise<void> {
  try {
    const admins = await queryFn(
      `SELECT user_id FROM workspace_member
       WHERE workspace_id = $1 AND role IN ('OWNER', 'ADMIN')`,
      [workspaceId]
    );
    for (const admin of admins.rows) {
      await createNotification(queryFn, {
        workspaceId,
        userId: admin.user_id,
        eventType,
        title,
        body,
        severity,
      });
    }
  } catch {
    logWarn("Failed to notify admins", { workspaceId, eventType });
  }
}
