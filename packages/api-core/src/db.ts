import pg from "pg";
import fs from "fs";

export interface CreatePoolConfig {
  envPrefix: string;
  defaultTestUrl: string;
  logWarnFn: (message: string, fields?: Record<string, unknown>) => void;
}

export function createPool(config: CreatePoolConfig) {
  const { envPrefix, defaultTestUrl, logWarnFn } = config;
  const isTestRuntime = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

  const connectionString = process.env[`${envPrefix}_DATABASE_URL`] || process.env.DATABASE_URL;
  const resolvedConnectionString =
    connectionString || (isTestRuntime ? defaultTestUrl : undefined);
  if (!resolvedConnectionString && !isTestRuntime) {
    throw new Error(`FATAL: ${envPrefix}_DATABASE_URL must be set in non-test runtime`);
  }

  function resolveSslConfig(): any {
    const sslEnv = process.env.DATABASE_SSL;
    if (sslEnv === "false") {
      const dbUrl = process.env[`${envPrefix}_DATABASE_URL`] || process.env.DATABASE_URL || "";
      const isUnixSocket = dbUrl.includes("/cloudsql/");
      if (process.env.NODE_ENV === "production" && !isUnixSocket) {
        throw new Error("FATAL: DATABASE_SSL=false is not allowed in production (except Cloud SQL Unix sockets)");
      }
      return undefined;
    }
    const ca = process.env.DATABASE_SSL_CA_BASE64
      ? Buffer.from(process.env.DATABASE_SSL_CA_BASE64, "base64").toString("utf-8")
      : process.env.DATABASE_SSL_CA_PATH
        ? fs.readFileSync(process.env.DATABASE_SSL_CA_PATH, "utf-8")
        : process.env.DATABASE_SSL_CA || undefined;
    return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  }

  const pool = new pg.Pool({
    connectionString: resolvedConnectionString || defaultTestUrl,
    max: Number.parseInt(process.env.PG_POOL_MAX || "20", 10) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 30000,
    ssl: resolveSslConfig(),
  });

  // Periodic pool metrics (every 30s)
  if (!isTestRuntime) {
    setInterval(() => {
      logWarnFn("DB_POOL_METRICS", {
        totalClients: pool.totalCount,
        idleClients: pool.idleCount,
        waitingClients: pool.waitingCount,
      });
    }, 30_000).unref();
  }

  async function query(text: string, params?: any[]) {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 500) {
      logWarnFn("SLOW_QUERY", { text: text.slice(0, 120), durationMs: duration });
    }
    return res;
  }

  async function getClient() {
    return await pool.connect();
  }

  return { pool, query, getClient };
}
