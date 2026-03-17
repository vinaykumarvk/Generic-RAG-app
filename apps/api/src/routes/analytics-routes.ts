/**
 * Analytics routes — /api/v1/workspaces/:wid/analytics
 */

import { FastifyInstance } from "fastify";
import type { QueryFn } from "@puda/api-core";

export function createAnalyticsRoutes(app: FastifyInstance, deps: { queryFn: QueryFn }) {
  const { queryFn } = deps;

  // Dashboard analytics
  app.get<{ Params: { wid: string }; Querystring: { days?: string } }>(
    "/api/v1/workspaces/:wid/analytics",
    async (request) => {
      const { wid } = request.params;
      const days = Math.min(90, Math.max(1, parseInt(request.query.days || "30", 10)));

      const [queries, latency, cacheHits, avgRating, topQuestions, llmUsage, docStats] = await Promise.all([
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
      };
    }
  );
}
