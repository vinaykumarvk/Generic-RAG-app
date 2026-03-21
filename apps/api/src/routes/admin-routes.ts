/**
 * Admin routes — system settings CRUD (FR-023).
 * /api/v1/admin/settings
 */

import { FastifyInstance } from "fastify";
import { send400, send404, sendError } from "@puda/api-core";
import type { QueryFn, GetClientFn, LlmProvider } from "@puda/api-core";

export interface AdminRouteDeps {
  queryFn: QueryFn;
  getClient: GetClientFn;
  llmProvider: LlmProvider;
}

export function createAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps) {
  const { queryFn } = deps;

  // Helper: require admin
  const requireAdmin = (request: { authUser?: { userType?: string } }, reply: { code: (n: number) => void }) => {
    if (request.authUser?.userType !== "ADMIN") {
      reply.code(403);
      return { error: "FORBIDDEN", message: "Admin access required" };
    }
    return null;
  };

  // GET /admin/settings — list all settings grouped by category (FR-023/AC-01)
  app.get("/api/v1/admin/settings", async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    const result = await queryFn(
      "SELECT key, category, value, value_type, description, updated_at FROM system_setting ORDER BY category, key"
    );

    // Group by category
    const grouped: Record<string, Array<{
      key: string; value: string; value_type: string; description: string | null; updated_at: string;
    }>> = {};

    for (const row of result.rows) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push({
        key: row.key,
        value: row.value,
        value_type: row.value_type,
        description: row.description,
        updated_at: row.updated_at,
      });
    }

    return { settings: grouped };
  });

  // PUT /admin/settings/:key — update a setting with type validation (FR-023/AC-02, AC-03)
  app.put<{ Params: { key: string } }>("/api/v1/admin/settings/:key", async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    const { key } = request.params;
    const { value } = request.body as { value?: string };

    if (value === undefined || value === null) {
      return send400(reply, "value is required");
    }

    // Fetch current setting for type validation
    const existing = await queryFn("SELECT value_type FROM system_setting WHERE key = $1", [key]);
    if (existing.rows.length === 0) return send404(reply, `Setting '${key}' not found`);

    const valueType = existing.rows[0].value_type;

    // Type validation (FR-023/AC-03)
    if (valueType === "number" && isNaN(Number(value))) {
      return send400(reply, `Value must be a valid number for setting '${key}'`);
    }
    if (valueType === "boolean" && !["true", "false"].includes(value.toLowerCase())) {
      return send400(reply, `Value must be 'true' or 'false' for setting '${key}'`);
    }
    if (valueType === "json") {
      try { JSON.parse(value); } catch {
        return send400(reply, `Value must be valid JSON for setting '${key}'`);
      }
    }

    const result = await queryFn(
      "UPDATE system_setting SET value = $1, updated_at = now() WHERE key = $2 RETURNING *",
      [value, key]
    );

    // FR-023/AC-04: Audit log for settings changes
    await queryFn(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, detail)
       VALUES ($1, 'UPDATE_SETTING', 'system_setting', $2, $3)`,
      [request.authUser?.userId, key, JSON.stringify({ value })]
    );

    return result.rows[0];
  });

  // POST /admin/settings/reset — reset all settings to defaults (FR-023/AC-05)
  app.post("/api/v1/admin/settings/reset", async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    const { confirm } = request.body as { confirm?: boolean };
    if (!confirm) {
      return send400(reply, "Set confirm=true to reset all settings to defaults");
    }

    // Delete all and re-seed
    await queryFn("DELETE FROM system_setting");
    await queryFn(`
      INSERT INTO system_setting (key, category, value, value_type, description) VALUES
        ('max_file_size_bytes', 'storage', '262144000', 'number', 'Maximum file upload size in bytes (250MB)'),
        ('storage_provider', 'storage', 'local', 'string', 'Storage provider: local or gcs'),
        ('gcs_bucket', 'storage', '', 'string', 'GCS bucket name'),
        ('chunk_size_tokens', 'chunking', '512', 'number', 'Target chunk size in tokens'),
        ('chunk_overlap_tokens', 'chunking', '50', 'number', 'Chunk overlap in tokens'),
        ('max_chunk_chars', 'chunking', '10000', 'number', 'Hard limit on chunk character count'),
        ('kg_confidence_threshold', 'knowledge_graph', '0.75', 'number', 'Minimum entity confidence for KG inclusion'),
        ('kg_dedup_threshold', 'knowledge_graph', '0.90', 'number', 'Similarity threshold for KG entity deduplication'),
        ('ocr_parallel_pages', 'ocr', '10', 'number', 'Number of pages to OCR in parallel'),
        ('ocr_confidence_threshold', 'ocr', '0.7', 'number', 'Minimum OCR confidence before warning'),
        ('ocr_page_timeout_s', 'ocr', '120', 'number', 'Per-page OCR timeout in seconds'),
        ('cache_ttl_hours', 'retrieval', '24', 'number', 'Answer cache TTL in hours'),
        ('query_expansion_timeout_ms', 'retrieval', '500', 'number', 'Query expansion timeout in milliseconds'),
        ('graph_context_timeout_ms', 'retrieval', '300', 'number', 'Graph context lookup timeout in milliseconds'),
        ('max_references', 'retrieval', '10', 'number', 'Maximum references appended to answers'),
        ('default_preset', 'retrieval', 'balanced', 'string', 'Default retrieval preset')
    `);

    // FR-023/AC-04: Audit log for settings reset
    await queryFn(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, detail)
       VALUES ($1, 'RESET_SETTINGS', 'system_setting', 'all', '{}')`,
      [request.authUser?.userId]
    );

    return { reset: true, message: "All settings reset to defaults" };
  });

  // GET /admin/ingestion/volume — refresh and return materialized view data
  app.get<{ Params: { wid: string }; Querystring: { days?: string } }>("/api/v1/workspaces/:wid/admin/ingestion-volume", async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    const { wid } = request.params;
    const days = Math.min(90, Math.max(1, parseInt(request.query.days || "30", 10)));

    try {
      await queryFn("REFRESH MATERIALIZED VIEW CONCURRENTLY v_ingestion_volume");
    } catch {
      // May fail if no unique index or first run
    }

    const result = await queryFn(
      `SELECT day,
              doc_count::int AS upload_count,
              total_bytes::bigint AS total_bytes,
              active_count::int AS active_count,
              failed_count::int AS failed_count,
              searchable_count::int AS searchable_count
       FROM v_ingestion_volume
       WHERE workspace_id = $1
         AND day >= date_trunc('day', now()) - ($2::int - 1) * interval '1 day'
       ORDER BY day ASC`,
      [wid, days]
    );

    return { period_days: days, data: result.rows, volume: result.rows };
  });
}
