/**
 * District court analytics routes.
 *
 * Dashboard endpoints read district_case_fact_daily, which is refreshed by the
 * worker or the explicit refresh endpoint. The only raw-case endpoint here is
 * the filtered CNR export for follow-up acquisition work.
 */

import { FastifyInstance, FastifyReply } from "fastify";
import { sendError, logError } from "@puda/api-core";
import type { QueryFn, GetClientFn, LlmProvider } from "@puda/api-core";

export interface DistrictAnalyticsRouteDeps {
  queryFn: QueryFn;
  getClient: GetClientFn;
  llmProvider: LlmProvider;
}

type QueryValue = string | string[] | undefined;

interface DistrictAnalyticsQuery {
  date_from?: QueryValue;
  date_to?: QueryValue;
  state_code?: QueryValue;
  district_code?: QueryValue;
  district_key?: QueryValue;
  court_level?: QueryValue;
  statute?: QueryValue;
  section?: QueryValue;
  offence_category?: QueryValue;
  disposition?: QueryValue;
  language?: QueryValue;
  source_name?: QueryValue;
  commercial_safe?: QueryValue;
  case_search?: QueryValue;
  bucket?: QueryValue;
  limit?: QueryValue;
  offset?: QueryValue;
}

interface SqlFilters {
  whereClause: string;
  whereParts: string[];
  params: unknown[];
}

const FILTER_OPTIONS_TTL_MS = 15 * 60 * 1000;
const filterOptionsCache = new Map<string, { expiresAt: number; payload: unknown }>();
const FETCH_SOURCE_ORDER = ["indian_kanoon", "ecourts", "hldc"] as const;
const OPEN_FETCH_STATUSES = new Set(["pending", "processing", "rate_limited"]);

type FetchSourceName = typeof FETCH_SOURCE_ORDER[number];

interface DistrictFetchJudgmentBody {
  sources?: string[];
  force?: boolean;
}

interface DistrictCaseFetchRow {
  district_case_id: string;
  workspace_id: string;
  cnr: string | null;
  source_case_id: string;
  state_code: number | null;
  state_name: string | null;
  district_code: number | null;
  district_name: string | null;
  court_name: string | null;
  court_level: string | null;
  case_type: string | null;
  decision_date: string | null;
  offence_categories: string[];
  is_criminal_target: boolean;
  text_status: string;
}

