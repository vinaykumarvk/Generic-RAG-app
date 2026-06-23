/**
 * District batch-operation routes.
 *
 * The API enqueues bulk seeding and enumeration discovery into
 * `district_batch_job`; the Python worker executes them (discovery hits the
 * eCourts portal + CAPTCHA solver, which only the worker can do). Write
 * endpoints are ADMIN-gated because discovery spends metered CAPTCHA budget.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError, logError } from "@puda/api-core";
import type { QueryFn, GetClientFn, LlmProvider } from "@puda/api-core";

export interface DistrictBatchRouteDeps {
  queryFn: QueryFn;
  getClient: GetClientFn;
  llmProvider: LlmProvider;
}

interface SeedBody {
  limit?: number;
  state_code?: number;
  year?: number;
}

interface ProcessBody {
  limit?: number;
}

interface DiscoverBody {
  state?: string;
  establishment?: string;
  court_code?: number;
  year?: number;
  start?: number;
  count?: number;
}

const MAX_SEED_LIMIT = 100_000;
const MAX_DISCOVER_COUNT = 1_000;
const MAX_PROCESS_LIMIT = 10_000;
const BATCH_JOB_LIST_LIMIT = 50;

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.authUser?.userType !== "ADMIN") {
    sendError(reply, 403, "FORBIDDEN", "District batch operations require an admin user");
    return false;
  }
  return true;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? Math.trunc(value) : Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function validateDiscover(body: DiscoverBody): { error?: string; params?: Record<string, unknown> } {
  const state = String(body.state ?? "").trim().toUpperCase();
  const establishment = String(body.establishment ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return { error: "state must be 2 letters (e.g. UP)" };
  if (!/^[A-Z]{2}$/.test(establishment)) return { error: "establishment must be 2 letters (e.g. LU)" };
  const courtCode = Number(body.court_code);
  if (!Number.isInteger(courtCode) || courtCode < 0 || courtCode > 99) {
    return { error: "court_code must be an integer 0-99" };
  }
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return { error: "year must be a 4-digit year" };
  }
  return {
    params: {
      state,
      establishment,
      court_code: courtCode,
      year,
      start: boundedInt(body.start, 1, 1, Number.MAX_SAFE_INTEGER),
      count: boundedInt(body.count, 100, 1, MAX_DISCOVER_COUNT),
    },
  };
}

async function insertJob(
  queryFn: QueryFn,
  wid: string,
  jobType: "seed" | "discover" | "process",
  params: Record<string, unknown>,
  requestedBy: string | null,
) {
  const result = await queryFn(
    `INSERT INTO district_batch_job (workspace_id, job_type, params, requested_by)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING district_batch_job_id, workspace_id, job_type, status, params, created_at`,
    [wid, jobType, JSON.stringify(params), requestedBy],
  );
  return result.rows[0];
}

export function createDistrictBatchRoutes(app: FastifyInstance, deps: DistrictBatchRouteDeps) {
  const { queryFn } = deps;

  app.post<{ Params: { wid: string }; Body: SeedBody }>(
    "/api/v1/workspaces/:wid/district/seed",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return reply;
      const body = request.body ?? {};
      if (body.year !== undefined && !(Number.isInteger(Number(body.year)) && Number(body.year) >= 1900 && Number(body.year) <= 2100)) {
        return sendError(reply, 400, "DISTRICT_BATCH_INVALID", "year must be a 4-digit year");
      }
      if (body.state_code !== undefined && !Number.isInteger(Number(body.state_code))) {
        return sendError(reply, 400, "DISTRICT_BATCH_INVALID", "state_code must be an integer");
      }
      try {
        const params: Record<string, unknown> = { limit: boundedInt(body.limit, 1000, 1, MAX_SEED_LIMIT) };
        if (body.state_code !== undefined) params.state_code = Number(body.state_code);
        if (body.year !== undefined) params.year = Number(body.year);
        const job = await insertJob(queryFn, request.params.wid, "seed", params, request.authUser?.userId ?? null);
        return reply.code(202).send({ job });
      } catch (err) {
        logError("Failed to enqueue district seed job", { error: String(err), workspaceId: request.params.wid });
        return sendError(reply, 500, "DISTRICT_BATCH_ERROR", "Failed to enqueue seed job");
      }
    },
  );

  app.post<{ Params: { wid: string }; Body: DiscoverBody }>(
    "/api/v1/workspaces/:wid/district/discover",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return reply;
      const { error, params } = validateDiscover(request.body ?? {});
      if (error || !params) {
        return sendError(reply, 400, "DISTRICT_BATCH_INVALID", error ?? "Invalid discovery parameters");
      }
      try {
        const job = await insertJob(queryFn, request.params.wid, "discover", params, request.authUser?.userId ?? null);
        return reply.code(202).send({ job });
      } catch (err) {
        logError("Failed to enqueue district discover job", { error: String(err), workspaceId: request.params.wid });
        return sendError(reply, 500, "DISTRICT_BATCH_ERROR", "Failed to enqueue discover job");
      }
    },
  );

  app.post<{ Params: { wid: string }; Body: ProcessBody }>(
    "/api/v1/workspaces/:wid/district/process",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return reply;
      try {
        const limit = boundedInt(request.body?.limit, 100, 1, MAX_PROCESS_LIMIT);
        const job = await insertJob(queryFn, request.params.wid, "process", { limit }, request.authUser?.userId ?? null);
        return reply.code(202).send({ job });
      } catch (err) {
        logError("Failed to enqueue district process job", { error: String(err), workspaceId: request.params.wid });
        return sendError(reply, 500, "DISTRICT_BATCH_ERROR", "Failed to enqueue process job");
      }
    },
  );

  app.get<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/district/stage-counts",
    async (request, reply) => {
      try {
        const wid = request.params.wid;
        const [queue, artifacts] = await Promise.all([
          queryFn(
            `SELECT
               count(*) FILTER (WHERE status IN ('pending','processing','rate_limited'))::int AS queued_for_fetch,
               count(*) FILTER (WHERE status IN ('failed','blocked'))::int AS fetch_failed
             FROM district_acquisition_queue
             WHERE workspace_id = $1`,
            [wid],
          ),
          queryFn(
            `SELECT
               count(*) FILTER (WHERE document_id IS NULL AND storage_uri IS NOT NULL)::int AS stored_awaiting_processing,
               count(*) FILTER (WHERE document_id IS NOT NULL)::int AS processed
             FROM district_text_artifact
             WHERE workspace_id = $1`,
            [wid],
          ),
        ]);
        return {
          queued_for_fetch: queue.rows[0]?.queued_for_fetch ?? 0,
          fetch_failed: queue.rows[0]?.fetch_failed ?? 0,
          stored_awaiting_processing: artifacts.rows[0]?.stored_awaiting_processing ?? 0,
          processed: artifacts.rows[0]?.processed ?? 0,
        };
      } catch (err) {
        logError("Failed to load district stage counts", { error: String(err), workspaceId: request.params.wid });
        return sendError(reply, 500, "DISTRICT_BATCH_ERROR", "Failed to load stage counts");
      }
    },
  );

  app.get<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/district/batch-jobs",
    async (request, reply) => {
      try {
        const result = await queryFn(
          `SELECT district_batch_job_id, job_type, status, params, result, error_message,
                  attempt_count, created_at, updated_at
           FROM district_batch_job
           WHERE workspace_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [request.params.wid, BATCH_JOB_LIST_LIMIT],
        );
        return { jobs: result.rows };
      } catch (err) {
        logError("Failed to list district batch jobs", { error: String(err), workspaceId: request.params.wid });
        return sendError(reply, 500, "DISTRICT_BATCH_ERROR", "Failed to list batch jobs");
      }
    },
  );

  app.get<{ Params: { wid: string; jobId: string } }>(
    "/api/v1/workspaces/:wid/district/batch-jobs/:jobId",
    async (request, reply) => {
      try {
        const result = await queryFn(
          `SELECT district_batch_job_id, job_type, status, params, result, error_message,
                  attempt_count, created_at, updated_at
           FROM district_batch_job
           WHERE workspace_id = $1 AND district_batch_job_id = $2`,
          [request.params.wid, request.params.jobId],
        );
        if (result.rows.length === 0) {
          return sendError(reply, 404, "NOT_FOUND", "Batch job not found");
        }
        return { job: result.rows[0] };
      } catch (err) {
        logError("Failed to load district batch job", { error: String(err), workspaceId: request.params.wid });
        return sendError(reply, 500, "DISTRICT_BATCH_ERROR", "Failed to load batch job");
      }
    },
  );
}
