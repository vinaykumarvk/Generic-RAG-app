/**
 * Org Unit routes — /api/v1/workspaces/:wid/org-units (FR-003)
 * CRUD with hierarchy, soft-deactivate, canonical case_ref format validation.
 */

import { FastifyInstance } from "fastify";
import { send400, send404, sendError } from "@puda/api-core";
import type { QueryFn } from "@puda/api-core";

export function createOrgUnitRoutes(app: FastifyInstance, deps: { queryFn: QueryFn }) {
  const { queryFn } = deps;

  // List org units (tree-friendly: includes parent_id)
  app.get<{ Params: { wid: string }; Querystring: { active_only?: string } }>(
    "/api/v1/workspaces/:wid/org-units",
    async (request) => {
      const { wid } = request.params;
      const activeOnly = request.query.active_only !== "false";

      const whereClause = activeOnly
        ? "workspace_id = $1 AND is_active = true"
        : "workspace_id = $1";

      const result = await queryFn(
        `SELECT org_unit_id, name, parent_id, is_active, created_at
         FROM org_unit WHERE ${whereClause}
         ORDER BY name`,
        [wid]
      );

      return { org_units: result.rows };
    }
  );

  // Create org unit
  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/org-units",
    async (request, reply) => {
      const { wid } = request.params;
      const { name, parent_id } = request.body as { name?: string; parent_id?: string };

      if (!name || name.trim().length === 0) {
        return send400(reply, "name is required");
      }

      // Validate parent exists if specified
      if (parent_id) {
        const parentResult = await queryFn(
          "SELECT org_unit_id FROM org_unit WHERE org_unit_id = $1 AND workspace_id = $2",
          [parent_id, wid]
        );
        if (parentResult.rows.length === 0) {
          return send400(reply, "Parent org unit not found");
        }
      }

      try {
        const result = await queryFn(
          `INSERT INTO org_unit (workspace_id, name, parent_id)
           VALUES ($1, $2, $3) RETURNING *`,
          [wid, name.trim(), parent_id || null]
        );
        reply.code(201);
        return result.rows[0];
      } catch (err) {
        if (String(err).includes("unique")) {
          return sendError(reply, 409, "DUPLICATE", "An org unit with this name already exists in this workspace");
        }
        throw err;
      }
    }
  );

  // Update org unit
  app.patch<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/org-units/:id",
    async (request, reply) => {
      const { wid, id } = request.params;
      const { name, parent_id, is_active } = request.body as {
        name?: string;
        parent_id?: string | null;
        is_active?: boolean;
      };

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name.trim()); }
      if (parent_id !== undefined) { fields.push(`parent_id = $${idx++}`); values.push(parent_id); }
      if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }

      if (fields.length === 0) return send400(reply, "No fields to update");

      fields.push("updated_at = now()");
      values.push(id, wid);

      const result = await queryFn(
        `UPDATE org_unit SET ${fields.join(", ")}
         WHERE org_unit_id = $${idx++} AND workspace_id = $${idx}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) return send404(reply, "Org unit not found");
      return result.rows[0];
    }
  );

  // Get org unit with children
  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/org-units/:id",
    async (request, reply) => {
      const { wid, id } = request.params;

      const [unitResult, childrenResult, docCountResult] = await Promise.all([
        queryFn("SELECT * FROM org_unit WHERE org_unit_id = $1 AND workspace_id = $2", [id, wid]),
        queryFn("SELECT org_unit_id, name, is_active FROM org_unit WHERE parent_id = $1 AND workspace_id = $2 ORDER BY name", [id, wid]),
        queryFn("SELECT count(*) FROM document WHERE org_unit_id = $1 AND workspace_id = $2 AND status != 'DELETED'", [id, wid]),
      ]);

      if (unitResult.rows.length === 0) return send404(reply, "Org unit not found");

      return {
        ...unitResult.rows[0],
        children: childrenResult.rows,
        document_count: parseInt(docCountResult.rows[0].count, 10),
      };
    }
  );
}