export function createDistrictAnalyticsRoutes(app: FastifyInstance, deps: DistrictAnalyticsRouteDeps) {
  const { queryFn } = deps;

  app.get<{ Params: { wid: string }; Querystring: DistrictAnalyticsQuery }>(
    "/api/v1/workspaces/:wid/district/analytics/summary",
    async (request, reply) => {
      try {
        const filters = buildFactFilters(request.params.wid, request.query);
        const [summary, refresh] = await Promise.all([
          queryFn(
            `SELECT
               COALESCE(sum(metadata_case_count), 0)::int AS total_cases,
               COALESCE(sum(criminal_target_count), 0)::int AS criminal_targets,
               COALESCE(sum(text_available_count), 0)::int AS text_available,
               COALESCE(sum(ocr_required_count), 0)::int AS ocr_required,
               COALESCE(sum(translated_count), 0)::int AS translated,
               COALESCE(sum(redacted_count), 0)::int AS redacted,
               COALESCE(sum(rag_active_count), 0)::int AS rag_active,
               COALESCE(sum(fetch_failed_count), 0)::int AS fetch_failed,
               round(avg(avg_days_registration_to_decision))::int AS avg_delay_days,
               round(max(p95_days_registration_to_decision))::int AS p95_delay_days
             FROM district_case_fact_daily
             WHERE ${filters.whereClause}`,
            filters.params,
          ),
          queryFn(
            `SELECT completed_at, inserted_fact_rows
             FROM district_analytics_refresh_log
             WHERE workspace_id = $1
             ORDER BY completed_at DESC NULLS LAST, started_at DESC
             LIMIT 1`,
            [request.params.wid],
          ),
        ]);

        const row = summary.rows[0] || {};
        return {
          totals: {
            total_cases: numberValue(row.total_cases),
            criminal_targets: numberValue(row.criminal_targets),
            text_available: numberValue(row.text_available),
            ocr_required: numberValue(row.ocr_required),
            translated: numberValue(row.translated),
            redacted: numberValue(row.redacted),
            rag_active: numberValue(row.rag_active),
            fetch_failed: numberValue(row.fetch_failed),
          },
          delay: {
            avg_days_registration_to_decision: nullableNumber(row.avg_delay_days),
            p95_days_registration_to_decision: nullableNumber(row.p95_delay_days),
          },
          last_refresh: refresh.rows[0] || null,
          filters: normalizeFilterEcho(request.query),
        };
      } catch (err) {
        logError("Failed to fetch district analytics summary", { error: String(err) });
        return sendError(reply, 500, "DISTRICT_ANALYTICS_ERROR", "Failed to fetch district analytics summary");
      }
    },
  );

  app.get<{ Params: { wid: string }; Querystring: DistrictAnalyticsQuery }>(
    "/api/v1/workspaces/:wid/district/analytics/coverage",
    async (request, reply) => {
      try {
        const filters = buildFactFilters(request.params.wid, request.query);
        const result = await queryFn(
          `WITH coverage AS (
             SELECT
               state_code,
               district_code,
               court_level,
               language,
               source_name,
               COALESCE(sum(metadata_case_count), 0)::int AS total_cases,
               COALESCE(sum(criminal_target_count), 0)::int AS criminal_targets,
               COALESCE(sum(text_available_count), 0)::int AS text_available,
               COALESCE(sum(translated_count), 0)::int AS translated,
               COALESCE(sum(redacted_count), 0)::int AS redacted,
               COALESCE(sum(rag_active_count), 0)::int AS rag_active
             FROM district_case_fact_daily
             WHERE ${filters.whereClause}
             GROUP BY state_code, district_code, court_level, language, source_name
             ORDER BY total_cases DESC
             LIMIT 200
           ),
           state_labels AS (
             SELECT
               state_code,
               min(NULLIF(state_name, '')) AS state_name
             FROM district_case
             WHERE workspace_id = $1
               AND state_code IS NOT NULL
               AND NULLIF(state_name, '') IS NOT NULL
             GROUP BY state_code
           ),
           district_labels AS (
             SELECT
               state_code,
               district_code,
               min(NULLIF(district_name, '')) AS district_name
             FROM district_case
             WHERE workspace_id = $1
               AND state_code IS NOT NULL
               AND district_code IS NOT NULL
               AND NULLIF(district_name, '') IS NOT NULL
             GROUP BY state_code, district_code
           )
           SELECT
             coverage.*,
             state_labels.state_name,
             district_labels.district_name
           FROM coverage
           LEFT JOIN state_labels ON state_labels.state_code = coverage.state_code
           LEFT JOIN district_labels
             ON district_labels.state_code = coverage.state_code
            AND district_labels.district_code = coverage.district_code
           ORDER BY coverage.total_cases DESC`,
          filters.params,
        );
        return { coverage: result.rows };
      } catch (err) {
        logError("Failed to fetch district analytics coverage", { error: String(err) });
        return sendError(reply, 500, "DISTRICT_ANALYTICS_ERROR", "Failed to fetch district analytics coverage");
      }
    },
  );

  app.get<{ Params: { wid: string }; Querystring: DistrictAnalyticsQuery }>(
    "/api/v1/workspaces/:wid/district/analytics/volume",
    async (request, reply) => {
      try {
        const filters = buildFactFilters(request.params.wid, request.query);
        const bucket = bucketValue(request.query.bucket);
        const bucketExpr = bucketExpression(bucket);
        const result = await queryFn(
          `SELECT
             ${bucketExpr} AS bucket,
             state_code,
             district_code,
             COALESCE(sum(metadata_case_count), 0)::int AS total_cases,
             COALESCE(sum(criminal_target_count), 0)::int AS criminal_targets,
             COALESCE(sum(text_available_count), 0)::int AS text_available
           FROM district_case_fact_daily
           WHERE ${filters.whereClause}
           GROUP BY bucket, state_code, district_code
           ORDER BY bucket, total_cases DESC
           LIMIT 500`,
          filters.params,
        );
        return { bucket, volume: result.rows };
      } catch (err) {
        logError("Failed to fetch district case volume", { error: String(err) });
        return sendError(reply, 500, "DISTRICT_ANALYTICS_ERROR", "Failed to fetch district case volume");
      }
    },
  );

  app.get<{ Params: { wid: string }; Querystring: DistrictAnalyticsQuery }>(
    "/api/v1/workspaces/:wid/district/analytics/outcomes",
    async (request, reply) => {
      try {
        const filters = buildFactFilters(request.params.wid, request.query);
        const result = await queryFn(
          `SELECT
             COALESCE(NULLIF(disposition, ''), 'unknown') AS disposition,
             COALESCE(sum(metadata_case_count), 0)::int AS total_cases,
             COALESCE(sum(criminal_target_count), 0)::int AS criminal_targets,
             COALESCE(sum(text_available_count), 0)::int AS text_available,
             round(avg(avg_days_registration_to_decision))::int AS avg_delay_days
           FROM district_case_fact_daily
           WHERE ${filters.whereClause}
           GROUP BY COALESCE(NULLIF(disposition, ''), 'unknown')
           ORDER BY total_cases DESC
           LIMIT 100`,
          filters.params,
        );
        return { outcomes: result.rows };
      } catch (err) {
        logError("Failed to fetch district outcomes", { error: String(err) });
        return sendError(reply, 500, "DISTRICT_ANALYTICS_ERROR", "Failed to fetch district outcomes");
      }
    },
  );

  app.get<{ Params: { wid: string }; Querystring: DistrictAnalyticsQuery & { days?: string } }>(
    "/api/v1/workspaces/:wid/district/analytics/source-performance",
    async (request, reply) => {
      try {
        const days = Math.min(90, Math.max(1, parseInt(firstQueryValue(request.query.days) || "7", 10)));
        const factFilters = buildFactFilters(request.params.wid, request.query);
        const [sources, queue, attempts, quota] = await Promise.all([
          queryFn(
            `SELECT
               source_name,
               license_classification,
               commercial_safe,
               COALESCE(sum(metadata_case_count), 0)::int AS total_cases,
               COALESCE(sum(text_available_count), 0)::int AS text_available,
               COALESCE(sum(translated_count), 0)::int AS translated,
               COALESCE(sum(fetch_failed_count), 0)::int AS fetch_failed
             FROM district_case_fact_daily
             WHERE ${factFilters.whereClause}
             GROUP BY source_name, license_classification, commercial_safe
             ORDER BY total_cases DESC`,
            factFilters.params,
          ),
          queryFn(
            `SELECT source_name, status, count(*)::int AS count
             FROM district_acquisition_queue
             WHERE workspace_id = $1
             GROUP BY source_name, status
             ORDER BY source_name, status`,
            [request.params.wid],
          ),
          queryFn(
            `SELECT source_name, outcome, count(*)::int AS count
             FROM district_fetch_attempt
             WHERE workspace_id = $1
               AND attempted_at >= now() - $2::int * interval '1 day'
             GROUP BY source_name, outcome
             ORDER BY source_name, outcome`,
            [request.params.wid, days],
          ),
          queryFn(
            `SELECT source_name, period_start, period_end, quota_units, used_units, cost_currency, estimated_cost
             FROM district_source_quota
             WHERE workspace_id = $1
             ORDER BY period_start DESC, source_name
             LIMIT 50`,
            [request.params.wid],
          ),
        ]);

        return {
          period_days: days,
          sources: sources.rows,
          queue: queue.rows,
          attempts: attempts.rows,
          quota: quota.rows,
        };
      } catch (err) {
        logError("Failed to fetch district source performance", { error: String(err) });
        return sendError(reply, 500, "DISTRICT_ANALYTICS_ERROR", "Failed to fetch district source performance");
      }
    },
  );

  app.get<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/district/analytics/filter-options",
    async (request, reply) => {
      try {
        const workspaceId = request.params.wid;
        const cached = filterOptionsCache.get(workspaceId);
        if (cached && cached.expiresAt > Date.now()) {
          return cached.payload;
        }

        const [states, districts, optionRows, years] = await Promise.all([
          queryFn(
            `SELECT
               state_code::text AS value,
               state_code,
               COALESCE(NULLIF(state_name, ''), 'State ' || state_code::text) AS name,
               COALESCE(NULLIF(state_name, ''), 'State ' || state_code::text) || ' (' || state_code::text || ')' AS label,
               count(*)::int AS count
             FROM district_case
             WHERE workspace_id = $1 AND state_code IS NOT NULL
             GROUP BY state_code, COALESCE(NULLIF(state_name, ''), 'State ' || state_code::text)
             ORDER BY name`,
            [workspaceId],
          ),
          queryFn(
            `SELECT
               state_code::text || ':' || district_code::text AS value,
               state_code,
               COALESCE(NULLIF(state_name, ''), 'State ' || state_code::text) AS state_name,
               district_code,
               COALESCE(NULLIF(district_name, ''), 'District ' || district_code::text) AS district_name,
               COALESCE(NULLIF(district_name, ''), 'District ' || district_code::text)
                 || ', '
                 || COALESCE(NULLIF(state_name, ''), 'State ' || state_code::text)
                 || ' (' || state_code::text || ':' || district_code::text || ')' AS label,
               count(*)::int AS count
             FROM district_case
             WHERE workspace_id = $1 AND state_code IS NOT NULL AND district_code IS NOT NULL
             GROUP BY state_code, state_name, district_code, district_name
             ORDER BY state_name, district_name, district_code
             LIMIT 1000`,
            [workspaceId],
          ),
          queryFn(
            `WITH expanded AS (
               SELECT
                 option.kind,
                 option.value,
                 f.metadata_case_count
               FROM district_case_fact_daily f
               CROSS JOIN LATERAL (
                 VALUES
                   ('court_level', f.court_level),
                   ('statute', f.statute),
                   ('section', f.section),
                   ('offence_category', f.offence_category),
                   ('disposition', f.disposition),
                   ('language', f.language),
                   ('source_name', f.source_name)
               ) AS option(kind, value)
               WHERE f.workspace_id = $1
                 AND option.value IS NOT NULL
                 AND option.value <> ''
             ),
             grouped AS (
               SELECT kind, value, value AS label, COALESCE(sum(metadata_case_count), 0)::int AS count
               FROM expanded
               GROUP BY kind, value
             ),
             ranked AS (
               SELECT *, row_number() OVER (PARTITION BY kind ORDER BY count DESC, label) AS rn
               FROM grouped
             )
             SELECT kind, value, label, count
             FROM ranked
             WHERE rn <= 500
             ORDER BY kind, count DESC, label`,
            [workspaceId],
          ),
          queryFn(
            `SELECT DISTINCT EXTRACT(YEAR FROM decision_date)::int AS year
             FROM district_case
             WHERE workspace_id = $1
               AND is_criminal_target = true
               AND decision_date IS NOT NULL
             ORDER BY year DESC`,
            [workspaceId],
          ),
        ]);
        const groupedOptions = groupFilterOptions(optionRows.rows);

        const payload = {
          states: states.rows,
          districts: districts.rows,
          court_levels: groupedOptions.court_level,
          statutes: groupedOptions.statute,
          sections: groupedOptions.section,
          offence_categories: groupedOptions.offence_category,
          dispositions: groupedOptions.disposition,
          languages: groupedOptions.language,
          sources: groupedOptions.source_name,
          years: years.rows.map((row: { year: number }) => row.year),
        };
        filterOptionsCache.set(workspaceId, { expiresAt: Date.now() + FILTER_OPTIONS_TTL_MS, payload });
        return payload;
      } catch (err) {
        logError("Failed to fetch district filter options", { error: String(err), workspaceId: request.params.wid });
        return sendError(reply, 500, "DISTRICT_FILTER_OPTIONS_ERROR", "Failed to fetch district filter options");
      }
    },
  );

  app.get<{ Params: { wid: string }; Querystring: DistrictAnalyticsQuery }>(
    "/api/v1/workspaces/:wid/district/cases",
    async (request, reply) => {
      try {
        const filters = buildCaseFilters(request.params.wid, request.query);
        const where = [...filters.whereParts];
        appendCaseSearchFilter(where, filters.params, request.query.case_search);
        const whereClause = where.join(" AND ");
        const limit = Math.min(100, Math.max(1, parseInt(firstQueryValue(request.query.limit) || "25", 10)));
        const offset = Math.max(0, parseInt(firstQueryValue(request.query.offset) || "0", 10));

        const [rows, count] = await Promise.all([
          queryFn(
            `SELECT
               district_case_id,
               cnr,
               source_case_id,
               source_name,
               metadata_source,
               dataset_version,
               state_code,
               state_name,
               district_code,
               district_name,
               court_no,
               court_code,
               court_name,
               court_level,
               case_type,
               filing_date,
               registration_date,
               decision_date,
               disposition,
               purpose_name,
               judge_position,
               acts_cited,
               sections_cited,
               offence_categories,
               is_criminal_target,
               text_status,
               commercial_safe,
               license_classification,
               sensitive_data_flags,
               created_at,
               updated_at
             FROM district_case
             WHERE ${whereClause}
             ORDER BY decision_date DESC NULLS LAST, registration_date DESC NULLS LAST, created_at DESC
             LIMIT $${filters.params.length + 1} OFFSET $${filters.params.length + 2}`,
            [...filters.params, limit, offset],
          ),
          queryFn(
            `SELECT count(*)::int AS total
             FROM district_case
             WHERE ${whereClause}`,
            filters.params,
          ),
        ]);

        return {
          cases: rows.rows,
          total: numberValue(count.rows[0]?.total),
          limit,
          offset,
        };
      } catch (err) {
        logError("Failed to fetch district cases", { error: String(err), workspaceId: request.params.wid });
        return sendError(reply, 500, "DISTRICT_CASES_ERROR", "Failed to fetch district cases");
      }
    },
  );

  app.get<{ Params: { wid: string; caseId: string } }>(
    "/api/v1/workspaces/:wid/district/cases/:caseId",
    async (request, reply) => {
      try {
        const [caseResult, sources, events, artifacts, queue, attempts] = await Promise.all([
          queryFn(
            `SELECT *
             FROM district_case
             WHERE workspace_id = $1 AND district_case_id = $2`,
            [request.params.wid, request.params.caseId],
          ),
          queryFn(
            `SELECT *
             FROM district_case_source
             WHERE workspace_id = $1 AND district_case_id = $2
             ORDER BY created_at DESC`,
            [request.params.wid, request.params.caseId],
          ),
          queryFn(
            `SELECT *
             FROM district_case_event
             WHERE workspace_id = $1 AND district_case_id = $2
             ORDER BY event_date DESC NULLS LAST, created_at DESC`,
            [request.params.wid, request.params.caseId],
          ),
          queryFn(
            `SELECT *
             FROM district_text_artifact
             WHERE workspace_id = $1 AND district_case_id = $2
             ORDER BY created_at DESC`,
            [request.params.wid, request.params.caseId],
          ),
          queryFn(
            `SELECT *
             FROM district_acquisition_queue
             WHERE workspace_id = $1 AND district_case_id = $2
             ORDER BY created_at DESC`,
            [request.params.wid, request.params.caseId],
          ),
          queryFn(
            `SELECT *
             FROM district_fetch_attempt
             WHERE workspace_id = $1 AND district_case_id = $2
             ORDER BY attempted_at DESC
             LIMIT 50`,
            [request.params.wid, request.params.caseId],
          ),
        ]);

        if (caseResult.rows.length === 0) {
          reply.code(404);
          return { error: "NOT_FOUND", message: "District case not found" };
        }

        return {
          case: caseResult.rows[0],
          sources: sources.rows,
          events: events.rows,
          artifacts: artifacts.rows,
          acquisition_queue: queue.rows,
          fetch_attempts: attempts.rows,
        };
      } catch (err) {
        logError("Failed to fetch district case detail", { error: String(err), workspaceId: request.params.wid, caseId: request.params.caseId });
        return sendError(reply, 500, "DISTRICT_CASE_DETAIL_ERROR", "Failed to fetch district case detail");
      }
    },
  );

  app.post<{ Params: { wid: string; caseId: string }; Body: DistrictFetchJudgmentBody }>(
    "/api/v1/workspaces/:wid/district/cases/:caseId/fetch-judgment",
    async (request, reply) => {
      const { wid, caseId } = request.params;
      const force = request.body?.force === true;

      try {
        const caseResult = await queryFn(
          `SELECT district_case_id,
                  workspace_id,
                  cnr,
                  source_case_id,
                  state_code,
                  state_name,
                  district_code,
                  district_name,
                  court_name,
                  court_level,
                  case_type,
                  decision_date,
                  offence_categories,
                  is_criminal_target,
                  text_status
           FROM district_case
           WHERE workspace_id = $1 AND district_case_id = $2`,
          [wid, caseId],
        );

        if (caseResult.rows.length === 0) {
          reply.code(404);
          return { error: "NOT_FOUND", message: "District case not found" };
        }

        const districtCase = caseResult.rows[0] as DistrictCaseFetchRow;
        const before = await loadFetchJudgmentStatus(queryFn, wid, caseId);
        const availableArtifact = firstAvailableArtifact(before.artifacts);
        if (availableArtifact && !force) {
          return {
            ...before,
            case_id: caseId,
            text_status: districtCase.text_status,
            action: "available",
            already_available: true,
            queued: false,
            document_id: availableArtifact.document_id,
            artifact_id: availableArtifact.district_text_artifact_id,
          };
        }

        const openQueue = before.acquisition_queue.filter((row: { status?: string }) => OPEN_FETCH_STATUSES.has(String(row.status || "")));
        if (openQueue.length > 0 && !force) {
          return {
            ...before,
            case_id: caseId,
            text_status: districtCase.text_status,
            action: "pending",
            already_available: false,
            queued: false,
            document_id: null,
            artifact_id: null,
          };
        }

        const plannedSources = planFetchSources(districtCase, request.body?.sources);
        if (plannedSources.length === 0) {
          return {
            ...before,
            case_id: caseId,
            text_status: districtCase.text_status,
            action: "no_eligible_sources",
            already_available: false,
            queued: false,
            document_id: null,
            artifact_id: null,
          };
        }

        await queryFn(
          `UPDATE district_case
           SET text_status = 'targeted',
               updated_at = now()
           WHERE workspace_id = $1
             AND district_case_id = $2
             AND text_status = 'metadata_only'`,
          [wid, caseId],
        );

        for (const source of plannedSources) {
          await queryFn(
            `INSERT INTO district_acquisition_queue (
               workspace_id,
               district_case_id,
               source_name,
               status,
               priority,
               max_attempts,
               requested_metadata
             )
             VALUES ($1, $2, $3, 'pending', $4, 3, $5::jsonb)
             ON CONFLICT (workspace_id, district_case_id, source_name)
             DO UPDATE SET
               status = CASE
                 WHEN $6::boolean OR district_acquisition_queue.status IN ('failed','rate_limited')
                   THEN 'pending'
                 ELSE district_acquisition_queue.status
               END,
               priority = GREATEST(district_acquisition_queue.priority, EXCLUDED.priority),
               requested_metadata = district_acquisition_queue.requested_metadata || EXCLUDED.requested_metadata,
               error_message = CASE
                 WHEN $6::boolean OR district_acquisition_queue.status IN ('failed','rate_limited')
                   THEN NULL
                 ELSE district_acquisition_queue.error_message
               END,
               next_attempt_at = CASE
                 WHEN $6::boolean OR district_acquisition_queue.status IN ('failed','rate_limited')
                   THEN NULL
                 ELSE district_acquisition_queue.next_attempt_at
               END,
               updated_at = now()`,
            [
              wid,
              caseId,
              source.source_name,
              source.priority,
              JSON.stringify(source.requested_metadata),
              force,
            ],
          );
        }

        const after = await loadFetchJudgmentStatus(queryFn, wid, caseId);
        return {
          ...after,
          case_id: caseId,
          text_status: "targeted",
          action: "queued",
          already_available: false,
          queued: true,
          document_id: null,
          artifact_id: null,
          planned_sources: plannedSources.map((source) => source.source_name),
        };
      } catch (err) {
        logError("Failed to request district judgment fetch", { error: String(err), workspaceId: wid, caseId });
        return sendError(reply, 500, "DISTRICT_JUDGMENT_FETCH_ERROR", "Failed to request judgment fetch");
      }
    },
  );

  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/district/analytics/refresh",
    async (request, reply) => {
      try {
        const result = await queryFn(
          `SELECT refreshed_workspace_id, inserted_rows, refreshed_at
           FROM refresh_district_case_fact_daily($1::uuid)`,
          [request.params.wid],
        );
        filterOptionsCache.delete(request.params.wid);
        return { refreshed: result.rows };
      } catch (err) {
        logError("Failed to refresh district analytics", { error: String(err), workspaceId: request.params.wid });
        return sendError(reply, 500, "DISTRICT_ANALYTICS_ERROR", "Failed to refresh district analytics");
      }
    },
  );

  app.get<{ Params: { wid: string }; Querystring: DistrictAnalyticsQuery }>(
    "/api/v1/workspaces/:wid/district/analytics/export.csv",
    async (request, reply) => {
      try {
        const filters = buildFactFilters(request.params.wid, request.query);
        const result = await queryFn(
          `SELECT
             fact_date,
             state_code,
             district_code,
             court_level,
             statute,
             section,
             offence_category,
             disposition,
             language,
             source_name,
             commercial_safe,
             metadata_case_count,
             criminal_target_count,
             text_available_count,
             translated_count,
             redacted_count,
             rag_active_count,
             fetch_failed_count
           FROM district_case_fact_daily
           WHERE ${filters.whereClause}
           ORDER BY fact_date DESC, metadata_case_count DESC
           LIMIT 10000`,
          filters.params,
        );
        return sendCsv(reply, `district-analytics-${request.params.wid}.csv`, [
          "fact_date,state_code,district_code,court_level,statute,section,offence_category,disposition,language,source_name,commercial_safe,metadata_case_count,criminal_target_count,text_available_count,translated_count,redacted_count,rag_active_count,fetch_failed_count",
          ...result.rows.map((row) => csvLine([
            row.fact_date,
            row.state_code,
            row.district_code,
            row.court_level,
            row.statute,
            row.section,
            row.offence_category,
            row.disposition,
            row.language,
            row.source_name,
            row.commercial_safe,
            row.metadata_case_count,
            row.criminal_target_count,
            row.text_available_count,
            row.translated_count,
            row.redacted_count,
            row.rag_active_count,
            row.fetch_failed_count,
          ])),
        ].join("\n"));
      } catch (err) {
        logError("Failed to export district analytics", { error: String(err) });
        return sendError(reply, 500, "DISTRICT_ANALYTICS_ERROR", "Failed to export district analytics");
      }
    },
  );

  app.get<{ Params: { wid: string }; Querystring: DistrictAnalyticsQuery }>(
    "/api/v1/workspaces/:wid/district/analytics/cnrs.csv",
    async (request, reply) => {
      try {
        const filters = buildCaseFilters(request.params.wid, request.query);
        const limit = Math.min(10000, Math.max(1, parseInt(firstQueryValue(request.query.limit) || "5000", 10)));
        filters.params.push(limit);
        const result = await queryFn(
          `SELECT
             cnr,
             source_case_id,
             source_name,
             state_code,
             state_name,
             district_code,
             district_name,
             court_level,
             court_name,
             case_type,
             filing_date,
             registration_date,
             decision_date,
             disposition,
             array_to_string(offence_categories, '|') AS offence_categories,
             text_status,
             commercial_safe
           FROM district_case
           WHERE ${filters.whereClause}
           ORDER BY decision_date DESC NULLS LAST, registration_date DESC NULLS LAST, created_at DESC
           LIMIT $${filters.params.length}`,
          filters.params,
        );
        return sendCsv(reply, `district-cnrs-${request.params.wid}.csv`, [
          "cnr,source_case_id,source_name,state_code,state_name,district_code,district_name,court_level,court_name,case_type,filing_date,registration_date,decision_date,disposition,offence_categories,text_status,commercial_safe",
          ...result.rows.map((row) => csvLine([
            row.cnr,
            row.source_case_id,
            row.source_name,
            row.state_code,
            row.state_name,
            row.district_code,
            row.district_name,
            row.court_level,
            row.court_name,
            row.case_type,
            row.filing_date,
            row.registration_date,
            row.decision_date,
            row.disposition,
            row.offence_categories,
            row.text_status,
            row.commercial_safe,
          ])),
        ].join("\n"));
      } catch (err) {
        logError("Failed to export district CNRs", { error: String(err) });
        return sendError(reply, 500, "DISTRICT_ANALYTICS_ERROR", "Failed to export district CNRs");
      }
    },
  );
}

