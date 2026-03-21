/**
 * IntelliRAG API — Fastify entry point.
 * Uses @puda/api-core createApp() factory with RAG-specific routes.
 */

import { Pool } from "pg";
import {
  createApp,
  createAuthMiddleware,
  createAuthRoutes,
  createLlmConfigRoutes,
  createAuditLogger,
  createLlmProvider,
  hashPassword,
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
import { createAdminRoutes } from "./routes/admin-routes";
import { createOrgUnitRoutes } from "./routes/org-unit-routes";
import { createReviewQueueRoutes } from "./routes/review-queue-routes";
import { createNotificationRoutes } from "./routes/notification-routes";
import { createAuditRoutes } from "./routes/audit-routes";
import { createIngestionRoutes } from "./routes/ingestion-routes";
import { createWorkspaceMemberGuard } from "./middleware/workspace-guard";
import { createStorageProvider } from "./storage";

function isTruthy(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function validateStorageSafety(): void {
  const provider = (process.env.STORAGE_PROVIDER || "local").trim().toLowerCase();
  if (provider !== "local") {
    return;
  }

  if (isTruthy(process.env.ALLOW_LOCAL_STORAGE_SHARED_MOUNT) || isTruthy(process.env.ALLOW_LOCAL_STORAGE_WITH_PROD_DB)) {
    return;
  }

  const databaseUrl = (process.env.DATABASE_URL || "").toLowerCase();
  const looksLikeProductionDb = databaseUrl.includes("/police_kb")
    || databaseUrl.includes("dbname=police_kb");

  if (looksLikeProductionDb) {
    throw new Error(
      "Unsafe storage configuration: local filesystem storage against the production police_kb database " +
      "can create document rows whose files exist only on the local machine. " +
      "Use shared storage, or set ALLOW_LOCAL_STORAGE_SHARED_MOUNT=true for mounted shared storage " +
      "or ALLOW_LOCAL_STORAGE_WITH_PROD_DB=true to override intentionally."
    );
  }
}

// FR-NFR: Env var validation at startup — fail hard on missing vars, never silently fallback
function validateEnv(): void {
  const required = ["DATABASE_URL", "JWT_SECRET"];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
      `Ensure .env is loaded (use --env-file flag) or variables are exported in your shell.`
    );
  }

  validateStorageSafety();

  logInfo("Environment validated", {
    DATABASE_URL: process.env.DATABASE_URL?.replace(/\/\/.*@/, "//<credentials>@"),
  });
}

// FR-001: Bootstrap admin user on startup
async function bootstrapAdmin(queryFn: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): Promise<void> {
  try {
    const email = process.env.ADMIN_EMAIL || "admin@intellirag.local";
    const password = process.env.ADMIN_PASSWORD || "Admin123!";
    const hash = await hashPassword(password);

    const adminCheck = await queryFn(
      "SELECT user_id FROM user_account WHERE user_type = 'ADMIN' LIMIT 1",
      []
    );

    if (adminCheck.rows.length > 0) {
      // Log current admin state for debugging
      const adminInfo = await queryFn(
        "SELECT user_id, username, email, status, is_active, failed_login_attempts, locked_until FROM user_account WHERE user_type = 'ADMIN'",
        []
      );
      logInfo("Existing admin user(s)", { admins: adminInfo.rows });

      // Ensure admin password is synced and account is unlocked (match by user_type only)
      const updateResult = await queryFn(
        `UPDATE user_account
         SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL, status = 'ACTIVE', is_active = true
         WHERE user_type = 'ADMIN'
         RETURNING username`,
        [hash]
      );
      logInfo("Bootstrap admin password synced and account unlocked", { updated: updateResult.rows });
      return;
    }

    await queryFn(
      `INSERT INTO user_account (username, email, full_name, password_hash, user_type, status)
       VALUES ($1, $2, $3, $4, 'ADMIN', 'ACTIVE')
       ON CONFLICT (email) DO NOTHING`,
      [email.split("@")[0], email, "System Admin", hash]
    );
    logInfo("Bootstrap admin user created", { email });
  } catch (err) {
    logWarn("Bootstrap admin check failed (non-fatal)", { error: String(err) });
  }
}

