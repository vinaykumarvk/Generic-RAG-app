import { createRemoteJWKSet, jwtVerify, type JWTVerifyResult } from "jose";
import type { AuthPayload, QueryFn } from "../types";
import type { OidcConfig } from "./types";
import { logInfo, logError, logWarn } from "../logging/logger";

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

interface OidcState {
  discovery: OidcDiscovery | null;
  jwks: ReturnType<typeof createRemoteJWKSet> | null;
  discoveredAt: number;
}

const DISCOVERY_TTL_MS = 3600_000; // 1 hour

export function createOidcAuth(config: OidcConfig, queryFn: QueryFn) {
  const {
    issuerUrl,
    clientId,
    clientSecret,
    redirectUri,
    claimMapping = {},
  } = config;

  const state: OidcState = {
    discovery: null,
    jwks: null,
    discoveredAt: 0,
  };

  const claimMap = {
    userId: claimMapping.userId || "sub",
    userType: claimMapping.userType || "user_type",
    roles: claimMapping.roles || "roles",
    unitId: claimMapping.unitId || "unit_id",
  };

  async function discover(): Promise<OidcDiscovery> {
    if (state.discovery && Date.now() - state.discoveredAt < DISCOVERY_TTL_MS) {
      return state.discovery;
    }

    const wellKnownUrl = `${issuerUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
    logInfo("OIDC discovery", { url: wellKnownUrl });

    const response = await fetch(wellKnownUrl);
    if (!response.ok) {
      throw new Error(`OIDC discovery failed: ${response.status} ${response.statusText}`);
    }

    const discovery = (await response.json()) as OidcDiscovery;

    if (discovery.issuer !== issuerUrl && discovery.issuer !== issuerUrl.replace(/\/$/, "")) {
      throw new Error(`OIDC issuer mismatch: expected ${issuerUrl}, got ${discovery.issuer}`);
    }

    state.discovery = discovery;
    state.jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    state.discoveredAt = Date.now();

    return discovery;
  }

  /**
   * Verify an OIDC ID token using the issuer's JWKS.
   * @param idToken The raw ID token string
   * @param expectedNonce The nonce sent in the authorization request (from cookie).
   *                      Pass undefined to skip nonce validation (e.g. for access tokens).
   * Returns the mapped AuthPayload or null if invalid.
   */
  async function verifyIdToken(idToken: string, expectedNonce?: string): Promise<AuthPayload | null> {
    try {
      await discover();
      if (!state.jwks) return null;

      const verifyOpts: Parameters<typeof jwtVerify>[2] = {
        issuer: issuerUrl,
        audience: clientId,
      };

      const result: JWTVerifyResult = await jwtVerify(idToken, state.jwks, verifyOpts);

      // Validate nonce if provided — prevents replay attacks
      if (expectedNonce) {
        const tokenNonce = result.payload.nonce as string | undefined;
        if (!tokenNonce || tokenNonce !== expectedNonce) {
          logError("OIDC nonce mismatch", { expected: expectedNonce, got: tokenNonce });
          return null;
        }
      }

      const claims = result.payload as Record<string, unknown>;

      const userId = String(claims[claimMap.userId] || "");
      if (!userId) return null;

      const userType = String(claims[claimMap.userType] || "SSO_USER");
      const rawRoles = claims[claimMap.roles];
      const roles = Array.isArray(rawRoles)
        ? rawRoles.map(String)
        : typeof rawRoles === "string"
          ? rawRoles.split(",").map((r) => r.trim()).filter(Boolean)
          : [];
      const unitId = claims[claimMap.unitId] ? String(claims[claimMap.unitId]) : null;
      const jti = String(claims.jti || "");

      return { userId, userType, roles, jti, unitId };
    } catch (err) {
      logError("OIDC token verification failed", { error: String(err) });
      return null;
    }
  }

  /**
   * Build the authorization URL for the OIDC flow.
   */
  async function getAuthorizationUrl(stateParam: string, nonce: string): Promise<string> {
    const discovery = await discover();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid profile email",
      state: stateParam,
      nonce,
    });
    return `${discovery.authorization_endpoint}?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for tokens.
   */
  async function exchangeCode(code: string): Promise<{
    idToken: string;
    accessToken: string;
    refreshToken?: string;
  }> {
    const discovery = await discover();

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
    });
    if (clientSecret) {
      body.set("client_secret", clientSecret);
    }

    const response = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OIDC token exchange failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as Record<string, string>;

    return {
      idToken: data.id_token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    };
  }

  /**
   * Ensure the OIDC user exists in the local user_account table.
   * Creates a new account if not found (JIT provisioning).
   */
  async function ensureLocalUser(payload: AuthPayload, idTokenClaims?: Record<string, unknown>): Promise<void> {
    const existing = await queryFn(
      "SELECT user_id FROM user_account WHERE user_id = $1",
      [payload.userId],
    );

    if (existing.rows.length > 0) return;

    // JIT provision — create a local shadow user
    const fullName = idTokenClaims
      ? String(idTokenClaims.name || idTokenClaims.preferred_username || payload.userId)
      : payload.userId;

    await queryFn(
      `INSERT INTO user_account (user_id, username, password_hash, full_name, user_type, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (user_id) DO NOTHING`,
      [payload.userId, payload.userId, "SSO_NO_PASSWORD", fullName, payload.userType],
    );

    logInfo("OIDC JIT user provisioned", { userId: payload.userId });
  }

  return {
    discover,
    verifyIdToken,
    getAuthorizationUrl,
    exchangeCode,
    ensureLocalUser,
  };
}

export type OidcAuth = ReturnType<typeof createOidcAuth>;
