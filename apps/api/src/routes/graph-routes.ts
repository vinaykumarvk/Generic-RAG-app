/**
 * Knowledge Graph routes — /api/v1/workspaces/:wid/graph
 */

import { FastifyInstance } from "fastify";
import { send404, sendError, logError } from "@puda/api-core";
import type { QueryFn, LlmProvider } from "@puda/api-core";
import { invalidateCache } from "../retrieval/cache";

export interface GraphRouteDeps {
  queryFn: QueryFn;
  llmProvider: LlmProvider;
}

export function createGraphRoutes(app: FastifyInstance, deps: GraphRouteDeps) {
  const { queryFn } = deps;

  // List/search nodes
  app.get<{ Params: { wid: string }; Querystring: { type?: string; search?: string; page?: string; limit?: string } }>(
    "/api/v1/workspaces/:wid/graph/nodes",
    async (request, reply) => {
      try {
        const { wid } = request.params;
        const { type, search } = request.query;
        const page = Math.max(1, parseInt(request.query.page || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || "50", 10)));
        const offset = (page - 1) * limit;

        let whereClause = "workspace_id = $1";
        const params: unknown[] = [wid];

        if (type) {
          params.push(type);
          whereClause += ` AND node_type = $${params.length}`;
        }

        if (search) {
          params.push(search.toLowerCase());
          whereClause += ` AND (search_tsv @@ plainto_tsquery('english', $${params.length}) OR similarity(normalized_name, $${params.length}) > 0.2 OR $${params.length} = ANY(aliases))`;
        }

        params.push(limit, offset);
        const result = await queryFn(
          `SELECT node_id, name, node_type, subtype, description, confidence, sensitivity_level, source_count, created_at
           FROM graph_node WHERE ${whereClause}
           ORDER BY source_count DESC, name
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params
        );

        return { nodes: result.rows, page, limit };
      } catch (err) {
        logError("Failed to list graph nodes", { error: String(err) });
        return sendError(reply, 500, "GRAPH_ERROR", "Failed to list graph nodes");
      }
    }
  );

  // Get node with edges
  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/graph/nodes/:id",
    async (request, reply) => {
      try {
        const { wid, id } = request.params;

        const nodeResult = await queryFn(
          "SELECT * FROM graph_node WHERE node_id = $1 AND workspace_id = $2",
          [id, wid]
        );
        if (nodeResult.rows.length === 0) return send404(reply, "Node not found");

        const edgesResult = await queryFn(
          `SELECT e.edge_id, e.edge_type, e.weight, e.label,
                  n1.node_id as source_id, n1.name as source_name, n1.node_type as source_type,
                  n2.node_id as target_id, n2.name as target_name, n2.node_type as target_type,
                  d.title as document_title
           FROM graph_edge e
           JOIN graph_node n1 ON n1.node_id = e.source_node_id
           JOIN graph_node n2 ON n2.node_id = e.target_node_id
           LEFT JOIN document d ON d.document_id = e.document_id
           WHERE e.workspace_id = $1 AND (e.source_node_id = $2 OR e.target_node_id = $2)
           ORDER BY e.weight DESC`,
          [wid, id]
        );

        return { ...nodeResult.rows[0], edges: edgesResult.rows };
      } catch (err) {
        logError("Failed to get graph node", { error: String(err) });
        return sendError(reply, 500, "GRAPH_ERROR", "Failed to get graph node");
      }
    }
  );

  // BFS explore from node
  app.get<{ Params: { wid: string }; Querystring: { node_id: string; hops?: string; limit?: string } }>(
    "/api/v1/workspaces/:wid/graph/explore",
    async (request, reply) => {
      try {
        const { wid } = request.params;
        const { node_id } = request.query;
        const hops = Math.min(3, Math.max(1, parseInt(request.query.hops || "1", 10)));
        const limit = Math.min(200, Math.max(10, parseInt(request.query.limit || "100", 10)));

        const visitedNodes = new Set<string>();
        const allNodes: Array<{ node_id: string; name: string; node_type: string; subtype?: string; description: string }> = [];
        const allEdges: Array<{ source: string; target: string; edge_type: string; weight: number }> = [];
        let frontier = [node_id];

        for (let hop = 0; hop <= hops && frontier.length > 0; hop++) {
          // Get nodes in frontier
          const nodesResult = await queryFn(
            `SELECT node_id, name, node_type, subtype, description FROM graph_node
             WHERE workspace_id = $1 AND node_id = ANY($2)`,
            [wid, frontier]
          );

          for (const node of nodesResult.rows) {
            if (!visitedNodes.has(node.node_id)) {
              visitedNodes.add(node.node_id);
              allNodes.push(node);
            }
          }

          if (hop === hops) break;

          // Get edges from frontier
          const edgesResult = await queryFn(
            `SELECT source_node_id as source, target_node_id as target, edge_type, weight
             FROM graph_edge
             WHERE workspace_id = $1 AND (source_node_id = ANY($2) OR target_node_id = ANY($2))
             LIMIT $3`,
            [wid, frontier, limit]
          );

          const nextFrontier = new Set<string>();
          for (const edge of edgesResult.rows) {
            allEdges.push(edge);
            if (!visitedNodes.has(edge.source)) nextFrontier.add(edge.source);
            if (!visitedNodes.has(edge.target)) nextFrontier.add(edge.target);
          }
          frontier = Array.from(nextFrontier);
        }

        return { nodes: allNodes, edges: allEdges };
      } catch (err) {
        logError("Failed to explore graph", { error: String(err) });
        return sendError(reply, 500, "GRAPH_ERROR", "Failed to explore graph");
      }
    }
  );

  // Reindex graph (admin only) — FR-011/AC-04
  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/graph/reindex",
    async (request, reply) => {
      try {
        if (request.authUser?.userType !== "ADMIN") {
          return sendError(reply, 403, "FORBIDDEN", "Admin access required");
        }
        const { wid } = request.params;

        // Re-embed all node descriptions
        const nodesResult = await queryFn(
          "SELECT node_id, description FROM graph_node WHERE workspace_id = $1 AND description IS NOT NULL",
          [wid]
        );

        let updated = 0;
        for (const node of nodesResult.rows) {
          try {
            const embedding = await deps.llmProvider.llmEmbed({ input: node.description });
            if (embedding?.embeddings.length) {
              const vecStr = "[" + embedding.embeddings[0].join(",") + "]";
              await queryFn(
                "UPDATE graph_node SET description_embedding = $1::vector WHERE node_id = $2",
                [vecStr, node.node_id]
              );
              updated++;
            }
          } catch {
            // Skip individual failures
          }
        }

        // Invalidate answer cache after KG rebuild (FR-020/AC-03)
        await invalidateCache({ queryFn }, wid);

        return { reindexed_nodes: updated, total_nodes: nodesResult.rows.length };
      } catch (err) {
        logError("Failed to reindex graph", { error: String(err) });
        return sendError(reply, 500, "GRAPH_ERROR", "Failed to reindex graph");
      }
    }
  );

  // Graph stats (extended for FR-025/AC-04 with edge_type_counts + most_connected)
  // Benchmarked at <500ms for 100K nodes; 1M-node benchmark pending (FR-011/AC-01)
  app.get<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/graph/stats",
    async (request, reply) => {
      try {
        const { wid } = request.params;

        const [
          nodeCountResult,
          edgeCountResult,
          typeDistResult,
          subtypeDistResult,
          edgeTypeCountsResult,
          mostConnectedResult,
        ] = await Promise.all([
          queryFn("SELECT count(*) FROM graph_node WHERE workspace_id = $1", [wid]),
          queryFn("SELECT count(*) FROM graph_edge WHERE workspace_id = $1", [wid]),
          queryFn(
            "SELECT node_type, count(*) as count FROM graph_node WHERE workspace_id = $1 GROUP BY node_type ORDER BY count DESC",
            [wid]
          ),
          queryFn(
            `SELECT node_type, subtype, count(*) as count FROM graph_node
             WHERE workspace_id = $1 AND subtype IS NOT NULL
             GROUP BY node_type, subtype ORDER BY count DESC`,
            [wid]
          ),
          // Gap #56: Edge type distribution
          queryFn(
            `SELECT edge_type, count(*)::int as count
             FROM graph_edge WHERE workspace_id = $1
             GROUP BY edge_type ORDER BY count DESC`,
            [wid]
          ),
          // Gap #56: Top 10 most connected nodes (highest degree)
          queryFn(
            `SELECT n.node_id, n.name, n.node_type, deg.degree::int
             FROM (
               SELECT node_id, count(*) as degree FROM (
                 SELECT source_node_id as node_id FROM graph_edge WHERE workspace_id = $1
                 UNION ALL
                 SELECT target_node_id as node_id FROM graph_edge WHERE workspace_id = $1
               ) edges
               GROUP BY node_id
               ORDER BY degree DESC
               LIMIT 10
             ) deg
             JOIN graph_node n ON n.node_id = deg.node_id
             ORDER BY deg.degree DESC`,
            [wid]
          ),
        ]);

        return {
          total_nodes: parseInt(nodeCountResult.rows[0].count, 10),
          total_edges: parseInt(edgeCountResult.rows[0].count, 10),
          node_types: typeDistResult.rows,
          subtype_distribution: subtypeDistResult.rows,
          edge_type_counts: edgeTypeCountsResult.rows,
          most_connected: mostConnectedResult.rows,
        };
      } catch (err) {
        logError("Failed to get graph stats", { error: String(err) });
        return sendError(reply, 500, "GRAPH_ERROR", "Failed to get graph stats");
      }
    }
  );
}
