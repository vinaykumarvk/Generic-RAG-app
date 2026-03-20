/**
 * User management routes — /api/v1/users
 */

import { FastifyInstance } from "fastify";
import { send400, send404, hashPassword } from "@puda/api-core";
import type { QueryFn, GetClientFn, LlmProvider } from "@puda/api-core";

export interface UserRouteDeps {
  queryFn: QueryFn;
  getClient: GetClientFn;
  llmProvider: LlmProvider;
}

export function createUserRoutes(app: FastifyInstance, deps: UserRouteDeps) {
  const { queryFn } = deps;

  // List users (admin only)
  app.get("/api/v1/users", async (request, reply) => {
    if (request.authUser?.userType !== "ADMIN") {
      reply.code(403);
      return { error: "FORBIDDEN", message: "Admin access required" };
    }
    const result = await queryFn(
      `SELECT user_id, username, email, full_name, user_type, status, last_login_at, created_at
       FROM user_account ORDER BY created_at DESC`
    );
    return { users: result.rows };
  });

  // Get user profile (self or admin)
  app.get<{ Params: { id: string } }>("/api/v1/users/:id", async (request, reply) => {
    const { id } = request.params;
    const isSelf = request.authUser?.userId === id;
    const isAdmin = request.authUser?.userType === "ADMIN";
    if (!isSelf && !isAdmin) {
      reply.code(403);
      return { error: "FORBIDDEN", message: "Access denied" };
    }
    const result = await queryFn(
      `SELECT user_id, username, email, full_name, user_type, status, avatar_url, last_login_at, created_at
       FROM user_account WHERE user_id = $1`,
      [id]
    );
    if (result.rows.length === 0) return send404(reply, "User not found");
    return result.rows[0];
  });

  // Create user (admin only)
  app.post("/api/v1/users", async (request, reply) => {
    if (request.authUser?.userType !== "ADMIN") {
      reply.code(403);
      return { error: "FORBIDDEN", message: "Admin access required" };
    }

    const { username, email, full_name, password, user_type } = request.body as {
      username: string; email: string; full_name: string; password: string; user_type?: string;
    };

    if (!username || !email || !full_name || !password) {
      return send400(reply, "username, email, full_name, and password are required");
    }

    const existing = await queryFn(
      "SELECT 1 FROM user_account WHERE username = $1 OR email = $2",
      [username, email]
    );
    if (existing.rows.length > 0) return send400(reply, "Username or email already exists");

    const password_hash = await hashPassword(password);
    const result = await queryFn(
      `INSERT INTO user_account (username, email, full_name, password_hash, user_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING user_id, username, email, full_name, user_type, status, created_at`,
      [username, email, full_name, password_hash, user_type || "MEMBER"]
    );

    reply.code(201);
    return result.rows[0];
  });

  // Update user
  app.patch<{ Params: { id: string } }>("/api/v1/users/:id", async (request, reply) => {
    const { id } = request.params;
    const isSelf = request.authUser?.userId === id;
    const isAdmin = request.authUser?.userType === "ADMIN";
    if (!isSelf && !isAdmin) {
      reply.code(403);
      return { error: "FORBIDDEN", message: "Access denied" };
    }

    const { full_name, email, status, user_type } = request.body as {
      full_name?: string; email?: string; status?: string; user_type?: string;
    };

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (full_name !== undefined) { fields.push(`full_name = $${idx++}`); values.push(full_name); }
    // Email updates removed for security (FR-022/AC-03)
    if (status !== undefined && isAdmin) { fields.push(`status = $${idx++}`); values.push(status); }
    if (user_type !== undefined && isAdmin) { fields.push(`user_type = $${idx++}`); values.push(user_type); }

    if (fields.length === 0) return send400(reply, "No fields to update");

    fields.push(`updated_at = now()`);
    values.push(id);

    const result = await queryFn(
      `UPDATE user_account SET ${fields.join(", ")} WHERE user_id = $${idx}
       RETURNING user_id, username, email, full_name, user_type, status`,
      values
    );
    if (result.rows.length === 0) return send404(reply, "User not found");
    return result.rows[0];
  });

  // Soft-delete user (admin only) — FR-022/AC-05
  app.delete<{ Params: { id: string } }>("/api/v1/users/:id", async (request, reply) => {
    if (request.authUser?.userType !== "ADMIN") {
      reply.code(403);
      return { error: "FORBIDDEN", message: "Admin access required" };
    }
    const { id } = request.params;

    // Cannot delete yourself
    if (request.authUser?.userId === id) {
      return send400(reply, "Cannot archive your own account");
    }

    // FR-022/AC-05: Reassign resources before archiving
    await queryFn(
      "UPDATE document SET uploaded_by = 'system' WHERE uploaded_by = $1",
      [id]
    );

    // FR-022/AC-04: Archive user and revoke all tokens in one atomic update
    const result = await queryFn(
      `UPDATE user_account
       SET tokens_revoked_before = now(), status = 'ARCHIVED', archived_at = now(), archived_by = $1, updated_at = now()
       WHERE user_id = $2 AND status != 'ARCHIVED'
       RETURNING user_id, username, status`,
      [request.authUser?.userId, id]
    );

    if (result.rows.length === 0) return send404(reply, "User not found or already archived");

    return { archived: true, user_id: id };
  });

  // Get current user profile
  app.get("/api/v1/users/me", async (request) => {
    const userId = request.authUser?.userId;
    const result = await queryFn(
      `SELECT user_id, username, email, full_name, user_type, status, avatar_url, last_login_at, created_at
       FROM user_account WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  });
}
