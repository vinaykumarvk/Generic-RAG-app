/**
 * IntelliRAG API — Fastify entry point.
 * Uses @puda/api-core createApp() factory with RAG-specific routes.
 */

import { Pool } from "pg";
import {
  createApp,
  createAuthMiddleware,
  createAuditLogger,
  createLlmProvider,
  logInfo,
  logWarn,
  logError,
} from "@puda/api-core";
import { runMigrations } from "./migrate-runner";
import { createWorkspaceRoutes } from "./routes/workspace-routes";
import { createUserRoutes } from "./routes/user-routes";
import { createDocumentRoutes } from "./routes/document-routes";
import { createRagRoutes } from "./routes/rag-routes";
import { createGraphRoutes } from "./routes/graph-routes";
import { createFeedbackRoutes } from "./routes/feedback-routes";
import { createAnalyticsRoutes } from "./routes/analytics-routes";
import { createExportRoutes } from "./routes/export-routes";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://intellirag:intellirag@localhost:5432/intellirag",
    max: parseInt(process.env.DB_POOL_MAX || "8", 10),
  });

  // Run migrations on startup
  try {
    await runMigrations(pool);
    logInfo("Migrations completed");
  } catch (err) {
    logError("Migration failed, starting anyway", { error: String(err) });
  }

  const queryFn = async (text: string, params?: unknown[]) => {
    return pool.query(text, params);
  };

  const getClient = async () => pool.connect();

  const llmProvider = createLlmProvider({ queryFn });

  const authMiddleware = createAuthMiddleware({
    queryFn,
    cookieName: "intellirag_session",
    defaultDevSecret: process.env.JWT_SECRET || "intellirag-dev-secret-change-me",
    publicRoutes: ["/health", "/ready", "/docs", "/api/v1/auth/login"],
  });

  const auditLogger = createAuditLogger({
    queryFn,
    tableName: "audit_log",
  });

  const app = await createApp({
    apiTitle: "IntelliRAG API",
    apiDescription: "Multi-LLM RAG + Knowledge Graph platform",
    apiVersion: "0.1.0",
    swaggerTags: [
      { name: "workspaces", description: "Workspace management" },
      { name: "users", description: "User management" },
      { name: "documents", description: "Document upload and management" },
      { name: "rag", description: "RAG query and conversation" },
      { name: "graph", description: "Knowledge graph" },
      { name: "admin", description: "Administration" },
    ],
    authMiddleware,
    auditLogger,
    dbQueryFn: () => queryFn("SELECT 1"),
    logWarnFn: logWarn,
    domainRoutes: async (app) => {
      const deps = { queryFn, getClient, llmProvider };
      await app.register(import("@fastify/multipart"), { limits: { fileSize: 52_428_800 } });
      createWorkspaceRoutes(app, deps);
      createUserRoutes(app, deps);
      createDocumentRoutes(app, deps);
      createRagRoutes(app, deps);
      createGraphRoutes(app, deps);
      createFeedbackRoutes(app, deps);
      createAnalyticsRoutes(app, deps);
      createExportRoutes(app, deps);
    },
  });

  const port = parseInt(process.env.API_PORT || "3001", 10);
  const host = process.env.API_HOST || "0.0.0.0";

  await app.listen({ port, host });
  logInfo(`IntelliRAG API listening on ${host}:${port}`);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
