import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import type { AuthMiddleware } from "../middleware/auth-middleware";
import type { OidcAuth } from "../auth/oidc-auth";

export interface OidcRouteDeps {
  auth: AuthMiddleware;
  oidc: OidcAuth;
}

export function createOidcRoutes(deps: OidcRouteDeps) {
  const { auth, oidc } = deps;

  return async function registerOidcRoutes(app: FastifyInstance): Promise<void> {
    /**
     * GET /api/v1/auth/oidc/authorize
     * Redirects the user to the OIDC provider's authorization endpoint.
     */
    app.get("/api/v1/auth/oidc/authorize", async (_request, reply) => {
      const state = randomUUID();
      const nonce = randomUUID();

      // Store state and nonce in a short-lived cookie for CSRF protection
      reply.setCookie("oidc_state", state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 300, // 5 minutes
      });
      reply.setCookie("oidc_nonce", nonce, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 300,
      });

      const url = await oidc.getAuthorizationUrl(state, nonce);
      return reply.redirect(url);
    });

    /**
     * GET /api/v1/auth/oidc/callback
     * Handles the OIDC provider's redirect with an authorization code.
     */
    app.get("/api/v1/auth/oidc/callback", {
      schema: {
        querystring: {
          type: "object",
          properties: {
            code: { type: "string" },
            state: { type: "string" },
            error: { type: "string" },
            error_description: { type: "string" },
          },
        },
      },
    }, async (request, reply) => {
      const { code, state, error, error_description } = request.query as Record<string, string | undefined>;

      // Handle provider errors
      if (error) {
        reply.code(401);
        return {
          error: "OIDC_ERROR",
          message: error_description || error,
          statusCode: 401,
        };
      }

      if (!code || !state) {
        reply.code(400);
        return {
          error: "INVALID_CALLBACK",
          message: "Missing code or state parameter",
          statusCode: 400,
        };
      }

      // Validate state against cookie (CSRF protection)
      const storedState = (request.cookies as Record<string, string> | undefined)?.oidc_state;
      if (!storedState || storedState !== state) {
        reply.code(401);
        return {
          error: "INVALID_STATE",
          message: "State parameter mismatch — possible CSRF attack",
          statusCode: 401,
        };
      }

      // Extract nonce from cookie for replay-attack prevention
      const storedNonce = (request.cookies as Record<string, string> | undefined)?.oidc_nonce;

      // Clear OIDC cookies
      reply.clearCookie("oidc_state", { path: "/" });
      reply.clearCookie("oidc_nonce", { path: "/" });

      // Exchange code for tokens
      const tokens = await oidc.exchangeCode(code);

      // Verify the ID token (with nonce validation)
      const payload = await oidc.verifyIdToken(tokens.idToken, storedNonce || undefined);
      if (!payload) {
        reply.code(401);
        return {
          error: "INVALID_ID_TOKEN",
          message: "ID token verification failed",
          statusCode: 401,
        };
      }

      // JIT provision local user
      await oidc.ensureLocalUser(payload);

      // Issue a local JWT
      const localToken = auth.generateToken({
        user_id: payload.userId,
        user_type: payload.userType,
        roles: payload.roles,
        unit_id: payload.unitId,
      });

      auth.setAuthCookie(reply, localToken);

      return { user: payload, token: localToken };
    });
  };
}
