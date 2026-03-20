/**
 * Audit routes — /api/v1/audit (FR-020)
 * Audit log search/filter API, CSV/JSON export.
 */

import { FastifyInstance } from "fastify";
import { sendError } from "@puda/api-core";
import type { QueryFn } from "@puda/api-core";

export function createAuditRoutes(app: FastifyInstance, deps: { queryFn: QueryFn }) {
  const { queryFn } = deps;

  // Search audit logs
  app.get<{ Querystring: { user_id?: string; action?: string; resource_type?: string; date_from?: string; date_to?: string; event_subtype?: string; page?: string; limit?: string } }>(
    "/api/v1/audit/logs",
    async (request, reply) => {
      if (request.authUser?.userType !== "ADMIN") {
        return sendError(reply, 403, "FORBIDDEN", "Admin access required");
      }

      const page = Math.max(1, parseInt(request.query.page || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || "50", 10)));
      const offset = (page - 1) * limit;

      let whereClause = "1=1";
      const params: unknown[] = [];

      if (request.query.user_id) {
        params.push(request.query.user_id);
        whereClause += ` AND a.user_id = $${params.length}`;
      }
      if (request.query.action) {
        params.push(request.query.action);
        whereClause += ` AND a.action = $${params.length}`;
      }
      if (request.query.resource_type) {
        params.push(request.query.resource_type);
        whereClause += ` AND a.resource_type = $${params.length}`;
      }
      if (request.query.event_subtype) {
        params.push(request.query.event_subtype);
        whereClause += ` AND a.event_subtype = $${params.length}`;
      }
      if (request.query.date_from) {
        params.push(request.query.date_from);
        whereClause += ` AND a.created_at >= $${params.length}::timestamptz`;
      }
      if (request.query.date_to) {
        params.push(request.query.date_to);
        whereClause += ` AND a.created_at <= $${params.length}::timestamptz`;
      }

      const [countResult, result] = await Promise.all([
        queryFn(`SELECT count(*) FROM audit_log a WHERE ${whereClause}`, params),
        queryFn(
          `SELECT a.*, u.full_name as user_name
           FROM audit_log a
           LEFT JOIN user_account u ON u.user_id = a.user_id
           WHERE ${whereClause}
           ORDER BY a.created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        ),
      ]);

      return {
        logs: result.rows,
        total: parseInt(countResult.rows[0].count, 10),
        page,
        limit,
      };
    }
  );

  // Export audit logs as JSON (async for large datasets)
  app.get<{ Querystring: { format?: string; date_from?: string; date_to?: string } }>(
    "/api/v1/audit/export",
    async (request, reply) => {
      if (request.authUser?.userType !== "ADMIN") {
        return sendError(reply, 403, "FORBIDDEN", "Admin access required");
      }

      const format = request.query.format || "json";
      let whereClause = "1=1";
      const params: unknown[] = [];

      if (request.query.date_from) {
        params.push(request.query.date_from);
        whereClause += ` AND created_at >= $${params.length}::timestamptz`;
      }
      if (request.query.date_to) {
        params.push(request.query.date_to);
        whereClause += ` AND created_at <= $${params.length}::timestamptz`;
      }

      const result = await queryFn(
        `SELECT * FROM audit_log WHERE ${whereClause} ORDER BY created_at DESC LIMIT 10000`,
        params
      );

      // Log export event
      await queryFn(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, event_subtype)
         VALUES ($1, 'audit.export', 'audit_log', NULL, $2, 'EXPORT')`,
        [request.authUser!.userId, JSON.stringify({ format, count: result.rows.length })]
      );

      if (format === "csv") {
        reply.header("Content-Type", "text/csv");
        reply.header("Content-Disposition", "attachment; filename=audit_log.csv");
        const headers = ["log_id", "user_id", "action", "resource_type", "resource_id", "event_subtype", "created_at"];
        const csv = [headers.join(",")];
        for (const row of result.rows) {
          csv.push(headers.map((h) => JSON.stringify(String(row[h] ?? ""))).join(","));
        }
        return csv.join("\n");
      }

      return { logs: result.rows, count: result.rows.length };
    }
  );
}