// Bootstrap LLM providers: Qwen/OpenRouter as default, Gemini assigned to KG_EXTRACTION
async function bootstrapProviders(queryFn: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): Promise<void> {
  try {
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (openRouterKey) {
      const existing = await queryFn(
        `SELECT config_id FROM llm_provider_config WHERE api_base_url LIKE '%openrouter%' LIMIT 1`,
      );
      if (existing.rows.length === 0) {
        await queryFn(`UPDATE llm_provider_config SET is_default = FALSE WHERE is_default = TRUE`);
        await queryFn(
          `INSERT INTO llm_provider_config
             (provider, display_name, api_base_url, api_key_enc, model_id,
              is_active, is_default, max_tokens, temperature, timeout_ms, max_retries, config_jsonb)
           VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, 4096, 0.3, 60000, 2, $6::jsonb)`,
          [
            "openai", "Qwen 3.5 35B (OpenRouter)",
            "https://openrouter.ai/api/v1", openRouterKey,
            "qwen/qwen3.5-35b-a3b",
            JSON.stringify({ input_cost_per_million: 0.1625, output_cost_per_million: 1.30 }),
          ],
        );
        logInfo("Bootstrap: Qwen/OpenRouter provider created as default");
      }
    }

    // Assign Gemini provider to KG_EXTRACTION if not already assigned
    const gemini = await queryFn(
      `SELECT config_id, config_jsonb FROM llm_provider_config WHERE provider = 'gemini' AND is_active = TRUE LIMIT 1`,
    );
    if (gemini.rows.length > 0) {
      const row = gemini.rows[0] as { config_id: string; config_jsonb: Record<string, unknown> };
      const useCases = (row.config_jsonb?.assigned_use_cases as string[]) || [];
      if (!useCases.includes("KG_EXTRACTION")) {
        await queryFn(
          `UPDATE llm_provider_config
           SET config_jsonb = config_jsonb || '{"assigned_use_cases": ["KG_EXTRACTION"]}'::jsonb
           WHERE config_id = $1`,
          [row.config_id],
        );
        logInfo("Bootstrap: Gemini provider assigned to KG_EXTRACTION");
      }
    }

    // Assign OpenAI provider to EMBEDDING if not already assigned (matches stored 768-dim vectors)
    const openai = await queryFn(
      `SELECT config_id, config_jsonb FROM llm_provider_config
       WHERE provider = 'openai' AND api_base_url LIKE '%api.openai.com%' AND is_active = TRUE LIMIT 1`,
    );
    if (openai.rows.length > 0) {
      const row = openai.rows[0] as { config_id: string; config_jsonb: Record<string, unknown> };
      const useCases = (row.config_jsonb?.assigned_use_cases as string[]) || [];
      if (!useCases.includes("EMBEDDING")) {
        await queryFn(
          `UPDATE llm_provider_config
           SET config_jsonb = config_jsonb || $1::jsonb
           WHERE config_id = $2`,
          [
            JSON.stringify({
              assigned_use_cases: [...useCases, "EMBEDDING"],
              embedding_model: "text-embedding-3-small",
              embedding_dimensions: 768,
            }),
            row.config_id,
          ],
        );
        logInfo("Bootstrap: OpenAI provider assigned to EMBEDDING (768-dim)");
      }
    }
  } catch (err) {
    logWarn("Bootstrap providers check failed (non-fatal)", { error: String(err) });
  }
}

