/**
 * Ingestion routes — /api/v1/workspaces/:wid/ingestion (FR-018)
 * Step history, SLA tracking, batch reprocess.
 */

import { FastifyInstance } from "fastify";
import { send400, send404 } from "@puda/api-core";
import type { QueryFn, GetClientFn } from "@puda/api-core";

export function createIngestionRoutes(app: FastifyInstance, deps: { queryFn: QueryFn; getClient: GetClientFn }) {
  const { queryFn } = deps;

  // Step history for a document (all ingestion jobs with timestamps/errors)
  app.get<{ Params: { wid: string; docId: string } }>(
    "/api/v1/workspaces/:wid/ingestion/:docId/history",
    async (request, reply) => {
      const { wid, docId } = request.params;

      const result = await queryFn(
        `SELECT job_id, step, status, attempt, error_message, progress,
                started_at, completed_at, created_at,
                EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000 as duration_ms
         FROM ingestion_job
         WHERE document_id = $1 AND workspace_id = $2
         ORDER BY created_at`,
        [docId, wid]
      );

      if (result.rows.length === 0) return send404(reply, "No ingestion history found");

      return { document_id: docId, steps: result.rows };
    }
  );

  // SLA tracking — average step durations across workspace
  app.get<{ Params: { wid: string }; Querystring: { days?: string } }>(
    "/api/v1/workspaces/:wid/ingestion/sla",
    async (request) => {
      const { wid } = request.params;
      const days = Math.min(90, Math.max(1, parseInt(request.query.days || "30", 10)));

      const result = await queryFn(
        `SELECT step,
                count(*) as total,
                count(*) FILTER (WHERE status = 'COMPLETED') as completed,
                count(*) FILTER (WHERE status = 'FAILED') as failed,
                avg(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE status = 'COMPLETED') as avg_duration_ms,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE status = 'COMPLETED') as p95_duration_ms
         FROM ingestion_job
         WHERE workspace_id = $1 AND created_at > now() - $2::int * interval '1 day'
         GROUP BY step
         ORDER BY step`,
        [wid, days]
      );

      return { period_days: days, steps: result.rows };
    }
  );

  // Batch reprocess by case_ref, station, or failed cohort (FR-018)
  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/ingestion/batch-reprocess",
    async (request, reply) => {
      const { wid } = request.params;
      const { case_reference, station_code, failed_only, reprocess_reason } = request.body as {
        case_reference?: string;
        station_code?: string;
        failed_only?: boolean;
        reprocess_reason?: string;
      };

      if (!reprocess_reason) {
        return send400(reply, "reprocess_reason is required");
      }

      let whereClause = "workspace_id = $1 AND status != 'DELETED'";
      const params: unknown[] = [wid];

      if (failed_only) {
        whereClause += " AND status = 'FAILED'";
      }
      if (case_reference) {
        params.push(case_reference);
        whereClause += ` AND case_reference = $${params.length}`;
      }
      if (station_code) {
        params.push(station_code);
        whereClause += ` AND station_code = $${params.length}`;
      }

      // Find matching documents
      const docs = await queryFn(
        `SELECT document_id FROM document WHERE ${whereClause} LIMIT 500`,
        params
      );

      if (docs.rows.length === 0) {
        return { reprocessed: 0, message: "No matching documents found" };
      }

      const client = await deps.getClient();
      try {
        await client.query("BEGIN");
        const docIds = docs.rows.map((d: { document_id: string }) => d.document_id);

        // Mark as REPROCESSING (keep existing chunks queryable — FR-018)
        await client.query(
          "UPDATE document SET status = 'REPROCESSING', updated_at = now() WHERE document_id = ANY($1)",
          [docIds]
        );

        // Cancel pending jobs
        await client.query(
          "UPDATE ingestion_job SET status = 'FAILED' WHERE document_id = ANY($1) AND status IN ('PENDING', 'RETRYING')",
          [docIds]
        );

        // Create new VALIDATE jobs
        for (const docId of docIds) {
          await client.query(
            "INSERT INTO ingestion_job (document_id, workspace_id, step, status, metadata) VALUES ($1, $2, 'VALIDATE', 'PENDING', $3)",
            [docId, wid, JSON.stringify({ reprocess_reason })]
          );
        }

        // Audit
        await client.query(
          `INSERT INTO audit_log (user_id, action, resource_type, resource_id, workspace_id, details, event_subtype)
           VALUES ($1, 'document.batch_reprocess', 'document', NULL, $2, $3, 'REPROCESS')`,
          [request.authUser!.userId, wid, JSON.stringify({ count: docIds.length, reason: reprocess_reason, case_reference, station_code })]
        );

        await client.query("COMMIT");

        return { reprocessed: docIds.length, document_ids: docIds };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  );
}
