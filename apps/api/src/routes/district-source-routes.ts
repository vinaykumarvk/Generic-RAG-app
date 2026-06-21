/**
 * District court source and acquisition status routes.
 */

import { FastifyInstance } from "fastify";
import type { QueryFn, GetClientFn, LlmProvider } from "@puda/api-core";

export interface DistrictSourceRouteDeps {
  queryFn: QueryFn;
  getClient: GetClientFn;
  llmProvider: LlmProvider;
}

export function createDistrictSourceRoutes(app: FastifyInstance, deps: DistrictSourceRouteDeps) {
  const { queryFn } = deps;

  app.get<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/district/sources/status",
    async (request) => {
      const { wid } = request.params;

      const [cases, queue, attempts, artifacts] = await Promise.all([
        queryFn(
          `SELECT source_name,
                  license_classification,
                  count(*)::int AS total_cases,
                  count(*) FILTER (WHERE is_criminal_target)::int AS criminal_targets,
                  count(*) FILTER (WHERE text_status = 'text_ready')::int AS text_ready,
                  count(*) FILTER (WHERE text_status = 'blocked')::int AS blocked
           FROM district_case
           WHERE workspace_id = $1
           GROUP BY source_name, license_classification
           ORDER BY source_name`,
          [wid]
        ),
        queryFn(
          `SELECT source_name, status, count(*)::int AS count
           FROM district_acquisition_queue
           WHERE workspace_id = $1
           GROUP BY source_name, status
           ORDER BY source_name, status`,
          [wid]
        ),
        queryFn(
          `SELECT source_name, outcome, count(*)::int AS count
           FROM district_fetch_attempt
           WHERE workspace_id = $1
             AND attempted_at > now() - interval '24 hours'
           GROUP BY source_name, outcome
           ORDER BY source_name, outcome`,
          [wid]
        ),
        queryFn(
          `SELECT source_name,
                  artifact_type,
                  count(*)::int AS count,
                  count(*) FILTER (WHERE commercial_safe)::int AS commercial_safe_count
           FROM district_text_artifact
           WHERE workspace_id = $1
           GROUP BY source_name, artifact_type
           ORDER BY source_name, artifact_type`,
          [wid]
        ),
      ]);

      return {
        cases: cases.rows,
        queue: queue.rows,
        attempts_24h: attempts.rows,
        artifacts: artifacts.rows,
      };
    }
  );

  app.get<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/district/targets/summary",
    async (request) => {
      const { wid } = request.params;
      const result = await queryFn(
        `SELECT dc.state_code,
                dc.district_code,
                dc.court_level,
                offence.offence_category,
                count(*)::int AS cases,
                count(*) FILTER (WHERE dc.cnr IS NULL)::int AS missing_cnr,
                count(*) FILTER (WHERE dc.text_status = 'text_ready')::int AS text_ready
         FROM district_case dc
         CROSS JOIN LATERAL unnest(
           CASE
             WHEN array_length(dc.offence_categories, 1) IS NULL THEN ARRAY['unknown']
             ELSE dc.offence_categories
           END
         ) AS offence(offence_category)
         WHERE dc.workspace_id = $1
           AND dc.is_criminal_target = true
         GROUP BY dc.state_code, dc.district_code, dc.court_level, offence.offence_category
         ORDER BY cases DESC
         LIMIT 200`,
        [wid]
      );
      return { targets: result.rows };
    }
  );
}