function buildFactFilters(workspaceId: string, query: DistrictAnalyticsQuery): SqlFilters {
  const params: unknown[] = [workspaceId];
  const where = ["workspace_id = $1"];
  appendCommonFilters(where, params, query, "");
  return { whereClause: where.join(" AND "), whereParts: where, params };
}

function buildCaseFilters(workspaceId: string, query: DistrictAnalyticsQuery): SqlFilters {
  const params: unknown[] = [workspaceId];
  const where = ["workspace_id = $1"];
  const caseDate = "COALESCE(decision_date, registration_date, filing_date, created_at::date)";
  const dateFrom = firstQueryValue(query.date_from);
  const dateTo = firstQueryValue(query.date_to);
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`${caseDate} >= $${params.length}::date`);
  }
  if (dateTo) {
    params.push(dateTo);
    where.push(`${caseDate} <= $${params.length}::date`);
  }
  appendDistrictKeyFilter(where, params, query.district_key);
  appendNumberFilter(where, params, "state_code", query.state_code);
  if (!query.district_key) {
    appendNumberFilter(where, params, "district_code", query.district_code);
  }
  appendTextFilter(where, params, "court_level", query.court_level);
  appendTextFilter(where, params, "disposition", query.disposition);
  appendArrayTextFilter(where, params, "acts_cited", query.statute);
  appendArrayTextFilter(where, params, "sections_cited", query.section);
  appendArrayTextFilter(where, params, "offence_categories", query.offence_category);
  appendTextFilter(where, params, "COALESCE(source_payload->>'language', 'unknown')", query.language);
  appendTextFilter(where, params, "source_name", query.source_name);
  if (firstQueryValue(query.commercial_safe) !== "false") {
    where.push("commercial_safe = true");
  }
  return { whereClause: where.join(" AND "), whereParts: where, params };
}

