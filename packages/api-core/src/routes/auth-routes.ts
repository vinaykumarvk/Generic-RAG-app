import { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import type { QueryFn } from "../types";
import { authenticate } from "../auth/local-auth";
import { sendError } from "../errors";
import type { AuthMiddleware } from "../middleware/auth-middleware";
import type { LdapAuth } from "../auth/ldap-auth";

export interface AuthRouteDeps {
  queryFn: QueryFn;
  auth: AuthMiddleware;
  ldapAuth?: LdapAuth;
}

export function createAuthRoutes(deps: AuthRouteDeps) {
  const { queryFn, auth, ldapAuth } = deps;

  return async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
    // LDAP login endpoint (only registered when ldapAuth is provided)
    if (ldapAuth) {
      app.post("/api/v1/auth/ldap/login", {
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
        schema: { body: { type: "object", additionalProperties: false, properties: { username: { type: "string" }, password: { type: "string" } }, required: ["username", "password"] } },
      }, async (request, reply) => {
        const { username, password } = request.body as { username: string; password: string };
        const result = await ldapAuth.authenticate(username, password);
        if (!result.success) {
          return sendError(reply, 401, "LDAP_AUTH_FAILED", result.error || "LDAP authentication failed");
        }
        // Look up the user in our DB to get roles/type
        const userResult = await queryFn(
          `SELECT user_id, user_type, unit_id FROM user_account WHERE user_id = $1 AND is_active = true`,
          [result.userId]
        );
        if (userResult.rows.length === 0) {
          return sendError(reply, 401, "LDAP_USER_NOT_PROVISIONED", "LDAP user exists but is not provisioned in this system");
        }
        const dbUser = userResult.rows[0];
        const rolesResult = await queryFn(
          `SELECT r.role_key FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = $1`,
          [dbUser.user_id]
        );
        const roles = rolesResult.rows.map((r: any) => r.role_key);
        const token = auth.generateToken({ user_id: dbUser.user_id, user_type: dbUser.user_type, roles, unit_id: dbUser.unit_id });
        auth.setAuthCookie(reply, token);
        return { user: { userId: dbUser.user_id, userType: dbUser.user_type, roles, unitId: dbUser.unit_id, displayName: result.displayName, email: result.email } };
      });
    }

    app.post("/api/v1/auth/login", {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      schema: { body: { type: "object", additionalProperties: false, properties: { username: { type: "string" }, password: { type: "string" } }, required: ["username", "password"] } },
    }, async (request, reply) => {
      const { username, password } = request.body as { username: string; password: string };
      const result = await authenticate(queryFn, username, password);
      if (result.mfaRequired) {
        const mfaChallengeToken = auth.generateToken({ user_id: result.mfaUserId!, user_type: "MFA_CHALLENGE", roles: [], unit_id: null });
        return { mfaRequired: true, mfaChallengeToken };
      }
      if (!result.user) {
        return sendError(reply, 401, "INVALID_CREDENTIALS", "Invalid username or password");
      }
      const token = auth.generateToken({ user_id: result.user.user_id, user_type: result.user.user_type, roles: result.user.roles, unit_id: result.user.unit_id });
      auth.setAuthCookie(reply, token);
      return { user: result.user, token };
    });

    app.post("/api/v1/auth/logout", {
      schema: { body: { type: "object", additionalProperties: false, properties: {} } },
    }, async (request, reply) => {
      const authUser = request.authUser;
      const authToken = request.authToken;
      if (authUser && authToken) {
        const decoded = jwt.decode(authToken) as any;
        if (decoded?.exp) {
          await auth.revokeToken(authUser.jti, authUser.userId, new Date(decoded.exp * 1000));
        }
      }
      auth.clearAuthCookie(reply);
      return { success: true };
    });

    app.get("/api/v1/auth/me", async (request, reply) => {
      if (!request.authUser) { reply.code(401); return { error: "UNAUTHORIZED", statusCode: 401, message: "Not authenticated" }; }
      return { user: request.authUser };
    });
  };
}