async function main() {
  validateEnv();

  // DATABASE_URL is guaranteed by validateEnv() — no silent fallback
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.DB_POOL_MAX || "8", 10),
  });

  // Verify actual DB connectivity before proceeding
  try {
    const connTest = await pool.query("SELECT current_database() AS db, inet_server_addr() AS host, inet_server_port() AS port");
    const { db, host, port } = connTest.rows[0] as { db: string; host: string; port: number };
    logInfo("Database connected", { database: db, host: host ?? "local", port });
  } catch (err) {
    logError("Cannot connect to database", { error: String(err), url: process.env.DATABASE_URL?.replace(/\/\/.*@/, "//<credentials>@") });
    throw new Error("Database connection failed — check DATABASE_URL and ensure the database is reachable");
  }

  // Run migrations on startup
  try {
    await runMigrations(pool);
    logInfo("Migrations completed");
  } catch (err) {
    logError("Migration failed", { error: String(err) });
    if (process.env.NODE_ENV === "production") {
      logError("Fatal: migration failure in production, aborting startup");
      process.exit(1);
    }
    logWarn("Migration failed in non-production, continuing anyway");
  }

  const queryFn = async (text: string, params?: unknown[]) => {
    return pool.query(text, params);
  };

  const getClient = async () => pool.connect();

  // Bootstrap admin if no admin exists (FR-001)
  await bootstrapAdmin(queryFn);

  // Bootstrap LLM providers (Qwen/OpenRouter default, Gemini → KG_EXTRACTION)
  await bootstrapProviders(queryFn);

  const llmProvider = createLlmProvider({ queryFn });

  const authMiddleware = createAuthMiddleware({
    queryFn,
    cookieName: "intellirag_session",
    defaultDevSecret: process.env.JWT_SECRET!,
    publicRoutes: ["/health", "/ready", "/docs", "/api/v1/auth/login", "/api/v1/auth/refresh"],
  });

  const auditLogger = createAuditLogger({
    queryFn,
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
      { name: "notifications", description: "Notifications" },
      { name: "audit", description: "Audit logs" },
    ],
    authMiddleware,
    auditLogger,
    dbQueryFn: () => queryFn("SELECT 1"),
    logWarnFn: logWarn,
    domainRoutes: async (app) => {
      const storageProvider = createStorageProvider();
      const deps = { queryFn, getClient, llmProvider, storageProvider };
      // FR-004: Increase bodyLimit to 250MB
      await app.register(import("@fastify/multipart"), { limits: { fileSize: 262_144_000 } });

      // Auth routes (login, logout, me, refresh)
      const authRoutes = createAuthRoutes({ queryFn, auth: authMiddleware });
      await app.register(authRoutes);

      // LLM config routes (provider management, system prompts)
      const llmConfigRoutes = createLlmConfigRoutes({ queryFn, llmProvider });
      await app.register(llmConfigRoutes);

      // Register workspace membership guard for all /workspaces/:wid/* sub-routes
      const workspaceMemberGuard = createWorkspaceMemberGuard(queryFn);
      app.addHook("preHandler", workspaceMemberGuard);

      createWorkspaceRoutes(app, deps);
      createUserRoutes(app, deps);
      createDocumentRoutes(app, deps);
      createRagRoutes(app, deps);
      createGraphRoutes(app, deps);
      createFeedbackRoutes(app, deps);
      createAnalyticsRoutes(app, deps);
      createExportRoutes(app, deps);
      createAdminRoutes(app, deps);
      createOrgUnitRoutes(app, deps);
      createReviewQueueRoutes(app, deps);
      createNotificationRoutes(app, deps);
      createAuditRoutes(app, deps);
      createIngestionRoutes(app, deps);
    },
  });

  const port = parseInt(process.env.PORT || process.env.API_PORT || "3001", 10);
  const host = process.env.API_HOST || "0.0.0.0";

  await app.listen({ port, host });
  logInfo(`IntelliRAG API listening on ${host}:${port}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logInfo(`Received ${signal}, shutting down gracefully...`);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logError("Fatal startup error", { error: String(err) });
  process.exit(1);
});