function appendCommonFilters(
  where: string[],
  params: unknown[],
  query: DistrictAnalyticsQuery,
  tableAlias: string,
) {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  const dateFrom = firstQueryValue(query.date_from);
  const dateTo = firstQueryValue(query.date_to);
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`${prefix}fact_date >= $${params.length}::date`);
  }
  if (dateTo) {
    params.push(dateTo);
    where.push(`${prefix}fact_date <= $${params.length}::date`);
  }
  appendDistrictKeyFilter(where, params, query.district_key, prefix);
  appendNumberFilter(where, params, `${prefix}state_code`, query.state_code);
  if (!query.district_key) {
    appendNumberFilter(where, params, `${prefix}district_code`, query.district_code);
  }
  appendTextFilter(where, params, `${prefix}court_level`, query.court_level);
  appendTextFilter(where, params, `${prefix}statute`, query.statute);
  appendTextFilter(where, params, `${prefix}section`, query.section);
  appendTextFilter(where, params, `${prefix}offence_category`, query.offence_category);
  appendTextFilter(where, params, `${prefix}disposition`, query.disposition);
  appendTextFilter(where, params, `${prefix}language`, query.language);
  appendTextFilter(where, params, `${prefix}source_name`, query.source_name);

  if (firstQueryValue(query.commercial_safe) !== "false") {
    where.push(`${prefix}commercial_safe = true`);
  }
}

