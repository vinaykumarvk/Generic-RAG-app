/**
 * Notification routes — /api/v1/notifications (FR-021)
 * List, mark read, dismiss, update preferences.
 */

import { FastifyInstance, FastifyReply } from "fastify";
import { send400, send404 } from "@puda/api-core";
import type { QueryFn } from "@puda/api-core";

export function createNotificationRoutes(app: FastifyInstance, deps: { queryFn: QueryFn }) {
  const { queryFn } = deps;

  const workspaceScopeClause = (userParamIndex: number) => `
    (workspace_id IS NULL OR EXISTS (
      SELECT 1
      FROM workspace_member wm
      WHERE wm.workspace_id = notification_event.workspace_id
        AND wm.user_id = $${userParamIndex}
    ))
  `;

  const upsertPreference = async (
    userId: string,
    eventType: string,
    channel: string,
    enabled: boolean,
  ) => {
    await queryFn(
      `INSERT INTO notification_preference (user_id, event_type, channel, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, event_type, channel)
       DO UPDATE SET enabled = $4`,
      [userId, eventType, channel, enabled]
    );
  };

  // List notifications for current user
  app.get<{ Querystring: { status?: string; page?: string; limit?: string } }>(
    "/api/v1/notifications",
    async (request) => {
      const userId = request.authUser!.userId;
      const page = Math.max(1, parseInt(request.query.page || "1", 10));
      const limit = Math.min(50, Math.max(1, parseInt(request.query.limit || "20", 10)));
      const offset = (page - 1) * limit;

      let whereClause = `${workspaceScopeClause(1)} AND dismissed_at IS NULL`;
      const params: unknown[] = [userId];

      if (request.query.status === "unread") {
        whereClause += " AND read_at IS NULL";
      }

      const [countResult, result] = await Promise.all([
        queryFn(`SELECT count(*) FROM notification_event WHERE ${whereClause}`, params),
        queryFn(
          `SELECT event_id, workspace_id, event_type, title, description AS body, severity, read_at, created_at
           FROM notification_event
           WHERE ${whereClause}
           ORDER BY created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        ),
      ]);

      // Unread count
      const unreadResult = await queryFn(
        `SELECT count(*)
         FROM notification_event
         WHERE ${workspaceScopeClause(1)}
           AND read_at IS NULL
           AND dismissed_at IS NULL`,
        [userId]
      );

      return {
        notifications: result.rows,
        total: parseInt(countResult.rows[0].count, 10),
        unread_count: parseInt(unreadResult.rows[0].count, 10),
        page,
        limit,
      };
    }
  );

  // Mark notification as read
  const markReadHandler = async (
    request: { params: { id: string }; authUser?: { userId: string } },
    reply: FastifyReply,
  ) => {
    const result = await queryFn(
      `UPDATE notification_event
       SET read_at = COALESCE(read_at, now())
       WHERE event_id = $1
         AND (${workspaceScopeClause(2)})
       RETURNING event_id`,
      [request.params.id, request.authUser!.userId]
    );
    if (result.rows.length === 0) return send404(reply, "Notification not found");
    return { read: true };
  };

  app.patch<{ Params: { id: string } }>("/api/v1/notifications/:id/read", markReadHandler);
  app.post<{ Params: { id: string } }>("/api/v1/notifications/:id/read", markReadHandler);

  // Mark all as read
  app.post(
    "/api/v1/notifications/read-all",
    async (request) => {
      const result = await queryFn(
        `UPDATE notification_event
         SET read_at = COALESCE(read_at, now())
         WHERE read_at IS NULL
           AND dismissed_at IS NULL
           AND ${workspaceScopeClause(1)}`,
        [request.authUser!.userId]
      );
      return { marked_read: result.rowCount };
    }
  );

  // Dismiss notification
  app.patch<{ Params: { id: string } }>(
    "/api/v1/notifications/:id/dismiss",
    async (request, reply) => {
      const result = await queryFn(
        `UPDATE notification_event
         SET dismissed_at = COALESCE(dismissed_at, now())
         WHERE event_id = $1
           AND ${workspaceScopeClause(2)}
         RETURNING event_id`,
        [request.params.id, request.authUser!.userId]
      );
      if (result.rows.length === 0) return send404(reply, "Notification not found");
      return { dismissed: true };
    }
  );

  // Get notification preferences
  app.get(
    "/api/v1/notifications/preferences",
    async (request) => {
      const result = await queryFn(
        "SELECT event_type, channel, enabled FROM notification_preference WHERE user_id = $1",
        [request.authUser!.userId]
      );
      return { preferences: result.rows };
    }
  );

  // Update notification preference
  app.patch(
    "/api/v1/notifications/preferences",
    async (request, reply) => {
      const { event_type, channel, enabled } = request.body as {
        event_type?: string;
        channel?: string;
        enabled?: boolean;
      };

      if (!event_type) return send400(reply, "event_type is required");
      if (enabled === undefined) return send400(reply, "enabled is required");

      const ch = channel || "in_app";
      await upsertPreference(request.authUser!.userId, event_type, ch, enabled);

      return { event_type, channel: ch, enabled };
    }
  );

  app.put<{ Params: { eventType: string } }>(
    "/api/v1/notifications/preferences/:eventType",
    async (request, reply) => {
      const { eventType } = request.params;
      const { channel, enabled } = request.body as { channel?: string; enabled?: boolean };

      if (enabled === undefined) return send400(reply, "enabled is required");
      const ch = channel || "in_app";

      await upsertPreference(request.authUser!.userId, eventType, ch, enabled);

      return { event_type: eventType, channel: ch, enabled };
    }
  );
}
