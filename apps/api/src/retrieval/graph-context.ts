/**
 * Graph-assisted retrieval — semantic KG node discovery + BFS expansion.
 * Returns empty results until Phase 3 populates the KG tables.
 */

import type { QueryFn, LlmProvider } from "@puda/api-core";
import { logWarn } from "@puda/api-core";

export interface GraphContextResult {
  nodes: Array<{ node_id: string; name: string; node_type: string; subtype?: string; description: string }>;
  edges: Array<{ source: string; target: string; edge_type: string; source_name: string; target_name: string }>;
  contextText: string;
  /** Chunk IDs associated with discovered graph nodes (for reranker boost) */
  chunkIds: Set<string>;
  /** Node IDs discovered during graph context lookup (FR-013/AC-05) */
  nodeIds: string[];
}

const GRAPH_CONTEXT_TIMEOUT_MS = 3000;

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
  } catch (err) {
    logWarn("Graph node table check failed", { workspaceId, error: err instanceof Error ? err.message : String(err) });
  }

  if (!hasGraph) {
    return {
      result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
      latencyMs: Date.now() - start,
    };
  }

  // 1. Semantic node discovery via pgvector
  const queryEmbedding = await deps.llmProvider.llmEmbed({ input: query });
  const discoveredNodes: Array<{ node_id: string; name: string; node_type: string; subtype?: string; description: string }> = [];

  if (queryEmbedding?.embeddings.length) {
    const vecStr = "[" + queryEmbedding.embeddings[0].join(",") + "]";
    const semanticNodes = await deps.queryFn(
      `SELECT node_id, name, node_type, subtype, description,
              1 - (description_embedding <=> $1::vector) as similarity
       FROM graph_node
       WHERE workspace_id = $2 AND description_embedding IS NOT NULL
       ORDER BY description_embedding <=> $1::vector
       LIMIT 10`,
      [vecStr, workspaceId]
    );
    for (const n of semanticNodes.rows) {
      if (n.similarity > 0.3) {
        discoveredNodes.push(n);
      }
    }
  }

  // 2. Entity name matching via trigram (batched to avoid N+1)
  if (entities.length > 0) {
    const entityNames = entities.map((e) => e.name.toLowerCase());
    const nameMatches = await deps.queryFn(
      `SELECT DISTINCT ON (node_id) node_id, name, node_type, subtype, description
       FROM graph_node, unnest($2::text[]) AS entity_name
       WHERE workspace_id = $1 AND similarity(normalized_name, entity_name) > 0.3
       ORDER BY node_id, similarity(normalized_name, entity_name) DESC
       LIMIT 25`,
      [workspaceId, entityNames]
    );
    for (const n of nameMatches.rows) {
      if (!discoveredNodes.find((d) => d.node_id === n.node_id)) {
        discoveredNodes.push(n);
      }
    }
  }

  if (discoveredNodes.length === 0) {
    return {
      result: { nodes: [], edges: [], contextText: "", chunkIds: new Set(), nodeIds: [] },
      latencyMs: Date.now() - start,
    };
  }

  // 3. BFS graph expansion
  const nodeIds = new Set(discoveredNodes.map((n) => n.node_id));
  const allEdges: Array<{ source: string; target: string; edge_type: string; source_name: string; target_name: string }> = [];

  for (let hop = 0; hop < hops; hop++) {
    const currentIds = Array.from(nodeIds);
    // FR-012: Filter edges with confidence < 0.55, only from ACTIVE documents
    const edgeResult = await deps.queryFn(
      `SELECT e.source_node_id as source, e.target_node_id as target, e.edge_type,
              n1.name as source_name, n2.name as target_name
       FROM graph_edge e
       JOIN graph_node n1 ON n1.node_id = e.source_node_id
       JOIN graph_node n2 ON n2.node_id = e.target_node_id
       LEFT JOIN document d ON d.document_id = e.document_id
       WHERE e.workspace_id = $1
         AND (e.source_node_id = ANY($2) OR e.target_node_id = ANY($2))
         AND e.weight >= 0.55
         AND (d.document_id IS NULL OR d.status = 'ACTIVE')
       LIMIT 50`,
      [workspaceId, currentIds]
    );

    for (const edge of edgeResult.rows) {
      allEdges.push({
        source: edge.source,
        target: edge.target,
        edge_type: edge.edge_type,
        source_name: edge.source_name,
        target_name: edge.target_name,
      });
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
  }

  // 4. Collect chunk IDs from graph edges for reranker boost
  const chunkIds = new Set<string>();
  if (nodeIds.size > 0) {
    try {
      const allNodeIds = Array.from(nodeIds);
      const chunkResult = await deps.queryFn(
        `SELECT DISTINCT evidence_chunk_id
         FROM graph_edge
         WHERE workspace_id = $1
           AND (source_node_id = ANY($2) OR target_node_id = ANY($2))
           AND evidence_chunk_id IS NOT NULL
         LIMIT 100`,
        [workspaceId, allNodeIds]
      );
      for (const row of chunkResult.rows) {
        chunkIds.add(row.evidence_chunk_id);
      }
    } catch (err) {
      logWarn("Graph chunk ID collection failed", { workspaceId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 5. Format as context text
  const contextParts: string[] = [];
  for (const node of discoveredNodes) {
    const typeLabel = node.subtype ? `${node.node_type}/${node.subtype}` : node.node_type;
    contextParts.push(`[${typeLabel}] ${node.name}: ${node.description || "No description"}`);
  }
  for (const edge of allEdges) {
    contextParts.push(`Relationship: ${edge.source_name} --[${edge.edge_type}]--> ${edge.target_name}`);
  }

  return {
    result: {
      nodes: discoveredNodes,
      edges: allEdges,
      contextText: contextParts.join("\n"),
      chunkIds,
      nodeIds: Array.from(nodeIds),
    },
    latencyMs: Date.now() - start,
  };
}