function appendNumberFilter(where: string[], params: unknown[], column: string, value?: QueryValue) {
  const values = queryValues(value)
    .map((item) => parseInt(item, 10))
    .filter((item) => Number.isFinite(item));
  if (!values.length) return;
  params.push(values);
  where.push(`${column} = ANY($${params.length}::int[])`);
}

function appendTextFilter(where: string[], params: unknown[], column: string, value?: QueryValue) {
  const values = queryValues(value).map((item) => item.toLowerCase());
  if (!values.length) return;
  params.push(values);
  where.push(`LOWER(COALESCE(${column}, '')) = ANY($${params.length}::text[])`);
}

function appendArrayTextFilter(where: string[], params: unknown[], column: string, value?: QueryValue) {
  const values = queryValues(value).map((item) => item.toLowerCase());
  if (!values.length) return;
  params.push(values);
  where.push(`EXISTS (SELECT 1 FROM unnest(${column}) item WHERE LOWER(item) = ANY($${params.length}::text[]))`);
}

function appendDistrictKeyFilter(where: string[], params: unknown[], value?: QueryValue, prefix = "") {
  const pairs = queryValues(value)
    .map((item) => item.split(":").map((part) => parseInt(part, 10)))
    .filter(([stateCode, districtCode]) => Number.isFinite(stateCode) && Number.isFinite(districtCode));
  if (!pairs.length) return;
  const clauses: string[] = [];
  for (const [stateCode, districtCode] of pairs) {
    params.push(stateCode, districtCode);
    clauses.push(`(${prefix}state_code = $${params.length - 1} AND ${prefix}district_code = $${params.length})`);
  }
  where.push(`(${clauses.join(" OR ")})`);
}

