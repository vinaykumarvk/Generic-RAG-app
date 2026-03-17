/**
 * Knowledge Graph routes — /api/v1/workspaces/:wid/graph
 */

import { FastifyInstance } from "fastify";
import { send404 } from "@puda/api-core";
import type { QueryFn, LlmProvider } from "@puda/api-core";

export interface GraphRouteDeps {
  queryFn: QueryFn;
  llmProvider: LlmProvider;
}

export function createGraphRoutes(app: FastifyInstance, deps: GraphRouteDeps) {
  const { queryFn } = deps;

  // List/search nodes
  app.get<{ Params: { wid: string }; Querystring: { type?: string; search?: string; page?: string; limit?: string } }>(
    "/api/v1/workspaces/:wid/graph/nodes",
    async (request) => {
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
        whereClause += ` AND similarity(normalized_name, $${params.length}) > 0.2`;
      }

      params.push(limit, offset);
      const result = await queryFn(
        `SELECT node_id, name, node_type, description, source_count, created_at
         FROM graph_node WHERE ${whereClause}
         ORDER BY source_count DESC, name
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      return { nodes: result.rows, page, limit };
    }
  );

  // Get node with edges
  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/graph/nodes/:id",
    async (request, reply) => {
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
    }
  );

  // BFS explore from node
  app.get<{ Params: { wid: string }; Querystring: { node_id: string; hops?: string; limit?: string } }>(
    "/api/v1/workspaces/:wid/graph/explore",
    async (request) => {
      const { wid } = request.params;
      const { node_id } = request.query;
      const hops = Math.min(3, Math.max(1, parseInt(request.query.hops || "1", 10)));
      const limit = Math.min(200, Math.max(10, parseInt(request.query.limit || "100", 10)));

      const visitedNodes = new Set<string>();
      const allNodes: Array<{ node_id: string; name: string; node_type: string; description: string }> = [];
      const allEdges: Array<{ source: string; target: string; edge_type: string; weight: number }> = [];
      let frontier = [node_id];

      for (let hop = 0; hop <= hops && frontier.length > 0; hop++) {
        // Get nodes in frontier
        const nodesResult = await queryFn(
          `SELECT node_id, name, node_type, description FROM graph_node
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
    }
  );

  // Graph stats
  app.get<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/graph/stats",
    async (request) => {
      const { wid } = request.params;

      const [nodeCountResult, edgeCountResult, typeDistResult] = await Promise.all([
        queryFn("SELECT count(*) FROM graph_node WHERE workspace_id = $1", [wid]),
        queryFn("SELECT count(*) FROM graph_edge WHERE workspace_id = $1", [wid]),
        queryFn(
          "SELECT node_type, count(*) as count FROM graph_node WHERE workspace_id = $1 GROUP BY node_type ORDER BY count DESC",
          [wid]
        ),
      ]);

      return {
        total_nodes: parseInt(nodeCountResult.rows[0].count, 10),
        total_edges: parseInt(edgeCountResult.rows[0].count, 10),
        node_types: typeDistResult.rows,
      };
    }
  );
}
