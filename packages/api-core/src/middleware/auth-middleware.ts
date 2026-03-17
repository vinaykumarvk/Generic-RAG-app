import { randomUUID } from "node:crypto";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import type { AuthPayload, QueryFn } from "../types";
import type { OidcAuth } from "../auth/oidc-auth";

export interface AuthMiddlewareConfig {
  cookieName: string;
  defaultDevSecret: string;
  queryFn: QueryFn;
  inactivityTimeoutMs?: number;
  publicRoutes?: string[];
  /** When provided, the middleware will attempt RS256 OIDC verification as a fallback when HS256 fails. */
  oidcAuth?: OidcAuth;
}

const DEFAULT_PUBLIC_ROUTES = [
  "/health",
  "/ready",
  "/api/v1/auth/login",
  "/api/v1/auth/ldap/login",
  "/api/v1/auth/logout",
];

const OIDC_PUBLIC_ROUTES = [
  "/api/v1/auth/oidc/authorize",
  "/api/v1/auth/oidc/callback",
];

function getJwtSecret(defaultDevSecret: string): string {
  if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    throw new Error("FATAL: JWT_SECRET must be set in production");
  }
  return process.env.JWT_SECRET || defaultDevSecret;
}

export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  const {
    cookieName,
    defaultDevSecret,
    queryFn,
    inactivityTimeoutMs = 15 * 60 * 1000,
    publicRoutes: customPublicRoutes,
    oidcAuth,
  } = config;

  // Merge OIDC public routes when OIDC is enabled
  const publicRoutes = customPublicRoutes
    ? customPublicRoutes
    : oidcAuth
      ? [...DEFAULT_PUBLIC_ROUTES, ...OIDC_PUBLIC_ROUTES]
      : DEFAULT_PUBLIC_ROUTES;

  const jwtSecret = getJwtSecret(defaultDevSecret);

  function verifyToken(token: string): AuthPayload | null {
    try {
      const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] }) as JwtPayload;
      if (!payload.userId || !payload.userType) return null;
      return {
        userId: payload.userId as string,
        userType: payload.userType as string,
        roles: (payload.roles as string[]) || [],
        jti: (payload.jti as string) || "",
        unitId: (payload.unitId as string) || null,
      };
    } catch {
      return null;
    }
  }

  function generateToken(user: { user_id: string; user_type: string; roles: string[]; unit_id?: string | null }): string {
    return jwt.sign(
      { userId: user.user_id, userType: user.user_type, roles: user.roles, unitId: user.unit_id || null, jti: randomUUID() },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || "30m" } as SignOptions
    );
  }

  function setAuthCookie(reply: FastifyReply, token: string): void {
    const isProduction = process.env.NODE_ENV === "production";
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
      maxAge: 1800,
    });
  }

  function clearAuthCookie(reply: FastifyReply): void {
    reply.clearCookie(cookieName, { path: "/" });
  }

  async function checkTokenRevocation(jti: string, userId: string, iat: number): Promise<boolean> {
    const denyResult = await queryFn(
      "SELECT 1 FROM auth_token_denylist WHERE jti = $1",
      [jti]
    );
    if (denyResult.rows.length > 0) return true;

    const userResult = await queryFn(
      "SELECT tokens_revoked_before FROM user_account WHERE user_id = $1",
      [userId]
    );
    if (userResult.rows.length > 0 && userResult.rows[0].tokens_revoked_before) {
      const revokedBefore = new Date(userResult.rows[0].tokens_revoked_before).getTime() / 1000;
      if (iat < revokedBefore) return true;
    }

    return false;
  }

  async function revokeToken(jti: string, userId: string, expiresAt: Date): Promise<void> {
    await queryFn(
      "INSERT INTO auth_token_denylist (jti, user_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (jti) DO NOTHING",
      [jti, userId, expiresAt]
    );
  }

  async function revokeAllUserTokens(userId: string): Promise<void> {
    await queryFn(
      "UPDATE user_account SET tokens_revoked_before = NOW() WHERE user_id = $1",
      [userId]
    );
  }

  async function checkSessionInactivity(jti: string, _userId: string): Promise<boolean> {
    const result = await queryFn(
      "SELECT last_activity_at FROM auth_session_activity WHERE jti = $1",
      [jti]
    );
    if (result.rows.length === 0) return false;
    const lastActivity = new Date(result.rows[0].last_activity_at).getTime();
    return Date.now() - lastActivity > inactivityTimeoutMs;
  }

  async function updateSessionActivity(jti: string, userId: string): Promise<void> {
    try {
      await queryFn(
        `INSERT INTO auth_session_activity (jti, user_id, last_activity_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (jti) DO UPDATE SET last_activity_at = NOW()
         WHERE auth_session_activity.last_activity_at < NOW() - INTERVAL '1 minute'`,
        [jti, userId]
      );
    } catch (err) {
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "test") {
        console.warn("[AUTH] Failed to update session activity:", err);
      }
    }
  }

  function register(app: FastifyInstance): void {
    app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      const url = request.url.split("?")[0];
      if (publicRoutes.some((r) => url === r)) return;

      const authHeader = request.headers.authorization;
      const cookieToken = (request.cookies as Record<string, string> | undefined)?.[cookieName];
      const token = cookieToken || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
      if (!token) {
        reply.code(401).send({ error: "AUTHENTICATION_REQUIRED", message: "Missing authentication", statusCode: 401 });
        return;
      }
      // Try local HS256 JWT first, then OIDC RS256 as fallback
      let payload = verifyToken(token);
      if (!payload && oidcAuth) {
        payload = await oidcAuth.verifyIdToken(token);
      }
      if (!payload) {
        reply.code(401).send({ error: "INVALID_TOKEN", message: "Token is invalid or expired", statusCode: 401 });
        return;
      }

      const decoded = jwt.decode(token) as JwtPayload | null;
      const iat = decoded?.iat || 0;
      if (payload.jti) {
        const isRevoked = await checkTokenRevocation(payload.jti, payload.userId, iat);
        if (isRevoked) {
          reply.code(401).send({ error: "TOKEN_REVOKED", message: "Token has been revoked", statusCode: 401 });
          return;
        }

        const isInactive = await checkSessionInactivity(payload.jti, payload.userId);
        if (isInactive) {
          reply.code(401).send({ error: "SESSION_INACTIVE", message: "Session expired due to inactivity", statusCode: 401 });
          return;
        }

        await updateSessionActivity(payload.jti, payload.userId);
      }

      // Block MFA_CHALLENGE tokens from accessing anything except the MFA verify endpoint
      if (payload.userType === "MFA_CHALLENGE") {
        const mfaUrl = request.url.split("?")[0];
        if (!mfaUrl.startsWith("/api/v1/auth/mfa/")) {
          reply.code(403).send({ error: "MFA_REQUIRED", message: "MFA verification required to access this resource", statusCode: 403 });
          return;
        }
      }

      request.authUser = payload;
      request.authToken = token;
    });
  }

  return {
    register,
    verifyToken,
    generateToken,
    setAuthCookie,
    clearAuthCookie,
    checkTokenRevocation,
    revokeToken,
    revokeAllUserTokens,
  };
}

export type AuthMiddleware = ReturnType<typeof createAuthMiddleware>;
