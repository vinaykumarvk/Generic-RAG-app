/**
 * Graph-assisted retrieval — semantic KG node discovery + BFS expansion.
 * Returns empty results until Phase 3 populates the KG tables.
 */

import type { QueryFn, LlmProvider } from "@puda/api-core";

export interface GraphContextResult {
  nodes: Array<{ node_id: string; name: string; node_type: string; description: string }>;
  edges: Array<{ source: string; target: string; edge_type: string }>;
  contextText: string;
}

export async function graphContextLookup(
  deps: { queryFn: QueryFn; llmProvider: LlmProvider },
  workspaceId: string,
  query: string,
  entities: Array<{ name: string; type: string }>,
  hops: number,
): Promise<{ result: GraphContextResult; latencyMs: number }> {
  const start = Date.now();

  // Check if graph tables have data
  let hasGraph = false;
  try {
    const countResult = await deps.queryFn(
      "SELECT count(*) FROM graph_node WHERE workspace_id = $1 LIMIT 1",
      [workspaceId]
    );
    hasGraph = parseInt(countResult.rows[0].count, 10) > 0;
  } catch {
    // Table may not exist yet
  }

  if (!hasGraph) {
    return {
      result: { nodes: [], edges: [], contextText: "" },
      latencyMs: Date.now() - start,
    };
  }

  // 1. Semantic node discovery via pgvector
  const queryEmbedding = await deps.llmProvider.llmEmbed({ input: query });
  const discoveredNodes: Array<{ node_id: string; name: string; node_type: string; description: string }> = [];

  if (queryEmbedding?.embeddings.length) {
    const vecStr = "[" + queryEmbedding.embeddings[0].join(",") + "]";
    const semanticNodes = await deps.queryFn(
      `SELECT node_id, name, node_type, description,
              1 - (description_embedding <=> $1::vector) as similarity
       FROM graph_node
       WHERE workspace_id = $2 AND description_embedding IS NOT NULL
       ORDER BY description_embedding <=> $1::vector
       LIMIT 10`,
      [vecStr, workspaceId]
    );
    for (const n of semanticNodes.rows) {
      if (n.similarity > 0.5) {
        discoveredNodes.push(n);
      }
    }
  }

  // 2. Entity name matching via trigram
  for (const entity of entities) {
    const nameMatches = await deps.queryFn(
      `SELECT node_id, name, node_type, description
       FROM graph_node
       WHERE workspace_id = $1 AND similarity(normalized_name, $2) > 0.3
       ORDER BY similarity(normalized_name, $2) DESC
       LIMIT 5`,
      [workspaceId, entity.name.toLowerCase()]
    );
    for (const n of nameMatches.rows) {
      if (!discoveredNodes.find((d) => d.node_id === n.node_id)) {
        discoveredNodes.push(n);
      }
    }
  }

  if (discoveredNodes.length === 0) {
    return {
      result: { nodes: [], edges: [], contextText: "" },
      latencyMs: Date.now() - start,
    };
  }

  // 3. BFS graph expansion
  const nodeIds = new Set(discoveredNodes.map((n) => n.node_id));
  const allEdges: Array<{ source: string; target: string; edge_type: string }> = [];

  for (let hop = 0; hop < hops; hop++) {
    const currentIds = Array.from(nodeIds);
    const edgeResult = await deps.queryFn(
      `SELECT e.source_node_id as source, e.target_node_id as target, e.edge_type,
              n1.name as source_name, n2.name as target_name
       FROM graph_edge e
       JOIN graph_node n1 ON n1.node_id = e.source_node_id
       JOIN graph_node n2 ON n2.node_id = e.target_node_id
       WHERE e.workspace_id = $1 AND (e.source_node_id = ANY($2) OR e.target_node_id = ANY($2))
       LIMIT 50`,
      [workspaceId, currentIds]
    );

    for (const edge of edgeResult.rows) {
      allEdges.push({ source: edge.source, target: edge.target, edge_type: edge.edge_type });
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
  }

  // 4. Format as context text
  const contextParts: string[] = [];
  for (const node of discoveredNodes) {
    contextParts.push(`[${node.node_type}] ${node.name}: ${node.description || "No description"}`);
  }
  for (const edge of allEdges) {
    contextParts.push(`Relationship: ${edge.source} --[${edge.edge_type}]--> ${edge.target}`);
  }

  return {
    result: {
      nodes: discoveredNodes,
      edges: allEdges,
      contextText: contextParts.join("\n"),
    },
    latencyMs: Date.now() - start,
  };
}
