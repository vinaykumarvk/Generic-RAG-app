import { FastifyInstance } from "fastify";

export interface TestHelperConfig {
  buildApp: (logger?: boolean) => Promise<FastifyInstance>;
  dbUrlEnvVar: string;
  defaultDbUrl: string;
}

export function createTestHelpers(config: TestHelperConfig) {
  const { buildApp, dbUrlEnvVar, defaultDbUrl } = config;

  async function buildTestApp(): Promise<FastifyInstance> {
    process.env.VITEST = "true";
    process.env[dbUrlEnvVar] = process.env[dbUrlEnvVar] || defaultDbUrl;
    process.env.RATE_LIMIT_MAX = "10000";
    const app = await buildApp(false);
    await app.ready();
    return app;
  }

  async function getAuthToken(
    app: FastifyInstance,
    username = "admin",
    password = "password",
  ): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username, password },
    });
    const body = JSON.parse(res.body);
    if (!body.token) {
      throw new Error(
        `getAuthToken failed for ${username}: ${res.statusCode} – ${res.body}`,
      );
    }
    return body.token as string;
  }

  async function authInject(
    app: FastifyInstance,
    token: string,
    opts: {
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      url: string;
      payload?: Record<string, unknown> | string;
    },
  ) {
    return app.inject({
      method: opts.method,
      url: opts.url,
      headers: { authorization: `Bearer ${token}` },
      ...(opts.payload !== undefined ? { payload: opts.payload } : {}),
    });
  }

  async function isDatabaseReady(app: FastifyInstance): Promise<boolean> {
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "admin", password: "password" },
      });
      return res.statusCode === 200;
    } catch {
      return false;
    }
  }

  return { buildTestApp, getAuthToken, authInject, isDatabaseReady };
}
