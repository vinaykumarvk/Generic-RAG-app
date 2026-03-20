/**
 * Analytics routes — /api/v1/workspaces/:wid/analytics
 */

import { FastifyInstance, FastifyReply } from "fastify";
import { sendError, logError } from "@puda/api-core";
import type { QueryFn } from "@puda/api-core";

export function createAnalyticsRoutes(app: FastifyInstance, deps: { queryFn: QueryFn }) {
  const { queryFn } = deps;

  // Dashboard analytics
  app.get<{ Params: { wid: string }; Querystring: { days?: string } }>(
    "/api/v1/workspaces/:wid/analytics",
    async (request) => {
      const { wid } = request.params;
      const days = Math.min(90, Math.max(1, parseInt(request.query.days || "30", 10)));

      const [queries, latency, cacheHits, avgRating, topQuestions, llmUsage, docStats, fileTypeStats, ocrStats] = await Promise.all([
        // Queries per day
        queryFn(
          `SELECT date_trunc('day', created_at)::date as day, count(*) as count
           FROM retrieval_run WHERE workspace_id = $1 AND created_at > now() - $2::int * interval '1 day'
           GROUP BY day ORDER BY day`,
          [wid, days]
        ),
        // Average latency
        queryFn(
          `SELECT avg(total_latency_ms) as avg_latency, percentile_cont(0.95) WITHIN GROUP (ORDER BY total_latency_ms) as p95_latency
           FROM retrieval_run WHERE workspace_id = $1 AND created_at > now() - $2::int * interval '1 day'`,
          [wid, days]
        ),
        // Cache hit rate
        queryFn(
          `SELECT count(*) FILTER (WHERE cache_hit) as hits, count(*) as total
           FROM retrieval_run WHERE workspace_id = $1 AND created_at > now() - $2::int * interval '1 day'`,
          [wid, days]
        ),
        // Average rating
        queryFn(
          `SELECT avg(rating) as avg_rating, count(*) as total_feedback,
                  count(*) FILTER (WHERE feedback_type = 'THUMBS_UP') as thumbs_up,
                  count(*) FILTER (WHERE feedback_type = 'THUMBS_DOWN') as thumbs_down
           FROM feedback WHERE workspace_id = $1 AND created_at > now() - $2::int * interval '1 day'`,
          [wid, days]
        ),
        // Top questions
        queryFn(
          `SELECT original_query, count(*) as count
           FROM retrieval_run WHERE workspace_id = $1 AND created_at > now() - $2::int * interval '1 day'
           GROUP BY original_query ORDER BY count DESC LIMIT 10`,
          [wid, days]
        ),
        // LLM usage
        queryFn(
          `SELECT provider, model_name, count(*) as calls,
                  sum(prompt_tokens) as total_prompt_tokens, sum(output_tokens) as total_output_tokens,
                  avg(latency_ms) as avg_latency
           FROM model_prediction_log WHERE created_at > now() - $1::int * interval '1 day'
           GROUP BY provider, model_name ORDER BY calls DESC`,
          [days]
        ),
        // Document processing stats
        queryFn(
          `SELECT status, count(*) as count
           FROM document WHERE workspace_id = $1 AND status != 'DELETED'
           GROUP BY status`,
          [wid]
        ),
        // File type distribution
        queryFn(
          `SELECT mime_type, count(*) as count
           FROM document WHERE workspace_id = $1 AND status != 'DELETED'
           GROUP BY mime_type ORDER BY count DESC`,
          [wid]
        ),
        // FR-020: OCR rate metric
        queryFn(
          `SELECT
             count(*) FILTER (WHERE review_required = true) as ocr_flagged,
             count(*) as total,
             avg(metadata_confidence) as avg_metadata_confidence
           FROM document WHERE workspace_id = $1 AND status != 'DELETED'`,
          [wid]
        ),
      ]);

      const totalQueries = parseInt(cacheHits.rows[0]?.total || "0", 10);
      const hitCount = parseInt(cacheHits.rows[0]?.hits || "0", 10);

      return {
        period_days: days,
        queries_per_day: queries.rows,
        latency: {
          avg_ms: Math.round(latency.rows[0]?.avg_latency || 0),
          p95_ms: Math.round(latency.rows[0]?.p95_latency || 0),
        },
        cache: {
          hit_rate: totalQueries > 0 ? hitCount / totalQueries : 0,
          hits: hitCount,
          total: totalQueries,
        },
        feedback: {
          avg_rating: parseFloat(avgRating.rows[0]?.avg_rating || "0"),
          total: parseInt(avgRating.rows[0]?.total_feedback || "0", 10),
          thumbs_up: parseInt(avgRating.rows[0]?.thumbs_up || "0", 10),
          thumbs_down: parseInt(avgRating.rows[0]?.thumbs_down || "0", 10),
        },
        top_questions: topQuestions.rows,
        llm_usage: llmUsage.rows,
        document_stats: docStats.rows,
        file_type_stats: fileTypeStats.rows,
        ocr: {
          flagged_for_review: parseInt(ocrStats.rows[0]?.ocr_flagged || "0", 10),
          total_documents: parseInt(ocrStats.rows[0]?.total || "0", 10),
          avg_metadata_confidence: parseFloat(ocrStats.rows[0]?.avg_metadata_confidence || "0"),
        },
      };
    }
  );

  // Gap #53 (FR-025/AC-01): Query volume per day
  app.get<{ Params: { wid: string }; Querystring: { days?: string } }>(
    "/api/v1/workspaces/:wid/analytics/query-volume",
    async (request, reply: FastifyReply) => {
      try {
        const { wid } = request.params;
        const days = Math.min(90, Math.max(1, parseInt(request.query.days || "30", 10)));

        const result = await queryFn(
          `SELECT date_trunc('day', created_at)::date as day, count(*)::int as count
           FROM retrieval_run
           WHERE workspace_id = $1 AND created_at >= now() - $2::int * interval '1 day'
           GROUP BY day ORDER BY day`,
          [wid, days]
        );

        return { period_days: days, data: result.rows };
      } catch (err) {
        logError("Failed to fetch query volume", { error: String(err) });
        return sendError(reply, 500, "ANALYTICS_ERROR", "Failed to fetch query volume");
      }
    }
  );

  // Gap #54 (FR-025/AC-02): Cache analytics detail
  app.get<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/analytics/cache-stats",
    async (request, reply: FastifyReply) => {
      try {
        const { wid } = request.params;

        const [sizeResult, topHitsResult] = await Promise.all([
          queryFn(
            `SELECT count(*)::int as total_entries FROM answer_cache WHERE workspace_id = $1`,
            [wid]
          ),
          queryFn(
            `SELECT query_text, hit_count::int as hit_count
             FROM answer_cache WHERE workspace_id = $1
             ORDER BY hit_count DESC LIMIT 10`,
            [wid]
          ),
        ]);

        return {
          total_entries: sizeResult.rows[0]?.total_entries ?? 0,
          most_hit_queries: topHitsResult.rows,
        };
      } catch (err) {
        logError("Failed to fetch cache stats", { error: String(err) });
        return sendError(reply, 500, "ANALYTICS_ERROR", "Failed to fetch cache stats");
      }
    }
  );

  // Gap #55 (FR-025/AC-03): User analytics
  app.get<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/analytics/users",
    async (request, reply: FastifyReply) => {
      try {
        const { wid } = request.params;

        const [activeUsersResult, queriesPerUserResult] = await Promise.all([
          queryFn(
            `SELECT count(DISTINCT user_id)::int as active_users
             FROM retrieval_run
             WHERE workspace_id = $1 AND created_at >= now() - interval '30 days'`,
            [wid]
          ),
          queryFn(
            `SELECT u.display_name, u.email, count(*)::int as query_count
             FROM retrieval_run rr
             JOIN app_user u ON u.user_id = rr.user_id
             WHERE rr.workspace_id = $1 AND rr.created_at >= now() - interval '30 days'
             GROUP BY u.user_id, u.display_name, u.email
             ORDER BY query_count DESC
             LIMIT 10`,
            [wid]
          ),
        ]);

        return {
          active_users_30d: activeUsersResult.rows[0]?.active_users ?? 0,
          top_users: queriesPerUserResult.rows,
        };
      } catch (err) {
        logError("Failed to fetch user analytics", { error: String(err) });
        return sendError(reply, 500, "ANALYTICS_ERROR", "Failed to fetch user analytics");
      }
    }
  );
}
