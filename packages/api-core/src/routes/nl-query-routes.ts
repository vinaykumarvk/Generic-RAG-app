/**
 * NL Query Routes — LLM-generated SQL from natural language questions.
 *
 * POST /api/v1/query — ask a question, get data back
 * GET  /api/v1/query/history — past queries for current user
 */

import { FastifyInstance } from "fastify";
import type { QueryFn } from "../types";
import type { LlmProvider } from "../llm/llm-provider";
import { sendError } from "../errors";
import { logInfo, logWarn, logError } from "../logging/logger";

export interface NlQueryPattern {
  pattern: RegExp;
  sqlTemplate: string;
  description: string;
}

export interface NlQueryRouteDeps {
  queryFn: QueryFn;
  llmProvider: LlmProvider;
  /** Regex-based fallback patterns when LLM is unavailable */
  queryPatterns?: NlQueryPattern[];
  /** DB schema description for LLM context */
  dbSchemaContext: string;
  /** Application identifier (e.g. "puda", "dopams", "forensic") */
  appId: string;
  /** Optional SQL WHERE restrictions based on user role */
  scopeRestrictions?: (userId: string, roles: string[]) => string;
  /** Extract user from request (varies by app — authUser, user, etc.) */
  getUser?: (request: any) => any;
}

const SELECT_ONLY_RE = /^\s*(SELECT|WITH)\b/i;
const DANGEROUS_RE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE)\b/i;
/** Reject multi-statement queries (semicolons followed by non-whitespace) to prevent stacked injections */
const MULTI_STATEMENT_RE = /;\s*\S/;

export function createNlQueryRoutes(deps: NlQueryRouteDeps) {
  const { queryFn, llmProvider, queryPatterns, dbSchemaContext, appId, scopeRestrictions, getUser = (r: any) => r.authUser || r.user } = deps;

  return async function registerNlQueryRoutes(app: FastifyInstance): Promise<void> {
    // ── POST /api/v1/query ─────────────────────────────────────────────────
    app.post("/api/v1/query", {
      schema: {
        body: {
          type: "object",
          required: ["question"],
          additionalProperties: false,
          properties: {
            question: { type: "string", minLength: 3, maxLength: 1000 },
          },
        },
      },
    }, async (request, reply) => {
      const user = getUser(request);
      if (!user) return sendError(reply, 401, "UNAUTHORIZED", "Authentication required");

      const { question } = request.body as { question: string };
      const startTime = Date.now();

      // Try LLM-based query first
      const llmAvailable = await llmProvider.isLlmAvailable();
      if (llmAvailable) {
        try {
          const result = await llmGenerateAndExecute(question, user.userId || user.user_id, user.roles || []);
          if (result) {
            await logQuery(user.userId || user.user_id, question, result.sql, result.summary, result.citations, "LLM", Date.now() - startTime);
            return {
              summary: result.summary,
              data: result.data,
              citations: result.citations,
              source: "LLM",
              executionTimeMs: Date.now() - startTime,
            };
          }
        } catch (err) {
          logWarn("LLM query generation failed, falling back to regex", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Fallback to regex patterns
      if (queryPatterns) {
        for (const pattern of queryPatterns) {
          const match = question.match(pattern.pattern);
          if (match) {
            try {
              // Build parameterized query — capture groups become query params
              const captureGroups = match.slice(1);
              let sql = pattern.sqlTemplate;
              // Re-index template placeholders to PostgreSQL $N params
              captureGroups.forEach((_group, idx) => {
                sql = sql.replace(`'$${idx + 1}'`, `$${idx + 1}`);
              });
              const result = await queryFn(sql, captureGroups);
              const summary = `Found ${result.rows.length} result(s) matching: ${pattern.description}`;
              await logQuery(user.userId || user.user_id, question, sql, summary, [], "REGEX", Date.now() - startTime);
              return {
                summary,
                data: result.rows,
                citations: [],
                source: "REGEX",
                executionTimeMs: Date.now() - startTime,
              };
            } catch (err) {
              logError("Regex pattern query execution failed", { error: String(err) });
            }
          }
        }
      }

      return { summary: "I couldn't find an answer to that question. Try rephrasing.", data: [], citations: [], source: "NONE", executionTimeMs: Date.now() - startTime };
    });

    // ── GET /api/v1/query/history ──────────────────────────────────────────
    app.get("/api/v1/query/history", {
      config: { skipStrictReadSchema: true },
    }, async (request, reply) => {
      const user = getUser(request);
      if (!user) return sendError(reply, 401, "UNAUTHORIZED", "Authentication required");

      const result = await queryFn(
        `SELECT query_id, question, summary, source, execution_time_ms, created_at
         FROM nl_query_log
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [user.userId || user.user_id],
      );
      return { history: result.rows };
    });

    // ── Helpers ────────────────────────────────────────────────────────────
    async function llmGenerateAndExecute(question: string, userId: string, roles: string[]) {
      const scopeClause = scopeRestrictions ? scopeRestrictions(userId, roles) : "";

      const result = await llmProvider.llmCompleteJson<{
        sql: string;
        summary: string;
        citations: Array<{ type: string; id: string; label: string }>;
      }>({
        messages: [
          {
            role: "system",
            content: `You are a read-only SQL query generator for the ${appId} database. Generate PostgreSQL SELECT queries only.

DATABASE SCHEMA:
${dbSchemaContext}

RULES:
- ONLY generate SELECT statements. Never INSERT, UPDATE, DELETE, DROP, or any DDL.
- Always include LIMIT (max 100 rows).
- If the user asks about data you cannot query, return sql: "SELECT 'Not available' AS message".
${scopeClause ? `- Always apply this scope filter: ${scopeClause}` : ""}
- Return JSON with: { "sql": "...", "summary": "human-readable answer", "citations": [{"type": "entity_type", "id": "entity_id", "label": "display_label"}] }`,
          },
          { role: "user", content: question },
        ],
        useCase: "NL_QUERY",
        maxTokens: 1024,
        temperature: 0.1,
      }, [
        { field: "sql", type: "string" },
        { field: "summary", type: "string" },
        { field: "citations", type: "array" },
      ]);

      if (!result) return null;

      const { sql, summary, citations } = result.data;

      // Sanitize SQL — reject non-SELECT, DML keywords, and multi-statement queries
      if (!SELECT_ONLY_RE.test(sql) || DANGEROUS_RE.test(sql) || MULTI_STATEMENT_RE.test(sql)) {
        logWarn("LLM generated unsafe SQL, blocking", { sql: sql.slice(0, 200) });
        return null;
      }

      // Strip any trailing semicolons to prevent statement stacking
      const safeSql = sql.replace(/;\s*$/, "");
      const queryResult = await queryFn(safeSql);
      return { sql, summary, citations, data: queryResult.rows };
    }

    async function logQuery(
      userId: string, question: string, sql: string,
      summary: string, citations: unknown[], source: string, executionTimeMs: number,
    ) {
      queryFn(
        `INSERT INTO nl_query_log (user_id, question, generated_sql, summary, citations, source, execution_time_ms, app_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [userId, question, sql, summary, JSON.stringify(citations), source, executionTimeMs, appId],
      ).catch((err) => logWarn("NL query log write failed", { error: String(err) }));
    }
  };
}
