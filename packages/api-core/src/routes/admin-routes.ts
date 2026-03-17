import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { QueryFn } from "../types";
import { createUser } from "../auth/local-auth";
import { sendError, send400, send403, send404 } from "../errors";

export interface AdminRouteDeps {
  queryFn: QueryFn;
}

function validatePasswordComplexity(pw: string): string | null {
  if (pw.length < 12) return "Password must be at least 12 characters";
  if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter";
  if (!/[a-z]/.test(pw)) return "Password must contain a lowercase letter";
  if (!/[0-9]/.test(pw)) return "Password must contain a digit";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password must contain a special character";
  return null;
}

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const roles = request.authUser?.roles ?? [];
  if (!roles.includes("ADMINISTRATOR") && !roles.includes("PLATFORM_ADMINISTRATOR")) {
    send403(reply, "FORBIDDEN", "Administrator access required");
    return false;
  }
  return true;
}

export function createAdminRoutes(deps: AdminRouteDeps) {
  const { queryFn } = deps;

  return async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
    app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireAdmin(request, reply)) return;
    });

    app.get("/api/v1/users", async () => {
      const result = await queryFn(
        `SELECT u.user_id, u.username, u.full_name, u.user_type, u.is_active, u.created_at,
                COALESCE(array_agg(r.role_key) FILTER (WHERE r.role_key IS NOT NULL), '{}') AS roles
         FROM user_account u
         LEFT JOIN user_role ur ON ur.user_id = u.user_id
         LEFT JOIN role r ON r.role_id = ur.role_id
         GROUP BY u.user_id
         ORDER BY u.created_at DESC`,
      );
      return { users: result.rows, total: result.rows.length };
    });

    app.post("/api/v1/users", {
      schema: { body: { type: "object", additionalProperties: false, required: ["username", "password", "fullName"], properties: { username: { type: "string", minLength: 3, maxLength: 100 }, password: { type: "string", minLength: 12, maxLength: 128 }, fullName: { type: "string", minLength: 1, maxLength: 200 }, userType: { type: "string" } } } },
    }, async (request, reply) => {
      const { username, password, fullName, userType } = request.body as { username: string; password: string; fullName: string; userType?: string };
      const pwError = validatePasswordComplexity(password);
      if (pwError) return send400(reply, "WEAK_PASSWORD", pwError);
      try {
        const user = await createUser(queryFn, { username, password, fullName, userType });
        reply.code(201);
        return { user };
      } catch (err: unknown) {
        const pgCode = err instanceof Error && "code" in err ? (err as any).code : undefined;
        if (pgCode === "23505") {
          return send400(reply, "USERNAME_EXISTS", "Username already taken");
        }
        request.log.error(err, "User creation failed");
        return sendError(reply, 500, "INTERNAL_ERROR", "An internal error occurred");
      }
    });

    app.put("/api/v1/users/:id/role", {
      schema: {
        params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
        body: { type: "object", additionalProperties: false, required: ["roleId"], properties: {
          roleId: { type: "string" },
          action: { type: "string", enum: ["assign", "revoke"] },
          permissionSetJson: { type: "object", additionalProperties: true },
        } },
      },
    }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const { roleId, action, permissionSetJson } = request.body as { roleId: string; action?: "assign" | "revoke"; permissionSetJson?: Record<string, unknown> };

      if (id === request.authUser?.userId) {
        return send403(reply, "SELF_ROLE_CHANGE", "Cannot modify your own roles");
      }

      const userCheck = await queryFn(`SELECT 1 FROM user_account WHERE user_id = $1`, [id]);
      if (userCheck.rows.length === 0) {
        return send404(reply, "USER_NOT_FOUND", "User not found");
      }

      const roleCheck = await queryFn(`SELECT role_id FROM role WHERE role_id = $1`, [roleId]);
      if (roleCheck.rows.length === 0) {
        return send404(reply, "ROLE_NOT_FOUND", "Role not found");
      }

      if (action === "revoke") {
        await queryFn(`DELETE FROM user_role WHERE user_id = $1 AND role_id = $2`, [id, roleId]);
      } else {
        // FR-14 AC-03: Support permission_set_json on role assignment
        await queryFn(
          `INSERT INTO user_role (user_id, role_id, permission_set_json) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, role_id) DO UPDATE SET permission_set_json = COALESCE($3, user_role.permission_set_json)`,
          [id, roleId, permissionSetJson ? JSON.stringify(permissionSetJson) : null],
        );
      }

      return { success: true };
    });
  };
}
