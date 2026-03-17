import Fastify, { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { setLogContext } from "./logging/log-context";
import type { AuthMiddleware } from "./middleware/auth-middleware";
import type { AuditLogger } from "./middleware/audit-logger";

export interface SwaggerTag {
  name: string;
  description: string;
}

export interface AppBuilderConfig {
  apiTitle: string;
  apiDescription: string;
  apiVersion?: string;
  swaggerTags?: SwaggerTag[];
  authMiddleware: AuthMiddleware;
  auditLogger: AuditLogger;
  dbQueryFn: () => Promise<{ rows: any[] }>;
  logWarnFn: (message: string, fields?: Record<string, unknown>) => void;
  domainRoutes: (app: FastifyInstance) => Promise<void>;
}

export async function createApp(config: AppBuilderConfig, logger = true): Promise<FastifyInstance> {
  const {
    apiTitle,
    apiDescription,
    apiVersion = "1.0.0",
    swaggerTags = [],
    authMiddleware,
    auditLogger,
    dbQueryFn,
    logWarnFn,
    domainRoutes,
  } = config;

  const isTestRuntime = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const isProduction = process.env.NODE_ENV === "production";

  const rawAllowedOrigins = process.env.ALLOWED_ORIGINS;
  if (isProduction && !rawAllowedOrigins) {
    throw new Error("FATAL: ALLOWED_ORIGINS must be set in production (comma-separated list of allowed origins)");
  }
  const allowedOrigins = rawAllowedOrigins
    ? rawAllowedOrigins.split(",").map((o) => o.trim()).filter(Boolean)
    : isTestRuntime ? true : [];

  const app = Fastify({ logger, bodyLimit: 10_485_760 });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  });
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(cors, { origin: allowedOrigins, credentials: true });
  await app.register(cookie);

  const globalRateLimitMax = Number.parseInt(process.env.RATE_LIMIT_MAX || "100", 10);
  await app.register(rateLimit, {
    max: Number.isFinite(globalRateLimitMax) ? globalRateLimitMax : 100,
    timeWindow: process.env.RATE_LIMIT_WINDOW || "1 minute",
  });

  // Stricter rate limits for mutation endpoints
  app.addHook("onRoute", (routeOptions) => {
    if (
      routeOptions.config?.rateLimit ||
      routeOptions.url === "/health" ||
      routeOptions.url === "/ready"
    ) {
      return;
    }
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    const isMutation = methods.some((m: string) =>
      ["POST", "PUT", "PATCH", "DELETE"].includes(m),
    );
    if (isMutation) {
      routeOptions.config = routeOptions.config || {};
      (routeOptions.config as Record<string, unknown>).rateLimit = {
        max: 30,
        timeWindow: "1 minute",
      };
    }
  });

  const docsEnabled = process.env.NODE_ENV !== "production";
  await app.register(swagger, {
    openapi: {
      info: {
        title: apiTitle,
        description: apiDescription,
        version: apiVersion,
      },
      tags: [
        { name: "health", description: "Health check endpoints" },
        { name: "auth", description: "Authentication and authorization" },
        ...swaggerTags,
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
  if (docsEnabled) {
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { statusCode?: number; code?: string };
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) {
      app.log.error(err);
      return reply.code(500).send({ error: "INTERNAL_ERROR", message: "An unexpected error occurred", statusCode: 500 });
    }
    return reply.code(statusCode).send({ error: err.code || "ERROR", message: err.message, statusCode });
  });

  authMiddleware.register(app);
  auditLogger.register(app);

  app.addHook("onRequest", async (request) => {
    setLogContext({ requestId: request.id });
  });

  app.addHook("onResponse", async (request, reply) => {
    setLogContext({ requestId: request.id });
    const duration = reply.elapsedTime;
    if (duration > 1000) {
      logWarnFn("SLOW_REQUEST", { method: request.method, url: request.url, statusCode: reply.statusCode, durationMs: Math.round(duration) });
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async (_request, reply) => {
    try {
      await dbQueryFn();
      return { status: "ok" };
    } catch {
      reply.code(503);
      return { status: "degraded", reason: "database_unreachable" };
    }
  });

  await domainRoutes(app);

  return app;
}