function appendCaseSearchFilter(where: string[], params: unknown[], value?: QueryValue) {
  const search = firstQueryValue(value)?.trim();
  if (!search) return;
  params.push(`%${search.toLowerCase()}%`);
  const patternIndex = params.length;
  const exactConditions: string[] = [];
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search)) {
    params.push(search);
    exactConditions.push(`district_case_id = $${params.length}::uuid`);
  }
  where.push(`(
    ${exactConditions.length ? `${exactConditions.join(" OR ")} OR` : ""}
    LOWER(COALESCE(cnr, '')) LIKE $${patternIndex}
    OR LOWER(COALESCE(source_case_id, '')) LIKE $${patternIndex}
    OR LOWER(COALESCE(court_name, '')) LIKE $${patternIndex}
    OR LOWER(COALESCE(state_name, '')) LIKE $${patternIndex}
    OR LOWER(COALESCE(district_name, '')) LIKE $${patternIndex}
  )`);
}

function bucketValue(value?: QueryValue): "day" | "month" | "year" {
  const bucket = firstQueryValue(value);
  if (bucket === "day" || bucket === "year") return bucket;
  return "month";
}

function bucketExpression(bucket?: string): string {
  if (bucket === "day") return "fact_date";
  if (bucket === "year") return "date_trunc('year', fact_date)::date";
  return "date_trunc('month', fact_date)::date";
}

