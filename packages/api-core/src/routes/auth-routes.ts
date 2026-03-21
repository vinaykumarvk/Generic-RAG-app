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
        const roles = rolesResult.rows.map((r: { role_key: string }) => r.role_key);
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
      return { user: result.user };
    });

    app.post("/api/v1/auth/refresh", {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { body: { type: "object", additionalProperties: false, properties: {} } },
    }, async (request, reply) => {
      const cookieName = process.env.AUTH_COOKIE_NAME || "intellirag_session";
      const token = request.cookies?.[cookieName];
      if (!token) {
        return sendError(reply, 401, "NO_TOKEN", "No session token found");
      }

      // Try normal verify first, then decode with 5-min grace for just-expired tokens
      let payload = auth.verifyToken(token);
      if (!payload) {
        const decoded = jwt.decode(token) as { exp?: number; userId?: string; userType?: string; roles?: string[]; jti?: string; unitId?: string | null } | null;
        if (!decoded?.exp || !decoded.userId) {
          return sendError(reply, 401, "INVALID_TOKEN", "Token is invalid");
        }
        const expiredAgoMs = Date.now() - decoded.exp * 1000;
        if (expiredAgoMs > 5 * 60 * 1000) {
          return sendError(reply, 401, "TOKEN_EXPIRED", "Token expired beyond grace period");
        }
        payload = {
          userId: decoded.userId,
          userType: decoded.userType || "",
          roles: decoded.roles || [],
          jti: decoded.jti || "",
          unitId: decoded.unitId || null,
        };
      }

      // Confirm user is still active
      const userResult = await queryFn(
        `SELECT user_id, user_type, unit_id, is_active FROM user_account WHERE user_id = $1`,
        [payload.userId]
      );
      if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
        auth.clearAuthCookie(reply);
        return sendError(reply, 401, "USER_INACTIVE", "User account is no longer active");
      }

      // Revoke old token
      if (payload.jti) {
        const decoded = jwt.decode(token) as { exp?: number } | null;
        if (decoded?.exp) {
          await auth.revokeToken(payload.jti, payload.userId, new Date(decoded.exp * 1000));
        }
      }

      // Fetch current roles and issue new token
      const rolesResult = await queryFn(
        `SELECT r.role_key FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = $1`,
        [payload.userId]
      );
      const roles = rolesResult.rows.map((r: { role_key: string }) => r.role_key);
      const dbUser = userResult.rows[0];
      const newToken = auth.generateToken({ user_id: dbUser.user_id, user_type: dbUser.user_type, roles, unit_id: dbUser.unit_id });
      auth.setAuthCookie(reply, newToken);
      return { success: true };
    });

    app.post("/api/v1/auth/logout", {
      schema: { body: { type: "object", additionalProperties: false, properties: {} } },
    }, async (request, reply) => {
      const authUser = request.authUser;
      const authToken = request.authToken;
      if (authUser && authToken) {
        const decoded = jwt.decode(authToken) as { exp?: number } | null;
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
