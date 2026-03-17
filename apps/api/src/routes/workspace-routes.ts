/**
 * Workspace CRUD routes — /api/v1/workspaces
 */

import { FastifyInstance } from "fastify";
import { send400, send404 } from "@puda/api-core";
import type { QueryFn, GetClientFn, LlmProvider } from "@puda/api-core";

export interface WorkspaceRouteDeps {
  queryFn: QueryFn;
  getClient: GetClientFn;
  llmProvider: LlmProvider;
}

export function createWorkspaceRoutes(app: FastifyInstance, deps: WorkspaceRouteDeps) {
  const { queryFn } = deps;

  // List workspaces (filtered by user membership)
  app.get("/api/v1/workspaces", async (request) => {
    const user = request.authUser;
    const isAdmin = user?.userType === "ADMIN";

    let result;
    if (isAdmin) {
      result = await queryFn(
        `SELECT w.*, (SELECT count(*) FROM workspace_member wm WHERE wm.workspace_id = w.workspace_id) as member_count
         FROM workspace w WHERE w.status != 'SUSPENDED' ORDER BY w.created_at DESC`
      );
    } else {
      result = await queryFn(
        `SELECT w.*, wm.role as member_role
         FROM workspace w
         JOIN workspace_member wm ON wm.workspace_id = w.workspace_id
         WHERE wm.user_id = $1 AND w.status != 'SUSPENDED'
         ORDER BY w.created_at DESC`,
        [user?.userId]
      );
    }

    return { workspaces: result.rows };
  });

  // Get workspace by ID
  app.get<{ Params: { wid: string } }>("/api/v1/workspaces/:wid", async (request, reply) => {
    const { wid } = request.params;
    const result = await queryFn(
      `SELECT w.*,
         (SELECT count(*) FROM workspace_member wm WHERE wm.workspace_id = w.workspace_id) as member_count,
         (SELECT count(*) FROM document d WHERE d.workspace_id = w.workspace_id AND d.status != 'DELETED') as document_count
       FROM workspace w WHERE w.workspace_id = $1`,
      [wid]
    );
    if (result.rows.length === 0) return send404(reply, "Workspace not found");
    return result.rows[0];
  });

  // Create workspace
  app.post("/api/v1/workspaces", async (request, reply) => {
    const { name, slug, description, settings } = request.body as {
      name: string; slug: string; description?: string; settings?: Record<string, unknown>;
    };

    if (!name || !slug) return send400(reply, "name and slug are required");
    if (!/^[a-z0-9-]+$/.test(slug)) return send400(reply, "slug must be lowercase alphanumeric with hyphens");

    const existing = await queryFn("SELECT 1 FROM workspace WHERE slug = $1", [slug]);
    if (existing.rows.length > 0) return send400(reply, "Workspace slug already exists");

    const userId = request.authUser?.userId;
    const result = await queryFn(
      `INSERT INTO workspace (name, slug, description, settings, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, slug, description || null, JSON.stringify(settings || {}), userId]
    );

    // Add creator as owner
    await queryFn(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [result.rows[0].workspace_id, userId]
    );

    reply.code(201);
    return result.rows[0];
  });

  // Update workspace
  app.patch<{ Params: { wid: string } }>("/api/v1/workspaces/:wid", async (request, reply) => {
    const { wid } = request.params;
    const { name, description, settings, status } = request.body as {
      name?: string; description?: string; settings?: Record<string, unknown>; status?: string;
    };

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (settings !== undefined) { fields.push(`settings = settings || $${idx++}::jsonb`); values.push(JSON.stringify(settings)); }
    if (status !== undefined) {
      const allowedStatuses = ["ACTIVE", "ARCHIVED", "SUSPENDED"];
      if (!allowedStatuses.includes(status)) return send400(reply, `Invalid status. Must be one of: ${allowedStatuses.join(", ")}`);
      fields.push(`status = $${idx++}`); values.push(status);
    }

    if (fields.length === 0) return send400(reply, "No fields to update");

    fields.push(`updated_at = now()`);
    values.push(wid);

    const result = await queryFn(
      `UPDATE workspace SET ${fields.join(", ")} WHERE workspace_id = $${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return send404(reply, "Workspace not found");
    return result.rows[0];
  });

  // Delete workspace (soft — sets status to ARCHIVED)
  app.delete<{ Params: { wid: string } }>("/api/v1/workspaces/:wid", async (request, reply) => {
    const { wid } = request.params;
    const result = await queryFn(
      `UPDATE workspace SET status = 'ARCHIVED', updated_at = now() WHERE workspace_id = $1 RETURNING workspace_id`,
      [wid]
    );
    if (result.rows.length === 0) return send404(reply, "Workspace not found");
    return { deleted: true, workspace_id: wid };
  });

  // Workspace members
  app.get<{ Params: { wid: string } }>("/api/v1/workspaces/:wid/members", async (request) => {
    const { wid } = request.params;
    const result = await queryFn(
      `SELECT u.user_id, u.username, u.email, u.full_name, u.user_type, wm.role, wm.joined_at
       FROM workspace_member wm
       JOIN user_account u ON u.user_id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY wm.joined_at`,
      [wid]
    );
    return { members: result.rows };
  });

  // Add member to workspace
  app.post<{ Params: { wid: string } }>("/api/v1/workspaces/:wid/members", async (request, reply) => {
    const { wid } = request.params;
    const { user_id, role } = request.body as { user_id: string; role?: string };

    if (!user_id) return send400(reply, "user_id is required");

    await queryFn(
      `INSERT INTO workspace_member (workspace_id, user_id, role)
       VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3`,
      [wid, user_id, role || "VIEWER"]
    );

    reply.code(201);
    return { added: true };
  });
}
