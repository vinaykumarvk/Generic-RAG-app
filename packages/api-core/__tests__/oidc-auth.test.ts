import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createOidcAuth } from "../src/auth/oidc-auth";
import type { QueryFn } from "../src/types";

// Generate a real RSA key pair for testing
let privateKey: CryptoKey;
let publicJwk: any;
let jwksResponse: any;

const ISSUER = "https://idp.example.com";
const CLIENT_ID = "test-app";
const REDIRECT_URI = "http://localhost:3000/api/v1/auth/oidc/callback";

const discoveryResponse = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
};

function createMockQueryFn(): QueryFn {
  return vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
}

async function createSignedIdToken(claims: Record<string, unknown>, nonce?: string): Promise<string> {
  const builder = new SignJWT({
    sub: "user-123",
    name: "Test User",
    user_type: "OFFICER",
    roles: ["ANALYST", "SUPERVISOR"],
    unit_id: "unit-1",
    nonce,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setExpirationTime("1h");

  return builder.sign(privateKey);
}

beforeEach(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  const jwk = await exportJWK(keyPair.publicKey);
  publicJwk = { ...jwk, kid: "test-key-1", use: "sig", alg: "RS256" };
  jwksResponse = { keys: [publicJwk] };
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch() {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/.well-known/openid-configuration")) {
      return new Response(JSON.stringify(discoveryResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/.well-known/jwks.json")) {
      return new Response(JSON.stringify(jwksResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/token")) {
      const idToken = await createSignedIdToken({});
      return new Response(JSON.stringify({
        id_token: idToken,
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        token_type: "bearer",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  });
  return fetchSpy;
}

describe("createOidcAuth", () => {
  describe("discover", () => {
    it("should fetch and cache OIDC discovery metadata", async () => {
      const fetchSpy = mockFetch();
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      const discovery = await oidc.discover();
      expect(discovery.issuer).toBe(ISSUER);
      expect(discovery.authorization_endpoint).toBe(`${ISSUER}/authorize`);
      expect(discovery.token_endpoint).toBe(`${ISSUER}/token`);

      // Second call should use cache (no additional fetch)
      await oidc.discover();
      const discoveryCalls = fetchSpy.mock.calls.filter(
        (c) => String(c[0]).includes("openid-configuration"),
      );
      expect(discoveryCalls.length).toBe(1);
    });

    it("should throw on discovery failure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Server Error", { status: 500 }),
      );
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      await expect(oidc.discover()).rejects.toThrow("OIDC discovery failed: 500");
    });
  });

  describe("verifyIdToken", () => {
    it("should verify a valid RS256 ID token", async () => {
      mockFetch();
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      const token = await createSignedIdToken({});
      const payload = await oidc.verifyIdToken(token);

      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe("user-123");
      expect(payload!.userType).toBe("OFFICER");
      expect(payload!.roles).toEqual(["ANALYST", "SUPERVISOR"]);
      expect(payload!.unitId).toBe("unit-1");
    });

    it("should validate nonce when provided", async () => {
      mockFetch();
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      const nonce = "test-nonce-abc";
      const token = await createSignedIdToken({}, nonce);

      // Correct nonce should pass
      const payload = await oidc.verifyIdToken(token, nonce);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe("user-123");
    });

    it("should reject token with mismatched nonce", async () => {
      mockFetch();
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      const token = await createSignedIdToken({}, "real-nonce");
      const payload = await oidc.verifyIdToken(token, "wrong-nonce");
      expect(payload).toBeNull();
    });

    it("should reject token with missing nonce when expected", async () => {
      mockFetch();
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      // Token without nonce
      const token = await createSignedIdToken({});
      const payload = await oidc.verifyIdToken(token, "expected-nonce");
      expect(payload).toBeNull();
    });

    it("should reject token with wrong audience", async () => {
      mockFetch();
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: "different-client",
        redirectUri: REDIRECT_URI,
      }, queryFn);

      // Token is signed for CLIENT_ID ("test-app"), not "different-client"
      const token = await createSignedIdToken({});
      const payload = await oidc.verifyIdToken(token);
      expect(payload).toBeNull();
    });

    it("should reject expired token", async () => {
      mockFetch();
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      // Create an expired token
      const token = await new SignJWT({ sub: "user-123", user_type: "OFFICER" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
        .sign(privateKey);

      const payload = await oidc.verifyIdToken(token);
      expect(payload).toBeNull();
    });

    it("should use custom claim mapping", async () => {
      mockFetch();
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        claimMapping: {
          userId: "employee_id",
          userType: "role_type",
          roles: "group_memberships",
          unitId: "department",
        },
      }, queryFn);

      const token = await new SignJWT({
        employee_id: "emp-456",
        role_type: "SUPERVISOR",
        group_memberships: ["ADMIN", "READER"],
        department: "dept-99",
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setIssuedAt()
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setExpirationTime("1h")
        .sign(privateKey);

      const payload = await oidc.verifyIdToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe("emp-456");
      expect(payload!.userType).toBe("SUPERVISOR");
      expect(payload!.roles).toEqual(["ADMIN", "READER"]);
      expect(payload!.unitId).toBe("dept-99");
    });

    it("should handle comma-separated roles string", async () => {
      mockFetch();
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      const token = await new SignJWT({
        sub: "user-789",
        user_type: "OFFICER",
        roles: "ANALYST, SUPERVISOR, ADMIN",
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setIssuedAt()
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setExpirationTime("1h")
        .sign(privateKey);

      const payload = await oidc.verifyIdToken(token);
      expect(payload!.roles).toEqual(["ANALYST", "SUPERVISOR", "ADMIN"]);
    });
  });

  describe("getAuthorizationUrl", () => {
    it("should build correct authorization URL", async () => {
      mockFetch();
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      const url = await oidc.getAuthorizationUrl("state-123", "nonce-456");
      expect(url).toContain(`${ISSUER}/authorize?`);
      expect(url).toContain("response_type=code");
      expect(url).toContain(`client_id=${CLIENT_ID}`);
      expect(url).toContain("state=state-123");
      expect(url).toContain("nonce=nonce-456");
      expect(url).toContain(encodeURIComponent(REDIRECT_URI));
      expect(url).toContain("scope=openid+profile+email");
    });
  });

  describe("exchangeCode", () => {
    it("should exchange authorization code for tokens", async () => {
      mockFetch();
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: "test-secret",
        redirectUri: REDIRECT_URI,
      }, queryFn);

      const tokens = await oidc.exchangeCode("auth-code-123");
      expect(tokens.idToken).toBeDefined();
      expect(tokens.accessToken).toBe("mock-access-token");
      expect(tokens.refreshToken).toBe("mock-refresh-token");
    });

    it("should throw on token exchange failure", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("openid-configuration")) {
          return new Response(JSON.stringify(discoveryResponse), { status: 200 });
        }
        if (url.includes("/token")) {
          return new Response("Invalid grant", { status: 400 });
        }
        return new Response("Not Found", { status: 404 });
      });
      const queryFn = createMockQueryFn();

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      await expect(oidc.exchangeCode("bad-code")).rejects.toThrow("OIDC token exchange failed: 400");
    });
  });

  describe("ensureLocalUser", () => {
    it("should skip insert if user already exists", async () => {
      mockFetch();
      const queryFn = vi.fn()
        .mockResolvedValueOnce({ rows: [{ user_id: "user-123" }], rowCount: 1 }) as unknown as QueryFn; // SELECT exists

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      await oidc.ensureLocalUser({
        userId: "user-123",
        userType: "OFFICER",
        roles: [],
        jti: "",
        unitId: null,
      });

      // Should only call SELECT, not INSERT
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect((queryFn as any).mock.calls[0][0]).toContain("SELECT");
    });

    it("should JIT provision user if not exists", async () => {
      mockFetch();
      const queryFn = (vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })      // SELECT — not found
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })      // INSERT
      ) as unknown as QueryFn;

      const oidc = createOidcAuth({
        issuerUrl: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }, queryFn);

      await oidc.ensureLocalUser(
        {
          userId: "new-user",
          userType: "SSO_USER",
          roles: [],
          jti: "",
          unitId: null,
        },
        { name: "Jane Doe", preferred_username: "jdoe" },
      );

      expect(queryFn).toHaveBeenCalledTimes(2);
      const insertCall = (queryFn as any).mock.calls[1];
      expect(insertCall[0]).toContain("INSERT INTO user_account");
      expect(insertCall[1]).toContain("Jane Doe");
      expect(insertCall[1]).toContain("SSO_NO_PASSWORD");
    });
  });
});