function queryValues(value?: QueryValue): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstQueryValue(value?: QueryValue): string | undefined {
  return queryValues(value)[0];
}

function groupFilterOptions(rows: Array<{ kind: string; value: string; label: string; count: number }>) {
  const grouped: Record<string, Array<{ value: string; label: string; count: number }>> = {
    court_level: [],
    statute: [],
    section: [],
    offence_category: [],
    disposition: [],
    language: [],
    source_name: [],
  };
  for (const row of rows) {
    if (!grouped[row.kind]) continue;
    grouped[row.kind].push({ value: row.value, label: row.label, count: numberValue(row.count) });
  }
  return grouped;
}

function normalizeFilterEcho(query: DistrictAnalyticsQuery): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, queryValues(value as QueryValue).join(",")])
  );
}

async function loadFetchJudgmentStatus(queryFn: QueryFn, workspaceId: string, caseId: string) {
  const [artifacts, queue, attempts] = await Promise.all([
    queryFn(
      `SELECT district_text_artifact_id,
              artifact_type,
              source_name,
              source_url,
              storage_uri,
              mime_type,
              language,
              redaction_status,
              translation_status,
              license_classification,
              commercial_safe,
              document_id,
              created_at,
              updated_at
       FROM district_text_artifact
       WHERE workspace_id = $1 AND district_case_id = $2
       ORDER BY (document_id IS NOT NULL) DESC, created_at DESC`,
      [workspaceId, caseId],
    ),
    queryFn(
      `SELECT district_acquisition_queue_id,
              source_name,
              status,
              priority,
              attempt_count,
              max_attempts,
              last_attempt_at,
              next_attempt_at,
              error_message,
              requested_metadata,
              result_metadata,
              created_at,
              updated_at
       FROM district_acquisition_queue
       WHERE workspace_id = $1 AND district_case_id = $2
       ORDER BY priority DESC, created_at DESC`,
      [workspaceId, caseId],
    ),
    queryFn(
      `SELECT district_fetch_attempt_id,
              source_name,
              outcome,
              http_status,
              bytes,
              captcha_outcome,
              cost_units,
              notes,
              metadata,
              attempted_at
       FROM district_fetch_attempt
       WHERE workspace_id = $1 AND district_case_id = $2
       ORDER BY attempted_at DESC
       LIMIT 20`,
      [workspaceId, caseId],
    ),
  ]);

  return {
    artifacts: artifacts.rows,
    acquisition_queue: queue.rows,
    fetch_attempts: attempts.rows,
  };
}

function firstAvailableArtifact(artifacts: Array<{ document_id?: string | null; artifact_type?: string; district_text_artifact_id?: string }>) {
  return artifacts.find((artifact) => artifact.document_id && artifact.artifact_type !== "metadata_only") || null;
}

function planFetchSources(districtCase: DistrictCaseFetchRow, requestedSources?: string[]) {
  if (!districtCase.is_criminal_target || ["text_ready", "blocked", "dead"].includes(districtCase.text_status)) {
    return [];
  }

  const requested = new Set(
    (requestedSources?.length ? requestedSources : [...FETCH_SOURCE_ORDER])
      .map((source) => source.trim().toLowerCase())
      .filter((source): source is FetchSourceName => (FETCH_SOURCE_ORDER as readonly string[]).includes(source))
  );
  const stateName = (districtCase.state_name || "").toLowerCase();
  const isUttarPradesh = districtCase.state_code === 9 || districtCase.state_code === 13 || stateName.includes("uttar pradesh");

  return FETCH_SOURCE_ORDER
    .filter((sourceName) => requested.has(sourceName))
    .filter((sourceName) => {
      if (sourceName === "ecourts") return Boolean(districtCase.cnr);
      if (sourceName === "hldc") return isUttarPradesh;
      return true;
    })
    .map((sourceName, index) => ({
      source_name: sourceName,
      priority: 100 - index * 10,
      requested_metadata: {
        cnr: districtCase.cnr,
        source_case_id: districtCase.source_case_id,
        state_code: districtCase.state_code,
        state_name: districtCase.state_name,
        district_code: districtCase.district_code,
        district_name: districtCase.district_name,
        court_name: districtCase.court_name,
        court_level: districtCase.court_level,
        case_type: districtCase.case_type,
        decision_date: districtCase.decision_date,
        offence_categories: districtCase.offence_categories || [],
        request_reason: sourceName === "indian_kanoon"
          ? "clean_text_first"
          : sourceName === "ecourts"
            ? "official_cnr_fallback"
            : "up_hindi_non_commercial_parallel",
      },
    }));
}

function numberValue(value: unknown): number {
  return Number(value || 0);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sendCsv(reply: FastifyReply, filename: string, csv: string) {
  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .send(csv);
}

function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
